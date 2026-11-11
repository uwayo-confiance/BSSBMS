const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit, applyBatchDelta, money } = require('../utils/helpers');
const adjustmentReasons = ['damaged', 'expired', 'lost', 'broken', 'wastage', 'stock_correction', 'opening_balance_correction', 'other'];

async function adjustmentRequiresManagerApproval() {
  const setting = await prisma.system_settings.findUnique({ where: { key: 'inventory' } });
  return setting?.value?.require_adjustment_approval !== false;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { low_only, active } = req.query;
    const isActive = active === 'true' || active === '1' ? 1
      : active === 'false' || active === '0' ? 0
        : active === 'all' ? undefined : 1;
    const [products, inventorySetting] = await Promise.all([
      prisma.products.findMany({
      where: {
        track_stock: 1,
        ...(isActive !== undefined ? { is_active: isActive } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        min_stock_level: true,
        cost_price: true,
        selling_price: true,
        base_unit_id: true,
        category_id: true,
        is_active: true,
      },
      }),
      prisma.system_settings.findUnique({ where: { key: 'inventory' } }),
    ]);
    const defaultThreshold = Number(inventorySetting?.value?.default_low_stock_threshold || 0);
    const productIds = products.map(({ id }) => id);
    const categoryIds = [...new Set(products.map(({ category_id }) => category_id).filter(Boolean))];
    const unitIds = [...new Set(products.map(({ base_unit_id }) => base_unit_id))];
    const [stocks, categories, units] = await Promise.all([
      prisma.stock.findMany({ where: { product_id: { in: productIds } } }),
      prisma.categories.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
      prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, abbreviation: true } }),
    ]);
    const stockByProduct = new Map(stocks.map((stock) => [stock.product_id, stock]));
    const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const data = products.flatMap((product) => {
      const stock = stockByProduct.get(product.id);
      if (!stock) return [];
      const threshold = Number(product.min_stock_level) > 0 ? Number(product.min_stock_level) : defaultThreshold;
      const isLow = threshold > 0 && Number(stock.quantity) <= threshold;
      if (low_only === 'true' && !isLow) return [];
      const unit = unitsById.get(product.base_unit_id);
      return [{
        id: product.id,
        name: product.name,
        sku: product.sku,
        min_stock_level: threshold,
        cost_price: product.cost_price,
        selling_price: product.selling_price,
        quantity: stock.quantity,
        last_updated: stock.last_updated,
        unit_name: unit?.name ?? null,
        abbreviation: unit?.abbreviation ?? null,
        category_name: categoryNames.get(product.category_id) ?? null,
        is_active: product.is_active,
        is_low: isLow ? 1 : 0,
      }];
    }).sort((a, b) => b.is_low - a.is_low || a.name.localeCompare(b.name));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stock' });
  }
});

router.get('/expiry', authenticate, async (req, res) => {
  const days = Number(req.query.days || 60);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ success: false, message: 'Expiry range must be between 1 and 365 days' });
  }
  try {
    const batches = await prisma.stock_batches.findMany({
      where: { remaining_quantity: { gt: 0 }, expires_at: { not: null } },
      orderBy: [{ expires_at: 'asc' }, { product_id: 'asc' }],
    });
    const productIds = [...new Set(batches.map(({ product_id }) => product_id))];
    const products = await prisma.products.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true },
    });
    const names = new Map(products.map((product) => [product.id, product]));
    const today = new Date();
    const data = batches.map((batch) => {
      const daysRemaining = Math.ceil((new Date(batch.expires_at).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
      return {
        ...batch,
        id: batch.id.toString(),
        product: names.get(batch.product_id) || null,
        days_remaining: daysRemaining,
        expiry_status: daysRemaining < 0 ? 'expired'
          : daysRemaining <= 7 ? 'within_7_days'
            : daysRemaining <= 30 ? 'within_30_days'
              : daysRemaining <= 60 ? 'within_60_days' : 'safe',
      };
    }).filter((batch) => batch.days_remaining <= days);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Expiry stock lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to load expiry alerts' });
  }
});

router.get('/valuation', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const [products, stocks, batches] = await Promise.all([
      prisma.products.findMany({
        where: { is_active: 1, track_stock: 1 },
        select: { id: true, name: true, cost_price: true },
      }),
      prisma.stock.findMany(),
      prisma.stock_batches.findMany({ where: { remaining_quantity: { gt: 0 } } }),
    ]);
    const stocksById = new Map(stocks.map((stock) => [stock.product_id, Number(stock.quantity)]));
    const batchesByProduct = new Map();
    for (const batch of batches) {
      const rows = batchesByProduct.get(batch.product_id) || [];
      rows.push(batch);
      batchesByProduct.set(batch.product_id, rows);
    }
    const data = products.map((product) => {
      const quantity = stocksById.get(product.id) || 0;
      const productBatches = batchesByProduct.get(product.id) || [];
      const batchQuantity = productBatches.reduce((sum, batch) => sum + Number(batch.remaining_quantity), 0);
      const batchesValue = productBatches.reduce((sum, batch) =>
        sum + Number(batch.remaining_quantity) * Number(batch.unit_cost_base), 0);
      const batchShare = batchQuantity > 0 ? Math.min(quantity, batchQuantity) / batchQuantity : 0;
      const valuedBatchQuantity = Math.min(quantity, batchQuantity);
      const legacyQuantity = Math.max(0, quantity - valuedBatchQuantity);
      const value = batchesValue * batchShare + legacyQuantity * Number(product.cost_price || 0);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_cost: product.cost_price,
        stock_value: money(value),
      };
    });
    res.json({
      success: true,
      data: { products: data, total_value: money(data.reduce((sum, row) => sum + row.stock_value, 0)) },
    });
  } catch (err) {
    console.error('Inventory valuation error:', err);
    res.status(500).json({ success: false, message: 'Failed to calculate inventory valuation' });
  }
});

