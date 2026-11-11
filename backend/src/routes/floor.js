const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money } = require('../utils/helpers');
const { recordAuditEvent } = require('../utils/auditLog');

const managers = ['admin', 'manager'];
const floorUsers = ['admin', 'manager', 'cashier', 'waiter'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

async function getSessionTotals(db, sessionIds) {
  if (!sessionIds.length) return { served: 0, paid: 0, pending: 0 };
  const rounds = await db.table_order_rounds.findMany({ where: { session_id: { in: sessionIds } } });
  const servedRoundIds = rounds.filter((round) => round.status === 'served').map(({ id }) => id);
  const [items, payments] = await Promise.all([
    db.table_order_items.findMany({ where: { round_id: { in: servedRoundIds } } }),
    db.table_payments.findMany({ where: { session_id: { in: sessionIds } } }),
  ]);
  return {
    served: money(items.reduce((sum, item) => sum + Number(item.line_total), 0)),
    paid: money(payments.reduce((sum, payment) => sum + Number(payment.amount), 0)),
    pending: rounds.filter((round) => round.status === 'draft').length,
  };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [areas, tables, sessions, waiterRoles] = await Promise.all([
      prisma.bar_areas.findMany({ orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
      prisma.dining_tables.findMany({ orderBy: [{ area_id: 'asc' }, { sort_order: 'asc' }, { table_name: 'asc' }] }),
      prisma.table_sessions.findMany({ where: { status: 'open' }, orderBy: { opened_at: 'asc' } }),
      prisma.roles.findMany({ where: { name: { in: ['waiter', 'cashier'] } }, select: { id: true } }),
    ]);
    const sessionIds = sessions.map(({ id }) => id);
    const children = sessionIds.length ? await prisma.table_sessions.findMany({
      where: { merged_into_session_id: { in: sessionIds }, status: 'merged' },
      select: { id: true, merged_into_session_id: true },
    }) : [];
    const familyBySession = new Map(sessions.map(({ id }) => [id.toString(), [id]]));
    for (const child of children) familyBySession.get(child.merged_into_session_id.toString())?.push(child.id);
    const allSessionIds = [...new Set([...familyBySession.values()].flat())];
    const [totalsBySession, users] = await Promise.all([
      Promise.all(sessions.map(async (session) => [
        session.id.toString(),
        await getSessionTotals(prisma, familyBySession.get(session.id.toString()) || [session.id]),
      ])),
      waiterRoles.length ? prisma.users.findMany({
        where: { is_active: 1, role_id: { in: waiterRoles.map(({ id }) => id) } },
        select: { id: true, full_name: true, username: true, role_id: true },
        orderBy: { full_name: 'asc' },
      }) : Promise.resolve([]),
    ]);
    const sessionTotals = new Map(totalsBySession);
    const sessionsByTable = new Map(sessions.map((session) => {
      const family = familyBySession.get(session.id.toString()) || [session.id];
      const totals = sessionTotals.get(session.id.toString()) || { served: 0, paid: 0, pending: 0 };
      return [session.dining_table_id, {
        ...session,
        id: session.id.toString(),
        merged_session_ids: family.slice(1).map((id) => id.toString()),
        bill_total: totals.served,
        amount_paid: totals.paid,
        balance: money(Math.max(0, totals.served - totals.paid)),
        pending_rounds: totals.pending,
      }];
    }));
    const areaNames = new Map(areas.map(({ id, name }) => [id, name]));
    res.json({
      success: true,
      data: {
        areas,
        tables: tables.map((table) => {
          const session = sessionsByTable.get(table.id) || null;
          const status = !table.is_active ? 'inactive'
            : !session ? 'available'
              : session.bill_total > session.amount_paid ? 'bill_pending' : 'occupied';
          return {
            ...table,
            area_name: areaNames.get(table.area_id) || null,
            status,
            session,
          };
        }),
        sessions: sessions.map((session) => ({ ...session, id: session.id.toString() })),
        waiters: users.map(({ id, full_name, username }) => ({ id, full_name, username })),
        merged_session_count: allSessionIds.length - sessions.length,
      },
    });
  } catch (err) {
    console.error('Floor overview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load floor overview' });
  }
});

