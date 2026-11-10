const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/registers', authenticate, async (req, res) => {
  const data = await prisma.cash_registers.findMany({ where: { is_active: 1 } });
  res.json({ success: true, data });
});

router.get('/sessions/current', authenticate, async (req, res) => {
  try {
    const session = await prisma.cash_sessions.findFirst({
      where: { status: 'open' },
      orderBy: { opened_at: 'desc' },
    });
    if (!session) return res.json({ success: true, data: null });
    const [register, user] = await Promise.all([
      prisma.cash_registers.findUnique({ where: { id: session.register_id }, select: { name: true } }),
      prisma.users.findUnique({ where: { id: session.opened_by }, select: { full_name: true } }),
    ]);
    res.json({
      success: true,
      data: { ...session, register_name: register?.name ?? null, opened_by_name: user?.full_name ?? null },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
});

router.post('/sessions/open', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { register_id, opening_balance } = req.body;
    const session = await prisma.$transaction(async (tx) => {
      await tx.cash_sessions.updateMany({
        where: { status: 'open' },
        data: { status: 'closed', closed_at: new Date() },
      });
      return tx.cash_sessions.create({
        data: {
          register_id: Number(register_id || 1),
          opened_by: req.user.id,
          opening_balance: opening_balance || 0,
        },
        select: { id: true },
      });
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to open session' });
  }
});

router.post('/sessions/:id/close', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const sessionId = BigInt(req.params.id);
    const { actual_cash, notes } = req.body;
    const session = await prisma.cash_sessions.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Session not open' });
    }
    const expected = Number(session.opening_balance);
    const actual = Number(actual_cash || 0);
    await prisma.cash_sessions.update({
      where: { id: sessionId },
      data: {
        status: 'closed',
        closed_by: req.user.id,
        closed_at: new Date(),
        expected_cash: expected,
        actual_cash: actual,
        difference: actual - expected,
        notes: notes || null,
      },
    });
    res.json({ success: true, message: 'Session closed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to close session' });
  }
});

module.exports = router;
