const express = require('express');
const router = express.Router();
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');
const { recordAuditEvent } = require('../utils/auditLog');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, active } = req.query;
    const isActive = active === 'true' || active === '1' ? 1
      : active === 'false' || active === '0' ? 0
        : active === 'all' ? undefined : 1;
    const customers = await prisma.customers.findMany({
      where: {
        ...(isActive !== undefined ? { is_active: isActive } : {}),
        ...(search ? {
          OR: [
            { name: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
            { address: { contains: search } },
          ],
        } : {}),
      },
      orderBy: { name: 'asc' },
    });
    const debts = await prisma.customer_debts.groupBy({
      by: ['customer_id'],
      where: { customer_id: { in: customers.map(({ id }) => id) }, status: { in: ['open', 'partial'] } },
      _sum: { remaining_amount: true },
    });
    const debtTotals = new Map(debts.map(({ customer_id, _sum }) => [customer_id, _sum.remaining_amount ?? 0]));
    res.json({
      success: true,
      data: customers.map((customer) => ({ ...customer, total_debt: debtTotals.get(customer.id) || 0 })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { name, phone, email, address, credit_limit, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const customer = await prisma.customers.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        credit_limit: credit_limit || 0,
        notes: notes || null,
      },
      select: { id: true },
    });
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create customer' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { name, phone, email, address, credit_limit, is_active } = req.body;
    const customerId = Number(req.params.id);
    const parsedCreditLimit = Number(credit_limit);
    const adjustsDebt = Object.hasOwn(req.body, 'outstanding_debt');
    const targetDebt = Number(req.body.outstanding_debt);
    const debtAdjustmentReason = typeof req.body.debt_adjustment_reason === 'string'
      ? req.body.debt_adjustment_reason.trim() : '';
    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!Number.isFinite(parsedCreditLimit) || parsedCreditLimit < 0) {
      return res.status(400).json({ success: false, message: 'Credit limit must be a non-negative number' });
    }
    if (is_active !== 0 && is_active !== 1 && is_active !== false && is_active !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }
    if (adjustsDebt && (!Number.isFinite(targetDebt) || targetDebt < 0)) {
      return res.status(400).json({ success: false, message: 'Outstanding debt must be a non-negative amount' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [existing] = await tx.$queryRaw`
        SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE
      `;
      if (!existing) throw new Error('Customer not found');

      await tx.customers.update({
        where: { id: customerId },
        data: {
          name: name.trim(),
          phone: phone?.trim() || null,
          email: email?.trim() || null,
          address: address?.trim() || null,
          credit_limit: parsedCreditLimit,
          is_active: Number(is_active),
        },
      });

      if (!adjustsDebt) return { debtAdjusted: false };

      const debts = await tx.$queryRaw`
        SELECT id, remaining_amount
        FROM customer_debts
        WHERE customer_id = ${customerId} AND status IN ('open', 'partial')
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
      `;
      const previousBalance = money(debts.reduce((sum, debt) => sum + Number(debt.remaining_amount), 0));
      const newBalance = money(targetDebt);
      const adjustmentAmount = money(newBalance - previousBalance);

      if (adjustmentAmount !== 0) {
        if (!['admin', 'manager'].includes(req.user.role)) {
          throw new Error('Only managers can adjust customer debt');
        }
        if (!debtAdjustmentReason) throw new Error('A reason is required to adjust customer debt');

        if (adjustmentAmount > 0) {
          await tx.customer_debts.create({
            data: {
              customer_id: customerId,
              original_amount: adjustmentAmount,
              remaining_amount: adjustmentAmount,
              status: 'open',
              notes: `Balance adjustment: ${debtAdjustmentReason}`,
            },
          });
        } else {
          const debtIds = debts.map(({ id }) => id);
          const reservedRows = debtIds.length ? await tx.$queryRaw`
            SELECT a.debt_id, SUM(a.amount) AS reserved
            FROM customer_payment_allocations a
            JOIN customer_payments p ON p.id = a.customer_payment_id
            WHERE p.status = 'pending' AND a.debt_id IN (${Prisma.join(debtIds)})
            GROUP BY a.debt_id
          ` : [];
          const reserved = new Map(reservedRows.map((row) => [row.debt_id.toString(), Number(row.reserved)]));
          let reductionLeft = -adjustmentAmount;

          for (const debt of debts) {
            if (reductionLeft <= 0) break;
            const currentAmount = money(Number(debt.remaining_amount));
            const available = money(currentAmount - (reserved.get(debt.id.toString()) || 0));
            const reduction = money(Math.min(reductionLeft, available));
            if (reduction <= 0) continue;
            const remaining = money(currentAmount - reduction);
            await tx.customer_debts.update({
              where: { id: debt.id },
              data: { remaining_amount: remaining, status: remaining === 0 ? 'paid' : 'partial' },
            });
            reductionLeft = money(reductionLeft - reduction);
          }

          if (reductionLeft > 0) {
            throw new Error('Debt cannot be reduced below pending repayment allocations');
          }
        }

        await recordAuditEvent(tx, req, {
          action: 'customer_debt_adjusted',
          entityType: 'customer',
          entityId: customerId,
          reason: debtAdjustmentReason,
          before: { outstanding_debt: previousBalance },
          after: { outstanding_debt: newBalance, adjustment: adjustmentAmount },
        });
      }

      return { debtAdjusted: adjustmentAmount !== 0 };
    });
    res.json({
      success: true,
      message: result.debtAdjusted ? 'Customer and outstanding debt updated' : 'Customer updated',
    });
  } catch (err) {
    const known = ['Customer not found', 'Only managers can adjust customer debt',
      'A reason is required to adjust customer debt', 'Debt cannot be reduced below pending repayment allocations'];
    const status = err.message === 'Customer not found' ? 404
      : err.message === 'Only managers can adjust customer debt' ? 403
        : known.includes(err.message) ? 400 : 500;
    if (status === 500) console.error('Customer update failed:', err);
    res.status(status).json({
      success: false,
      message: status === 500 ? 'Failed to update customer' : err.message,
    });
  }
});

