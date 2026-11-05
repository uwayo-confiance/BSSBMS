const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/registers', authenticate, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM cash_registers WHERE is_active=1`);
  res.json({ success: true, data: rows });
});

router.get('/sessions/current', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT cs.*, cr.name AS register_name, u.full_name AS opened_by_name
       FROM cash_sessions cs
       JOIN cash_registers cr ON cs.register_id = cr.id
       JOIN users u ON cs.opened_by = u.id
       WHERE cs.status = 'open'
       ORDER BY cs.opened_at DESC LIMIT 1`
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
});

router.post('/sessions/open', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { register_id, opening_balance } = req.body;
    // Close any existing open session first (simplified)
    await pool.execute(`UPDATE cash_sessions SET status='closed', closed_at=NOW() WHERE status='open'`);
    const [result] = await pool.execute(
      `INSERT INTO cash_sessions (register_id, opened_by, opening_balance) VALUES (?, ?, ?)`,
      [register_id || 1, req.user.id, opening_balance || 0]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to open session' });
  }
});

router.post('/sessions/:id/close', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { actual_cash, notes } = req.body;
    // Simple expected = opening + cash sales (simplified for MVP)
    const [session] = await pool.execute(`SELECT * FROM cash_sessions WHERE id = ?`, [req.params.id]);
    if (!session.length || session[0].status !== 'open') {
      return res.status(400).json({ success: false, message: 'Session not open' });
    }
    const expected = Number(session[0].opening_balance); // real calc would sum movements
    const actual = Number(actual_cash || 0);
    await pool.execute(
      `UPDATE cash_sessions SET status='closed', closed_by=?, closed_at=NOW(),
       expected_cash=?, actual_cash=?, difference=?, notes=? WHERE id=?`,
      [req.user.id, expected, actual, actual - expected, notes || null, req.params.id]
    );
    res.json({ success: true, message: 'Session closed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to close session' });
  }
});

module.exports = router;
