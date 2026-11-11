const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { resolveProductUnit, money } = require('../utils/helpers');

const managers = ['admin', 'manager', 'stock_keeper'];
const makeNumber = (prefix) => `${prefix}-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;

function validId(value) {
  return /^\d+$/.test(String(value)) && BigInt(value) > 0n;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const orders = await prisma.purchase_orders.findMany({
      where: req.query.status ? { status: String(req.query.status) } : undefined,
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const ids = orders.map(({ id }) => id);
    const [items, suppliers] = await Promise.all([
      prisma.purchase_order_items.findMany({ where: { purchase_order_id: { in: ids } } }),
      prisma.suppliers.findMany({
        where: { id: { in: [...new Set(orders.map(({ supplier_id }) => supplier_id))] } },
        select: { id: true, name: true },
      }),
    ]);
    const supplierNames = new Map(suppliers.map(({ id, name }) => [id, name]));
    res.json({
      success: true,
      data: orders.map((order) => ({
        ...order,
        id: order.id.toString(),
        supplier_name: supplierNames.get(order.supplier_id) || null,
        items: items.filter((item) => item.purchase_order_id === order.id),
      })),
    });
  } catch (err) {
    console.error('Purchase order list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load purchase orders' });
  }
});

router.post('/', authenticate, authorize(...managers), async (req, res) => {
  const { supplier_id, expected_date, notes, items } = req.body;
  const supplierId = Number(supplier_id);
  if (!Number.isInteger(supplierId) || supplierId < 1 || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'A supplier and at least one product are required' });
  }
  if (expected_date && (Number.isNaN(new Date(`${expected_date}T00:00:00.000Z`).getTime()) ||
      new Date(`${expected_date}T00:00:00.000Z`).toISOString().slice(0, 10) !== expected_date)) {
    return res.status(400).json({ success: false, message: 'Expected date must be a valid YYYY-MM-DD date' });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const supplier = await tx.suppliers.findUnique({ where: { id: supplierId } });
      if (!supplier || !supplier.is_active) throw new Error('Select an active supplier');
      const lines = [];
      let subtotal = 0;
      for (const item of items) {
        const productId = Number(item.product_id);
        const unitId = Number(item.unit_id);
        const quantity = Number(item.quantity);
        const cost = Number(item.expected_unit_cost);
        if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(unitId) || unitId < 1 ||
            !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost <= 0) {
          throw new Error('Each line needs a product, purchase unit, positive quantity and positive expected cost');
        }
        const details = await resolveProductUnit(tx, productId, unitId, 'purchase');
        const totalCost = money(quantity * cost);
        subtotal = money(subtotal + totalCost);
        lines.push({
          product_id: productId,
          product_name_snapshot: details.product.name,
          quantity,
          unit_id: unitId,
          unit_name_snapshot: details.unitName,
          conversion_factor_snapshot: details.conversionFactor,
          expected_unit_cost: cost,
          total_cost: totalCost,
        });
      }

      const created = await tx.purchase_orders.create({
        data: {
          order_number: makeNumber('PO'),
          supplier_id: supplierId,
          status: 'draft',
          expected_date: expected_date ? new Date(`${expected_date}T00:00:00.000Z`) : null,
          subtotal,
          total_amount: subtotal,
          notes: notes || null,
          created_by: req.user.id,
        },
      });
      for (const line of lines) {
        await tx.purchase_order_items.create({
          data: { purchase_order_id: created.id, ...line },
        });
      }
      return created;
    });
    res.status(201).json({ success: true, message: 'Purchase order saved as draft', data: { ...order, id: order.id.toString() } });
  } catch (err) {
    console.error('Purchase order creation error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to create purchase order' });
  }
});

router.patch('/:id/status', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid purchase order ID' });
  const orderId = BigInt(req.params.id);
  const { status, reason } = req.body;
  if (['approved', 'cancelled'].includes(status) && !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Only a manager or administrator may approve or cancel a purchase order' });
  }
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.purchase_orders.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('Purchase order not found');
      if (status === 'submitted' && order.status === 'draft') {
        await tx.purchase_orders.update({ where: { id: orderId }, data: { status: 'submitted' } });
        return;
      }
      if (status === 'approved' && order.status === 'submitted') {
        await tx.purchase_orders.update({
          where: { id: orderId },
          data: { status: 'approved', approved_by: req.user.id },
        });
        return;
      }
      if (status === 'cancelled' && ['draft', 'submitted', 'approved', 'partially_received'].includes(order.status)) {
        if (typeof reason !== 'string' || !reason.trim()) throw new Error('A cancellation reason is required');
        await tx.purchase_orders.update({
          where: { id: orderId },
          data: { status: 'cancelled', cancel_reason: reason.trim(), cancelled_by: req.user.id },
        });
        return;
      }
      throw new Error(`Cannot change purchase order from ${order.status} to ${status}`);
    });
    res.json({ success: true, message: `Purchase order ${status}` });
  } catch (err) {
    res.status(err.message === 'Purchase order not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to update purchase order' });
  }
});

router.post('/:id/receipts', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid purchase order ID' });
  const orderId = BigInt(req.params.id);
  const { items, invoice_reference, delivery_note, notes, received_at } = req.body;
  const overReceiptApproved = req.body.allow_over_receipt === true &&
    ['admin', 'manager'].includes(req.user.role) &&
    typeof req.body.over_receipt_reason === 'string' && req.body.over_receipt_reason.trim();
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one received item is required' });
  }
  if (received_at && Number.isNaN(new Date(received_at).getTime())) {
    return res.status(400).json({ success: false, message: 'Receiving date must be valid' });
  }
  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${orderId} FOR UPDATE`;
      if (!locked) throw new Error('Purchase order not found');
      const order = await tx.purchase_orders.findUnique({ where: { id: orderId } });
      if (!['approved', 'partially_received'].includes(order.status)) {
        throw new Error('Only approved and partially received orders can receive goods');
      }
      const orderItems = await tx.purchase_order_items.findMany({ where: { purchase_order_id: orderId } });
      const byId = new Map(orderItems.map((item) => [item.id.toString(), item]));
      const seen = new Set();
      const acceptedLines = [];
      let receiptTotal = 0;
      for (const item of items) {
        if (!validId(item.purchase_order_item_id)) throw new Error('Invalid purchase order line');
        const key = String(item.purchase_order_item_id);
        if (seen.has(key)) throw new Error('Each purchase order line can only appear once per receipt');
        seen.add(key);
        const orderItem = byId.get(key);
        if (!orderItem) throw new Error('Received item is not part of this purchase order');
        const accepted = Number(item.accepted_quantity || 0);
        const damaged = Number(item.damaged_quantity || 0);
        const missing = Number(item.missing_quantity || 0);
        const unitCost = Number(item.unit_cost ?? orderItem.expected_unit_cost);
        if (![accepted, damaged, missing, unitCost].every(Number.isFinite) ||
            accepted < 0 || damaged < 0 || missing < 0 || unitCost < 0 || accepted + damaged + missing <= 0) {
          throw new Error('Enter valid accepted, damaged, missing quantities and cost for each received line');
        }
        const factor = Number(orderItem.conversion_factor_snapshot);
        const orderedBase = Number(orderItem.quantity) * factor;
        const outstandingBase = orderedBase - Number(orderItem.quantity_received_base);
        const physicalBase = Math.round((accepted + damaged) * factor * 1000) / 1000;
        const allowOverReceipt = Boolean(overReceiptApproved);
        if (physicalBase > outstandingBase + 0.0005 && !allowOverReceipt) {
          throw new Error(`Received quantity exceeds the outstanding quantity for ${orderItem.product_name_snapshot}`);
        }
        const outstandingUnits = outstandingBase / factor;
        if (missing > outstandingUnits + 0.0005 ||
            (!allowOverReceipt && accepted + damaged + missing > outstandingUnits + 0.0005)) {
          throw new Error(`Reported received and missing quantities exceed the outstanding quantity for ${orderItem.product_name_snapshot}`);
        }
        const product = await tx.products.findUnique({
          where: { id: orderItem.product_id },
          select: { track_expiry: true, require_batch: true },
        });
        if (product?.require_batch && accepted > 0 && !String(item.batch_number || '').trim()) {
          throw new Error(`A batch number is required for ${orderItem.product_name_snapshot}`);
        }
        if (product?.track_expiry && accepted > 0 && !item.expires_at) {
          throw new Error(`An expiry date is required for ${orderItem.product_name_snapshot}`);
        }
        if (item.expires_at && (!/^\d{4}-\d{2}-\d{2}$/.test(item.expires_at) ||
            Number.isNaN(new Date(`${item.expires_at}T00:00:00.000Z`).getTime()) ||
            new Date(`${item.expires_at}T00:00:00.000Z`).toISOString().slice(0, 10) !== item.expires_at)) {
          throw new Error('Expiry date must be a valid date');
        }
        if (item.manufactured_at && (!/^\d{4}-\d{2}-\d{2}$/.test(item.manufactured_at) ||
            Number.isNaN(new Date(`${item.manufactured_at}T00:00:00.000Z`).getTime()) ||
            new Date(`${item.manufactured_at}T00:00:00.000Z`).toISOString().slice(0, 10) !== item.manufactured_at)) {
          throw new Error('Manufacturing date must be a valid date');
        }
        const acceptedBase = Math.round(accepted * factor * 1000) / 1000;
        receiptTotal = money(receiptTotal + accepted * unitCost);
        acceptedLines.push({
          orderItem,
          accepted,
          damaged,
          missing,
          unitCost,
          acceptedBase,
          factor,
          batchNumber: String(item.batch_number || '').trim() || null,
          manufacturedAt: item.manufactured_at ? new Date(`${item.manufactured_at}T00:00:00.000Z`) : null,
          expiresAt: item.expires_at ? new Date(`${item.expires_at}T00:00:00.000Z`) : null,
        });
      }

      const purchase = await tx.purchases.create({
        data: {
          supplier_id: order.supplier_id,
          invoice_number: invoice_reference || null,
          purchase_date: new Date(new Date(received_at || Date.now()).toISOString().slice(0, 10)),
          status: 'received',
          subtotal: receiptTotal,
          total_amount: receiptTotal,
          amount_paid: 0,
          balance: receiptTotal,
          payment_status: receiptTotal > 0 ? 'unpaid' : 'paid',
          notes: overReceiptApproved
            ? [notes, `Over-receipt approved: ${req.body.over_receipt_reason}`].filter(Boolean).join('\n')
            : notes || null,
          created_by: req.user.id,
        },
        select: { id: true },
      });
      const createdReceipt = await tx.goods_receipts.create({
        data: {
          receipt_number: makeNumber('GR'),
          purchase_order_id: orderId,
          supplier_id: order.supplier_id,
          purchase_id: purchase.id,
          invoice_reference: invoice_reference || null,
          delivery_note: delivery_note || null,
          received_at: received_at ? new Date(received_at) : new Date(),
          notes: overReceiptApproved
            ? [notes, `Over-receipt approved: ${req.body.over_receipt_reason}`].filter(Boolean).join('\n')
            : notes || null,
          received_by: req.user.id,
        },
      });

      for (const line of acceptedLines) {
        const { orderItem } = line;
        await tx.goods_receipt_items.create({
          data: {
            receipt_id: createdReceipt.id,
            purchase_order_item_id: orderItem.id,
            product_id: orderItem.product_id,
            accepted_quantity: line.accepted,
            damaged_quantity: line.damaged,
            missing_quantity: line.missing,
            unit_id: orderItem.unit_id,
            conversion_factor_snapshot: line.factor,
            accepted_quantity_base: line.acceptedBase,
            unit_cost: line.unitCost,
            batch_number: line.batchNumber,
            manufactured_at: line.manufacturedAt,
            expires_at: line.expiresAt,
          },
        });
        if (line.accepted > 0) {
          const unitCostBase = line.unitCost / line.factor;
          await tx.purchase_items.create({
            data: {
              purchase_id: purchase.id,
              product_id: orderItem.product_id,
              product_name_snapshot: orderItem.product_name_snapshot,
              quantity: line.accepted,
              unit_id: orderItem.unit_id,
              unit_name_snapshot: orderItem.unit_name_snapshot,
              conversion_factor_snapshot: line.factor,
              quantity_base: line.acceptedBase,
              unit_cost: line.unitCost,
              total_cost: money(line.accepted * line.unitCost),
            },
          });
          await tx.stock.update({
            where: { product_id: orderItem.product_id },
            data: { quantity: { increment: line.acceptedBase } },
          });
          await tx.stock_movements.create({
            data: {
              product_id: orderItem.product_id,
              movement_type: 'purchase',
              quantity: line.acceptedBase,
              reference_type: 'goods_receipt',
              reference_id: createdReceipt.id,
              unit_cost: unitCostBase,
              notes: `Received against ${order.order_number}`,
              created_by: req.user.id,
            },
          });
          await tx.products.update({
            where: { id: orderItem.product_id },
            data: { cost_price: unitCostBase },
          });
          await tx.stock_batches.create({
            data: {
              product_id: orderItem.product_id,
              supplier_id: order.supplier_id,
              receipt_id: createdReceipt.id,
              batch_number: line.batchNumber,
              received_quantity: line.acceptedBase,
              remaining_quantity: line.acceptedBase,
              manufactured_at: line.manufacturedAt,
              expires_at: line.expiresAt,
              unit_cost_base: unitCostBase,
            },
          });
          await tx.purchase_order_items.update({
            where: { id: orderItem.id },
            data: { quantity_received_base: { increment: line.acceptedBase } },
          });
        }
      }

      const updatedItems = await tx.purchase_order_items.findMany({ where: { purchase_order_id: orderId } });
      const fullyReceived = updatedItems.every((item) =>
        Number(item.quantity_received_base) >= Number(item.quantity) * Number(item.conversion_factor_snapshot) - 0.0005
      );
      await tx.purchase_orders.update({
        where: { id: orderId },
        data: { status: fullyReceived ? 'fully_received' : 'partially_received' },
      });
      return { id: createdReceipt.id.toString(), receipt_number: createdReceipt.receipt_number, purchase_id: purchase.id.toString() };
    });
    res.status(201).json({ success: true, message: 'Goods received and stock updated', data: receipt });
  } catch (err) {
    console.error('Goods receipt error:', err);
    res.status(err.message === 'Purchase order not found' ? 404 : 400)
      .json({ success: false, message: err.message || 'Failed to receive goods' });
  }
});

module.exports = router;
