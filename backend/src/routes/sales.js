const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { resolveProductUnit, generateReceiptNumber, money, applyBatchDelta } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');
const { recordAuditEvent } = require('../utils/auditLog');

const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

router.post('/', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  let requestHash = '';
  let idempotencyKey = '';
  try {
    const {
      customer_id, items, payment_method, amount_paid,
      discount_amount, notes, payment_status,
    } = req.body;
    const method = payment_method || 'cash';
    idempotencyKey = String(req.body.idempotency_key || '').trim();
    if (!['cash', 'mobile_money', 'bank', 'card', 'credit', 'other'].includes(method)) {
      return res.status(400).json({ success: false, message: 'Select a valid payment method' });
    }
    if (!idempotencyKey || idempotencyKey.length > 100) {
      return res.status(400).json({ success: false, message: 'A valid sale idempotency key is required' });
    }
    requestHash = crypto.createHash('sha256').update(JSON.stringify({
      customer_id: customer_id || null,
      items,
      payment_method: method,
      amount_paid: amount_paid ?? null,
      discount_amount: discount_amount ?? 0,
      reference: req.body.reference || null,
      external_reference: req.body.external_reference || null,
    })).digest('hex');
    const existingSale = await prisma.sales.findUnique({ where: { idempotency_key: idempotencyKey } });
    if (existingSale) {
      if (existingSale.request_hash !== requestHash) {
        return res.status(409).json({ success: false, message: 'Sale idempotency key was already used for a different request' });
      }
      const existingPayment = await prisma.sale_payments.findFirst({
        where: { sale_id: existingSale.id },
        orderBy: { created_at: 'asc' },
        select: { id: true },
      });
      return res.json({
        success: true,
        message: 'Sale already completed',
        data: {
          id: existingSale.id,
          payment_id: existingPayment?.id.toString() || null,
          receipt_number: existingSale.receipt_number,
          total_amount: existingSale.total_amount,
          amount_paid: existingSale.amount_paid,
          change_given: existingSale.change_given,
          payment_status: existingSale.payment_status,
        },
      });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    const sale = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const processedItems = [];
      for (const item of items) {
        const { product_id, quantity, unit_id, unit_price, discount = 0 } = item;
        const productId = Number(product_id);
        const unitId = Number(unit_id);
        const itemQuantity = Number(quantity);
        const itemDiscount = Number(discount);
        if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(unitId) || unitId < 1 ||
            !Number.isFinite(itemQuantity) || itemQuantity <= 0 || !Number.isFinite(itemDiscount) || itemDiscount < 0) {
          throw new Error('Each item must have product_id, quantity, unit_id and unit_price');
        }

        const unitDetails = await resolveProductUnit(tx, productId, unitId, 'sale');
        if (unitDetails.isConfigured && unitDetails.unitPrice == null) {
          throw new Error(`Set a selling price for ${unitDetails.product.name} (${unitDetails.unitName})`);
        }
        const configuredPrice = unitDetails.unitPrice == null ? Number(unit_price) : Number(unitDetails.unitPrice);
        if (!Number.isFinite(configuredPrice) || configuredPrice < 0) {
          throw new Error(`Set a valid selling price for ${unitDetails.product.name} (${unitDetails.unitName})`);
        }
        const quantityBase = Math.round(itemQuantity * unitDetails.conversionFactor * 1000) / 1000;
        const [stockRow] = await tx.$queryRaw`
          SELECT quantity FROM stock WHERE product_id = ${productId} FOR UPDATE
        `;
        if (!stockRow || Number(stockRow.quantity) < quantityBase) {
          throw new Error(`Insufficient stock for ${unitDetails.product.name}`);
        }
        const grossTotal = money(itemQuantity * configuredPrice);
        if (itemDiscount > grossTotal) throw new Error(`Discount exceeds the line total for ${unitDetails.product.name}`);
        const lineTotal = money(grossTotal - itemDiscount);
        subtotal = money(subtotal + lineTotal);
        processedItems.push({
          product_id: productId,
          product_name_snapshot: unitDetails.product.name,
          quantity: itemQuantity,
          unit_id: unitId,
          unit_name_snapshot: unitDetails.unitName,
          conversion_factor_snapshot: unitDetails.conversionFactor,
          quantity_base: quantityBase,
          unit_price: configuredPrice,
          discount: itemDiscount,
          total_price: lineTotal,
          cost_at_sale: unitDetails.product.cost_price || 0,
        });
      }

      const discountAmount = money(discount_amount || 0);
      if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
        throw new Error('Sale discount must be between zero and the subtotal');
      }
      const totalAmount = money(subtotal - discountAmount);
      const requestedAmount = method === 'credit'
        ? Number(amount_paid == null ? 0 : amount_paid)
        : Number(amount_paid == null ? totalAmount : amount_paid);
      if (!Number.isFinite(requestedAmount) || requestedAmount < 0 ||
          (method !== 'cash' && requestedAmount > totalAmount) ||
          (method === 'credit' && requestedAmount !== 0)) {
        throw new Error('Payment amount is invalid for the selected payment method');
      }
      const pendingExternalPayment = method === 'mobile_money';
      const paid = pendingExternalPayment ? 0 : money(Math.min(requestedAmount, totalAmount));
      const change = method === 'cash' ? money(Math.max(0, requestedAmount - totalAmount)) : 0;
      const remaining = money(totalAmount - paid);
      const isCredit = remaining > 0 && !pendingExternalPayment;
      const status = remaining === 0 ? 'paid' : method === 'credit' ? 'credit' : 'partial';
      if (payment_status && payment_status !== status) {
        throw new Error('Payment status is calculated from confirmed payments and cannot be overridden');
      }

      let customer = null;
      if (customer_id) {
        const customerId = Number(customer_id);
        if (!Number.isInteger(customerId) || customerId < 1) throw new Error('Invalid customer');
        const [lockedCustomer] = await tx.$queryRaw`
          SELECT id, credit_limit, is_active FROM customers WHERE id = ${customerId} FOR UPDATE
        `;
        if (!lockedCustomer || Number(lockedCustomer.is_active) !== 1) throw new Error('Active customer not found');
        customer = lockedCustomer;
      }
      if (isCredit) {
        if (!customer_id) throw new Error('A customer is required for an unpaid or credit sale');
        if (!['admin', 'manager'].includes(req.user.role)) {
          throw new Error('Only a manager can approve customer credit');
        }
        const [debt] = await tx.$queryRaw`
          SELECT COALESCE(SUM(remaining_amount), 0) AS outstanding
          FROM customer_debts
          WHERE customer_id = ${Number(customer_id)} AND status IN ('open', 'partial')
        `;
        if (Number(debt.outstanding) + remaining > Number(customer.credit_limit || 0) + 0.005) {
          throw new Error('Sale would exceed the customer credit limit');
        }
      }
      const receiptNumber = await generateReceiptNumber(tx);
      const created = await tx.sales.create({
        data: {
          receipt_number: receiptNumber,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          customer_id: customer_id ? Number(customer_id) : null,
          status: 'completed',
          subtotal,
          discount_amount: discountAmount,
          total_amount: totalAmount,
          amount_paid: paid,
          change_given: change,
          payment_method: method,
          payment_status: status,
          notes: notes || null,
          created_by: req.user.id,
        },
        select: { id: true },
      });
      await recordAuditEvent(tx, req, {
        action: 'sale_completed',
        entityType: 'sale',
        entityId: created.id,
        after: { receipt_number: receiptNumber, total_amount: totalAmount, payment_status: status },
      });
      let initialPaymentId = null;

      for (const item of processedItems) {
        await tx.sale_items.create({
          data: { sale_id: created.id, ...item },
        });
        await tx.stock.update({
          where: { product_id: item.product_id },
          data: { quantity: { decrement: item.quantity_base } },
        });
        await applyBatchDelta(tx, {
          productId: item.product_id,
          quantity: -item.quantity_base,
          unitCostBase: item.cost_at_sale,
        });
        await tx.stock_movements.create({
          data: {
            product_id: item.product_id,
            movement_type: 'sale',
            quantity: -item.quantity_base,
            reference_type: 'sale',
            reference_id: created.id,
            unit_cost: item.cost_at_sale,
            created_by: req.user.id,
          },
        });
      }
      if (requestedAmount > 0) {
        const payment = await tx.sale_payments.create({
          data: {
            sale_id: created.id,
            payment_method: method === 'mobile_money' ? 'mobile_money' : method,
            amount: pendingExternalPayment ? money(requestedAmount) : paid,
            status: pendingExternalPayment ? 'pending' : 'confirmed',
            reference: req.body.reference || null,
            external_reference: req.body.external_reference || null,
            created_by: req.user.id,
            confirmed_by: pendingExternalPayment ? null : req.user.id,
            confirmed_at: pendingExternalPayment ? null : new Date(),
          },
        });
        initialPaymentId = payment.id;
        if (!pendingExternalPayment && method === 'cash' && paid > 0) {
          await recordCashMovement(tx, {
            userId: req.user.id,
            movementType: 'sale',
            amount: paid,
            referenceType: 'sale_payment',
            referenceId: payment.id,
            notes: `Cash received for ${receiptNumber}`,
            idempotencyKey: `sale-payment:${payment.id}:cash`,
          });
        }
      }

      if (isCredit) {
        await tx.customer_debts.create({
          data: {
            customer_id: Number(customer_id),
            sale_id: created.id,
            original_amount: remaining,
            remaining_amount: remaining,
            status: remaining === totalAmount ? 'open' : 'partial',
          },
        });
      }
      return { id: created.id, payment_id: initialPaymentId?.toString() || null, receipt_number: receiptNumber, total_amount: totalAmount, amount_paid: paid, change_given: change, payment_status: status };
    });

    res.status(201).json({ success: true, message: 'Sale completed', data: sale });
  } catch (err) {
    console.error('Sale error:', err);
    if (err.code === 'P2002' && idempotencyKey) {
      const existing = await prisma.sales.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        return res.status(existing.request_hash === requestHash ? 200 : 409).json({
          success: existing.request_hash === requestHash,
          message: existing.request_hash === requestHash ? 'Sale already completed' : 'Sale idempotency key was already used for a different request',
          ...(existing.request_hash === requestHash ? { data: existing } : {}),
        });
      }
    }
    const status = err.code === 'P2002' ||
      ['Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
        'Cash movement idempotency key was already used for a different request'].includes(err.message) ? 409 : 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to process sale' });
  }
});