router.post('/areas', authenticate, authorize(...managers), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const sortOrder = req.body.sort_order == null ? 0 : Number(req.body.sort_order);
  if (!name || name.length > 100 || !Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ success: false, message: 'Enter a valid area name and display order' });
  }
  try {
    const area = await prisma.$transaction(async (tx) => {
      const created = await tx.bar_areas.create({ data: { name, sort_order: sortOrder, created_by: req.user.id } });
      await recordAuditEvent(tx, req, {
        action: 'floor_area_created', entityType: 'bar_area', entityId: created.id,
        reason: req.body.reason || null,
        after: { name, sort_order: sortOrder },
      });
      return created;
    });
    res.status(201).json({ success: true, data: area });
  } catch (err) {
    res.status(err.code === 'P2002' ? 409 : 500).json({
      success: false,
      message: err.code === 'P2002' ? 'An area with this name already exists' : 'Failed to create area',
    });
  }
});

router.put('/areas/:id', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid area ID' });
  const name = String(req.body.name || '').trim();
  const sortOrder = req.body.sort_order == null ? undefined : Number(req.body.sort_order);
  if (!name || name.length > 100 || (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0))) {
    return res.status(400).json({ success: false, message: 'Enter a valid area name and display order' });
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const areaId = Number(req.params.id);
      const tables = await tx.dining_tables.findMany({ where: { area_id: areaId }, select: { id: true } });
      for (const table of tables) await tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ${table.id} FOR UPDATE`;
      if (req.body.is_active === false && tables.length) {
        const activeSession = await tx.table_sessions.findFirst({
          where: { dining_table_id: { in: tables.map(({ id }) => id) }, status: 'open' },
        });
        if (activeSession) throw new Error('An area with occupied tables cannot be deactivated');
      }
      const before = await tx.bar_areas.findUnique({ where: { id: areaId } });
      if (!before) throw new Error('Area not found');
      const area = await tx.bar_areas.update({
        where: { id: areaId },
        data: {
          name,
          ...(req.body.is_active !== undefined ? { is_active: req.body.is_active ? 1 : 0 } : {}),
          ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
        },
      });
      if (req.body.is_active === false) {
        await tx.dining_tables.updateMany({ where: { area_id: areaId }, data: { is_active: 0 } });
      }
      await recordAuditEvent(tx, req, {
        action: 'floor_area_updated', entityType: 'bar_area', entityId: areaId,
        reason: req.body.reason || null,
        before: { name: before.name, is_active: before.is_active, sort_order: before.sort_order },
        after: { name: area.name, is_active: area.is_active, sort_order: area.sort_order },
      });
      return area;
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(err.code === 'P2002' || err.message.includes('occupied') ? 409 : 404).json({
      success: false,
      message: err.code === 'P2002' ? 'An area with this name already exists' : err.message || 'Area not found',
    });
  }
});

router.post('/tables', authenticate, authorize(...managers), async (req, res) => {
  const areaId = Number(req.body.area_id);
  const tableName = String(req.body.table_name || '').trim();
  const capacity = Number(req.body.capacity || 2);
  const sortOrder = req.body.sort_order == null ? 0 : Number(req.body.sort_order);
  const displayX = req.body.display_x == null ? null : Number(req.body.display_x);
  const displayY = req.body.display_y == null ? null : Number(req.body.display_y);
  if (!Number.isInteger(areaId) || areaId < 1 || !tableName || tableName.length > 50 ||
      !Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(sortOrder) || sortOrder < 0 ||
      (displayX != null && !Number.isInteger(displayX)) || (displayY != null && !Number.isInteger(displayY))) {
    return res.status(400).json({ success: false, message: 'Area, table name and positive capacity are required' });
  }
  try {
    const area = await prisma.bar_areas.findUnique({ where: { id: areaId } });
    if (!area || !area.is_active) return res.status(400).json({ success: false, message: 'Select an active area' });
    const table = await prisma.$transaction(async (tx) => {
      const created = await tx.dining_tables.create({
        data: {
          area_id: areaId, table_name: tableName, capacity, sort_order: sortOrder,
          display_x: displayX, display_y: displayY,
          description: req.body.description || null, created_by: req.user.id,
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'dining_table_created', entityType: 'dining_table', entityId: created.id,
        reason: req.body.reason || null,
        after: { area_id: areaId, table_name: tableName, capacity, sort_order: sortOrder },
      });
      return created;
    });
    res.status(201).json({ success: true, data: table });
  } catch (err) {
    res.status(err.code === 'P2002' ? 409 : 500).json({
      success: false,
      message: err.code === 'P2002' ? 'This table name already exists in the selected area' : 'Failed to create table',
    });
  }
});

router.put('/tables/:id', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid table ID' });
  const tableId = Number(req.params.id);
  const tableName = String(req.body.table_name || '').trim();
  const areaId = Number(req.body.area_id);
  const capacity = Number(req.body.capacity);
  const sortOrder = req.body.sort_order == null ? undefined : Number(req.body.sort_order);
  const displayX = req.body.display_x === undefined ? undefined : (req.body.display_x == null ? null : Number(req.body.display_x));
  const displayY = req.body.display_y === undefined ? undefined : (req.body.display_y == null ? null : Number(req.body.display_y));
  if (!tableName || tableName.length > 50 || !Number.isInteger(areaId) || areaId < 1 ||
      !Number.isInteger(capacity) || capacity < 1 ||
      (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) ||
      (displayX != null && displayX !== undefined && !Number.isInteger(displayX)) ||
      (displayY != null && displayY !== undefined && !Number.isInteger(displayY))) {
    return res.status(400).json({ success: false, message: 'Area, table name and positive capacity are required' });
  }
  try {
    const area = await prisma.bar_areas.findUnique({ where: { id: areaId } });
    if (!area || !area.is_active) return res.status(400).json({ success: false, message: 'Select an active area' });
    const activeSession = await prisma.table_sessions.findFirst({ where: { dining_table_id: tableId, status: 'open' } });
    if (activeSession && req.body.is_active === false) {
      return res.status(409).json({ success: false, message: 'An occupied table cannot be deactivated' });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.dining_tables.findUnique({ where: { id: tableId } });
      if (!before) throw new Error('Table not found');
      const table = await tx.dining_tables.update({
        where: { id: tableId },
        data: {
          area_id: areaId,
          table_name: tableName,
          capacity,
          description: req.body.description || null,
          ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
          ...(displayX !== undefined ? { display_x: displayX } : {}),
          ...(displayY !== undefined ? { display_y: displayY } : {}),
          ...(req.body.is_active !== undefined ? { is_active: req.body.is_active ? 1 : 0 } : {}),
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'dining_table_updated', entityType: 'dining_table', entityId: tableId,
        reason: req.body.reason || null,
        before: { area_id: before.area_id, table_name: before.table_name, capacity: before.capacity, is_active: before.is_active },
        after: { area_id: areaId, table_name: table.table_name, capacity: table.capacity, is_active: table.is_active },
      });
      return table;
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(err.code === 'P2002' ? 409 : 404).json({
      success: false,
      message: err.code === 'P2002' ? 'This table name already exists in the selected area' : 'Table not found',
    });
  }
});

router.post('/tables/:id/sessions', authenticate, authorize(...floorUsers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid table ID' });
  const tableId = Number(req.params.id);
  const guestCount = req.body.guest_count == null ? null : Number(req.body.guest_count);
  const waiterId = req.body.waiter_id == null ? req.user.id : Number(req.body.waiter_id);
  if ((guestCount != null && (!Number.isInteger(guestCount) || guestCount < 1)) ||
      !Number.isInteger(waiterId) || waiterId < 1) {
    return res.status(400).json({ success: false, message: 'Guest count and waiter must be valid' });
  }
  try {
    const session = await prisma.$transaction(async (tx) => {
      const [table] = await tx.$queryRaw`SELECT id, is_active FROM dining_tables WHERE id = ${tableId} FOR UPDATE`;
      if (!table || !table.is_active) throw new Error('Table is not active');
      const existing = await tx.table_sessions.findFirst({ where: { dining_table_id: tableId, status: 'open' } });
      if (existing) throw new Error('Table already has an open session');
      const waiter = await tx.users.findUnique({ where: { id: waiterId }, select: { id: true, is_active: true } });
      if (!waiter || !waiter.is_active) throw new Error('Select an active waiter');
      return tx.table_sessions.create({
        data: {
          session_number: `TS-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          dining_table_id: tableId,
          waiter_id: waiterId,
          guest_count: guestCount,
          status: 'open',
          opened_by: req.user.id,
        },
      });
    });
    res.status(201).json({ success: true, message: 'Table session opened', data: { ...session, id: session.id.toString() } });
  } catch (err) {
    res.status(409).json({ success: false, message: err.message || 'Could not open table session' });
  }
});

