const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money } = require('../utils/helpers');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, active } = req.query;
    let sql = `
      SELECT c.*,
             COALESCE(SUM(cd.remaining_amount), 0) AS total_debt
      FROM customers c
      LEFT JOIN customer_debts cd ON c.id = cd.customer_id AND cd.status IN ('open','partial')
      WHERE 1=1
    `;
    const params = [];
    if (active === 'true' || active === '1') {
      sql += ` AND c.is_active = 1`;
    } else if (active === 'false' || active === '0') {
      sql += ` AND c.is_active = 0`;
    } else if (active !== 'all') {
      sql += ` AND c.is_active = 1`;
    }
    if (search) {
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.address LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` GROUP BY c.id ORDER BY c.name`;
    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { name, phone, email, address, credit_limit, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const [result] = await pool.execute(
      `INSERT INTO customers (name, phone, email, address, credit_limit, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone || null, email || null, address || null, credit_limit || 0, notes || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create customer' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const { name, phone, email, address, credit_limit, is_active } = req.body;
    const customerId = Number(req.params.id);
    const parsedCreditLimit = Number(credit_limit);

    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!Number.isFinite(parsedCreditLimit) || parsedCreditLimit < 0) {
      return res.status(400).json({ success: false, message: 'Credit limit must be a non-negative number' });
    }
    if (is_active !== 0 && is_active !== 1 && is_active !== false && is_active !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const [existing] = await pool.execute(`SELECT id FROM customers WHERE id = ?`, [customerId]);
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    await pool.execute(
      `UPDATE customers
       SET name = ?, phone = ?, email = ?, address = ?, credit_limit = ?, is_active = ?
       WHERE id = ?`,
      [
        name.trim(),
        phone?.trim() || null,
        email?.trim() || null,
        address?.trim() || null,
        parsedCreditLimit,
        Number(is_active),
        customerId,
      ]
    );

    res.json({ success: true, message: 'Customer updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update customer' });
  }
});

router.patch('/:id/status', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const { is_active: isActive } = req.body;

    if (!Number.isInteger(customerId) || customerId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    if (isActive !== 0 && isActive !== 1 && isActive !== false && isActive !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const [result] = await pool.execute(
      `UPDATE customers SET is_active = ? WHERE id = ?`,
      [Number(isActive), customerId]
    );
    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(`SELECT id FROM customers WHERE id = ?`, [customerId]);
      if (!existing.length) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
    }

    res.json({ success: true, message: Number(isActive) ? 'Customer restored' : 'Customer deactivated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update customer status' });
  }
});

// Record customer payment against debt
router.post('/:id/payments', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { amount, payment_method, notes, debt_id } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO customer_payments (customer_id, debt_id, amount, payment_method, payment_date, notes, created_by)
       VALUES (?, ?, ?, ?, CURDATE(), ?, ?)`,
      [req.params.id, debt_id || null, amount, payment_method || 'cash', notes || null, req.user.id]
    );

    // Apply to specific debt or oldest open debts
    let remaining = money(amount);
    if (debt_id) {
      const [debts] = await conn.execute(
        `SELECT remaining_amount FROM customer_debts WHERE id = ? AND customer_id = ? FOR UPDATE`,
        [debt_id, req.params.id]
      );
      if (debts.length) {
        const newRem = money(Math.max(0, Number(debts[0].remaining_amount) - remaining));
        await conn.execute(
          `UPDATE customer_debts SET remaining_amount = ?, status = ? WHERE id = ?`,
          [newRem, newRem === 0 ? 'paid' : 'partial', debt_id]
        );
      }
    } else {
      const [openDebts] = await conn.execute(
        `SELECT id, remaining_amount FROM customer_debts
         WHERE customer_id = ? AND status IN ('open','partial')
         ORDER BY created_at ASC FOR UPDATE`,
        [req.params.id]
      );
      for (const d of openDebts) {
        if (remaining <= 0) break;
        const apply = money(Math.min(remaining, Number(d.remaining_amount)));
        const newRem = money(Number(d.remaining_amount) - apply);
        await conn.execute(
          `UPDATE customer_debts SET remaining_amount = ?, status = ? WHERE id = ?`,
          [newRem, newRem === 0 ? 'paid' : 'partial', d.id]
        );
        remaining = money(remaining - apply);
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Payment recorded' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Failed to record payment' });
  } finally {
    conn.release();
  }
});

// Customer debts
router.get('/:id/debts', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT cd.*, s.receipt_number
       FROM customer_debts cd
       LEFT JOIN sales s ON cd.sale_id = s.id
       WHERE cd.customer_id = ?
       ORDER BY cd.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch debts' });
  }
});

module.exports = router;
