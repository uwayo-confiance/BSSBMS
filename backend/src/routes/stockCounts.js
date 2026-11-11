const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { money, applyBatchDelta } = require('../utils/helpers');

const managers = ['admin', 'manager'];
const countManagers = ['admin', 'manager', 'stock_keeper'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

router.get('/', authenticate, authorize(...countManagers), async (req, res) => {
  try {
    const sessions = await prisma.stock_count_sessions.findMany({
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const ids = sessions.map(({ id }) => id);
    const items = await prisma.stock_count_items.findMany({ where: { count_session_id: { in: ids } } });
    res.json({
      success: true,
      data: sessions.map((session) => ({
        ...session,
        id: session.id.toString(),
        items: items.filter((item) => item.count_session_id === session.id)
          .map((item) => ({ ...item, id: item.id.toString() })),
      })),
    });
  } catch (err) {
    console.error('Stock count list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stock counts' });
  }
});

router.post('/', authenticate, authorize(...countManagers), async (req, res) => {
  const productIds = req.body.product_ids;
  const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
  if ((productIds !== undefined && (!Array.isArray(productIds) || productIds.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1))) ||
      (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1))) {
    return res.status(400).json({ success: false, message: 'Select valid products or a category' });
  }
  try {
    const products = await prisma.products.findMany({
      where: {
        is_active: 1,
        track_stock: 1,
        ...(productIds?.length ? { id: { in: [...new Set(productIds.map(Number))] } } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      orderBy: { name: 'asc' },
    });
    if (!products.length) return res.status(400).json({ success: false, message: 'No active stock-tracked products matched the count' });
    const stocks = await prisma.stock.findMany({ where: { product_id: { in: products.map(({ id }) => id) } } });
    const stockByProduct = new Map(stocks.map((stock) => [stock.product_id, stock]));
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.stock_count_sessions.create({
        data: {
          count_number: `SC-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          status: 'draft',
          category_id: categoryId,
          notes: req.body.notes || null,
          created_by: req.user.id,
        },
      });
      for (const product of products) {
        await tx.stock_count_items.create({
          data: {
            count_session_id: session.id,
            product_id: product.id,
            product_name_snapshot: product.name,
            expected_quantity: Number(stockByProduct.get(product.id)?.quantity || 0),
          },
        });
      }
      return session;
    });
    res.status(201).json({ success: true, message: 'Stock count started', data: { id: created.id.toString(), count_number: created.count_number } });
  } catch (err) {
    console.error('Stock count creation error:', err);
    res.status(500).json({ success: false, message: 'Failed to start stock count' });
  }
});

router.put('/:id/items', authenticate, authorize(...countManagers), async (req, res) => {
  if (!validId(req.params.id) || !Array.isArray(req.body.items) || req.body.items.length === 0) {
    return res.status(400).json({ success: false, message: 'A valid count and at least one counted item are required' });
  }
  try {
    const countId = BigInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const session = await tx.stock_count_sessions.findUnique({ where: { id: countId } });
      if (!session) throw new Error('Stock count not found');
      if (session.status !== 'draft') throw new Error('Only draft stock counts can be edited');
      for (const item of req.body.items) {
        if (!validId(item.id)) throw new Error('Invalid stock count line');
        const physical = Number(item.physical_quantity);
        if (!Number.isFinite(physical) || physical < 0) throw new Error('Physical quantities must be non-negative numbers');
        const line = await tx.stock_count_items.findFirst({
          where: { id: BigInt(item.id), count_session_id: countId },
        });
        if (!line) throw new Error('Stock count line not found');
        await tx.stock_count_items.update({
          where: { id: line.id },
          data: {
            physical_quantity: physical,
            variance: Math.round((physical - Number(line.expected_quantity)) * 1000) / 1000,
            reason: item.reason || null,
            notes: item.notes || null,
          },
        });
      }
    });
    res.json({ success: true, message: 'Stock count progress saved' });
  } catch (err) {
    res.status(err.message === 'Stock count not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to save stock count' });
  }
});

router.patch('/:id/submit', authenticate, authorize(...countManagers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid stock count ID' });
  try {
    const countId = BigInt(req.params.id);
    const lines = await prisma.stock_count_items.findMany({ where: { count_session_id: countId } });
    if (!lines.length || lines.some((line) => line.physical_quantity == null)) {
      return res.status(400).json({ success: false, message: 'Count every product before submitting' });
    }
    if (lines.some((line) => Number(line.variance) !== 0 && !String(line.reason || '').trim())) {
      return res.status(400).json({ success: false, message: 'Add a reason for every stock variance before submitting' });
    }
    const changed = await prisma.stock_count_sessions.updateMany({
      where: { id: countId, status: 'draft' },
      data: { status: 'submitted', submitted_by: req.user.id, submitted_at: new Date() },
    });
    if (!changed.count) return res.status(400).json({ success: false, message: 'Only draft stock counts can be submitted' });
    res.json({ success: true, message: 'Stock count submitted for approval' });
  } catch (err) {
    console.error('Stock count submission error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit stock count' });
  }
});

router.patch('/:id/review', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id) || !['approved', 'rejected'].includes(req.body.decision)) {
    return res.status(400).json({ success: false, message: 'Choose approve or reject for a valid stock count' });
  }
  const countId = BigInt(req.params.id);
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.stock_count_sessions.findUnique({ where: { id: countId } });
      if (!session) throw new Error('Stock count not found');
      if (session.status !== 'submitted') throw new Error('Only submitted counts can be reviewed');
      if (req.body.decision === 'rejected') {
        if (!String(req.body.review_notes || '').trim()) throw new Error('A rejection reason is required');
        await tx.stock_count_sessions.update({
          where: { id: countId },
          data: { status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date(), review_notes: req.body.review_notes },
        });
        return;
      }

      const lines = await tx.stock_count_items.findMany({ where: { count_session_id: countId } });
      for (const line of lines) {
        const [stock] = await tx.$queryRaw`SELECT quantity FROM stock WHERE product_id = ${line.product_id} FOR UPDATE`;
        if (!stock) throw new Error(`Stock record not found for ${line.product_name_snapshot}`);
        const previousQuantity = Number(stock.quantity);
        const physicalQuantity = Number(line.physical_quantity);
        const difference = Math.round((physicalQuantity - previousQuantity) * 1000) / 1000;
        if (difference < 0 && previousQuantity + difference < -0.0005) {
          throw new Error(`Stock cannot become negative for ${line.product_name_snapshot}`);
        }
        if (difference !== 0) {
          await tx.stock.update({ where: { product_id: line.product_id }, data: { quantity: physicalQuantity } });
          const product = await tx.products.findUnique({
            where: { id: line.product_id },
            select: { cost_price: true },
          });
          await applyBatchDelta(tx, {
            productId: line.product_id,
            quantity: difference,
            unitCostBase: Number(product?.cost_price || 0),
          });
          await tx.stock_movements.create({
            data: {
              product_id: line.product_id,
              movement_type: 'adjustment',
              quantity: difference,
              reference_type: 'stock_count',
              reference_id: countId,
              adjustment_reason: line.reason,
              previous_quantity: previousQuantity,
              new_quantity: physicalQuantity,
              approved_by: req.user.id,
              approved_at: new Date(),
              notes: line.notes || `Approved stock count ${session.count_number}`,
              created_by: req.user.id,
            },
          });
        }
        await tx.stock_count_items.update({
          where: { id: line.id },
          data: { variance: Math.round((physicalQuantity - Number(line.expected_quantity)) * 1000) / 1000 },
        });
      }
      await tx.stock_count_sessions.update({
        where: { id: countId },
        data: {
          status: 'approved',
          reviewed_by: req.user.id,
          reviewed_at: new Date(),
          review_notes: req.body.review_notes || null,
        },
      });
    });
    res.json({ success: true, message: req.body.decision === 'approved' ? 'Stock count approved and adjustments posted' : 'Stock count rejected' });
  } catch (err) {
    console.error('Stock count review error:', err);
    res.status(err.message === 'Stock count not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to review stock count' });
  }
});

router.get('/summary', authenticate, async (req, res) => {
  try {
    const [products, stocks, batches, movements, damagedMovement] = await Promise.all([
      prisma.products.findMany({
        where: { is_active: 1, track_stock: 1 },
        select: { id: true, name: true, cost_price: true, min_stock_level: true, track_expiry: true },
      }),
      prisma.stock.findMany(),
      prisma.stock_batches.findMany({ where: { remaining_quantity: { gt: 0 } } }),
      prisma.stock_movements.findMany({ orderBy: { created_at: 'desc' }, take: 10 }),
      prisma.stock_movements.aggregate({
        where: { adjustment_reason: { in: ['damaged', 'expired', 'broken', 'wastage'] } },
        _sum: { quantity: true },
      }),
    ]);
    const stockByProduct = new Map(stocks.map((row) => [row.product_id, Number(row.quantity)]));
    const batchQty = new Map();
    const batchValue = new Map();
    for (const batch of batches) {
      batchQty.set(batch.product_id, (batchQty.get(batch.product_id) || 0) + Number(batch.remaining_quantity));
      batchValue.set(batch.product_id, (batchValue.get(batch.product_id) || 0) +
        Number(batch.remaining_quantity) * Number(batch.unit_cost_base));
    }
    let totalValue = 0;
    let totalQuantity = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const product of products) {
      const quantity = stockByProduct.get(product.id) || 0;
      totalQuantity += quantity;
      if (quantity <= 0) outOfStock += 1;
      if (Number(product.min_stock_level || 0) > 0 && quantity <= Number(product.min_stock_level)) lowStock += 1;
      const valuedBatchQty = Math.min(quantity, batchQty.get(product.id) || 0);
      totalValue += (batchValue.get(product.id) || 0) * (batchQty.get(product.id) ? valuedBatchQty / batchQty.get(product.id) : 0)
        + Math.max(0, quantity - valuedBatchQty) * Number(product.cost_price || 0);
    }
    const activeBatches = batches.filter((batch) => batch.expires_at);
    const now = new Date();
    const daysUntilExpiry = (batch) =>
      Math.ceil((new Date(batch.expires_at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
    const alerts = activeBatches.filter((batch) => daysUntilExpiry(batch) <= 60);
    const batchProductIds = [...new Set([...batches.map(({ product_id }) => product_id), ...products.map(({ id }) => id)])];
    const names = new Map(products.map(({ id, name }) => [id, name]));
    res.json({
      success: true,
      data: {
        active_products: products.length,
        total_quantity: Math.round(totalQuantity * 1000) / 1000,
        low_stock_products: lowStock,
        out_of_stock_products: outOfStock,
        total_value: money(totalValue),
        expiry_alerts: alerts.length,
        expired_batches: activeBatches.filter((batch) => daysUntilExpiry(batch) < 0).length,
        expiring_within_7_days: activeBatches.filter((batch) => daysUntilExpiry(batch) >= 0 && daysUntilExpiry(batch) <= 7).length,
        expiring_within_30_days: activeBatches.filter((batch) => daysUntilExpiry(batch) >= 0 && daysUntilExpiry(batch) <= 30).length,
        damaged_stock: Math.abs(Math.min(0, Number(damagedMovement._sum.quantity || 0))),
        recent_movements: movements.map((movement) => ({
          ...movement,
          id: movement.id.toString(),
          product_name: names.get(movement.product_id) || `Product ${movement.product_id}`,
        })),
        tracked_products: batchProductIds.length,
      },
    });
  } catch (err) {
    console.error('Stock summary error:', err);
    res.status(500).json({ success: false, message: 'Failed to build inventory summary' });
  }
});

module.exports = router;