router.patch('/sessions/:id/waiter', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id) || !Number.isInteger(Number(req.body.waiter_id))) {
    return res.status(400).json({ success: false, message: 'Session and waiter IDs are required' });
  }
  try {
    const sessionId = BigInt(req.params.id);
    const [updated, waiter] = await Promise.all([
      prisma.table_sessions.findUnique({ where: { id: sessionId } }),
      prisma.users.findUnique({ where: { id: Number(req.body.waiter_id) } }),
    ]);
    if (!updated || updated.status !== 'open') return res.status(404).json({ success: false, message: 'Open table session not found' });
    if (!waiter || !waiter.is_active) return res.status(400).json({ success: false, message: 'Waiter is not active' });
    await prisma.$transaction([
      prisma.table_sessions.update({ where: { id: sessionId }, data: { waiter_id: waiter.id } }),
      prisma.table_session_events.create({
        data: {
          session_id: sessionId,
          event_type: 'waiter_changed',
          from_waiter_id: updated.waiter_id,
          to_waiter_id: waiter.id,
          created_by: req.user.id,
        },
      }),
    ]);
    res.json({ success: true, message: 'Waiter assignment updated' });
  } catch (err) {
    console.error('Waiter assignment error:', err);
    res.status(500).json({ success: false, message: 'Failed to update waiter assignment' });
  }
});