router.patch('/:id/status', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const { is_active: isActive } = req.body;
    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (isActive !== 0 && isActive !== 1 && isActive !== false && isActive !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const existing = await prisma.customers.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Customer not found' });
    await prisma.customers.update({
      where: { id: customerId },
      data: { is_active: Number(isActive) },
    });
    res.json({ success: true, message: Number(isActive) ? 'Customer restored' : 'Customer deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update customer status' });
  }
});

router.post('/:id/payments', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const amount = Number(req.body.amount);
    const paymentMethod = String(req.body.payment_method || 'cash');
    const idempotencyKey = String(req.body.idempotency_key || '').trim();
    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || !['cash', 'mobile_money', 'bank', 'cheque', 'other'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Enter a positive amount and valid payment method' });
    }
    if (!idempotencyKey || idempotencyKey.length > 100) {
      return res.status(400).json({ success: false, message: 'A valid payment idempotency key is required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.customer_payments.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.customer_id !== customerId || Number(existing.amount) !== money(amount) ||
            existing.payment_method !== paymentMethod) {
          throw new Error('Payment idempotency key was already used for a different request');
        }
        return { ...existing, duplicate: true };
      }

      const [customer] = await tx.$queryRaw`
        SELECT id, is_active FROM customers WHERE id = ${customerId} FOR UPDATE
      `;
      if (!customer || Number(customer.is_active) !== 1) throw new Error('Active customer not found');
      const debts = await tx.$queryRaw`
        SELECT id, remaining_amount
        FROM customer_debts
        WHERE customer_id = ${customerId} AND status IN ('open', 'partial')
        ORDER BY created_at ASC
        FOR UPDATE
      `;
      if (!debts.length) throw new Error('Customer has no outstanding debt');
      const debtIds = debts.map(({ id }) => id);
      const reservedRows = await tx.$queryRaw`
        SELECT a.debt_id, SUM(a.amount) AS reserved
        FROM customer_payment_allocations a
        JOIN customer_payments p ON p.id = a.customer_payment_id
        WHERE p.status = 'pending' AND a.debt_id IN (${Prisma.join(debtIds)})
        GROUP BY a.debt_id
      `;
      const reserved = new Map(reservedRows.map((row) => [row.debt_id.toString(), Number(row.reserved)]));
      const requested = Array.isArray(req.body.allocations) ? req.body.allocations
        : req.body.debt_id ? [{ debt_id: req.body.debt_id, amount }] : [];
      const allocations = [];
      if (requested.length) {
        const seen = new Set();
        for (const item of requested) {
          if (!/^\d+$/.test(String(item.debt_id)) || BigInt(item.debt_id) <= 0n) {
            throw new Error('Invalid debt in repayment allocation');
          }
          const debtId = BigInt(item.debt_id);
          const debt = debts.find((entry) => entry.id === debtId);
          const allocationAmount = Number(item.amount);
          if (!debt || !Number.isFinite(allocationAmount) || allocationAmount <= 0 ||
              seen.has(debtId.toString())) {
            throw new Error('Repayment allocations must reference distinct open debts and positive amounts');
          }
          seen.add(debtId.toString());
          const available = money(Number(debt.remaining_amount) - (reserved.get(debtId.toString()) || 0));
          if (allocationAmount > available + 0.005) throw new Error('Repayment allocation exceeds outstanding debt');
          allocations.push({ debtId, amount: money(allocationAmount) });
        }
        if (money(allocations.reduce((sum, item) => sum + item.amount, 0)) !== money(amount)) {
          throw new Error('Repayment allocations must equal the payment amount');
        }
      } else {
        let remaining = money(amount);
        for (const debt of debts) {
          if (remaining <= 0) break;
          const available = money(Number(debt.remaining_amount) - (reserved.get(debt.id.toString()) || 0));
          if (available <= 0) continue;
          const applied = money(Math.min(remaining, available));
          allocations.push({ debtId: debt.id, amount: applied });
          remaining = money(remaining - applied);
        }
        if (remaining > 0) throw new Error('Repayment exceeds the customer’s available outstanding debt');
      }

      const pending = paymentMethod === 'mobile_money';
      const created = await tx.customer_payments.create({
        data: {
          customer_id: customerId,
          debt_id: allocations.length === 1 ? allocations[0].debtId : null,
          amount: money(amount),
          payment_method: paymentMethod,
          status: pending ? 'pending' : 'confirmed',
          payment_date: new Date(new Date().toISOString().slice(0, 10)),
          reference: req.body.reference || null,
          external_reference: req.body.external_reference || null,
          idempotency_key: idempotencyKey,
          notes: req.body.notes || null,
          created_by: req.user.id,
          confirmed_by: pending ? null : req.user.id,
          confirmed_at: pending ? null : new Date(),
        },
      });
      await recordAuditEvent(tx, req, {
        action: pending ? 'customer_repayment_pending' : 'customer_repayment_recorded',
        entityType: 'customer_payment',
        entityId: created.id,
        reason: req.body.notes || null,
        after: { customer_id: customerId, amount: money(amount), method: paymentMethod, status: created.status },
      });
      for (const allocation of allocations) {
        await tx.customer_payment_allocations.create({
          data: {
            customer_payment_id: created.id,
            debt_id: allocation.debtId,
            amount: allocation.amount,
          },
        });
        if (!pending) {
          const debt = debts.find((entry) => entry.id === allocation.debtId);
          const remaining = money(Number(debt.remaining_amount) - allocation.amount);
          await tx.customer_debts.update({
            where: { id: allocation.debtId },
            data: { remaining_amount: remaining, status: remaining === 0 ? 'paid' : 'partial' },
          });
        }
      }
      if (!pending && paymentMethod === 'cash') {
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'customer_payment',
          amount,
          referenceType: 'customer_payment',
          referenceId: created.id,
          notes: `Customer repayment #${created.id}`,
          idempotencyKey: `customer-payment:${created.id}:cash`,
        });
      }
      return created;
    });
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      message: result.status === 'pending' ? 'Mobile Money repayment pending confirmation' : 'Customer repayment recorded',
      data: { ...result, id: result.id.toString() },
    });
  } catch (err) {
    const known = ['Payment idempotency key was already used for a different request', 'Active customer not found',
      'Customer has no outstanding debt', 'Invalid debt in repayment allocation',
      'Repayment allocations must reference distinct open debts and positive amounts',
      'Repayment allocation exceeds outstanding debt', 'Repayment allocations must equal the payment amount',
      'Repayment exceeds the customer’s available outstanding debt',
      'Open a cashier shift before recording a cash transaction',
      'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'];
    const status = err.code === 'P2002' || err.message === 'Payment idempotency key was already used for a different request' ? 409 :
      err.message === 'Active customer not found' ? 404 :
        ['Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
          'Cash movement idempotency key was already used for a different request'].includes(err.message) ? 409 : known.includes(err.message) ? 400 : 500;
    if (!known.includes(err.message) && status === 500) console.error('Customer repayment failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to record customer repayment' : err.message });
  }
});

