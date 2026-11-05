const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `SELECT * FROM suppliers WHERE 1=1`;
    const params = [];
    if (search) {
      sql += ` AND (name LIKE ? OR phone LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY name`;
    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const [result] = await pool.execute(
      `INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, contact_person || null, phone || null, email || null, address || null, notes || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create supplier' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, notes, is_active } = req.body;
    await pool.execute(
      `UPDATE suppliers SET name=COALESCE(?,name), contact_person=?, phone=?, email=?,
       address=?, notes=?, is_active=COALESCE(?,is_active) WHERE id=?`,
      [name, contact_person, phone, email, address, notes, is_active, req.params.id]
    );
    res.json({ success: true, message: 'Supplier updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update supplier' });
  }
});

module.exports = router;
