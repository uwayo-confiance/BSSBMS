const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money } = require('../utils/helpers');

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

    const existing = await prisma.customers.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Customer not found' });
    await prisma.customers.update({
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
    res.json({ success: true, message: 'Customer updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update customer' });
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
    const { amount, payment_method, notes, debt_id } = req.body;
    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.customer_payments.create({
        data: {
          customer_id: customerId,
          debt_id: debt_id ? BigInt(debt_id) : null,
          amount,
          payment_method: payment_method || 'cash',
          payment_date: new Date(new Date().toISOString().slice(0, 10)),
          notes: notes || null,
          created_by: req.user.id,
        },
      });

      let remaining = money(amount);
      if (debt_id) {
        const debtId = BigInt(debt_id);
        const [debt] = await tx.$queryRaw`
          SELECT id, remaining_amount
          FROM customer_debts
          WHERE id = ${debtId} AND customer_id = ${customerId}
          FOR UPDATE
        `;
        if (debt) {
          const newRemaining = money(Math.max(0, Number(debt.remaining_amount) - remaining));
          await tx.customer_debts.update({
            where: { id: debtId },
            data: { remaining_amount: newRemaining, status: newRemaining === 0 ? 'paid' : 'partial' },
          });
        }
      } else {
        const openDebts = await tx.$queryRaw`
          SELECT id, remaining_amount
          FROM customer_debts
          WHERE customer_id = ${customerId} AND status IN ('open', 'partial')
          ORDER BY created_at ASC
          FOR UPDATE
        `;
        for (const debt of openDebts) {
          if (remaining <= 0) break;
          const applied = money(Math.min(remaining, Number(debt.remaining_amount)));
          const newRemaining = money(Number(debt.remaining_amount) - applied);
          await tx.customer_debts.update({
            where: { id: debt.id },
            data: { remaining_amount: newRemaining, status: newRemaining === 0 ? 'paid' : 'partial' },
          });
          remaining = money(remaining - applied);
        }
      }
    });
    res.json({ success: true, message: 'Payment recorded' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to record payment' });
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
