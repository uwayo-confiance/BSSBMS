const { money } = require('./helpers');

function calculateRefundLines(saleItems, saleTotal, requestedItems, refundedQuantities) {
  const itemTotal = money(saleItems.reduce((sum, item) => sum + Number(item.total_price), 0));
  return requestedItems.map((request) => {
    const item = saleItems.find((candidate) => candidate.id === request.id);
    if (!item) throw new Error('A refund line does not belong to this sale');
    const soldQuantity = Number(item.quantity);
    const previousQuantity = refundedQuantities.get(item.id.toString()) || 0;
    if (request.quantity + previousQuantity > soldQuantity + 0.0005) {
      throw new Error(`Refund quantity exceeds the remaining quantity of ${item.product_name_snapshot}`);
    }
    const quantityBase = Math.round((Number(item.quantity_base) * request.quantity / soldQuantity) * 1000) / 1000;
    const amount = itemTotal > 0
      ? money(Number(saleTotal) * Number(item.total_price) / itemTotal * request.quantity / soldQuantity)
      : 0;
    return {
      item,
      quantity: request.quantity,
      quantityBase,
      disposition: request.disposition,
      amount,
    };
  });
}

module.exports = { calculateRefundLines };
