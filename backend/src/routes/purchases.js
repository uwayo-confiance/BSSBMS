const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { resolveProductUnit, money, applyBatchDelta } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');

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
        id: purchase.id.toString(),
        supplier_name: supplierNames.get(purchase.supplier_id) ?? null,
        created_by_name: userNames.get(purchase.created_by) ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch purchases' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || BigInt(req.params.id) < 1n) {
    return res.status(400).json({ success: false, message: 'Invalid purchase ID' });
  }
  try {
    const purchaseId = BigInt(req.params.id);
    const [purchase, items, payments] = await Promise.all([
      prisma.purchases.findUnique({ where: { id: purchaseId } }),
      prisma.purchase_items.findMany({ where: { purchase_id: purchaseId } }),
      prisma.supplier_payments.findMany({
        where: { purchase_id: purchaseId },
        select: { id: true },
      }),
    ]);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
    res.json({
      success: true,
      data: {
        ...purchase,
        id: purchase.id.toString(),
        items: items.map((item) => ({ ...item, id: item.id.toString(), purchase_id: item.purchase_id.toString() })),
        has_supplier_payments: payments.length > 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase details' });
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
        const productId = Number(item.product_id);
        const unitId = Number(item.unit_id);
        const quantity = Number(item.quantity);
        const unitCost = Number(item.unit_cost);
        if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(unitId) || unitId < 1 ||
            !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
          throw new Error('Each item must have a valid product, unit, quantity and unit cost');
        }
        const unitDetails = await resolveProductUnit(tx, productId, unitId, 'purchase');
        const quantityBase = Math.round(quantity * unitDetails.conversionFactor * 1000) / 1000;
        const totalCost = money(quantity * unitCost);
        subtotal = money(subtotal + totalCost);
        processed.push({
          product_id: productId,
          product_name_snapshot: unitDetails.product.name,
          quantity,
          unit_id: unitId,
          unit_name_snapshot: unitDetails.unitName,
          conversion_factor_snapshot: unitDetails.conversionFactor,
          quantity_base: quantityBase,
          unit_cost: unitCost,
          total_cost: totalCost,
        });
      }

      const paid = money(amount_paid || 0);
      if (paid < 0 || paid > subtotal) throw new Error('Amount paid must be between zero and the purchase total');
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
            product_id: item.product_id,
            product_name_snapshot: item.product_name_snapshot,
            quantity: item.quantity,
            unit_id: item.unit_id,
            unit_name_snapshot: item.unit_name_snapshot,
            conversion_factor_snapshot: item.conversion_factor_snapshot,
            quantity_base: item.quantity_base,
            unit_cost: item.unit_cost,
            total_cost: item.total_cost,
          },
        });
        await tx.stock.update({
          where: { product_id: item.product_id },
          data: { quantity: { increment: item.quantity_base } },
        });
        await applyBatchDelta(tx, {
          productId: item.product_id,
          quantity: item.quantity_base,
          unitCostBase: item.unit_cost / item.conversion_factor_snapshot,
        });
        await tx.products.update({
          where: { id: item.product_id },
          data: { cost_price: item.unit_cost / item.conversion_factor_snapshot },
        });
        await tx.stock_movements.create({
          data: {
            product_id: item.product_id,
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
        const supplierPayment = await tx.supplier_payments.create({
          data: {
            supplier_id: Number(supplier_id),
            purchase_id: created.id,
            amount: paid,
            payment_method: 'cash',
            payment_date: new Date(new Date().toISOString().slice(0, 10)),
            created_by: req.user.id,
          },
        });
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'supplier_payment',
          amount: paid,
          referenceType: 'supplier_payment',
          referenceId: supplierPayment.id,
          notes: `Cash supplier payment for purchase ${created.id}`,
          idempotencyKey: `supplier-payment:${supplierPayment.id}:cash`,
        });
      }
      return created;
    });
    res.status(201).json({
      success: true,
      message: 'Purchase recorded',
      data: { ...purchase, id: purchase.id.toString() },
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: err.message || 'Failed to record purchase' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || BigInt(req.params.id) < 1n) {
    return res.status(400).json({ success: false, message: 'Invalid purchase ID' });
  }
  const purchaseId = BigInt(req.params.id);
  const { supplier_id, invoice_number, purchase_date, items, amount_paid, notes } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one purchase item is required' });
  }
  if (typeof purchase_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(purchase_date) ||
      Number.isNaN(new Date(`${purchase_date}T00:00:00.000Z`).getTime()) ||
      new Date(`${purchase_date}T00:00:00.000Z`).toISOString().slice(0, 10) !== purchase_date) {
    return res.status(400).json({ success: false, message: 'A valid purchase date is required' });
  }
  if (supplier_id != null && (!Number.isInteger(Number(supplier_id)) || Number(supplier_id) < 1)) {
    return res.status(400).json({ success: false, message: 'Invalid supplier' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.purchases.findUnique({ where: { id: purchaseId } });
      if (!current) throw new Error('Purchase not found');
      if (current.status === 'cancelled') throw new Error('Cancelled purchases cannot be edited');

      const payments = await tx.supplier_payments.findMany({ where: { purchase_id: purchaseId } });
      const paid = payments.length ? Number(current.amount_paid || 0) : Number(amount_paid || 0);
      if (!Number.isFinite(paid) || paid < 0) throw new Error('Amount paid must be a non-negative number');
      if (payments.length && Number(supplier_id || 0) !== Number(current.supplier_id || 0)) {
        throw new Error('Supplier cannot be changed after a payment has been recorded');
      }

      const oldItems = await tx.purchase_items.findMany({ where: { purchase_id: purchaseId } });
      const processedItems = [];
      let subtotal = 0;
      for (const item of items) {
        const productId = Number(item.product_id);
        const unitId = Number(item.unit_id);
        const quantity = Number(item.quantity);
        const unitCost = Number(item.unit_cost);
        if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(unitId) || unitId < 1 ||
            !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
          throw new Error('Each item must have a valid product, unit, quantity and unit cost');
        }
        const unitDetails = await resolveProductUnit(tx, productId, unitId, 'purchase');
        const quantityBase = Math.round(quantity * unitDetails.conversionFactor * 1000) / 1000;
        const totalCost = money(quantity * unitCost);
        subtotal = money(subtotal + totalCost);
        processedItems.push({
          product_id: productId,
          product_name_snapshot: unitDetails.product.name,
          quantity,
          unit_id: unitId,
          unit_name_snapshot: unitDetails.unitName,
          conversion_factor_snapshot: unitDetails.conversionFactor,
          quantity_base: quantityBase,
          unit_cost: unitCost,
          total_cost: totalCost,
        });
      }
      if (paid > subtotal) throw new Error('Amount paid cannot be greater than the purchase total');

      const stockDeltas = new Map();
      oldItems.forEach((item) => {
        stockDeltas.set(item.product_id, (stockDeltas.get(item.product_id) || 0) - Number(item.quantity_base));
      });
      processedItems.forEach((item) => {
        stockDeltas.set(item.product_id, (stockDeltas.get(item.product_id) || 0) + Number(item.quantity_base));
      });

      for (const [productId, delta] of stockDeltas) {
        if (Math.abs(delta) < 0.0005) continue;
        const [stock] = await tx.$queryRaw`
          SELECT quantity FROM stock WHERE product_id = ${productId} FOR UPDATE
        `;
        if (!stock) throw new Error(`Stock record not found for product ${productId}`);
        const updatedQuantity = Number(stock.quantity) + delta;
        if (updatedQuantity < -0.0005) {
          throw new Error('Cannot reduce the purchase quantity because some of that stock has already been used');
        }
        await tx.stock.update({
          where: { product_id: productId },
          data: { quantity: { increment: delta } },
        });
        await applyBatchDelta(tx, {
          productId,
          quantity: delta,
          unitCostBase: Number((await tx.products.findUnique({
            where: { id: productId },
            select: { cost_price: true },
          }))?.cost_price || 0),
        });
        await tx.stock_movements.create({
          data: {
            product_id: productId,
            movement_type: 'adjustment',
            quantity: delta,
            reference_type: 'purchase_edit',
            reference_id: purchaseId,
            notes: `Stock adjusted after editing purchase ${purchaseId}`,
            created_by: req.user.id,
          },
        });
      }

      await tx.purchase_items.deleteMany({ where: { purchase_id: purchaseId } });
      for (const item of processedItems) {
        await tx.purchase_items.create({
          data: {
            purchase_id: purchaseId,
            product_id: item.product_id,
            product_name_snapshot: item.product_name_snapshot,
            quantity: item.quantity,
            unit_id: item.unit_id,
            unit_name_snapshot: item.unit_name_snapshot,
            conversion_factor_snapshot: item.conversion_factor_snapshot,
            quantity_base: item.quantity_base,
            unit_cost: item.unit_cost,
            total_cost: item.total_cost,
          },
        });
        await tx.products.update({
          where: { id: item.product_id },
          data: { cost_price: item.unit_cost / item.conversion_factor_snapshot },
        });
      }

      const balance = money(subtotal - paid);
      const paymentStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      await tx.purchases.update({
        where: { id: purchaseId },
        data: {
          supplier_id: supplier_id ? Number(supplier_id) : null,
          invoice_number: invoice_number || null,
          purchase_date: new Date(`${purchase_date}T00:00:00.000Z`),
          subtotal,
          total_amount: subtotal,
          amount_paid: paid,
          balance,
          payment_status: paymentStatus,
          notes: notes || null,
        },
      });

      if (!payments.length && paid > 0 && supplier_id) {
        const supplierPayment = await tx.supplier_payments.create({
          data: {
            supplier_id: Number(supplier_id),
            purchase_id: purchaseId,
            amount: paid,
            payment_method: 'cash',
            payment_date: new Date(new Date().toISOString().slice(0, 10)),
            created_by: req.user.id,
          },
        });
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'supplier_payment',
          amount: paid,
          referenceType: 'supplier_payment',
          referenceId: supplierPayment.id,
          notes: `Cash supplier payment for purchase ${purchaseId}`,
          idempotencyKey: `supplier-payment:${supplierPayment.id}:cash`,
        });
      }
    });

    res.json({ success: true, message: 'Purchase updated', data: { id: purchaseId.toString() } });
  } catch (err) {
    console.error('Purchase update error:', err);
    res.status(err.message === 'Purchase not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to update purchase' });
  }
});

