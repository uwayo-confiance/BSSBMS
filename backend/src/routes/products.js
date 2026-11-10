const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

async function addProductLabels(products, { includeUnit = false } = {}) {
  const categoryIds = [...new Set(products.map(({ category_id }) => category_id).filter(Boolean))];
  const unitIds = [...new Set(products.flatMap(({ base_unit_id }) => [base_unit_id]))];
  const productIds = products.map(({ id }) => id);
  const [categories, units, stocks] = await Promise.all([
    prisma.categories.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
    includeUnit
      ? prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, abbreviation: true } })
      : Promise.resolve([]),
    prisma.stock.findMany({ where: { product_id: { in: productIds } }, select: { product_id: true, quantity: true, last_updated: true } }),
  ]);
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const unitDetails = new Map(units.map((unit) => [unit.id, unit]));
  const stockDetails = new Map(stocks.map((stock) => [stock.product_id, stock]));

  return products.map((product) => {
    const stock = stockDetails.get(product.id);
    const unit = unitDetails.get(product.base_unit_id);
    return {
      ...product,
      category_name: categoryNames.get(product.category_id) ?? null,
      ...(includeUnit ? {
        base_unit_name: unit?.name ?? null,
        base_unit_abbr: unit?.abbreviation ?? null,
      } : {}),
      stock_qty: stock?.quantity ?? null,
      ...(includeUnit ? { stock_updated: stock?.last_updated ?? null } : {}),
    };
  });
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category_id, active } = req.query;
    const products = await prisma.products.findMany({
      where: {
        ...(search ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
            { barcode: { contains: search } },
          ],
        } : {}),
        ...(category_id ? { category_id: Number(category_id) } : {}),
        ...(active !== undefined ? { is_active: active === 'true' || active === '1' ? 1 : 0 } : {}),
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: await addProductLabels(products, { includeUnit: true }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    const product = await prisma.products.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const [data] = await addProductLabels([product]);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, track_stock, quantity,
    } = req.body;

    if (!name || !base_unit_id) {
      return res.status(400).json({ success: false, message: 'Name and base unit are required' });
    }
    const initialQuantity = quantity === undefined ? 0 : Number(quantity);
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0) {
      return res.status(400).json({ success: false, message: 'Initial quantity must be a non-negative number' });
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.products.create({
        data: {
          name,
          sku: sku || null,
          barcode: barcode || null,
          category_id: category_id ? Number(category_id) : null,
          description: description || null,
          base_unit_id: Number(base_unit_id),
          purchase_unit_id: purchase_unit_id ? Number(purchase_unit_id) : null,
          sale_unit_id: sale_unit_id ? Number(sale_unit_id) : null,
          cost_price: cost_price || 0,
          selling_price: selling_price || 0,
          min_stock_level: min_stock_level || 0,
          track_stock: track_stock !== false ? 1 : 0,
        },
        select: { id: true },
      });
      await tx.stock.create({ data: { product_id: created.id, quantity: initialQuantity } });
      if (initialQuantity > 0) {
        await tx.stock_movements.create({
          data: {
            product_id: created.id,
            movement_type: 'adjustment',
            quantity: initialQuantity,
            reference_type: 'adjustment',
            notes: 'Initial stock when product was created',
            created_by: req.user.id,
          },
        });
      }
      return created;
    });
    res.status(201).json({ success: true, message: 'Product created', data: product });
  } catch (err) {
    console.error(err);
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'SKU or barcode already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, is_active, track_stock,
    } = req.body;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    if (typeof name !== 'string' || !name.trim() || !base_unit_id) {
      return res.status(400).json({ success: false, message: 'Name and base unit are required' });
    }
    for (const [field, value] of Object.entries({ cost_price, selling_price, min_stock_level })) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return res.status(400).json({ success: false, message: `${field.split('_').join(' ')} must be a non-negative number` });
      }
    }
    if (is_active !== undefined && is_active !== 0 && is_active !== 1 && is_active !== false && is_active !== true) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const existing = await prisma.products.findUnique({
      where: { id: productId },
      select: { base_unit_id: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });
    if (existing.base_unit_id !== Number(base_unit_id)) {
      return res.status(400).json({ success: false, message: 'Base unit cannot be changed after a product is created' });
    }

    await prisma.products.update({
      where: { id: productId },
      data: {
        name: name.trim(),
        sku: sku || null,
        barcode: barcode || null,
        category_id: category_id ? Number(category_id) : null,
        description: description || null,
        base_unit_id: Number(base_unit_id),
        purchase_unit_id: purchase_unit_id ? Number(purchase_unit_id) : null,
        sale_unit_id: sale_unit_id ? Number(sale_unit_id) : null,
        ...(cost_price != null ? { cost_price } : {}),
        ...(selling_price != null ? { selling_price } : {}),
        ...(min_stock_level != null ? { min_stock_level } : {}),
        ...(is_active != null ? { is_active: Number(is_active) } : {}),
        ...(track_stock != null ? { track_stock: Number(track_stock) } : {}),
      },
    });
    res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    console.error(err);
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'SKU or barcode already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

router.patch('/bulk/deactivate', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1)) {
      return res.status(400).json({ success: false, message: 'A non-empty list of valid product IDs is required' });
    }
    const productIds = [...new Set(ids.map(Number))];
    const result = await prisma.products.updateMany({
      where: { id: { in: productIds } },
      data: { is_active: 0 },
    });
    res.json({ success: true, message: 'Selected products deactivated', data: { updated: result.count } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to deactivate selected products' });
  }
});

router.patch('/:id/restore', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    const result = await prisma.products.updateMany({ where: { id: productId }, data: { is_active: 1 } });
    if (result.count === 0) {
      const existing = await prisma.products.findUnique({ where: { id: productId }, select: { id: true } });
      if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, message: 'Product restored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to restore product' });
  }
});

module.exports = router;