router.get('/payments/:paymentId/status', authenticate, async (req, res) => {
  if (!validId(req.params.paymentId)) return res.status(400).json({ success: false, message: 'Invalid payment ID' });
  try {
    const payment = await prisma.sale_payments.findUnique({ where: { id: BigInt(req.params.paymentId) } });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    const sale = await prisma.sales.findUnique({
      where: { id: payment.sale_id },
      select: { id: true, receipt_number: true, total_amount: true, amount_paid: true, payment_status: true },
    });
    res.json({
      success: true,
      data: {
        payment_id: payment.id.toString(),
        payment_status: payment.status,
        receipt_number: sale?.receipt_number || null,
        amount_paid: sale?.amount_paid || 0,
        balance_due: money(Number(sale?.total_amount || 0) - Number(sale?.amount_paid || 0)),
      },
    });
  } catch (err) {
    console.error('Sale payment status lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to check payment status' });
  }
});

router.post('/:id/payments', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid sale ID' });
  const amount = Number(req.body.amount);
  const method = String(req.body.payment_method || '');
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 ||
      !['cash', 'mobile_money', 'bank', 'card', 'other'].includes(method) ||
      !idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'Enter a positive amount, valid payment method, and idempotency key' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const saleId = BigInt(req.params.id);
      const [sale] = await tx.$queryRaw`
        SELECT id, status, total_amount, amount_paid FROM sales WHERE id = ${saleId} FOR UPDATE
      `;
      if (!sale || sale.status !== 'completed') throw new Error('Completed sale not found');
      const existing = await tx.sale_payments.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.sale_id !== saleId || Number(existing.amount) !== money(amount) || existing.payment_method !== method) {
          throw new Error('Payment idempotency key was already used for a different request');
        }
        return { ...existing, duplicate: true };
      }
      const due = money(Number(sale.total_amount) - Number(sale.amount_paid || 0));
      const pending = await tx.sale_payments.aggregate({
        where: { sale_id: saleId, status: 'pending' },
        _sum: { amount: true },
      });
      const available = money(due - Number(pending._sum.amount || 0));
      if (amount > available + 0.005) throw new Error('Payment exceeds the remaining sale balance');
      const isPending = method === 'mobile_money';
      const payment = await tx.sale_payments.create({
        data: {
          sale_id: saleId,
          payment_method: method,
          amount: money(amount),
          reference: req.body.reference || null,
          external_reference: req.body.reference || null,
          status: isPending ? 'pending' : 'confirmed',
          idempotency_key: idempotencyKey,
          created_by: req.user.id,
          confirmed_by: isPending ? null : req.user.id,
          confirmed_at: isPending ? null : new Date(),
        },
      });
      if (!isPending) {
        const newPaid = money(Number(sale.amount_paid || 0) + amount);
        await tx.sales.update({
          where: { id: saleId },
          data: { amount_paid: newPaid, payment_status: newPaid >= Number(sale.total_amount) ? 'paid' : 'partial' },
        });
        const [debt] = await tx.$queryRaw`
          SELECT id, remaining_amount FROM customer_debts
          WHERE sale_id = ${saleId} AND status IN ('open', 'partial')
          FOR UPDATE
        `;
        if (debt) {
          const remaining = money(Math.max(0, Number(debt.remaining_amount) - amount));
          await tx.customer_debts.update({
            where: { id: debt.id },
            data: { remaining_amount: remaining, status: remaining === 0 ? 'paid' : 'partial' },
          });
        }
        if (method === 'cash') {
          await recordCashMovement(tx, {
            userId: req.user.id,
            movementType: 'sale',
            amount,
            referenceType: 'sale_payment',
            referenceId: payment.id,
            notes: `Cash payment for sale ${saleId}`,
            idempotencyKey: `sale-payment:${payment.id}:cash`,
          });
        }
      }
      return payment;
    });
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      message: result.status === 'pending' ? 'Mobile Money payment pending confirmation' : 'Sale payment recorded',
      data: { ...result, id: result.id.toString() },
    });
  } catch (err) {
    const status = err.code === 'P2002' ? 409 :
      err.message === 'Completed sale not found' ? 404 :
        ['Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
          'Cash movement idempotency key was already used for a different request'].includes(err.message) ? 409 : 400;
    if (!['Completed sale not found', 'Payment exceeds the remaining sale balance',
      'Payment idempotency key was already used for a different request',
      'Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'].includes(err.message) && status === 400) {
      console.error('Sale payment creation failed:', err);
    }
    res.status(status).json({ success: false, message: err.message || 'Failed to record sale payment' });
  }
});

