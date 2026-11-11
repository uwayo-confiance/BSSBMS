const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { recordCashMovement, calculateExpectedCash } = require('../utils/cashLedger');
const { money } = require('../utils/helpers');
const { recordAuditEvent } = require('../utils/auditLog');

const managers = ['admin', 'manager'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

router.get('/registers', authenticate, async (req, res) => {
  try {
    const data = await prisma.cash_registers.findMany({ where: { is_active: 1 }, orderBy: { name: 'asc' } });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Cash registers lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch cash registers' });
  }
});

router.get('/sessions/current', authenticate, async (req, res) => {
  try {
    const session = await prisma.cash_sessions.findFirst({
      where: {
        status: 'open',
        ...(managers.includes(req.user.role) && req.query.all === 'true' ? {} : { opened_by: req.user.id }),
      },
      orderBy: { opened_at: 'desc' },
    });
    if (!session) return res.json({ success: true, data: null });
    const [register, user, movements] = await Promise.all([
      prisma.cash_registers.findUnique({ where: { id: session.register_id }, select: { name: true } }),
      prisma.users.findUnique({ where: { id: session.opened_by }, select: { full_name: true } }),
      prisma.cash_movements.findMany({ where: { session_id: session.id } }),
    ]);
    res.json({
      success: true,
      data: {
        ...session,
        register_name: register?.name ?? null,
        opened_by_name: user?.full_name ?? null,
        movement_count: movements.length,
        expected_cash: calculateExpectedCash(session.opening_balance, movements),
        movements,
      },
    });
  } catch (err) {
    console.error('Current cash session lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch cashier shift' });
  }
});

router.get('/sessions', authenticate, authorize(...managers), async (req, res) => {
  try {
    const sessions = await prisma.cash_sessions.findMany({
      where: {
        ...(req.query.status ? { status: String(req.query.status) } : {}),
        ...(req.query.cashier_id && /^\d+$/.test(String(req.query.cashier_id))
          ? { opened_by: Number(req.query.cashier_id) } : {}),
        ...(req.query.from || req.query.to ? {
          opened_at: {
            ...(req.query.from ? { gte: new Date(`${req.query.from}T00:00:00.000Z`) } : {}),
            ...(req.query.to ? { lte: new Date(`${req.query.to}T23:59:59.999Z`) } : {}),
          },
        } : {}),
      },
      orderBy: { opened_at: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: sessions });
  } catch (err) {
    console.error('Cash session list failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch cashier shifts' });
  }
});

