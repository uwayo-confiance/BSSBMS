const { money } = require('./helpers');

async function recordCashMovement(tx, {
  userId,
  movementType,
  amount,
  referenceType,
  referenceId,
  notes,
  idempotencyKey,
}) {
  const value = money(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Cash movement amount must be greater than zero');
  }
  if (idempotencyKey) {
    const existing = await tx.cash_movements.findUnique({ where: { idempotency_key: idempotencyKey } });
    if (existing) {
      if (existing.movement_type !== movementType || Number(existing.amount) !== value ||
          existing.reference_type !== (referenceType || null) ||
          String(existing.reference_id || '') !== String(referenceId || '') ||
          existing.created_by !== userId) {
        throw new Error('Cash movement idempotency key was already used for a different request');
      }
      return existing;
    }
  }

  const [session] = await tx.$queryRaw`
    SELECT id, opening_balance
    FROM cash_sessions
    WHERE opened_by = ${userId} AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
    FOR UPDATE
  `;
  if (!session) throw new Error('Open a cashier shift before recording a cash transaction');
  const movements = await tx.cash_movements.findMany({ where: { session_id: session.id } });
  const expected = calculateExpectedCash(session.opening_balance, movements);
  const decreasesCash = ['expense', 'purchase_payment', 'supplier_payment', 'cash_out', 'refund',
    'cash_drop', 'cash_withdrawal', 'cash_adjustment_out'].includes(movementType);
  if (decreasesCash && value > expected + 0.005) {
    throw new Error('Cash movement exceeds the available drawer balance');
  }

  return tx.cash_movements.create({
    data: {
      session_id: session.id,
      movement_type: movementType,
      amount: value,
      reference_type: referenceType || null,
      reference_id: referenceId == null ? null : BigInt(referenceId),
      notes: notes || null,
      created_by: userId,
      idempotency_key: idempotencyKey || null,
    },
  });
}

function calculateExpectedCash(openingBalance, movements) {
  const signs = {
    sale: 1,
    customer_payment: 1,
    cash_in: 1,
    cash_deposit: 1,
    cash_adjustment_in: 1,
    expense: -1,
    purchase_payment: -1,
    supplier_payment: -1,
    cash_out: -1,
    refund: -1,
    cash_drop: -1,
    cash_withdrawal: -1,
    cash_adjustment_out: -1,
    adjustment: 0,
  };
  return money(Number(openingBalance) + movements.reduce((total, movement) => {
    const sign = signs[movement.movement_type];
    if (sign == null) throw new Error(`Unsupported cash movement type: ${movement.movement_type}`);
    return total + sign * Number(movement.amount);
  }, 0));
}

module.exports = { recordCashMovement, calculateExpectedCash };