router.put('/:productId/quantity', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const productId = Number(req.params.productId);
  const quantity = Number(req.body.quantity);
  const reason = String(req.body.reason || '');
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be a non-negative number' });
  }
  if (!adjustmentReasons.includes(reason)) {
    return res.status(400).json({ success: false, message: 'Select a valid stock adjustment reason' });
  }
  try {
    if (req.user.role === 'stock_keeper' && await adjustmentRequiresManagerApproval()) {
      return res.status(403).json({ success: false, message: 'A manager must approve this stock adjustment' });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw`
        SELECT s.quantity
        FROM stock s
        JOIN products p ON p.id = s.product_id
        WHERE s.product_id = ${productId} AND p.is_active = 1 AND p.track_stock = 1
        FOR UPDATE
      `;
      if (!row) return false;
      const previousQuantity = Number(row.quantity);
      const difference = Number((quantity - previousQuantity).toFixed(3));
      if (difference !== 0) {
        await tx.stock.update({ where: { product_id: productId }, data: { quantity } });
        const product = await tx.products.findUnique({ where: { id: productId }, select: { cost_price: true } });
        await applyBatchDelta(tx, {
          productId,
          quantity: difference,
          unitCostBase: Number(product?.cost_price || 0),
        });
        await tx.stock_movements.create({
          data: {
            product_id: productId,
            movement_type: 'adjustment',
            quantity: difference,
            reference_type: 'adjustment',
            adjustment_reason: reason,
            previous_quantity: previousQuantity,
            new_quantity: quantity,
            notes: req.body.notes || `Stock quantity changed from ${previousQuantity} to ${quantity}`,
            created_by: req.user.id,
          },
        });
      }
      return true;
    });
    if (!updated) return res.status(404).json({ success: false, message: 'Active stock record not found' });
    res.json({ success: true, message: 'Stock quantity updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update stock quantity' });
  }
});

router.post('/adjust', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    if (req.user.role === 'stock_keeper' && await adjustmentRequiresManagerApproval()) {
      return res.status(403).json({ success: false, message: 'A manager must approve this stock adjustment' });
    }
    const { product_id, quantity, unit_id, reason, notes } = req.body;
    const productId = Number(product_id);
    const amount = Number(quantity);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(Number(unit_id)) || Number(unit_id) < 1 ||
        !Number.isFinite(amount) || amount === 0 || !adjustmentReasons.includes(String(reason || ''))) {
      return res.status(400).json({ success: false, message: 'Product, non-zero quantity, unit and valid adjustment reason are required' });
    }
    await prisma.$transaction(async (tx) => {
      const quantityBase = await toBaseUnit(tx, productId, Math.abs(amount), unit_id) * Math.sign(amount);
      const [row] = await tx.$queryRaw`SELECT quantity FROM stock WHERE product_id = ${productId} FOR UPDATE`;
      if (!row) throw new Error('Stock record not found');
      const previousQuantity = Number(row.quantity);
      const newQuantity = Math.round((previousQuantity + quantityBase) * 1000) / 1000;
      if (newQuantity < -0.0005) throw new Error('Stock adjustment cannot make inventory negative');
      await tx.stock.update({
        where: { product_id: productId },
        data: { quantity: newQuantity },
      });
      const product = await tx.products.findUnique({ where: { id: productId }, select: { cost_price: true } });
      await applyBatchDelta(tx, {
        productId,
        quantity: quantityBase,
        unitCostBase: Number(product?.cost_price || 0),
      });
      await tx.stock_movements.create({
        data: {
          product_id: productId,
          movement_type: 'adjustment',
          quantity: quantityBase,
          reference_type: 'adjustment',
          adjustment_reason: reason,
          previous_quantity: previousQuantity,
          new_quantity: newQuantity,
          notes: notes || reason || null,
          created_by: req.user.id,
        },
      });
    });
    res.json({ success: true, message: 'Stock adjusted successfully' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: err.message || 'Adjustment failed' });
  }
});

router.get('/movements', authenticate, async (req, res) => {
  try {
    const { product_id, limit = 100 } = req.query;
    const movements = await prisma.stock_movements.findMany({
      where: product_id ? { product_id: Number(product_id) } : undefined,
      orderBy: { created_at: 'desc' },
      take: parseInt(limit, 10),
    });
    const productIds = [...new Set(movements.map(({ product_id: id }) => id))];
    const userIds = [...new Set(movements.map(({ created_by }) => created_by).filter(Boolean))];
    const [products, users] = await Promise.all([
      prisma.products.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
    ]);
    const productNames = new Map(products.map(({ id, name }) => [id, name]));
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    res.json({
      success: true,
      data: movements.map((movement) => ({
        ...movement,
        product_name: productNames.get(movement.product_id),
        created_by_name: userNames.get(movement.created_by) ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch movements' });
  }
});

module.exports = router;
