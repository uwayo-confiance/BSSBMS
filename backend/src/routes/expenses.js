const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/categories', authenticate, async (req, res) => {
  const [rows] = await pool.execute(`SELECT * FROM expense_categories ORDER BY name`);
  res.json({ success: true, data: rows });
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `
      SELECT e.*, ec.name AS category_name, u.full_name AS created_by_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      LEFT JOIN users u ON e.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (from) { sql += ` AND e.expense_date >= ?`; params.push(from); }
    if (to) { sql += ` AND e.expense_date <= ?`; params.push(to); }
    sql += ` ORDER BY e.expense_date DESC LIMIT 200`;
    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch expenses' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { category_id, title, amount, expense_date, payment_method, reference, notes } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ success: false, message: 'Title and amount are required' });
    }
    const [result] = await pool.execute(
      `INSERT INTO expenses (category_id, title, amount, expense_date, payment_method, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [category_id || null, title, amount, expense_date || new Date().toISOString().slice(0,10),
       payment_method || 'cash', reference || null, notes || null, req.user.id]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create expense' });
  }
});

module.exports = router;
