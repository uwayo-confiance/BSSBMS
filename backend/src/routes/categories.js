const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const data = await prisma.categories.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const category = await prisma.categories.create({
      data: { name, description: description || null },
      select: { id: true },
    });
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create category' });
  }
});

module.exports = router;
