const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('admin'), async (req, res) => {
  const limit = Number(req.query.limit || 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({ success: false, message: 'Limit must be between 1 and 200' });
  }
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return res.status(400).json({ success: false, message: 'Invalid audit date range' });
  }
  try {
    const logs = await prisma.audit_logs.findMany({
      where: {
        ...(req.query.action ? { action: { contains: String(req.query.action).slice(0, 100) } } : {}),
        ...(req.query.entity_type ? { entity_type: String(req.query.entity_type).slice(0, 50) } : {}),
        ...(from || to ? {
          created_at: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    const userIds = [...new Set(logs.map(({ user_id }) => user_id).filter(Boolean))];
    const users = await prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, full_name: true, username: true },
    });
    const actors = new Map(users.map((user) => [user.id, user]));
    res.json({
      success: true,
      data: logs.map((log) => ({
        ...log,
        id: log.id.toString(),
        entity_id: log.entity_id?.toString() || null,
        actor: actors.get(log.user_id) || null,
      })),
    });
  } catch (err) {
    console.error('Audit log query failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch audit history' });
  }
});

module.exports = router;
