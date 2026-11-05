/**
 * Convert quantity from one unit to another using conversion factors.
 * Returns quantity in the target unit.
 */
async function convertQuantity(pool, quantity, fromUnitId, toUnitId) {
  if (fromUnitId === toUnitId) return Number(quantity);

  // Direct conversion
  const [direct] = await pool.execute(
    `SELECT factor FROM unit_conversions WHERE from_unit_id = ? AND to_unit_id = ?`,
    [fromUnitId, toUnitId]
  );
  if (direct.length) {
    return Number(quantity) * Number(direct[0].factor);
  }

  // Inverse conversion
  const [inverse] = await pool.execute(
    `SELECT factor FROM unit_conversions WHERE from_unit_id = ? AND to_unit_id = ?`,
    [toUnitId, fromUnitId]
  );
  if (inverse.length) {
    return Number(quantity) / Number(inverse[0].factor);
  }

  throw new Error(`No conversion factor found between unit ${fromUnitId} and ${toUnitId}`);
}

/**
 * Convert any quantity to the product's base unit.
 */
async function toBaseUnit(pool, productId, quantity, unitId) {
  const [products] = await pool.execute(
    `SELECT base_unit_id FROM products WHERE id = ?`,
    [productId]
  );
  if (!products.length) throw new Error('Product not found');

  const baseUnitId = products[0].base_unit_id;
  return convertQuantity(pool, quantity, unitId, baseUnitId);
}

/**
 * Generate sequential receipt number: BSS-YYYYMMDD-XXXX
 */
async function generateReceiptNumber(pool) {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `BSS-${dateStr}-`;

  const [rows] = await pool.execute(
    `SELECT receipt_number FROM sales
     WHERE receipt_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length) {
    const last = rows[0].receipt_number;
    const lastSeq = parseInt(last.split('-').pop(), 10);
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