router.post('/sessions/:id/transfer', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id) || !Number.isInteger(Number(req.body.to_table_id))) {
    return res.status(400).json({ success: false, message: 'Session and destination table are required' });
  }
  try {
    const sessionId = BigInt(req.params.id);
    const destinationId = Number(req.body.to_table_id);
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.table_sessions.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== 'open') throw new Error('Open table session not found');
      const ids = [session.dining_table_id, destinationId].sort((a, b) => a - b);
      await tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ${ids[0]} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ${ids[1]} FOR UPDATE`;
      const destination = await tx.dining_tables.findUnique({ where: { id: destinationId } });
      if (!destination || !destination.is_active) throw new Error('Destination table is not active');
      const occupied = await tx.table_sessions.findFirst({ where: { dining_table_id: destinationId, status: 'open' } });
      if (occupied) throw new Error('Destination table is already occupied');
      await tx.table_sessions.update({ where: { id: sessionId }, data: { dining_table_id: destinationId } });
      await tx.table_session_events.create({
        data: {
          session_id: sessionId,
          event_type: 'transferred',
          from_table_id: session.dining_table_id,
          to_table_id: destinationId,
          reason: req.body.reason || null,
          created_by: req.user.id,
        },
      });
      return { from_table_id: session.dining_table_id, to_table_id: destinationId };
    });
    res.json({ success: true, message: 'Table session transferred', data: result });
  } catch (err) {
    res.status(err.message === 'Open table session not found' ? 404 : 409)
      .json({ success: false, message: err.message || 'Failed to transfer table session' });
  }
});

router.post('/sessions/:id/merge', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id) || !validId(req.body.destination_session_id) ||
      String(req.params.id) === String(req.body.destination_session_id)) {
    return res.status(400).json({ success: false, message: 'Two different table sessions are required' });
  }
  try {
    const sourceId = BigInt(req.params.id);
    const destinationId = BigInt(req.body.destination_session_id);
    await prisma.$transaction(async (tx) => {
      const sessionIds = [sourceId, destinationId].sort((a, b) => a < b ? -1 : 1);
      await tx.$queryRaw`SELECT id FROM table_sessions WHERE id = ${sessionIds[0]} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM table_sessions WHERE id = ${sessionIds[1]} FOR UPDATE`;
      const [source, destination] = await Promise.all([
        tx.table_sessions.findUnique({ where: { id: sourceId } }),
        tx.table_sessions.findUnique({ where: { id: destinationId } }),
      ]);
      if (!source || !destination || source.status !== 'open' || destination.status !== 'open') {
        throw new Error('Both sessions must be open before merging');
      }
      await tx.table_sessions.update({
        where: { id: sourceId },
        data: { status: 'merged', merged_into_session_id: destinationId, closed_by: req.user.id, closed_at: new Date() },
      });
      await tx.table_session_events.create({
        data: {
          session_id: sourceId,
          event_type: 'merged',
          from_table_id: source.dining_table_id,
          to_table_id: destination.dining_table_id,
          related_session_id: destinationId,
          reason: req.body.reason || null,
          created_by: req.user.id,
        },
      });
    });
    res.json({ success: true, message: 'Table sessions merged without removing their history' });
  } catch (err) {
    res.status(409).json({ success: false, message: err.message || 'Failed to merge table sessions' });
  }
});

router.post('/sessions/:id/close', authenticate, authorize(...floorUsers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session ID' });
  const sessionId = BigInt(req.params.id);
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.table_sessions.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== 'open') throw new Error('Open table session not found');
      const childSessions = await tx.table_sessions.findMany({
        where: { merged_into_session_id: sessionId, status: 'merged' },
        select: { id: true },
      });
      const sessionIds = [sessionId, ...childSessions.map(({ id }) => id)];
      const totals = await getSessionTotals(tx, sessionIds);
      if (totals.pending) throw new Error('Resolve or void draft orders before closing the table');
      if (totals.served - totals.paid > 0.005) throw new Error('Table bill must be fully settled before closing');
      const now = new Date();
      await tx.table_sessions.updateMany({
        where: { id: { in: sessionIds } },
        data: { status: 'closed', closed_by: req.user.id, closed_at: now },
      });
      await tx.table_session_events.create({
        data: { session_id: sessionId, event_type: 'closed', reason: req.body.reason || null, created_by: req.user.id },
      });
    });
    res.json({ success: true, message: 'Table session closed' });
  } catch (err) {
    res.status(err.message === 'Open table session not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to close table session' });
  }
});

router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await prisma.table_sessions.findMany({
      where: req.query.status ? { status: String(req.query.status) } : undefined,
      orderBy: { opened_at: 'desc' },
      take: 200,
    });
    const tableIds = [...new Set(sessions.map(({ dining_table_id }) => dining_table_id))];
    const tables = await prisma.dining_tables.findMany({ where: { id: { in: tableIds } }, select: { id: true, table_name: true, area_id: true } });
    const tableMap = new Map(tables.map((table) => [table.id, table]));
    res.json({
      success: true,
      data: sessions.map((session) => ({
        ...session,
        id: session.id.toString(),
        table: tableMap.get(session.dining_table_id) || null,
      })),
    });
  } catch (err) {
    console.error('Table session history error:', err);
    res.status(500).json({ success: false, message: 'Failed to load table session history' });
  }
});

router.get('/sessions/:id/events', authenticate, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid session ID' });
  try {
    const events = await prisma.table_session_events.findMany({
      where: { session_id: BigInt(req.params.id) },
      orderBy: { created_at: 'desc' },
    });
    const userIds = [...new Set(events.flatMap((event) => [event.from_waiter_id, event.to_waiter_id, event.created_by]).filter(Boolean))];
    const tableIds = [...new Set(events.flatMap((event) => [event.from_table_id, event.to_table_id]).filter(Boolean))];
    const [users, tables] = await Promise.all([
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
      prisma.dining_tables.findMany({ where: { id: { in: tableIds } }, select: { id: true, table_name: true } }),
    ]);
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    const tableNames = new Map(tables.map(({ id, table_name }) => [id, table_name]));
    res.json({
      success: true,
      data: events.map((event) => ({
        ...event,
        id: event.id.toString(),
        session_id: event.session_id.toString(),
        from_table_name: tableNames.get(event.from_table_id) || null,
        to_table_name: tableNames.get(event.to_table_id) || null,
        from_waiter_name: userNames.get(event.from_waiter_id) || null,
        to_waiter_name: userNames.get(event.to_waiter_id) || null,
        performed_by_name: userNames.get(event.created_by) || null,
      })),
    });
  } catch (err) {
    console.error('Table session event lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to load table session events' });
  }
});

module.exports = router;
