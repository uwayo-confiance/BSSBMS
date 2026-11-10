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
  return convertQuantity(db, quantity, unitId, product.base_unit_id);
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
  generateReceiptNumber,
  money,
  formatRWF,
};
