const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRefundLines } = require('../src/utils/refundMath');

test('refund pricing prorates original sale-wide discounts and base-unit quantities', () => {
  const lines = calculateRefundLines([
    { id: 1n, quantity: 3, quantity_base: 60, total_price: 300, product_name_snapshot: 'Beer' },
    { id: 2n, quantity: 2, quantity_base: 24, total_price: 200, product_name_snapshot: 'Juice' },
  ], 450, [
    { id: 1n, quantity: 1, disposition: 'sellable' },
    { id: 2n, quantity: 1, disposition: 'damaged' },
  ], new Map());

  assert.deepEqual(lines.map(({ amount, quantityBase }) => ({ amount, quantityBase })), [
    { amount: 90, quantityBase: 20 },
    { amount: 90, quantityBase: 12 },
  ]);
});

test('refund pricing rejects cumulative quantities above the original sale quantity', () => {
  assert.throws(() => calculateRefundLines([
    { id: 1n, quantity: 2, quantity_base: 48, total_price: 240, product_name_snapshot: 'Beer' },
  ], 240, [{ id: 1n, quantity: 1, disposition: 'sellable' }], new Map([['1', 1.5]])),
  /Refund quantity exceeds the remaining quantity/);
});
