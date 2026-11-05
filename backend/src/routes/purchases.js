const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit, money } = require('../utils/helpers');

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.*, s.name AS supplier_name, u.full_name AS created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.created_by = u.id
      ORDER BY p.purchase_date DESC, p.id DESC
      LIMIT 100
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch purchases' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { supplier_id, invoice_number, purchase_date, items, amount_paid, notes } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'Items are required' });
    }

    await conn.beginTransaction();

    let subtotal = 0;
    const processed = [];

    for (const item of items) {
      const qtyBase = await toBaseUnit(conn, item.product_id, item.quantity, item.unit_id);
      const totalCost = money(item.quantity * item.unit_cost);
      subtotal = money(subtotal + totalCost);
      processed.push({ ...item, quantity_base: qtyBase, total_cost: totalCost });
    }

    const paid = money(amount_paid || 0);
    const balance = money(subtotal - paid);
    const paymentStatus = balance <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');

    const [result] = await conn.execute(
      `INSERT INTO purchases
       (supplier_id, invoice_number, purchase_date, status, subtotal, total_amount,
        amount_paid, balance, payment_status, notes, created_by)
       VALUES (?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_id || null, invoice_number || null, purchase_date || new Date().toISOString().slice(0,10),
        subtotal, subtotal, paid, balance, paymentStatus, notes || null, req.user.id
      ]
    );

    const purchaseId = result.insertId;

    for (const item of processed) {
      await conn.execute(
        `INSERT INTO purchase_items
         (purchase_id, product_id, quantity, unit_id, quantity_base, unit_cost, total_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, item.product_id, item.quantity, item.unit_id, item.quantity_base, item.unit_cost, item.total_cost]
      );

      // Increase stock
      await conn.execute(
        `UPDATE stock SET quantity = quantity + ? WHERE product_id = ?`,
        [item.quantity_base, item.product_id]
      );

      // Update product cost (weighted average simplified)
      await conn.execute(
        `UPDATE products SET cost_price = ? WHERE id = ?`,
        [item.unit_cost / (item.quantity_base / item.quantity || 1), item.product_id]
      );

      await conn.execute(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity, reference_type, reference_id, unit_cost, created_by)
         VALUES (?, 'purchase', ?, 'purchase', ?, ?, ?)`,
        [item.product_id, item.quantity_base, purchaseId, item.unit_cost, req.user.id]
      );
    }

    if (paid > 0 && supplier_id) {
      await conn.execute(
        `INSERT INTO supplier_payments
         (supplier_id, purchase_id, amount, payment_method, payment_date, created_by)
         VALUES (?, ?, ?, 'cash', CURDATE(), ?)`,
        [supplier_id, purchaseId, paid, req.user.id]
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'Purchase recorded', data: { id: purchaseId } });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(400).json({ success: false, message: err.message || 'Failed to record purchase' });
  } finally {
    conn.release();
  }
});

module.exports = router;
