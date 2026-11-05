const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit, generateReceiptNumber, money } = require('../utils/helpers');

// Create sale (POS)
router.post('/', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      customer_id, items, payment_method, amount_paid,
      discount_amount, notes, payment_status
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    await conn.beginTransaction();

    // Calculate totals and validate stock
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const { product_id, quantity, unit_id, unit_price, discount = 0 } = item;
      if (!product_id || !quantity || !unit_id || unit_price == null) {
        throw new Error('Each item must have product_id, quantity, unit_id and unit_price');
      }

      const qtyBase = await toBaseUnit(conn, product_id, quantity, unit_id);

      // Check stock
      const [stockRows] = await conn.execute(
        `SELECT quantity FROM stock WHERE product_id = ? FOR UPDATE`,
        [product_id]
      );
      if (!stockRows.length || Number(stockRows[0].quantity) < qtyBase) {
        const [prod] = await conn.execute(`SELECT name FROM products WHERE id = ?`, [product_id]);
        throw new Error(`Insufficient stock for ${prod[0]?.name || 'product'}`);
      }

      const lineTotal = money(quantity * unit_price - (discount || 0));
      subtotal = money(subtotal + lineTotal);

      // Get cost for profit tracking
      const [prodCost] = await conn.execute(`SELECT cost_price FROM products WHERE id = ?`, [product_id]);

      processedItems.push({
        product_id, quantity, unit_id, quantity_base: qtyBase,
        unit_price, discount: discount || 0, total_price: lineTotal,
        cost_at_sale: prodCost[0]?.cost_price || 0
      });
    }

    const discountAmt = money(discount_amount || 0);
    const totalAmount = money(subtotal - discountAmt);
    const paid = money(amount_paid || totalAmount);
    const change = money(Math.max(0, paid - totalAmount));
    const status = payment_status || (paid >= totalAmount ? 'paid' : (customer_id ? 'credit' : 'partial'));

    const receiptNumber = await generateReceiptNumber(conn);

    const [saleResult] = await conn.execute(
      `INSERT INTO sales
       (receipt_number, customer_id, status, subtotal, discount_amount, total_amount,
        amount_paid, change_given, payment_method, payment_status, notes, created_by)
       VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptNumber, customer_id || null, subtotal, discountAmt, totalAmount,
        paid, change, payment_method || 'cash', status, notes || null, req.user.id
      ]
    );

    const saleId = saleResult.insertId;

    // Insert items and update stock
    for (const item of processedItems) {
      await conn.execute(
        `INSERT INTO sale_items
         (sale_id, product_id, quantity, unit_id, quantity_base, unit_price, discount, total_price, cost_at_sale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, item.product_id, item.quantity, item.unit_id, item.quantity_base,
          item.unit_price, item.discount, item.total_price, item.cost_at_sale
        ]
      );

      // Deduct stock
      await conn.execute(
        `UPDATE stock SET quantity = quantity - ? WHERE product_id = ?`,
        [item.quantity_base, item.product_id]
      );

      // Stock movement
      await conn.execute(
        `INSERT INTO stock_movements
         (product_id, movement_type, quantity, reference_type, reference_id, unit_cost, created_by)
         VALUES (?, 'sale', ?, 'sale', ?, ?, ?)`,
        [item.product_id, -item.quantity_base, saleId, item.cost_at_sale, req.user.id]
      );
    }

    // Payment record
    await conn.execute(
      `INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)`,
      [saleId, payment_method || 'cash', paid]
    );

    // If credit sale, create debt
    if (status === 'credit' || (customer_id && paid < totalAmount)) {
      const remaining = money(totalAmount - paid);
      await conn.execute(
        `INSERT INTO customer_debts (customer_id, sale_id, original_amount, remaining_amount, status)
         VALUES (?, ?, ?, ?, ?)`,
        [customer_id, saleId, remaining, remaining, remaining === totalAmount ? 'open' : 'partial']
      );
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Sale completed',
      data: {
        id: saleId,
        receipt_number: receiptNumber,
        total_amount: totalAmount,
        amount_paid: paid,
        change_given: change,
        payment_status: status
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Sale error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to process sale' });
  } finally {
    conn.release();
  }
});

// List sales
router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to, limit = 50 } = req.query;
    let sql = `
      SELECT s.*, c.name AS customer_name, u.full_name AS cashier_name
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.status = 'completed'
    `;
    const params = [];
    if (from) { sql += ` AND DATE(s.sale_date) >= ?`; params.push(from); }
    if (to) { sql += ` AND DATE(s.sale_date) <= ?`; params.push(to); }
    sql += ` ORDER BY s.sale_date DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch sales' });
  }
});

// Get sale details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [sales] = await pool.execute(
      `SELECT s.*, c.name AS customer_name, u.full_name AS cashier_name
       FROM sales s
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN users u ON s.created_by = u.id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!sales.length) return res.status(404).json({ success: false, message: 'Sale not found' });

    const [items] = await pool.execute(
      `SELECT si.*, p.name AS product_name, un.name AS unit_name
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       JOIN units un ON si.unit_id = un.id
       WHERE si.sale_id = ?`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...sales[0], items } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
