const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const data = await prisma.suppliers.findMany({
      where: search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : undefined,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    const supplier = await prisma.suppliers.create({
      data: { name, contact_person: contact_person || null, phone: phone || null, email: email || null, address: address || null, notes: notes || null },
      select: { id: true },
    });
    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create supplier' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, phone, email, address, notes, is_active } = req.body;
    await prisma.suppliers.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name !== undefined ? { name } : {}),
        contact_person,
        phone,
        email,
        address,
        notes,
        ...(is_active !== undefined && is_active !== null ? { is_active: Number(is_active) } : {}),
      },
    });
    res.json({ success: true, message: 'Supplier updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update supplier' });
  }
});

module.exports = router;
