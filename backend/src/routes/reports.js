const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/product-performance', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { from, to, product_id } = req.query;
    const isValidDate = (date) => {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsedDate = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
    };

    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ success: false, message: 'Valid start and end dates are required (YYYY-MM-DD)' });
    }
    if (from > to) {
      return res.status(400).json({ success: false, message: 'Start date must be on or before end date' });
    }
    if (product_id !== undefined && (!/^\d+$/.test(String(product_id)) || Number(product_id) < 1)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    let sql = `
      SELECT p.id AS product_id, p.name AS product_name, p.sku,
             u.abbreviation AS unit,
             COUNT(DISTINCT si.sale_id) AS sales_count,
             COALESCE(SUM(si.quantity_base), 0) AS quantity_sold,
             COALESCE(SUM(si.total_price), 0) AS revenue,
             COALESCE(SUM(si.quantity_base * si.cost_at_sale), 0) AS cost_of_goods
      FROM products p
      JOIN units u ON u.id = p.base_unit_id
      LEFT JOIN (
        SELECT si.product_id, si.sale_id, si.quantity_base, si.total_price, si.cost_at_sale
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'completed' AND DATE(s.sale_date) BETWEEN ? AND ?
      ) si ON si.product_id = p.id
    `;
    const params = [from, to];
    if (product_id !== undefined) {
      sql += ` WHERE p.id = ?`;
      params.push(Number(product_id));
    }
    sql += ` GROUP BY p.id, p.name, p.sku, u.abbreviation ORDER BY revenue DESC, p.name`;

    const [products] = await pool.execute(sql, params);
    if (product_id !== undefined && products.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const data = products.map((product) => ({
      ...product,
      gross_profit: Number(product.revenue) - Number(product.cost_of_goods),
    }));
    res.json({ success: true, data: { period: { from, to }, products: data } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate product report' });
  }
});

router.get('/daily', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { date } = req.query;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'A valid report date is required (YYYY-MM-DD)' });
    }

    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ success: false, message: 'Report date is not a valid calendar date' });
    }

    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS transactions,
              COALESCE(SUM(total_amount), 0) AS revenue,
              COALESCE(SUM(discount_amount), 0) AS discounts,
              COALESCE(SUM(amount_paid), 0) AS amount_paid
       FROM sales
       WHERE status = 'completed' AND DATE(sale_date) = ?`,
      [date]
    );

    const [transactions] = await pool.execute(
      `SELECT s.id, s.receipt_number, s.sale_date, s.total_amount, s.amount_paid,
              s.payment_method, s.payment_status,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              u.full_name AS cashier_name
       FROM sales s
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN users u ON s.created_by = u.id
       WHERE s.status = 'completed' AND DATE(s.sale_date) = ?
       ORDER BY s.sale_date DESC`,
      [date]
    );

    const [products] = await pool.execute(
      `SELECT p.id AS product_id, p.name AS product_name,
              u.abbreviation AS unit,
              COALESCE(SUM(si.quantity_base), 0) AS quantity_sold,
              COALESCE(SUM(si.total_price), 0) AS revenue
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       JOIN units u ON u.id = p.base_unit_id
       WHERE s.status = 'completed' AND DATE(s.sale_date) = ?
       GROUP BY p.id, p.name, u.abbreviation
       ORDER BY revenue DESC, p.name`,
      [date]
    );

    const [[costs]] = await pool.execute(
      `SELECT COALESCE(SUM(si.quantity_base * si.cost_at_sale), 0) AS cost_of_goods
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND DATE(s.sale_date) = ?`,
      [date]
    );

    const [[expenses]] = await pool.execute(
      `SELECT COALESCE(SUM(amount), 0) AS expenses
       FROM expenses
       WHERE expense_date = ?`,
      [date]
    );

    const grossProfit = Number(totals.revenue) - Number(costs.cost_of_goods);
    const netProfit = grossProfit - Number(expenses.expenses);

    res.json({
      success: true,
      data: {
        date,
        totals,
        profit: {
          cost_of_goods: costs.cost_of_goods,
          gross_profit: grossProfit,
          expenses: expenses.expenses,
          net_profit: netProfit,
        },
        transactions,
        products,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Daily report failed' });
  }
});

router.get('/daily/products/:productId', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { date } = req.query;
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'A valid report date is required (YYYY-MM-DD)' });
    }
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ success: false, message: 'Report date is not a valid calendar date' });
    }

    const [products] = await pool.execute(
      `SELECT p.id, p.name, p.sku, p.barcode, p.cost_price, p.selling_price,
              p.min_stock_level, p.is_active, p.track_stock,
              c.name AS category_name,
              base_unit.name AS base_unit_name,
              base_unit.abbreviation AS base_unit_abbr,
              stock.quantity AS current_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN units base_unit ON base_unit.id = p.base_unit_id
       LEFT JOIN stock ON stock.product_id = p.id
       WHERE p.id = ?`,
      [productId]
    );
    if (!products.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const [sales] = await pool.execute(
      `SELECT si.id AS sale_item_id, s.id AS sale_id, s.receipt_number, s.sale_date,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              cashier.full_name AS cashier_name,
              units.name AS sale_unit_name,
              units.abbreviation AS sale_unit_abbr,
              si.quantity, si.quantity_base, si.unit_price, si.discount, si.total_price
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users cashier ON cashier.id = s.created_by
       LEFT JOIN units ON units.id = si.unit_id
       WHERE si.product_id = ? AND s.status = 'completed' AND DATE(s.sale_date) = ?
       ORDER BY s.sale_date DESC`,
      [productId, date]
    );

    const summary = sales.reduce((result, sale) => ({
      quantity_sold: result.quantity_sold + Number(sale.quantity_base),
      revenue: result.revenue + Number(sale.total_price),
    }), { quantity_sold: 0, revenue: 0 });

    res.json({
      success: true,
      data: { product: products[0], date, summary, sales },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch product report details' });
  }
});

router.get('/sales-summary', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from || new Date(new Date().setDate(1)).toISOString().slice(0,10);
    const end = to || new Date().toISOString().slice(0,10);

    const [daily] = await pool.execute(
      `SELECT DATE(sale_date) AS date, COUNT(*) AS transactions, SUM(total_amount) AS revenue
       FROM sales WHERE status='completed' AND DATE(sale_date) BETWEEN ? AND ?
       GROUP BY DATE(sale_date) ORDER BY date`,
      [start, end]
    );

    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS transactions, COALESCE(SUM(total_amount),0) AS revenue,
              COALESCE(SUM(discount_amount),0) AS discounts
       FROM sales WHERE status='completed' AND DATE(sale_date) BETWEEN ? AND ?`,
      [start, end]
    );

    res.json({ success: true, data: { daily, totals, period: { from: start, to: end } } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Report failed' });
  }
});

router.get('/profit', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from || new Date(new Date().setDate(1)).toISOString().slice(0,10);
    const end = to || new Date().toISOString().slice(0,10);

    const [[sales]] = await pool.execute(
      `SELECT COALESCE(SUM(si.total_price),0) AS revenue,
              COALESCE(SUM(si.quantity_base * si.cost_at_sale),0) AS cost
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       WHERE s.status='completed' AND DATE(s.sale_date) BETWEEN ? AND ?`,
      [start, end]
    );

    const [[expenses]] = await pool.execute(
      `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [start, end]
    );

    const grossProfit = Number(sales.revenue) - Number(sales.cost);
    const netProfit = grossProfit - Number(expenses.total);

    res.json({
      success: true,
      data: {
        revenue: sales.revenue,
        cost_of_goods: sales.cost,
        gross_profit: grossProfit,
        expenses: expenses.total,
        net_profit: netProfit,
        period: { from: start, to: end }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Report failed' });
  }
});

module.exports = router;
