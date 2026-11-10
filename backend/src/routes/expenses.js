const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/categories', authenticate, async (req, res) => {
  const data = await prisma.expense_categories.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data });
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
    };
    const expenses = await prisma.expenses.findMany({
      where: {
        ...(Object.keys(dateFilter).length ? { expense_date: dateFilter } : {}),
      },
      orderBy: { expense_date: 'desc' },
      take: 200,
    });
    const categoryIds = [...new Set(expenses.map(({ category_id }) => category_id).filter(Boolean))];
    const userIds = [...new Set(expenses.map(({ created_by }) => created_by).filter(Boolean))];
    const [categories, users] = await Promise.all([
      prisma.expense_categories.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
    ]);
    const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    res.json({
      success: true,
      data: expenses.map((expense) => ({
        ...expense,
        category_name: categoryNames.get(expense.category_id) ?? null,
        created_by_name: userNames.get(expense.created_by) ?? null,
      })),
    });
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
    const expense = await prisma.expenses.create({
      data: {
        category_id: category_id ? Number(category_id) : null,
        title,
        amount,
        expense_date: new Date(`${expense_date || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        payment_method: payment_method || 'cash',
        reference: reference || null,
        notes: notes || null,
        created_by: req.user.id,
      },
      select: { id: true },
    });
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create expense' });
  }
});

module.exports = router;
