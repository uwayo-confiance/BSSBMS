const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { resolveProductUnit, money, applyBatchDelta } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');

const tableUsers = ['admin', 'manager', 'cashier', 'waiter'];
const managers = ['admin', 'manager'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

async function getTab(db, sessionIds) {
  const rounds = await db.table_order_rounds.findMany({
    where: { session_id: { in: sessionIds } },
    orderBy: [{ session_id: 'asc' }, { round_number: 'asc' }],
  });
  const roundIds = rounds.map(({ id }) => id);
  const [items, payments] = await Promise.all([
    db.table_order_items.findMany({ where: { round_id: { in: roundIds } }, orderBy: { id: 'asc' } }),
    db.table_payments.findMany({ where: { session_id: { in: sessionIds } }, orderBy: { paid_at: 'asc' } }),
  ]);
  const servedRoundIds = new Set(rounds.filter((round) => round.status === 'served').map(({ id }) => id.toString()));
  const servedItems = items.filter((item) => servedRoundIds.has(item.round_id.toString()));
  const total = money(servedItems.reduce((sum, item) => sum + Number(item.line_total), 0));
  const paid = money(payments
    .filter((payment) => payment.status === 'confirmed')
    .reduce((sum, payment) => sum + Number(payment.amount), 0));
  return {
    rounds: rounds.map((round) => ({
      ...round,
      id: round.id.toString(),
      items: items.filter((item) => item.round_id === round.id).map((item) => ({ ...item, id: item.id.toString() })),
    })),
    payments: payments.map((payment) => ({ ...payment, id: payment.id.toString() })),
    total,
    paid,
    balance: money(Math.max(0, total - paid)),
    pending_rounds: rounds.filter((round) => round.status === 'draft').length,
  };
}

async function buildLineItems(tx, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('At least one product is required');
  const lines = [];
  for (const item of items) {
    const productId = Number(item.product_id);
    const unitId = Number(item.unit_id);
    const quantity = Number(item.quantity);
    const discount = Number(item.discount || 0);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(unitId) || unitId < 1 ||
        !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(discount) || discount < 0) {
      throw new Error('Each order item needs a valid product, unit, quantity and discount');
    }
    const details = await resolveProductUnit(tx, productId, unitId, 'sale');
    const unitPrice = Number(details.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Set a valid selling price for ${details.product.name} (${details.unitName})`);
    }
    const gross = money(quantity * unitPrice);
    if (discount > gross) throw new Error(`Discount exceeds the line total for ${details.product.name}`);
    lines.push({
      product_id: productId,
      product_name_snapshot: details.product.name,
      quantity,
      unit_id: unitId,
      unit_name_snapshot: details.unitName,
      conversion_factor_snapshot: details.conversionFactor,
      quantity_base: Math.round(quantity * details.conversionFactor * 1000) / 1000,
      unit_price: unitPrice,
      discount,
      line_total: money(gross - discount),
      cost_at_order: Number(details.product.cost_price || 0),
    });
  }
  return lines;
}

router.get('/:sessionId', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Invalid table session ID' });
  try {
    const sessionId = BigInt(req.params.sessionId);
    const session = await prisma.table_sessions.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ success: false, message: 'Table session not found' });
    const children = await prisma.table_sessions.findMany({
      where: { merged_into_session_id: sessionId, status: 'merged' },
      select: { id: true },
    });
    const tab = await getTab(prisma, [sessionId, ...children.map(({ id }) => id)]);
    const [table, waiter] = await Promise.all([
      prisma.dining_tables.findUnique({ where: { id: session.dining_table_id } }),
      session.waiter_id ? prisma.users.findUnique({ where: { id: session.waiter_id }, select: { full_name: true } }) : null,
    ]);
    res.json({
      success: true,
      data: {
        ...session,
        id: session.id.toString(),
        table,
        waiter_name: waiter?.full_name || null,
        ...tab,
      },
    });
  } catch (err) {
    console.error('Table tab lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to load table tab' });
  }
});

router.post('/:sessionId/rounds', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Invalid table session ID' });
  try {
    const sessionId = BigInt(req.params.sessionId);
    const round = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw`SELECT id, status FROM table_sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!locked || locked.status !== 'open') throw new Error('Table session is not open');
      const items = await buildLineItems(tx, req.body.items);
      const last = await tx.table_order_rounds.findFirst({
        where: { session_id: sessionId },
        orderBy: { round_number: 'desc' },
        select: { round_number: true },
      });
      const created = await tx.table_order_rounds.create({
        data: {
          session_id: sessionId,
          round_number: (last?.round_number || 0) + 1,
          status: 'draft',
          notes: req.body.notes || null,
          created_by: req.user.id,
        },
      });
      for (const item of items) {
        if (item.discount > 0 && !managers.includes(req.user.role)) {
          throw new Error('Only a manager or administrator may discount table order items');
        }
        await tx.table_order_items.create({ data: { round_id: created.id, ...item } });
      }
      return created;
    });
    res.status(201).json({ success: true, message: 'Draft order round saved', data: { ...round, id: round.id.toString() } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Failed to save order round' });
  }
});

