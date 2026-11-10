const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit, money } = require('../utils/helpers');

router.get('/', authenticate, async (req, res) => {
  try {
    const purchases = await prisma.purchases.findMany({
      orderBy: [{ purchase_date: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const supplierIds = [...new Set(purchases.map(({ supplier_id }) => supplier_id).filter(Boolean))];
    const userIds = [...new Set(purchases.map(({ created_by }) => created_by).filter(Boolean))];
    const [suppliers, users] = await Promise.all([
      prisma.suppliers.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }),
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
    ]);
    const supplierNames = new Map(suppliers.map(({ id, name }) => [id, name]));
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    res.json({
      success: true,
      data: purchases.map((purchase) => ({
        ...purchase,
        supplier_name: supplierNames.get(purchase.supplier_id) ?? null,
        created_by_name: userNames.get(purchase.created_by) ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch purchases' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const { supplier_id, invoice_number, purchase_date, items, amount_paid, notes } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'Items are required' });
    }

    const purchase = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const processed = [];
      for (const item of items) {
        const quantityBase = await toBaseUnit(tx, item.product_id, item.quantity, item.unit_id);
        const totalCost = money(item.quantity * item.unit_cost);
        subtotal = money(subtotal + totalCost);
        processed.push({ ...item, quantity_base: quantityBase, total_cost: totalCost });
      }

      const paid = money(amount_paid || 0);
      const balance = money(subtotal - paid);
      const paymentStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      const created = await tx.purchases.create({
        data: {
          supplier_id: supplier_id || null,
          invoice_number: invoice_number || null,
          purchase_date: new Date(`${purchase_date || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          status: 'received',
          subtotal,
          total_amount: subtotal,
          amount_paid: paid,
          balance,
          payment_status: paymentStatus,
          notes: notes || null,
          created_by: req.user.id,
        },
        select: { id: true },
      });

      for (const item of processed) {
        await tx.purchase_items.create({
          data: {
            purchase_id: created.id,
            product_id: Number(item.product_id),
            quantity: item.quantity,
            unit_id: Number(item.unit_id),
            quantity_base: item.quantity_base,
            unit_cost: item.unit_cost,
            total_cost: item.total_cost,
          },
        });
        await tx.stock.update({
          where: { product_id: Number(item.product_id) },
          data: { quantity: { increment: item.quantity_base } },
        });
        await tx.products.update({
          where: { id: Number(item.product_id) },
          data: { cost_price: item.unit_cost / (item.quantity_base / item.quantity || 1) },
        });
        await tx.stock_movements.create({
          data: {
            product_id: Number(item.product_id),
            movement_type: 'purchase',
            quantity: item.quantity_base,
            reference_type: 'purchase',
            reference_id: created.id,
            unit_cost: item.unit_cost,
            created_by: req.user.id,
          },
        });
      }

      if (paid > 0 && supplier_id) {
        await tx.supplier_payments.create({
          data: {
            supplier_id: Number(supplier_id),
            purchase_id: created.id,
            amount: paid,
            payment_method: 'cash',
            payment_date: new Date(new Date().toISOString().slice(0, 10)),
            created_by: req.user.id,
          },
        });
      }
      return created;
    });
    res.status(201).json({ success: true, message: 'Purchase recorded', data: purchase });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: err.message || 'Failed to record purchase' });
  }
});

module.exports = router;
