const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { convertQuantity } = require('../utils/helpers');
const { recordAuditEvent } = require('../utils/auditLog');

const productManagers = ['admin', 'manager', 'stock_keeper'];

function isEnabled(value) {
  return value === true || value === 1 || value === '1';
}

function normalizeProductUnits(rows, { baseUnitId, baseCost = 0, baseSellingPrice = 0 } = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const normalized = source.map((row) => ({
    unit_id: Number(row.unit_id),
    conversion_factor: Number(row.conversion_factor),
    purchase_price: row.purchase_price === '' || row.purchase_price == null ? null : Number(row.purchase_price),
    selling_price: row.selling_price === '' || row.selling_price == null ? null : Number(row.selling_price),
    is_purchase_enabled: isEnabled(row.is_purchase_enabled) ? 1 : 0,
    is_sale_enabled: isEnabled(row.is_sale_enabled) ? 1 : 0,
    is_active: row.is_active === undefined ? 1 : (isEnabled(row.is_active) ? 1 : 0),
    is_default_purchase: isEnabled(row.is_default_purchase) ? 1 : 0,
    is_default_sale: isEnabled(row.is_default_sale) ? 1 : 0,
  }));
  if (!normalized.some((row) => row.unit_id === Number(baseUnitId))) {
    normalized.unshift({
      unit_id: Number(baseUnitId),
      conversion_factor: 1,
      purchase_price: Number(baseCost) || 0,
      selling_price: Number(baseSellingPrice) || 0,
      is_purchase_enabled: 1,
      is_sale_enabled: 1,
      is_active: 1,
      is_default_purchase: source.some((row) => isEnabled(row.is_default_purchase)) ? 0 : 1,
      is_default_sale: source.some((row) => isEnabled(row.is_default_sale)) ? 0 : 1,
    });
  }

  const ids = new Set();
  for (const row of normalized) {
    if (!Number.isInteger(row.unit_id) || row.unit_id < 1 || ids.has(row.unit_id)) {
      throw new Error('Each product unit must use a unique valid unit');
    }
    ids.add(row.unit_id);
    if (!Number.isFinite(row.conversion_factor) || row.conversion_factor < 0.0001 ||
        !Number.isFinite(row.purchase_price ?? 0) || (row.purchase_price ?? 0) < 0 ||
        !Number.isFinite(row.selling_price ?? 0) || (row.selling_price ?? 0) < 0) {
      throw new Error('Unit conversion factors must be positive and prices must be non-negative');
    }
    if (row.unit_id !== Number(baseUnitId) && row.is_active && row.is_purchase_enabled &&
        (row.purchase_price == null || row.purchase_price <= 0)) {
      throw new Error('A positive purchase price is required for every active purchase unit');
    }
    if (row.is_active && row.is_sale_enabled && row.selling_price == null) {
      throw new Error('A selling price is required for every active sale unit');
    }
    if (row.unit_id !== Number(baseUnitId) && row.is_active && row.is_sale_enabled && row.selling_price <= 0) {
      throw new Error('A positive selling price is required for every active sale unit');
    }
    if (row.unit_id === Number(baseUnitId) && row.conversion_factor !== 1) {
      throw new Error('The base unit conversion factor must be 1');
    }
    if (row.unit_id === Number(baseUnitId) && !row.is_active) {
      throw new Error('The base unit must remain active');
    }
    if ((row.is_default_purchase && (!row.is_purchase_enabled || !row.is_active)) ||
        (row.is_default_sale && (!row.is_sale_enabled || !row.is_active))) {
      throw new Error('Default units must be active and enabled for the selected operation');
    }
  }

  for (const operation of ['purchase', 'sale']) {
    const enabledKey = `is_${operation}_enabled`;
    const defaultKey = `is_default_${operation}`;
    const enabled = normalized.filter((row) => row.is_active && row[enabledKey]);
    if (enabled.filter((row) => row[defaultKey]).length > 1) {
      throw new Error(`Only one default ${operation} unit is allowed`);
    }
    if (enabled.length && !enabled.some((row) => row[defaultKey])) enabled[0][defaultKey] = 1;
  }
  return normalized;
}

async function saveProductUnits(tx, productId, rows) {
  const unitIds = rows.map(({ unit_id }) => unit_id);
  const units = await tx.units.findMany({ where: { id: { in: unitIds } }, select: { id: true } });
  if (units.length !== unitIds.length) throw new Error('One or more selected units do not exist');

  await tx.product_units.updateMany({
    where: { product_id: productId },
    data: { is_default_purchase: 0, is_default_sale: 0 },
  });
  for (const row of rows) {
    await tx.product_units.upsert({
      where: { product_id_unit_id: { product_id: productId, unit_id: row.unit_id } },
      create: { product_id: productId, ...row },
      update: row,
    });
  }
  await tx.product_units.updateMany({
    where: { product_id: productId, unit_id: { notIn: unitIds } },
    data: { is_active: 0, is_default_purchase: 0, is_default_sale: 0 },
  });
}