router.delete('/:id', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || BigInt(req.params.id) < 1n) {
    return res.status(400).json({ success: false, message: 'Invalid purchase ID' });
  }
  const purchaseId = BigInt(req.params.id);
  try {
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchases.findUnique({ where: { id: purchaseId } });
      if (!purchase) throw new Error('Purchase not found');
      if (purchase.status === 'cancelled') throw new Error('Purchase is already cancelled');

      const payments = await tx.supplier_payments.count({ where: { purchase_id: purchaseId } });
      if (payments > 0 || Number(purchase.amount_paid || 0) > 0) {
        throw new Error('This purchase has recorded payments and cannot be deleted');
      }

      const items = await tx.purchase_items.findMany({ where: { purchase_id: purchaseId } });
      const quantities = new Map();
      const costs = new Map();
      items.forEach((item) => {
        quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + Number(item.quantity_base));
        const factor = Number(item.conversion_factor_snapshot) ||
          Number(item.quantity_base) / Number(item.quantity);
        costs.set(item.product_id, Number(item.unit_cost) / (factor || 1));
      });
      for (const [productId, quantity] of quantities) {
        const [stock] = await tx.$queryRaw`
          SELECT quantity FROM stock WHERE product_id = ${productId} FOR UPDATE
        `;
        if (!stock || Number(stock.quantity) + 0.0005 < quantity) {
          throw new Error('Cannot delete this purchase because some of its stock has already been used');
        }
        await tx.stock.update({
          where: { product_id: productId },
          data: { quantity: { decrement: quantity } },
        });
        await applyBatchDelta(tx, {
          productId,
          quantity: -quantity,
          unitCostBase: costs.get(productId) || 0,
        });
        await tx.stock_movements.create({
          data: {
            product_id: productId,
            movement_type: 'adjustment',
            quantity: -quantity,
            reference_type: 'purchase_cancel',
            reference_id: purchaseId,
            notes: `Stock reversed after cancelling purchase ${purchaseId}`,
            created_by: req.user.id,
          },
        });
      }
      await tx.purchases.update({
        where: { id: purchaseId },
        data: { status: 'cancelled' },
      });
    });
    res.json({ success: true, message: 'Purchase cancelled and stock reversed' });
  } catch (err) {
    console.error('Purchase cancellation error:', err);
    res.status(err.message === 'Purchase not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to cancel purchase' });
  }
});

module.exports = router;
