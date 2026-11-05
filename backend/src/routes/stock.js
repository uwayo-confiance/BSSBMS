const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit } = require('../utils/helpers');

// Current stock levels
router.get('/', authenticate, async (req, res) => {
  try {
    const { low_only, active } = req.query;
    let sql = `
      SELECT p.id, p.name, p.sku, p.min_stock_level, p.cost_price, p.selling_price,
             s.quantity, s.last_updated, u.name AS unit_name, u.abbreviation,
             c.name AS category_name, p.is_active,
             CASE WHEN p.min_stock_level > 0 AND s.quantity <= p.min_stock_level THEN 1 ELSE 0 END AS is_low
      FROM products p
      JOIN stock s ON p.id = s.product_id
      JOIN units u ON p.base_unit_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.track_stock = 1
    `;
    if (active === 'true' || active === '1') {
      sql += ` AND p.is_active = 1`;
    } else if (active === 'false' || active === '0') {
      sql += ` AND p.is_active = 0`;
    } else if (active !== 'all') {
      sql += ` AND p.is_active = 1`;
    }
    if (low_only === 'true') {
      sql += ` AND p.min_stock_level > 0 AND s.quantity <= p.min_stock_level`;
    }
    sql += ` ORDER BY is_low DESC, p.name`;

    const [rows] = await pool.execute(sql);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stock' });
  }
});

// Set the total stock quantity while recording the change in stock history.
router.put('/:productId/quantity', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const productId = Number(req.params.productId);
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be a non-negative number' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT s.quantity
       FROM stock s
       JOIN products p ON p.id = s.product_id
       WHERE s.product_id = ? AND p.is_active = 1 AND p.track_stock = 1
       FOR UPDATE`,
      [productId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Active stock record not found' });
    }

    const previousQuantity = Number(rows[0].quantity);
    const difference = Number((quantity - previousQuantity).toFixed(3));
    if (difference !== 0) {
      await conn.execute(
        `UPDATE stock SET quantity = ? WHERE product_id = ?`,
        [quantity, productId]
      );
      await conn.execute(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity, reference_type, notes, created_by)
         VALUES (?, 'adjustment', ?, 'adjustment', ?, ?)`,
        [
          productId,
          difference,
          `Stock quantity changed from ${previousQuantity} to ${quantity}`,
          req.user.id,
        ]
      );
    }

    await conn.commit();
    res.json({ success: true, message: 'Stock quantity updated' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update stock quantity' });
  } finally {
    conn.release();
  }
});

// Stock adjustment
router.post('/adjust', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { product_id, quantity, unit_id, reason, notes } = req.body;
    if (!product_id || quantity == null || !unit_id) {
      return res.status(400).json({ success: false, message: 'product_id, quantity and unit_id are required' });
    }

    await conn.beginTransaction();

    const qtyBase = await toBaseUnit(conn, product_id, quantity, unit_id);

    await conn.execute(
      `UPDATE stock SET quantity = quantity + ? WHERE product_id = ?`,
      [qtyBase, product_id]
    );

    await conn.execute(
      `INSERT INTO stock_movements
       (product_id, movement_type, quantity, reference_type, notes, created_by)
       VALUES (?, 'adjustment', ?, 'adjustment', ?, ?)`,
      [product_id, qtyBase, notes || reason || null, req.user.id]
    );

    await conn.commit();
    res.json({ success: true, message: 'Stock adjusted successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message || 'Adjustment failed' });
  } finally {
    conn.release();
  }
});

// Stock movements history
router.get('/movements', authenticate, async (req, res) => {
  try {
    const { product_id, limit = 100 } = req.query;
    let sql = `
      SELECT sm.*, p.name AS product_name, u.full_name AS created_by_name
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    if (product_id) {
      sql += ` AND sm.product_id = ?`;
      params.push(product_id);
    }
    sql += ` ORDER BY sm.created_at DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch movements' });
  }
});

module.exports = router;
