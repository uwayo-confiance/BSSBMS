const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateExpectedCash } = require('../src/utils/cashLedger');

test('expected cash includes only drawer movements with the correct signs', () => {
  const expected = calculateExpectedCash(10000, [
    { movement_type: 'sale', amount: 50000 },
    { movement_type: 'customer_payment', amount: 5000 },
    { movement_type: 'cash_deposit', amount: 2000 },
    { movement_type: 'refund', amount: 1000 },
    { movement_type: 'expense', amount: 3000 },
    { movement_type: 'supplier_payment', amount: 4000 },
    { movement_type: 'cash_withdrawal', amount: 2000 },
    { movement_type: 'cash_drop', amount: 5000 },
    { movement_type: 'cash_adjustment_in', amount: 1500 },
    { movement_type: 'cash_adjustment_out', amount: 500 },
  ]);
  assert.equal(expected, 53000);
});

test('expected cash rejects unknown movement types instead of silently ignoring them', () => {
  assert.throws(
    () => calculateExpectedCash(1000, [{ movement_type: 'mobile_money', amount: 500 }]),
    /Unsupported cash movement type/,
  );
});