router.put('/rounds/:roundId', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.roundId)) return res.status(400).json({ success: false, message: 'Invalid order round ID' });
  try {
    const roundId = BigInt(req.params.roundId);
    await prisma.$transaction(async (tx) => {
      const round = await tx.table_order_rounds.findUnique({ where: { id: roundId } });
      if (!round || round.status !== 'draft') throw new Error('Only a draft order can be edited');
      const [session] = await tx.$queryRaw`SELECT id, status FROM table_sessions WHERE id = ${round.session_id} FOR UPDATE`;
      if (!session || session.status !== 'open') throw new Error('Table session is not open');
      const items = await buildLineItems(tx, req.body.items);
      if (items.some((item) => item.discount > 0) && !managers.includes(req.user.role)) {
        throw new Error('Only a manager or administrator may discount table order items');
      }
      await tx.table_order_items.deleteMany({ where: { round_id: roundId } });
      for (const item of items) await tx.table_order_items.create({ data: { round_id: roundId, ...item } });
      await tx.table_order_rounds.update({ where: { id: roundId }, data: { notes: req.body.notes || null } });
    });
    res.json({ success: true, message: 'Draft order updated' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'Failed to update order' });
  }
});

router.post('/rounds/:roundId/serve', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.roundId)) return res.status(400).json({ success: false, message: 'Invalid order round ID' });
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotency_key || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'A unique idempotency key between 8 and 100 characters is required' });
  }
  const roundId = BigInt(req.params.roundId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const previousRequest = await tx.table_serve_requests.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (previousRequest) {
        if (previousRequest.round_id !== roundId) throw new Error('Idempotency key was already used for another order');
        return { ...previousRequest.result, idempotent_replay: true };
      }
      const [lockedRound] = await tx.$queryRaw`SELECT id, session_id, status FROM table_order_rounds WHERE id = ${roundId} FOR UPDATE`;
      if (!lockedRound) throw new Error('Order round not found');
      const replay = await tx.table_serve_requests.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (replay) {
        if (replay.round_id !== roundId) throw new Error('Idempotency key was already used for another order');
        return { ...replay.result, idempotent_replay: true };
      }
      if (lockedRound.status !== 'draft') throw new Error('Only draft orders can be served');
      const [session] = await tx.$queryRaw`SELECT id, status FROM table_sessions WHERE id = ${lockedRound.session_id} FOR UPDATE`;
      if (!session || session.status !== 'open') throw new Error('Table session is not open');
      const round = await tx.table_order_rounds.findUnique({ where: { id: roundId } });
      const items = await tx.table_order_items.findMany({ where: { round_id: roundId } });
      if (!items.length) throw new Error('Order round has no products');
      const requiredByProduct = new Map();
      for (const item of items) {
        requiredByProduct.set(item.product_id, (requiredByProduct.get(item.product_id) || 0) + Number(item.quantity_base));
      }
      for (const [productId, required] of requiredByProduct) {
        const [stock] = await tx.$queryRaw`SELECT quantity FROM stock WHERE product_id = ${productId} FOR UPDATE`;
        if (!stock || Number(stock.quantity) + 0.0005 < required) {
          const product = await tx.products.findUnique({ where: { id: productId }, select: { name: true } });
          throw new Error(`Insufficient stock for ${product?.name || 'product'}`);
        }
      }
      for (const [productId, required] of requiredByProduct) {
        const product = await tx.products.findUnique({ where: { id: productId }, select: { cost_price: true } });
        await tx.stock.update({ where: { product_id: productId }, data: { quantity: { decrement: required } } });
        await applyBatchDelta(tx, { productId, quantity: -required, unitCostBase: Number(product?.cost_price || 0) });
        await tx.stock_movements.create({
          data: {
            product_id: productId,
            movement_type: 'sale',
            quantity: -required,
            reference_type: 'table_order',
            reference_id: roundId,
            unit_cost: product?.cost_price || 0,
            notes: `Served table round ${round.round_number}`,
            created_by: req.user.id,
          },
        });
      }
      const total = money(items.reduce((sum, item) => sum + Number(item.line_total), 0));
      await tx.table_order_rounds.update({
        where: { id: roundId },
        data: { status: 'served', served_by: req.user.id, served_at: new Date() },
      });
      const response = { round_id: roundId.toString(), session_id: round.session_id.toString(), served_total: total };
      await tx.table_serve_requests.create({
        data: {
          session_id: round.session_id,
          round_id: roundId,
          idempotency_key: idempotencyKey,
          result: response,
          created_by: req.user.id,
        },
      });
      return response;
    });
    res.json({ success: true, message: result.idempotent_replay ? 'Original serve result returned' : 'Order confirmed served', data: result });
  } catch (err) {
    console.error('Table serve error:', err);
    res.status(err.message === 'Order round not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to confirm serving' });
  }
});