router.post('/payments/:paymentId/confirm', authenticate, authorize('admin', 'manager'), async (req, res) => {
  if (!/^\d+$/.test(String(req.params.paymentId)) || BigInt(req.params.paymentId) <= 0n) {
    return res.status(400).json({ success: false, message: 'Invalid repayment ID' });
  }
  try {
    const paymentId = BigInt(req.params.paymentId);
    const result = await prisma.$transaction(async (tx) => {
      const [payment] = await tx.$queryRaw`
        SELECT id, status FROM customer_payments WHERE id = ${paymentId} FOR UPDATE
      `;
      if (!payment) throw new Error('Repayment not found');
      if (payment.status !== 'pending') throw new Error('Only pending Mobile Money repayments can be confirmed');
      const allocations = await tx.customer_payment_allocations.findMany({
        where: { customer_payment_id: paymentId },
      });
      if (!allocations.length) throw new Error('Repayment has no debt allocations');
      const debtIds = allocations.map(({ debt_id }) => debt_id);
      const debts = await tx.$queryRaw`
        SELECT id, remaining_amount
        FROM customer_debts
        WHERE id IN (${Prisma.join(debtIds)})
        FOR UPDATE
      `;
      for (const allocation of allocations) {
        const debt = debts.find((entry) => entry.id === allocation.debt_id);
        if (!debt || Number(allocation.amount) > Number(debt.remaining_amount) + 0.005) {
          throw new Error('Outstanding debt changed; repayment cannot be confirmed');
        }
      }
      for (const allocation of allocations) {
        const debt = debts.find((entry) => entry.id === allocation.debt_id);
        const remaining = money(Number(debt.remaining_amount) - Number(allocation.amount));
        await tx.customer_debts.update({
          where: { id: allocation.debt_id },
          data: { remaining_amount: remaining, status: remaining === 0 ? 'paid' : 'partial' },
        });
      }
      await tx.customer_payments.update({
        where: { id: paymentId },
        data: { status: 'confirmed', confirmed_by: req.user.id, confirmed_at: new Date() },
      });
      return { id: paymentId.toString(), status: 'confirmed' };
    });
    res.json({ success: true, message: 'Repayment confirmed', data: result });
  } catch (err) {
    const status = err.message === 'Repayment not found' ? 404 :
      err.message === 'Outstanding debt changed; repayment cannot be confirmed' ? 409 :
        ['Only pending Mobile Money repayments can be confirmed', 'Repayment has no debt allocations'].includes(err.message) ? 400 : 500;
    if (status === 500) console.error('Repayment confirmation failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to confirm repayment' : err.message });
  }
});

router.get('/:id/debts', authenticate, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const debts = await prisma.customer_debts.findMany({
      where: { customer_id: customerId },
      orderBy: { created_at: 'desc' },
    });
    const sales = await prisma.sales.findMany({
      where: { id: { in: debts.map(({ sale_id }) => sale_id).filter((id) => id !== null) } },
      select: { id: true, receipt_number: true },
    });
    const receipts = new Map(sales.map(({ id, receipt_number }) => [id, receipt_number]));
    res.json({
      success: true,
      data: debts.map((debt) => ({ ...debt, receipt_number: receipts.get(debt.sale_id) ?? null })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch debts' });
  }
});

module.exports = router;