function unitConfigurationSignature(rows) {
  return rows
    .map((row) => [
      Number(row.unit_id),
      Number(row.conversion_factor),
      Number(row.is_purchase_enabled),
      Number(row.is_sale_enabled),
      Number(row.is_active),
      Number(row.is_default_purchase),
      Number(row.is_default_sale),
    ])
    .sort((a, b) => a[0] - b[0]);
}

async function addProductLabels(products, { includeUnit = false } = {}) {
  const categoryIds = [...new Set(products.map(({ category_id }) => category_id).filter(Boolean))];
  const unitIds = [...new Set(products.flatMap(({ base_unit_id }) => [base_unit_id]))];
  const productIds = products.map(({ id }) => id);
  const [categories, units, stocks, productUnits] = await Promise.all([
    prisma.categories.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
    includeUnit
      ? prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, abbreviation: true } })
      : Promise.resolve([]),
    prisma.stock.findMany({ where: { product_id: { in: productIds } }, select: { product_id: true, quantity: true, last_updated: true } }),
    prisma.product_units.findMany({
      where: { product_id: { in: productIds } },
      orderBy: [{ product_id: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const productUnitIds = [...new Set(productUnits.map(({ unit_id }) => unit_id))];
  const productUnitLabels = await prisma.units.findMany({
    where: { id: { in: productUnitIds } },
    select: { id: true, name: true, abbreviation: true },
  });
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const unitDetails = new Map(units.map((unit) => [unit.id, unit]));
  const productUnitNames = new Map(productUnitLabels.map((unit) => [unit.id, unit]));
  const stockDetails = new Map(stocks.map((stock) => [stock.product_id, stock]));
  const productUnitRows = new Map();
  for (const productUnit of productUnits) {
    const rows = productUnitRows.get(productUnit.product_id) || [];
    rows.push({ ...productUnit, unit: productUnitNames.get(productUnit.unit_id) ?? null });
    productUnitRows.set(productUnit.product_id, rows);
  }

  return products.map((product) => {
    const stock = stockDetails.get(product.id);
    const unit = unitDetails.get(product.base_unit_id);
    return {
      ...product,
      product_units: productUnitRows.get(product.id) || [],
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
    const [data] = await addProductLabels([product], { includeUnit: true });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/:id/units', authenticate, authorize('admin'), async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isInteger(productId) || productId < 1 || !Array.isArray(req.body.product_units)) {
      return res.status(400).json({ success: false, message: 'A valid product ID and product_units list are required' });
    }
    if (!reason) return res.status(400).json({ success: false, message: 'A reason is required to change product units or conversions' });

    const rows = await prisma.$transaction(async (tx) => {
      const [product] = await tx.$queryRaw`
        SELECT id, base_unit_id, cost_price, selling_price
        FROM products
        WHERE id = ${productId}
        FOR UPDATE
      `;
      if (!product) throw new Error('Product not found');
      const normalized = normalizeProductUnits(req.body.product_units, {
        baseUnitId: product.base_unit_id,
        baseCost: product.cost_price,
        baseSellingPrice: product.selling_price,
      });
      const selectedUnits = await tx.units.findMany({
        where: { id: { in: normalized.map(({ unit_id }) => unit_id) } },
        select: { id: true, name: true },
      });
      const countableUnitIds = new Set(selectedUnits
        .filter(({ name }) => /\b(crate|carton|pack|case|bottle|can|piece)\b/i.test(name))
        .map(({ id }) => id));
      if (normalized.some((row) => countableUnitIds.has(row.unit_id) &&
          row.unit_id !== Number(product.base_unit_id) && !Number.isInteger(row.conversion_factor))) {
        throw new Error('Conversions for countable units must be whole numbers');
      }
      const previous = await tx.product_units.findMany({ where: { product_id: productId } });
      const previousByUnit = new Map(previous.map((row) => [row.unit_id, row]));
      const nextUnitIds = new Set(normalized.map(({ unit_id }) => unit_id));

      for (const row of normalized) {
        const old = previousByUnit.get(row.unit_id);
        const nextValues = {
          conversion_factor: row.conversion_factor,
          purchase_price: row.purchase_price,
          selling_price: row.selling_price,
          is_purchase_enabled: row.is_purchase_enabled,
          is_sale_enabled: row.is_sale_enabled,
          is_active: row.is_active,
          is_default_purchase: row.is_default_purchase,
          is_default_sale: row.is_default_sale,
        };
        const oldValues = old ? {
          conversion_factor: Number(old.conversion_factor),
          purchase_price: old.purchase_price == null ? null : Number(old.purchase_price),
          selling_price: old.selling_price == null ? null : Number(old.selling_price),
          is_purchase_enabled: old.is_purchase_enabled,
          is_sale_enabled: old.is_sale_enabled,
          is_active: old.is_active,
          is_default_purchase: old.is_default_purchase,
          is_default_sale: old.is_default_sale,
        } : null;
        if (JSON.stringify(oldValues) !== JSON.stringify(nextValues)) {
          await tx.product_unit_history.create({
            data: {
              product_id: productId,
              unit_id: row.unit_id,
              old_values: oldValues ?? undefined,
              new_values: nextValues,
              reason,
              changed_by: req.user.id,
            },
          });
        }
      }
      for (const old of previous) {
        if (nextUnitIds.has(old.unit_id)) continue;
        await tx.product_unit_history.create({
          data: {
            product_id: productId,
            unit_id: old.unit_id,
            old_values: {
              conversion_factor: Number(old.conversion_factor),
              purchase_price: old.purchase_price == null ? null : Number(old.purchase_price),
              selling_price: old.selling_price == null ? null : Number(old.selling_price),
              is_purchase_enabled: old.is_purchase_enabled,
              is_sale_enabled: old.is_sale_enabled,
              is_active: old.is_active,
              is_default_purchase: old.is_default_purchase,
              is_default_sale: old.is_default_sale,
            },
            new_values: { is_active: 0 },
            reason,
            changed_by: req.user.id,
          },
        });
      }
      await saveProductUnits(tx, productId, normalized);
      await recordAuditEvent(tx, req, {
        action: 'product_units_updated',
        entityType: 'product',
        entityId: productId,
        reason,
        before: { product_id: productId, unit_count: previous.length },
        after: { product_id: productId, unit_count: normalized.length },
      });
      return normalized;
    });
    const [data] = await addProductLabels([await prisma.products.findUnique({ where: { id: productId } })], { includeUnit: true });
    res.json({ success: true, message: 'Product units updated; historical transactions are unchanged', data: data.product_units });
  } catch (err) {
    if (['One or more selected units do not exist', 'Product not found'].includes(err.message)) {
      return res.status(err.message === 'Product not found' ? 404 : 400).json({ success: false, message: err.message });
    }
    if (err.message.includes('conversion') || err.message.includes('Conversions') || err.message.includes('price') || err.message.includes('unit') ||
        err.message.includes('Default')) return res.status(400).json({ success: false, message: err.message });
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update product units' });
  }
});

router.post('/', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, track_stock, track_expiry, require_batch, quantity, product_units,
    } = req.body;

    if (!name || !base_unit_id) {
      return res.status(400).json({ success: false, message: 'Name and base unit are required' });
    }
    let normalizedUnits;
    try {
      normalizedUnits = normalizeProductUnits(product_units, {
        baseUnitId: base_unit_id,
        baseCost: cost_price,
        baseSellingPrice: selling_price,
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    const initialQuantity = quantity === undefined ? 0 : Number(quantity);
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0) {
      return res.status(400).json({ success: false, message: 'Initial quantity must be a non-negative number' });
    }

    const product = await prisma.$transaction(async (tx) => {
      const inventorySetting = await tx.system_settings.findUnique({ where: { key: 'inventory' } });
      const inventoryDefaults = inventorySetting?.value || {};
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
          min_stock_level: min_stock_level == null || Number(min_stock_level) === 0
            ? Number(inventoryDefaults.default_low_stock_threshold || 0)
            : Number(min_stock_level),
          track_stock: track_stock !== false ? 1 : 0,
          track_expiry: isEnabled(track_expiry == null ? inventoryDefaults.track_expiry_by_default : track_expiry) ? 1 : 0,
          require_batch: isEnabled(require_batch == null ? inventoryDefaults.require_batch_by_default : require_batch) ? 1 : 0,
        },
        select: { id: true },
      });
      await saveProductUnits(tx, created.id, normalizedUnits);
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
    if (err.message === 'One or more selected units do not exist') {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'manager', 'stock_keeper'), async (req, res) => {
  try {
    const {
      name, sku, barcode, category_id, description,
      base_unit_id, purchase_unit_id, sale_unit_id,
      cost_price, selling_price, min_stock_level, is_active, track_stock, track_expiry, require_batch, product_units,
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

    let normalizedUnits;
    if (product_units !== undefined) {
      try {
        normalizedUnits = normalizeProductUnits(product_units, {
          baseUnitId: base_unit_id,
          baseCost: cost_price,
          baseSellingPrice: selling_price,
        });
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      const currentUnits = await prisma.product_units.findMany({
        where: { product_id: productId },
      });
      const currentNormalizedUnits = normalizeProductUnits(currentUnits, { baseUnitId: base_unit_id });
      if (JSON.stringify(unitConfigurationSignature(currentNormalizedUnits)) !==
          JSON.stringify(unitConfigurationSignature(normalizedUnits))) {
        return res.status(400).json({
          success: false,
          message: 'Unit conversions and product-unit settings must be changed from Settings with admin access and a reason',
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.products.update({
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
          ...(track_expiry != null ? { track_expiry: isEnabled(track_expiry) ? 1 : 0 } : {}),
          ...(require_batch != null ? { require_batch: isEnabled(require_batch) ? 1 : 0 } : {}),
        },
      });
      if (normalizedUnits) await saveProductUnits(tx, productId, normalizedUnits);
    });
    res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    console.error(err);
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'SKU or barcode already exists' });
    }
    if (err.message === 'One or more selected units do not exist') {
      return res.status(400).json({ success: false, message: err.message });
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
