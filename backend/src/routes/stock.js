const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit } = require('../utils/helpers');

router.get('/', authenticate, async (req, res) => {
  try {
    const { low_only, active } = req.query;
    const isActive = active === 'true' || active === '1' ? 1
      : active === 'false' || active === '0' ? 0
        : active === 'all' ? undefined : 1;
    const products = await prisma.products.findMany({
      where: {
        track_stock: 1,
        ...(isActive !== undefined ? { is_active: isActive } : {}),
        ...(low_only === 'true' ? { min_stock_level: { gt: 0 } } : {}),
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
    });
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
      const isLow = Number(product.min_stock_level) > 0 && Number(stock.quantity) <= Number(product.min_stock_level);
      if (low_only === 'true' && !isLow) return [];
      const unit = unitsById.get(product.base_unit_id);
      return [{
        id: product.id,
        name: product.name,
        sku: product.sku,
        min_stock_level: product.min_stock_level,
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

router.put('/:productId/quantity', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  const productId = Number(req.params.productId);
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be a non-negative number' });
  }
  try {
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
        await tx.stock_movements.create({
          data: {
            product_id: productId,
            movement_type: 'adjustment',
            quantity: difference,
            reference_type: 'adjustment',
            notes: `Stock quantity changed from ${previousQuantity} to ${quantity}`,
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
    const { product_id, quantity, unit_id, reason, notes } = req.body;
    if (!product_id || quantity == null || !unit_id) {
      return res.status(400).json({ success: false, message: 'product_id, quantity and unit_id are required' });
    }
    await prisma.$transaction(async (tx) => {
      const quantityBase = await toBaseUnit(tx, product_id, quantity, unit_id);
      await tx.stock.update({
        where: { product_id: Number(product_id) },
        data: { quantity: { increment: quantityBase } },
      });
      await tx.stock_movements.create({
        data: {
          product_id: Number(product_id),
          movement_type: 'adjustment',
          quantity: quantityBase,
          reference_type: 'adjustment',
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
