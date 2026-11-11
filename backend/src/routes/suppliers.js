const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const suppliers = await prisma.suppliers.findMany({
      where: search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : undefined,
      orderBy: { name: 'asc' },
    });
    const supplierIds = suppliers.map(({ id }) => id);
    const [purchases, payments, returns] = await Promise.all([
      prisma.purchases.findMany({ where: { supplier_id: { in: supplierIds } } }),
      prisma.supplier_payments.findMany({ where: { supplier_id: { in: supplierIds } } }),
      prisma.supplier_returns.findMany({ where: { supplier_id: { in: supplierIds } }, select: { supplier_id: true, amount: true, created_at: true } }),
    ]);
    const data = suppliers.map((supplier) => {
      const supplierPurchases = purchases.filter((purchase) => purchase.supplier_id === supplier.id && purchase.status !== 'cancelled');
      const supplierPayments = payments.filter((payment) => payment.supplier_id === supplier.id);
      const supplierReturns = returns.filter((item) => item.supplier_id === supplier.id);
      const totalPurchases = supplierPurchases.reduce((sum, purchase) => sum + Number(purchase.total_amount || 0), 0);
      const totalPaid = supplierPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const totalReturns = supplierReturns.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const dates = [
        ...supplierPurchases.map((purchase) => new Date(purchase.purchase_date)),
        ...supplierPayments.map((payment) => new Date(payment.payment_date)),
        ...supplierReturns.map((item) => new Date(item.created_at)),
      ].filter((date) => !Number.isNaN(date.getTime()));
      return {
        ...supplier,
        total_purchases: totalPurchases,
        total_paid: totalPaid,
        outstanding_balance: supplierPurchases.reduce((sum, purchase) => sum + Number(purchase.balance || 0), 0),
        credit_balance: Math.max(0, totalPaid + totalReturns - totalPurchases),
        last_transaction_date: dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null,
      };
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