router.post('/payments/:paymentId/confirm', authenticate, authorize('admin', 'manager'), async (req, res) => {
  if (!validId(req.params.paymentId)) return res.status(400).json({ success: false, message: 'Invalid payment ID' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const paymentId = BigInt(req.params.paymentId);
      const [payment] = await tx.$queryRaw`
        SELECT id, sale_id, amount, status, payment_method FROM sale_payments WHERE id = ${paymentId} FOR UPDATE
      `;
      if (!payment) throw new Error('Payment not found');
      if (payment.status !== 'pending' || payment.payment_method !== 'mobile_money') {
        throw new Error('Only pending Mobile Money payments can be confirmed');
      }
      const [sale] = await tx.$queryRaw`
        SELECT id, status, total_amount, amount_paid FROM sales WHERE id = ${payment.sale_id} FOR UPDATE
      `;
      if (!sale || sale.status !== 'completed') throw new Error('Completed sale not found');
      const newPaid = money(Number(sale.amount_paid || 0) + Number(payment.amount));
      if (newPaid > Number(sale.total_amount) + 0.005) throw new Error('Payment exceeds the remaining sale balance');
      await tx.sale_payments.update({
        where: { id: paymentId },
        data: {
          status: 'confirmed',
          confirmed_by: req.user.id,
          confirmed_at: new Date(),
          ...(req.body.external_reference ? { external_reference: String(req.body.external_reference).slice(0, 100) } : {}),
        },
      });
      await tx.sales.update({
        where: { id: sale.id },
        data: { amount_paid: newPaid, payment_status: newPaid >= Number(sale.total_amount) ? 'paid' : 'partial' },
      });
      const [debt] = await tx.$queryRaw`
        SELECT id, remaining_amount FROM customer_debts
        WHERE sale_id = ${sale.id} AND status IN ('open', 'partial')
        FOR UPDATE
      `;
      if (debt) {
        const remaining = money(Math.max(0, Number(debt.remaining_amount) - Number(payment.amount)));
        await tx.customer_debts.update({
          where: { id: debt.id },
          data: { remaining_amount: remaining, status: remaining === 0 ? 'paid' : 'partial' },
        });
      }
      return { payment_id: paymentId.toString(), status: 'confirmed', amount_paid: newPaid };
    });
    res.json({ success: true, message: 'Mobile Money payment confirmed', data: result });
  } catch (err) {
    const status = err.message === 'Payment not found' || err.message === 'Completed sale not found' ? 404 :
      err.message === 'Payment exceeds the remaining sale balance' ? 409 : 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to confirm payment' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to, limit = 50 } = req.query;
    const dateFilter = {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
    const sales = await prisma.sales.findMany({
      where: {
        status: 'completed',
        ...(Object.keys(dateFilter).length ? { sale_date: dateFilter } : {}),
      },
      orderBy: { sale_date: 'desc' },
      take: parseInt(limit, 10),
    });
    const customerIds = [...new Set(sales.map(({ customer_id }) => customer_id).filter(Boolean))];
    const userIds = [...new Set(sales.map(({ created_by }) => created_by).filter(Boolean))];
    const [customers, users] = await Promise.all([
      prisma.customers.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }),
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
    ]);
    const customerNames = new Map(customers.map(({ id, name }) => [id, name]));
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    res.json({
      success: true,
      data: sales.map((sale) => ({
        ...sale,
        customer_name: customerNames.get(sale.customer_id) ?? null,
        cashier_name: userNames.get(sale.created_by) ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch sales' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const saleId = BigInt(req.params.id);
    const sale = await prisma.sales.findUnique({ where: { id: saleId } });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    const [customer, cashier, items, payments] = await Promise.all([
      sale.customer_id ? prisma.customers.findUnique({ where: { id: sale.customer_id }, select: { name: true } }) : null,
      sale.created_by ? prisma.users.findUnique({ where: { id: sale.created_by }, select: { full_name: true } }) : null,
      prisma.sale_items.findMany({ where: { sale_id: saleId } }),
      prisma.sale_payments.findMany({ where: { sale_id: saleId }, orderBy: { created_at: 'asc' } }),
    ]);
    const productIds = [...new Set(items.map(({ product_id }) => product_id))];
    const unitIds = [...new Set(items.map(({ unit_id }) => unit_id))];
    const [products, units] = await Promise.all([
      prisma.products.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
      prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }),
    ]);
    const productNames = new Map(products.map(({ id, name }) => [id, name]));
    const unitNames = new Map(units.map(({ id, name }) => [id, name]));
    res.json({
      success: true,
      data: {
        ...sale,
        customer_name: customer?.name ?? null,
        cashier_name: cashier?.full_name ?? null,
        payments: payments.map((payment) => ({ ...payment, id: payment.id.toString() })),
        items: items.map((item) => ({
          ...item,
          product_name: item.product_name_snapshot || productNames.get(item.product_id),
          unit_name: item.unit_name_snapshot || unitNames.get(item.unit_id),
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