router.patch('/rounds/:roundId/void', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.roundId) || typeof req.body.reason !== 'string' || !req.body.reason.trim()) {
    return res.status(400).json({ success: false, message: 'Order round and void reason are required' });
  }
  try {
    const roundId = BigInt(req.params.roundId);
    const updated = await prisma.table_order_rounds.updateMany({
      where: { id: roundId, status: 'draft' },
      data: { status: 'void', voided_by: req.user.id, void_reason: req.body.reason.trim() },
    });
    if (!updated.count) return res.status(400).json({ success: false, message: 'Only draft orders can be voided' });
    res.json({ success: true, message: 'Draft order voided without stock movement' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to void draft order' });
  }
});

router.post('/:sessionId/payments', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Invalid table session ID' });
  const amount = Number(req.body.amount);
  const method = String(req.body.payment_method || '');
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || !['cash', 'mobile_money', 'card', 'bank', 'other'].includes(method)) {
    return res.status(400).json({ success: false, message: 'Enter a positive payment amount and valid payment method' });
  }
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'A valid payment idempotency key is required' });
  }
  try {
    const payment = await prisma.$transaction(async (tx) => {
      const sessionId = BigInt(req.params.sessionId);
      const [locked] = await tx.$queryRaw`SELECT id, status FROM table_sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!locked || locked.status !== 'open') throw new Error('Open table session not found');
      const existing = await tx.table_payments.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.session_id !== sessionId || Number(existing.amount) !== money(amount) || existing.payment_method !== method) {
          throw new Error('Payment idempotency key was already used for a different request');
        }
        return existing;
      }
      const children = await tx.table_sessions.findMany({
        where: { merged_into_session_id: sessionId, status: 'merged' },
        select: { id: true },
      });
      const totals = await getTab(tx, [sessionId, ...children.map(({ id }) => id)]);
      const reserved = money(totals.payments.reduce((sum, item) => sum + Number(item.amount), 0));
      const unreservedBalance = money(Math.max(0, totals.total - reserved));
      if (amount > unreservedBalance + 0.005) throw new Error('Payment cannot exceed the outstanding table balance');
      const created = await tx.table_payments.create({
        data: {
          session_id: sessionId,
          amount: money(amount),
          payment_method: method,
          status: method === 'mobile_money' ? 'pending' : 'confirmed',
          reference: req.body.reference || null,
          external_reference: req.body.reference || null,
          idempotency_key: idempotencyKey,
          notes: req.body.notes || null,
          received_by: req.user.id,
          confirmed_by: method === 'mobile_money' ? null : req.user.id,
          confirmed_at: method === 'mobile_money' ? null : new Date(),
        },
      });
      if (method === 'cash') {
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'sale',
          amount,
          referenceType: 'table_payment',
          referenceId: created.id,
          notes: `Cash payment for table session ${sessionId}`,
          idempotencyKey: `table-payment:${created.id}:cash`,
        });
      }
      return created;
    });
    res.status(201).json({ success: true, message: 'Table payment recorded', data: { ...payment, id: payment.id.toString() } });
  } catch (err) {
    const known = ['Open table session not found', 'Payment cannot exceed the outstanding table balance',
      'Payment idempotency key was already used for a different request',
      'Open a cashier shift before recording a cash transaction',
      'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'];
    const status = err.code === 'P2002' ? 409 : err.message === 'Open table session not found' ? 404 :
      ['Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
        'Cash movement idempotency key was already used for a different request'].includes(err.message) ? 409 : 400;
    if (!known.includes(err.message) && status === 400) console.error('Table payment failed:', err);
    res.status(status).json({ success: false, message: err.message || 'Failed to record table payment' });
  }
});

router.post('/:sessionId/payments/:paymentId/confirm', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.sessionId) || !validId(req.params.paymentId)) {
    return res.status(400).json({ success: false, message: 'Invalid table session or payment ID' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessionId = BigInt(req.params.sessionId);
      const paymentId = BigInt(req.params.paymentId);
      const [session] = await tx.$queryRaw`SELECT id, status FROM table_sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!session) throw new Error('Table session not found');
      const [payment] = await tx.$queryRaw`
        SELECT id, session_id, amount, status FROM table_payments WHERE id = ${paymentId} FOR UPDATE
      `;
      if (!payment || payment.session_id !== sessionId) throw new Error('Table payment not found');
      if (payment.status !== 'pending') throw new Error('Only pending Mobile Money payments can be confirmed');
      const children = await tx.table_sessions.findMany({
        where: { merged_into_session_id: sessionId, status: 'merged' },
        select: { id: true },
      });
      const tab = await getTab(tx, [sessionId, ...children.map(({ id }) => id)]);
      if (Number(payment.amount) > tab.balance + 0.005) throw new Error('Payment exceeds the remaining table balance');
      const updated = await tx.table_payments.update({
        where: { id: paymentId },
        data: {
          status: 'confirmed',
          confirmed_by: req.user.id,
          confirmed_at: new Date(),
          ...(req.body.external_reference ? { external_reference: String(req.body.external_reference).slice(0, 100) } : {}),
        },
      });
      return { id: updated.id.toString(), status: updated.status, amount: updated.amount };
    });
    res.json({ success: true, message: 'Mobile Money payment confirmed', data: result });
  } catch (err) {
    const status = ['Table session not found', 'Table payment not found'].includes(err.message) ? 404 :
      err.code === 'P2002' ? 409 : 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to confirm payment' });
  }
});

router.get('/history/:sessionId', authenticate, authorize(...tableUsers), async (req, res) => {
  if (!validId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Invalid table session ID' });
  try {
    const sessionId = BigInt(req.params.sessionId);
    const session = await prisma.table_sessions.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ success: false, message: 'Table session not found' });
    const tab = await getTab(prisma, [sessionId]);
    res.json({ success: true, data: { ...session, id: session.id.toString(), ...tab } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load table history' });
  }
});

module.exports = router;
