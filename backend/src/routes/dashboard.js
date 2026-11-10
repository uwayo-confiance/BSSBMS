const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/summary', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const tomorrow = new Date(todayStart);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [salesToday, salesMonth, products, debts, expensesToday, recentSales, topProducts] = await Promise.all([
      prisma.sales.aggregate({
        where: { sale_date: { gte: todayStart, lt: tomorrow }, status: 'completed' },
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
      prisma.sales.aggregate({
        where: { sale_date: { gte: monthStart, lt: tomorrow }, status: 'completed' },
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
      prisma.products.findMany({
        where: { is_active: 1, track_stock: 1, min_stock_level: { gt: 0 } },
        select: { id: true, min_stock_level: true },
      }),
      prisma.customer_debts.aggregate({
        where: { status: { in: ['open', 'partial'] } },
        _sum: { remaining_amount: true },
      }),
      prisma.expenses.aggregate({
        where: { expense_date: todayStart },
        _sum: { amount: true },
      }),
      prisma.sales.findMany({
        where: { status: 'completed' },
        orderBy: { sale_date: 'desc' },
        take: 8,
        select: { id: true, receipt_number: true, total_amount: true, sale_date: true, customer_id: true },
      }),
      prisma.$queryRaw`
        SELECT p.name, SUM(si.quantity_base) AS qty_sold, SUM(si.total_price) AS revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        WHERE s.status = 'completed' AND s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY p.id
        ORDER BY qty_sold DESC
        LIMIT 5
      `,
    ]);

    const stock = await prisma.stock.findMany({
      where: { product_id: { in: products.map(({ id }) => id) } },
      select: { product_id: true, quantity: true },
    });
    const stockByProduct = new Map(stock.map(({ product_id, quantity }) => [product_id, quantity]));
    const lowStockCount = products.filter(({ id, min_stock_level }) =>
      Number(stockByProduct.get(id) ?? 0) <= Number(min_stock_level)
    ).length;
    const customerIds = [...new Set(recentSales.map(({ customer_id }) => customer_id).filter(Boolean))];
    const customers = await prisma.customers.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const customerNames = new Map(customers.map(({ id, name }) => [id, name]));
    const recentSalesData = recentSales.map((sale) => ({
      id: sale.id,
      receipt_number: sale.receipt_number,
      total_amount: sale.total_amount,
      sale_date: sale.sale_date,
      customer_name: customerNames.get(sale.customer_id) ?? null,
    }));

    res.json({
      success: true,
      data: {
        sales_today: { count: salesToday._count._all, total: salesToday._sum.total_amount ?? 0 },
        sales_month: { count: salesMonth._count._all, total: salesMonth._sum.total_amount ?? 0 },
        low_stock_count: lowStockCount,
        total_customer_debt: debts._sum.remaining_amount ?? 0,
        expenses_today: expensesToday._sum.amount ?? 0,
        recent_sales: recentSalesData,
        top_products: topProducts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
});

module.exports = router;
