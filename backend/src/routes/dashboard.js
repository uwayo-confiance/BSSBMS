const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/summary', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[salesToday]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS total
       FROM sales WHERE DATE(sale_date) = ? AND status = 'completed'`,
      [today]
    );

    const [[salesMonth]] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS total
       FROM sales WHERE YEAR(sale_date)=YEAR(CURDATE()) AND MONTH(sale_date)=MONTH(CURDATE())
       AND status = 'completed'`
    );

    const [[lowStock]] = await pool.execute(
      `SELECT COUNT(*) AS count FROM products p
       JOIN stock s ON p.id = s.product_id
       WHERE p.is_active=1 AND p.track_stock=1
         AND p.min_stock_level > 0 AND s.quantity <= p.min_stock_level`
    );

    const [[totalDebt]] = await pool.execute(
      `SELECT COALESCE(SUM(remaining_amount),0) AS total FROM customer_debts WHERE status IN ('open','partial')`
    );

    const [[expensesToday]] = await pool.execute(
      `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date = ?`,
      [today]
    );

    const [recentSales] = await pool.execute(
      `SELECT s.id, s.receipt_number, s.total_amount, s.sale_date, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON s.customer_id = c.id
       WHERE s.status='completed' ORDER BY s.sale_date DESC LIMIT 8`
    );

    const [topProducts] = await pool.execute(
      `SELECT p.name, SUM(si.quantity_base) AS qty_sold, SUM(si.total_price) AS revenue
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN products p ON si.product_id = p.id
       WHERE s.status='completed' AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY p.id ORDER BY qty_sold DESC LIMIT 5`
    );

    res.json({
      success: true,
      data: {
        sales_today: salesToday,
        sales_month: salesMonth,
        low_stock_count: lowStock.count,
        total_customer_debt: totalDebt.total,
        expenses_today: expensesToday.total,
        recent_sales: recentSales,
        top_products: topProducts
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

module.exports = router;