router.post('/sessions/open', authenticate, authorize('admin', 'manager', 'cashier', 'stock_keeper'), async (req, res) => {
  const registerId = Number(req.body.register_id);
  const openingBalance = Number(req.body.opening_balance);
  if (!Number.isInteger(registerId) || registerId < 1 ||
      !Number.isFinite(openingBalance) || openingBalance < 0 ||
      (req.body.notes != null && typeof req.body.notes !== 'string')) {
    return res.status(400).json({ success: false, message: 'Choose a register and enter a non-negative opening float' });
  }
  try {
    const session = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.user.id} FOR UPDATE`;
      const register = await tx.cash_registers.findFirst({ where: { id: registerId, is_active: 1 } });
      if (!register) throw new Error('Active cash register not found');
      const openSession = await tx.cash_sessions.findFirst({
        where: { opened_by: req.user.id, status: 'open' },
      });
      if (openSession) throw new Error('You already have an open cashier shift');
      const created = await tx.cash_sessions.create({
        data: {
          register_id: registerId,
          opened_by: req.user.id,
          opening_balance: money(openingBalance),
          notes: req.body.notes?.trim() || null,
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'cash_shift_opened',
        entityType: 'cash_session',
        entityId: created.id,
        after: { register_id: registerId, opening_balance: money(openingBalance) },
      });
      return created;
    });
    res.status(201).json({ success: true, message: 'Cashier shift opened', data: session });
  } catch (err) {
    const status = err.message === 'You already have an open cashier shift' ? 409 :
      err.message === 'Active cash register not found' ? 404 : 500;
    if (status === 500) console.error('Cash session open failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to open cashier shift' : err.message });
  }
});

router.get('/sessions/:id', authenticate, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid cashier shift ID' });
  try {
    const sessionId = BigInt(req.params.id);
    const session = await prisma.cash_sessions.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ success: false, message: 'Cashier shift not found' });
    if (session.opened_by !== req.user.id && !managers.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You cannot view another cashier shift' });
    }
    const movements = await prisma.cash_movements.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
    });
    const expected = calculateExpectedCash(session.opening_balance, movements);
    res.json({ success: true, data: { ...session, expected_cash: expected, movements } });
  } catch (err) {
    console.error('Cash session lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch cashier shift' });
  }
});

router.post('/sessions/:id/movements', authenticate, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid cashier shift ID' });
  const amount = Number(req.body.amount);
  const type = String(req.body.movement_type || '');
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  const types = ['cash_drop', 'cash_deposit', 'cash_withdrawal', 'cash_adjustment_in', 'cash_adjustment_out'];
  if (!Number.isFinite(amount) || amount <= 0 || !types.includes(type) || !reason) {
    return res.status(400).json({ success: false, message: 'Enter a positive amount, movement type, and reason' });
  }
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'A valid cash movement idempotency key is required' });
  }
  if (type.startsWith('cash_adjustment_') && !managers.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only managers can record cash adjustments' });
  }
  try {
    const sessionId = BigInt(req.params.id);
    const movement = await prisma.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw`
        SELECT id, opened_by, status
        FROM cash_sessions
        WHERE id = ${sessionId}
        FOR UPDATE
      `;
      if (!session || session.status !== 'open') throw new Error('Cashier shift is not open');
      if (session.opened_by !== req.user.id && !managers.includes(req.user.role)) {
        throw new Error('You cannot add movements to another cashier shift');
      }
      const created = await recordCashMovement(tx, {
        userId: session.opened_by,
        movementType: type,
        amount,
        referenceType: 'manual_cash_movement',
        referenceId: sessionId,
        notes: reason,
        idempotencyKey,
      });
      await recordAuditEvent(tx, req, {
        action: 'cash_movement_recorded',
        entityType: 'cash_movement',
        entityId: created.id,
        reason,
        after: { movement_type: type, amount: money(amount), session_id: sessionId.toString() },
      });
      return created;
    });
    res.status(201).json({ success: true, message: 'Cash movement recorded', data: movement });
  } catch (err) {
    const known = ['Cashier shift is not open', 'You cannot add movements to another cashier shift',
      'Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'];
    const status = known.includes(err.message) ? 409 : 400;
    if (!known.includes(err.message)) console.error('Cash movement creation failed:', err);
    res.status(status).json({ success: false, message: known.includes(err.message) ? err.message : 'Failed to record cash movement' });
  }
});

router.post('/sessions/:id/close', authenticate, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid cashier shift ID' });
  const actual = Number(req.body.actual_cash);
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  if (!Number.isFinite(actual) || actual < 0) {
    return res.status(400).json({ success: false, message: 'Enter a valid non-negative cash count' });
  }
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'A valid shift close idempotency key is required' });
  }
  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify({ session_id: req.params.id, actual_cash: money(actual), notes }))
    .digest('hex');
  try {
    const session = await prisma.$transaction(async (tx) => {
      const sessionId = BigInt(req.params.id);
      const [locked] = await tx.$queryRaw`
        SELECT id, opened_by, opening_balance, status, close_idempotency_key, close_request_hash,
          expected_cash, actual_cash, difference, review_status, notes
        FROM cash_sessions
        WHERE id = ${sessionId}
        FOR UPDATE
      `;
      if (!locked) throw new Error('Cashier shift not found');
      if (locked.opened_by !== req.user.id && !managers.includes(req.user.role)) {
        throw new Error('You cannot close another cashier shift');
      }
      if (locked.status !== 'open') {
        if (locked.close_idempotency_key === idempotencyKey && locked.close_request_hash === requestHash) {
          return {
            id: sessionId.toString(),
            expected_cash: Number(locked.expected_cash),
            actual_cash: Number(locked.actual_cash),
            difference: Number(locked.difference),
            review_status: locked.review_status,
            duplicate: true,
          };
        }
        throw new Error('Cashier shift is not open');
      }
      const movements = await tx.cash_movements.findMany({ where: { session_id: sessionId } });
      const expected = calculateExpectedCash(locked.opening_balance, movements);
      const difference = money(actual - expected);
      if (difference !== 0 && !notes) throw new Error('A reason is required when the cash count differs from expected cash');
      const updated = await tx.cash_sessions.updateMany({
        where: { id: sessionId, status: 'open' },
        data: {
          status: 'closed',
          closed_by: req.user.id,
          closed_at: new Date(),
          expected_cash: expected,
          actual_cash: money(actual),
          closing_balance: money(actual),
          difference,
          review_status: difference === 0 ? 'not_required' : 'pending',
          close_idempotency_key: idempotencyKey,
          close_request_hash: requestHash,
          notes: [locked.notes, notes].filter(Boolean).join('\n') || null,
        },
      });
      if (!updated.count) throw new Error('Cashier shift was already closed');
      await recordAuditEvent(tx, req, {
        action: 'cash_shift_closed',
        entityType: 'cash_session',
        entityId: sessionId,
        reason: notes || null,
        before: { status: 'open' },
        after: { status: 'closed', expected_cash: expected, actual_cash: money(actual), difference },
      });
      return { id: sessionId.toString(), expected_cash: expected, actual_cash: money(actual), difference, review_status: difference === 0 ? 'not_required' : 'pending' };
    });
    res.json({ success: true, message: session.duplicate ? 'Shift close already completed' : 'Cashier shift closed', data: session });
  } catch (err) {
    const known = ['Cashier shift is not open', 'Cashier shift not found', 'You cannot close another cashier shift',
      'A reason is required when the cash count differs from expected cash', 'Cashier shift was already closed'];
    const status = err.message === 'Cashier shift was already closed' ? 409 :
      err.message === 'Cashier shift not found' ? 404 :
        ['Cashier shift is not open', 'Cashier shift was already closed'].includes(err.message) ? 409 : known.includes(err.message) ? 400 : 500;
    if (status === 500) console.error('Cash session close failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to close cashier shift' : err.message });
  }
});

router.post('/sessions/:id/review', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid cashier shift ID' });
  const decision = String(req.body.decision || '');
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  if (!['approved', 'flagged'].includes(decision) || !notes) {
    return res.status(400).json({ success: false, message: 'Choose approve or flag and provide review notes' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shiftId = BigInt(req.params.id);
      const updated = await tx.cash_sessions.updateMany({
        where: { id: shiftId, status: 'closed', review_status: 'pending' },
        data: { review_status: decision, review_notes: notes, reviewed_by: req.user.id, reviewed_at: new Date() },
      });
      if (updated.count) {
        await recordAuditEvent(tx, req, {
          action: `cash_shift_${decision}`,
          entityType: 'cash_session',
          entityId: shiftId,
          reason: notes,
          after: { review_status: decision },
        });
      }
      return updated;
    });
    if (!result.count) return res.status(409).json({ success: false, message: 'Only unreconciled closed shifts can be reviewed' });
    res.json({ success: true, message: `Cashier shift ${decision}`, data: { review_status: decision } });
  } catch (err) {
    console.error('Cash session review failed:', err);
    res.status(500).json({ success: false, message: 'Failed to review cashier shift' });
  }
});

module.exports = router;
