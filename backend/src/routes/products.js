const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// List products with stock
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category_id, active } = req.query;
    let sql = `
      SELECT p.*, c.name AS category_name,
             u.name AS base_unit_name, u.abbreviation AS base_unit_abbr,
             s.quantity AS stock_qty, s.last_updated AS stock_updated
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN units u ON p.base_unit_id = u.id
      LEFT JOIN stock s ON p.id = s.product_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category_id) {
      sql += ` AND p.category_id = ?`;
      params.push(category_id);
    }
    if (active !== undefined) {
      sql += ` AND p.is_active = ?`;
      params.push(active === 'true' || active === '1' ? 1 : 0);
    }

    sql += ` ORDER BY p.name ASC`;

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// Get single product
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, c.name AS category_name, s.quantity AS stock_qty
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN stock s ON p.id = s.product_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create product
router.post('/', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, track_stock, quantity
    } = req.body;

    if (!name || !base_unit_id) {
      return res.status(400).json({ success: false, message: 'Name and base unit are required' });
    }
    const initialQuantity = quantity === undefined ? 0 : Number(quantity);
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0) {
      return res.status(400).json({ success: false, message: 'Initial quantity must be a non-negative number' });
    }

    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO products
       (name, sku, barcode, category_id, description, base_unit_id, purchase_unit_id, sale_unit_id,
        cost_price, selling_price, min_stock_level, track_stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, sku || null, barcode || null, category_id || null, description || null,
        base_unit_id, purchase_unit_id || null, sale_unit_id || null,
        cost_price || 0, selling_price || 0, min_stock_level || 0,
        track_stock !== false ? 1 : 0
      ]
    );

    await conn.execute(
      `INSERT INTO stock (product_id, quantity) VALUES (?, ?)`,
      [result.insertId, initialQuantity]
    );

    if (initialQuantity > 0) {
      await conn.execute(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity, reference_type, notes, created_by)
         VALUES (?, 'adjustment', ?, 'adjustment', 'Initial stock when product was created', ?)`,
        [result.insertId, initialQuantity, req.user.id]
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'Product created', data: { id: result.insertId } });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'SKU or barcode already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create product' });
  } finally {
    conn.release();
  }
});

// Update product
router.put('/:id', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, is_active, track_stock
    } = req.body;

    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    if (typeof name !== 'string' || !name.trim() || !base_unit_id) {
      return res.status(400).json({ success: false, message: 'Name and base unit are required' });
    }
    for (const [field, value] of Object.entries({ cost_price, selling_price, min_stock_level })) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return res.status(400).json({ success: false, message: `${field.split('_').join(' ')} must be a non-negative number` });
      }
    }
    if (is_active !== undefined && is_active !== 0 && is_active !== 1 && is_active !== false && is_active !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const [existing] = await pool.execute(`SELECT id, base_unit_id FROM products WHERE id = ?`, [productId]);
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (Number(existing[0].base_unit_id) !== Number(base_unit_id)) {
      return res.status(400).json({ success: false, message: 'Base unit cannot be changed after a product is created' });
    }

    await pool.execute(
      `UPDATE products SET
         name = ?,
         sku = ?,
         barcode = ?,
         category_id = ?,
         description = ?,
         base_unit_id = ?,
         purchase_unit_id = ?,
         sale_unit_id = ?,
         cost_price = ?,
         selling_price = ?,
         min_stock_level = ?,
         is_active = COALESCE(?, is_active),
         track_stock = COALESCE(?, track_stock)
       WHERE id = ?`,
      [
        name.trim(), sku || null, barcode || null, category_id || null, description || null,
        base_unit_id, purchase_unit_id || null, sale_unit_id || null,
         cost_price ?? null, selling_price ?? null, min_stock_level ?? null,
         is_active ?? null, track_stock ?? null,
         productId
       ]
    );

    res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'SKU or barcode already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

router.patch('/bulk/deactivate', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1)) {
      return res.status(400).json({ success: false, message: 'A non-empty list of valid product IDs is required' });
    }

    const productIds = [...new Set(ids.map(Number))];
    const placeholders = productIds.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `UPDATE products SET is_active = 0 WHERE id IN (${placeholders})`,
      productIds
    );

    res.json({ success: true, message: 'Selected products deactivated', data: { updated: result.affectedRows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to deactivate selected products' });
  }
});

router.patch('/:id/restore', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const [result] = await pool.execute(
      `UPDATE products SET is_active = 1 WHERE id = ?`,
      [productId]
    );
    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(`SELECT id FROM products WHERE id = ?`, [productId]);
      if (!existing.length) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }
    }

    res.json({ success: true, message: 'Product restored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to restore product' });
  }
});

module.exports = router;
