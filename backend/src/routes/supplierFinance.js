const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');
const { recordAuditEvent } = require('../utils/auditLog');

const managers = ['admin', 'manager', 'stock_keeper'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

router.get('/:supplierId/payments', authenticate, async (req, res) => {
  if (!validId(req.params.supplierId)) return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
  try {
    const payments = await prisma.supplier_payments.findMany({
      where: { supplier_id: Number(req.params.supplierId) },
      orderBy: [{ payment_date: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    const paymentIds = payments.map(({ id }) => id);
    const allocations = await prisma.supplier_payment_allocations.findMany({
      where: { supplier_payment_id: { in: paymentIds } },
    });
    const purchaseIds = [...new Set(allocations.map(({ purchase_id }) => purchase_id))];
    const purchases = await prisma.purchases.findMany({
      where: { id: { in: purchaseIds } },
      select: { id: true, invoice_number: true },
    });
    const invoices = new Map(purchases.map(({ id, invoice_number }) => [id.toString(), invoice_number]));
    res.json({
      success: true,
      data: payments.map((payment) => ({
        ...payment,
        id: payment.id.toString(),
        allocations: allocations.filter((allocation) => allocation.supplier_payment_id === payment.id)
          .map((allocation) => ({
            ...allocation,
            purchase_id: allocation.purchase_id.toString(),
            invoice_number: invoices.get(allocation.purchase_id.toString()) || null,
          })),
      })),
    });
  } catch (err) {
    console.error('Supplier payments lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to load supplier payments' });
  }
});

router.post('/payments', authenticate, authorize(...managers), async (req, res) => {
  const supplierId = Number(req.body.supplier_id);
  const amount = Number(req.body.amount);
  const allocations = req.body.allocations || [];
  const paymentDate = req.body.payment_date;
  const methods = ['cash', 'mobile_money', 'bank', 'cheque', 'other'];
  if (!Number.isInteger(supplierId) || supplierId < 1 || !Number.isFinite(amount) || amount <= 0 ||
      !methods.includes(req.body.payment_method || 'cash') || !Array.isArray(allocations)) {
    return res.status(400).json({ success: false, message: 'Supplier, positive payment amount, valid method and allocations are required' });
  }
  if (typeof paymentDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
      Number.isNaN(new Date(`${paymentDate}T00:00:00.000Z`).getTime()) ||
      new Date(`${paymentDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== paymentDate) {
    return res.status(400).json({ success: false, message: 'A valid payment date is required' });
  }
  try {
    const payment = await prisma.$transaction(async (tx) => {
      const supplier = await tx.suppliers.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new Error('Supplier not found');
      const seen = new Set();
      const normalized = [];
      let totalAllocated = 0;
      for (const allocation of allocations) {
        if (!validId(allocation.purchase_id)) throw new Error('Invalid invoice in payment allocation');
        const key = String(allocation.purchase_id);
        if (seen.has(key)) throw new Error('Each invoice can only be allocated once per payment');
        seen.add(key);
        const allocationAmount = Number(allocation.amount);
        if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
          throw new Error('Each invoice allocation must be a positive amount');
        }
        const purchaseId = BigInt(key);
        const [locked] = await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
        if (!locked) throw new Error('An allocated purchase was not found');
        const purchase = await tx.purchases.findUnique({ where: { id: purchaseId } });
        if (Number(purchase.supplier_id) !== supplierId || purchase.status === 'cancelled') {
          throw new Error('Allocated invoices must belong to this supplier and cannot be cancelled');
        }
        const balance = Number(purchase.balance ?? (Number(purchase.total_amount || 0) - Number(purchase.amount_paid || 0)));
        if (allocationAmount > balance + 0.005) throw new Error('An allocation cannot exceed its invoice balance');
        totalAllocated = money(totalAllocated + allocationAmount);
        normalized.push({ purchaseId, amount: money(allocationAmount), purchase });
      }
      if (totalAllocated > amount + 0.005) throw new Error('Allocated amount cannot exceed the payment amount');
      const created = await tx.supplier_payments.create({
        data: {
          supplier_id: supplierId,
          purchase_id: normalized.length === 1 ? normalized[0].purchaseId : null,
          amount: money(amount),
          payment_method: req.body.payment_method || 'cash',
          payment_date: new Date(`${paymentDate}T00:00:00.000Z`),
          reference: req.body.reference || null,
          notes: req.body.notes || null,
          created_by: req.user.id,
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'supplier_payment_recorded',
        entityType: 'supplier_payment',
        entityId: created.id,
        reason: req.body.notes || null,
        after: { supplier_id: supplierId, amount: money(amount), payment_method: req.body.payment_method || 'cash' },
      });
      if ((req.body.payment_method || 'cash') === 'cash') {
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'supplier_payment',
          amount,
          referenceType: 'supplier_payment',
          referenceId: created.id,
          notes: `Supplier payment for supplier ${supplierId}`,
          idempotencyKey: `supplier-payment:${created.id}:cash`,
        });
      }
      for (const allocation of normalized) {
        await tx.supplier_payment_allocations.create({
          data: {
            supplier_payment_id: created.id,
            purchase_id: allocation.purchaseId,
            amount: allocation.amount,
          },
        });
        const paid = money(Number(allocation.purchase.amount_paid || 0) + allocation.amount);
        const balance = money(Math.max(0, Number(allocation.purchase.total_amount || 0) - paid));
        await tx.purchases.update({
          where: { id: allocation.purchaseId },
          data: {
            amount_paid: paid,
            balance,
            payment_status: balance <= 0 ? 'paid' : 'partial',
          },
        });
      }
      return created;
    });
    res.status(201).json({
      success: true,
      message: 'Supplier payment recorded',
      data: { ...payment, id: payment.id.toString() },
    });
  } catch (err) {
    if (!['Open a cashier shift before recording a cash transaction',
      'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'].includes(err.message)) {
      console.error('Supplier payment error:', err);
    }
    res.status(err.message === 'Supplier not found' ? 404 :
      ['Open a cashier shift before recording a cash transaction',
        'Cash movement exceeds the available drawer balance',
        'Cash movement idempotency key was already used for a different request'].includes(err.message) ? 409 : 400)
      .json({ success: false, message: err.message || 'Failed to record supplier payment' });
  }
});

router.get('/:supplierId/statement', authenticate, async (req, res) => {
  if (!validId(req.params.supplierId)) return res.status(400).json({ success: false, message: 'Invalid supplier ID' });
  const supplierId = Number(req.params.supplierId);
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return res.status(400).json({ success: false, message: 'Invalid statement date range' });
  }
  try {
    const [purchases, payments, returns, supplier] = await Promise.all([
      prisma.purchases.findMany({ where: { supplier_id: supplierId }, orderBy: { purchase_date: 'asc' } }),
      prisma.supplier_payments.findMany({ where: { supplier_id: supplierId }, orderBy: { payment_date: 'asc' } }),
      prisma.supplier_returns.findMany({ where: { supplier_id: supplierId }, orderBy: { created_at: 'asc' } }),
      prisma.suppliers.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }),
    ]);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    const events = [
      ...purchases.filter((purchase) => purchase.status !== 'cancelled').map((purchase) => ({
        date: purchase.purchase_date,
        type: 'purchase',
        reference: purchase.invoice_number || `Purchase ${purchase.id}`,
        debit: Number(purchase.total_amount || 0),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        date: payment.payment_date,
        type: 'payment',
        reference: payment.reference || `Payment ${payment.id}`,
        debit: 0,
        credit: Number(payment.amount),
      })),
      ...returns.map((item) => ({
        date: item.created_at,
        type: 'supplier_return',
        reference: item.credit_note,
        debit: 0,
        credit: Number(item.amount),
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));
    const openingBalance = events
      .filter((event) => from && new Date(event.date) < from)
      .reduce((balance, event) => balance + event.debit - event.credit, 0);
    const selected = events.filter((event) =>
      (!from || new Date(event.date) >= from) && (!to || new Date(event.date) <= to)
    );
    let runningBalance = openingBalance;
    const rows = selected.map((event) => {
      runningBalance = money(runningBalance + event.debit - event.credit);
      return { ...event, balance: runningBalance };
    });
    res.json({
      success: true,
      data: {
        supplier,
        opening_balance: money(openingBalance),
        closing_balance: money(runningBalance),
        credit_balance: money(Math.max(0, -runningBalance)),
        entries: rows,
      },
    });
  } catch (err) {
    console.error('Supplier statement error:', err);
    res.status(500).json({ success: false, message: 'Failed to build supplier statement' });
  }
});

router.post('/returns', authenticate, authorize(...managers), async (req, res) => {
  const { purchase_id, items, reason, settlement_type, notes } = req.body;
  if (!validId(purchase_id) || !Array.isArray(items) || items.length === 0 ||
      typeof reason !== 'string' || !reason.trim() || !['credit', 'refund'].includes(settlement_type)) {
    return res.status(400).json({ success: false, message: 'Purchase, return reason, settlement type and items are required' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const purchaseId = BigInt(purchase_id);
      const [locked] = await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
      if (!locked) throw new Error('Purchase not found');
      const purchase = await tx.purchases.findUnique({ where: { id: purchaseId } });
      if (!purchase || !purchase.supplier_id || purchase.status === 'cancelled') {
        throw new Error('Select a valid purchase with a supplier');
      }
      const purchaseItems = await tx.purchase_items.findMany({ where: { purchase_id: purchaseId } });
      const itemById = new Map(purchaseItems.map((item) => [item.id.toString(), item]));
      const existingReturns = await tx.supplier_return_items.findMany({
        where: { purchase_item_id: { in: purchaseItems.map(({ id }) => id) } },
      });
      const alreadyReturned = new Map();
      for (const returned of existingReturns) {
        const key = returned.purchase_item_id.toString();
        alreadyReturned.set(key, (alreadyReturned.get(key) || 0) + Number(returned.quantity_base));
      }
      const normalized = [];
      let total = 0;
      const seen = new Set();
      for (const item of items) {
        if (!validId(item.purchase_item_id)) throw new Error('Invalid purchase line selected for return');
        const key = String(item.purchase_item_id);
        if (seen.has(key)) throw new Error('Each purchase line can only appear once per return');
        seen.add(key);
        const original = itemById.get(key);
        const quantity = Number(item.quantity);
        if (!original || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Return quantities must be positive');
        const factor = Number(original.conversion_factor_snapshot) || Number(original.quantity_base) / Number(original.quantity);
        const quantityBase = Math.round(quantity * factor * 1000) / 1000;
        const availableReturnBase = Number(original.quantity_base) - (alreadyReturned.get(key) || 0);
        if (quantityBase > availableReturnBase + 0.0005) throw new Error('Return quantity exceeds the amount purchased');
        const [stock] = await tx.$queryRaw`SELECT quantity FROM stock WHERE product_id = ${original.product_id} FOR UPDATE`;
        if (!stock || Number(stock.quantity) < quantityBase) {
          throw new Error(`Not enough current stock to return ${original.product_name_snapshot || 'this product'}`);
        }
        const lineTotal = money(quantity * Number(original.unit_cost));
        total = money(total + lineTotal);
        normalized.push({ original, quantity, quantityBase, factor, lineTotal });
      }
      const creditNote = `SR-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const returned = await tx.supplier_returns.create({
        data: {
          credit_note: creditNote,
          supplier_id: purchase.supplier_id,
          purchase_id: purchaseId,
          reason: reason.trim(),
          settlement_type,
          amount: total,
          notes: notes || null,
          created_by: req.user.id,
        },
      });
      for (const line of normalized) {
        const original = line.original;
        await tx.supplier_return_items.create({
          data: {
            supplier_return_id: returned.id,
            purchase_item_id: original.id,
            product_id: original.product_id,
            product_name_snapshot: original.product_name_snapshot || `Product ${original.product_id}`,
            quantity: line.quantity,
            unit_id: original.unit_id,
            unit_name_snapshot: original.unit_name_snapshot || 'unit',
            conversion_factor_snapshot: line.factor,
            quantity_base: line.quantityBase,
            unit_cost: original.unit_cost,
            total_cost: line.lineTotal,
          },
        });
        await tx.stock.update({
          where: { product_id: original.product_id },
          data: { quantity: { decrement: line.quantityBase } },
        });
        await tx.stock_movements.create({
          data: {
            product_id: original.product_id,
            movement_type: 'return',
            quantity: -line.quantityBase,
            reference_type: 'supplier_return',
            reference_id: returned.id,
            unit_cost: original.unit_cost,
            adjustment_reason: reason.trim().slice(0, 50),
            notes: `Supplier return ${creditNote}`,
            created_by: req.user.id,
          },
        });
        let remainingToRemove = line.quantityBase;
        const batches = await tx.stock_batches.findMany({
          where: { product_id: original.product_id, remaining_quantity: { gt: 0 } },
          orderBy: [{ expires_at: 'asc' }, { created_at: 'asc' }],
        });
        for (const batch of batches) {
          if (remainingToRemove <= 0) break;
          const removed = Math.min(remainingToRemove, Number(batch.remaining_quantity));
          await tx.stock_batches.update({
            where: { id: batch.id },
            data: { remaining_quantity: { decrement: removed } },
          });
          remainingToRemove = Math.round((remainingToRemove - removed) * 1000) / 1000;
        }
      }
      return { id: returned.id.toString(), credit_note: creditNote, amount: total };
    });
    res.status(201).json({ success: true, message: 'Supplier return recorded', data: result });
  } catch (err) {
    console.error('Supplier return error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to record supplier return' });
  }
});

module.exports = router;
