/**
 * Convert quantity from one unit to another using conversion factors.
 * Returns quantity in the target unit.
 */
async function convertQuantity(db, quantity, fromUnitId, toUnitId) {
  if (Number(fromUnitId) === Number(toUnitId)) return Number(quantity);

  const direct = await db.unit_conversions.findUnique({
    where: { from_unit_id_to_unit_id: { from_unit_id: Number(fromUnitId), to_unit_id: Number(toUnitId) } },
    select: { factor: true },
  });
  if (direct) return Number(quantity) * Number(direct.factor);

  const inverse = await db.unit_conversions.findUnique({
    where: { from_unit_id_to_unit_id: { from_unit_id: Number(toUnitId), to_unit_id: Number(fromUnitId) } },
    select: { factor: true },
  });
  if (inverse) return Number(quantity) / Number(inverse.factor);

  throw new Error(`No conversion factor found between unit ${fromUnitId} and ${toUnitId}`);
}

/**
 * Convert any quantity to the product's base unit.
 */
async function toBaseUnit(db, productId, quantity, unitId) {
  const product = await db.products.findUnique({
    where: { id: Number(productId) },
    select: { base_unit_id: true },
  });
  if (!product) throw new Error('Product not found');
  const productUnit = await db.product_units.findUnique({
    where: { product_id_unit_id: { product_id: Number(productId), unit_id: Number(unitId) } },
    select: { conversion_factor: true, is_active: true },
  });
  if (productUnit) {
    if (!productUnit.is_active) throw new Error('This unit is inactive for the product');
    return Math.round(Number(quantity) * Number(productUnit.conversion_factor) * 1000) / 1000;
  }
  const converted = await convertQuantity(db, quantity, unitId, product.base_unit_id);
  return Math.round(converted * 1000) / 1000;
}

async function applyBatchDelta(db, { productId, quantity, unitCostBase, supplierId = null, expiryDate = null, batchNumber = null }) {
  const delta = Number(quantity);
  if (!Number.isFinite(delta) || delta === 0) return;
  if (delta > 0) {
    await db.stock_batches.create({
      data: {
        product_id: Number(productId),
        supplier_id: supplierId,
        batch_number: batchNumber,
        received_quantity: delta,
        remaining_quantity: delta,
        expires_at: expiryDate,
        unit_cost_base: Number(unitCostBase) || 0,
      },
    });
    return;
  }

  let remaining = Math.abs(delta);
  const batches = await db.stock_batches.findMany({
    where: { product_id: Number(productId), remaining_quantity: { gt: 0 } },
    orderBy: [{ expires_at: 'asc' }, { created_at: 'asc' }],
  });
  for (const batch of batches) {
    if (remaining <= 0) break;
    const removed = Math.min(remaining, Number(batch.remaining_quantity));
    await db.stock_batches.update({
      where: { id: batch.id },
      data: { remaining_quantity: { decrement: removed } },
    });
    remaining = Math.round((remaining - removed) * 1000) / 1000;
  }
}

async function resolveProductUnit(db, productId, unitId, operation) {
  const product = await db.products.findUnique({
    where: { id: Number(productId) },
    select: {
      id: true,
      name: true,
      base_unit_id: true,
      purchase_unit_id: true,
      sale_unit_id: true,
      cost_price: true,
      selling_price: true,
    },
  });
  if (!product) throw new Error('Product not found');

  const productUnit = await db.product_units.findUnique({
    where: { product_id_unit_id: { product_id: Number(productId), unit_id: Number(unitId) } },
  });
  const unit = await db.units.findUnique({
    where: { id: Number(unitId) },
    select: { name: true },
  });
  if (!unit) throw new Error('Unit not found');

  if (productUnit) {
    const enabled = operation === 'sale' ? productUnit.is_sale_enabled : productUnit.is_purchase_enabled;
    if (!productUnit.is_active || !enabled) {
      throw new Error(`${unit.name} is not enabled for ${operation} on ${product.name}`);
    }
    return {
      product,
      unitName: unit.name,
      conversionFactor: Number(productUnit.conversion_factor),
      unitPrice: operation === 'sale' ? productUnit.selling_price : productUnit.purchase_price,
      isConfigured: true,
    };
  }

  const legacyUnitId = operation === 'sale' ? product.sale_unit_id : product.purchase_unit_id;
  if (Number(legacyUnitId) !== Number(unitId)) {
    throw new Error(`${unit.name} is not configured for ${operation} on ${product.name}`);
  }
  const conversionFactor = await convertQuantity(db, 1, unitId, product.base_unit_id);
  return {
    product,
    unitName: unit.name,
    conversionFactor,
    unitPrice: operation === 'sale' ? product.selling_price : product.cost_price,
    isConfigured: false,
  };
}

/**
 * Generate sequential receipt number: BSS-YYYYMMDD-XXXX
 */
async function generateReceiptNumber(db) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `BSS-${dateStr}-`;

  const lastSale = await db.sales.findFirst({
    where: { receipt_number: { startsWith: prefix } },
    orderBy: { id: 'desc' },
    select: { receipt_number: true },
  });

  let seq = 1;
  if (lastSale) {
    const lastSeq = parseInt(lastSale.receipt_number.split('-').pop(), 10);
    seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Safe decimal rounding for money (2 places)
 */
function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Format RWF currency
 */
function formatRWF(amount) {
  return new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

module.exports = {
  convertQuantity,
  toBaseUnit,
  resolveProductUnit,
  applyBatchDelta,
  generateReceiptNumber,
  money,
  formatRWF,
};
