const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { applyBatchDelta, money } = require('../utils/helpers');
const { recordCashMovement } = require('../utils/cashLedger');
const { recordAuditEvent } = require('../utils/auditLog');
const { calculateRefundLines } = require('../utils/refundMath');

const managers = ['admin', 'manager'];
const dispositions = ['sellable', 'damaged', 'quarantine', 'dispose'];
const methods = ['cash', 'mobile_money', 'bank', 'card', 'other'];
const validId = (value) => /^\d+$/.test(String(value)) && BigInt(value) > 0n;

function refundState(method) {
  return method === 'mobile_money' ? 'pending' : 'confirmed';
}

router.get('/sales', authenticate, authorize(...managers), async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  try {
    const sales = await prisma.sales.findMany({
      where: {
        status: 'completed',
        ...(search ? {
          OR: [
            { receipt_number: { contains: search } },
            ...(validId(search) ? [{ id: BigInt(search) }] : []),
          ],
        } : {}),
      },
      orderBy: { sale_date: 'desc' },
      take: 100,
      select: { id: true, receipt_number: true, sale_date: true, total_amount: true, amount_paid: true, customer_id: true },
    });
    res.json({
      success: true,
      data: sales.map((sale) => ({ ...sale, id: sale.id.toString() })),
    });
  } catch (err) {
    console.error('Refund sale search failed:', err);
    res.status(500).json({ success: false, message: 'Failed to search completed sales' });
  }
});

router.get('/sales/:saleId', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.saleId)) return res.status(400).json({ success: false, message: 'Invalid sale ID' });
  try {
    const saleId = BigInt(req.params.saleId);
    const sale = await prisma.sales.findUnique({ where: { id: saleId } });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    const items = await prisma.sale_items.findMany({ where: { sale_id: saleId }, orderBy: { id: 'asc' } });
    const returned = await prisma.$queryRaw`
      SELECT sale_item_id, SUM(quantity) AS returned_quantity
      FROM sale_refund_items i
      JOIN sale_refunds r ON r.id = i.refund_id
      WHERE r.sale_id = ${saleId}
      GROUP BY sale_item_id
    `;
    const byItem = new Map(returned.map((item) => [item.sale_item_id.toString(), Number(item.returned_quantity)]));
    const refunds = await prisma.sale_refunds.findMany({
      where: { sale_id: saleId },
      orderBy: { created_at: 'desc' },
    });
    res.json({
      success: true,
      data: {
        ...sale,
        id: sale.id.toString(),
        items: items.map((item) => ({
          ...item,
          id: item.id.toString(),
          refunded_quantity: byItem.get(item.id.toString()) || 0,
          available_quantity: Math.max(0, Number(item.quantity) - (byItem.get(item.id.toString()) || 0)),
          product_name: item.product_name_snapshot,
          unit_name: item.unit_name_snapshot,
        })),
        refunds: refunds.map((refund) => ({ ...refund, id: refund.id.toString() })),
      },
    });
  } catch (err) {
    console.error('Refund sale details lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to load sale refund details' });
  }
});

router.post('/sales/:saleId', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.saleId)) return res.status(400).json({ success: false, message: 'Invalid sale ID' });
  const saleId = BigInt(req.params.saleId);
  const method = String(req.body.refund_method || '');
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const idempotencyKey = String(req.body.idempotency_key || '').trim();
  const items = req.body.items;
  if (!methods.includes(method) || !reason || reason.length > 255 || !Array.isArray(items) || items.length === 0 ||
      !idempotencyKey || idempotencyKey.length > 100) {
    return res.status(400).json({ success: false, message: 'Refund method, reason, items, and idempotency key are required' });
  }
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    saleId: saleId.toString(),
    method,
    reason,
    items,
    original_reference: req.body.original_reference || null,
    external_reference: req.body.external_reference || null,
  })).digest('hex');
  try {
    const refund = await prisma.$transaction(async (tx) => {
      const [sale] = await tx.$queryRaw`
        SELECT id, receipt_number, status, subtotal, total_amount, amount_paid
        FROM sales WHERE id = ${saleId} FOR UPDATE
      `;
      if (!sale || sale.status !== 'completed') throw new Error('Completed sale not found');
      const existing = await tx.sale_refunds.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.request_hash !== requestHash) throw new Error('Refund idempotency key was already used for a different request');
        return { ...existing, duplicate: true };
      }

      const seen = new Set();
      const requestedItems = [];
      for (const input of items) {
        if (!validId(input.sale_item_id)) throw new Error('Invalid sale item in refund request');
        const key = String(input.sale_item_id);
        const quantity = Number(input.quantity);
        if (seen.has(key) || !Number.isFinite(quantity) || quantity <= 0 ||
            !dispositions.includes(input.disposition)) {
          throw new Error('Refund items require distinct sale lines, positive quantities, and a valid stock disposition');
        }
        seen.add(key);
        requestedItems.push({ id: BigInt(key), quantity, disposition: input.disposition });
      }
      const saleItems = await tx.sale_items.findMany({
        where: { sale_id: saleId, id: { in: requestedItems.map(({ id }) => id) } },
      });
      if (saleItems.length !== requestedItems.length) throw new Error('A refund line does not belong to this sale');
      const priorLines = await tx.$queryRaw`
        SELECT i.sale_item_id, SUM(i.quantity) AS returned_quantity
        FROM sale_refund_items i
        JOIN sale_refunds r ON r.id = i.refund_id
        WHERE r.sale_id = ${saleId}
        GROUP BY i.sale_item_id
      `;
      const refundedQuantities = new Map(priorLines.map((line) => [line.sale_item_id.toString(), Number(line.returned_quantity)]));
      const normalized = calculateRefundLines(saleItems, sale.total_amount, requestedItems, refundedQuantities);
      const total = money(normalized.reduce((sum, item) => sum + item.amount, 0));
      if (total <= 0) throw new Error('Refund amount must be greater than zero');
      const priorRefunds = await tx.sale_refunds.aggregate({
        where: { sale_id: saleId, status: { in: ['pending', 'confirmed'] } },
        _sum: { total_amount: true },
      });
      const availablePaid = money(Number(sale.amount_paid || 0) - Number(priorRefunds._sum.total_amount || 0));
      if (total > availablePaid + 0.005) throw new Error('Refund exceeds the amount actually received for this sale');

      const number = `RF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const pending = method === 'mobile_money';
      const created = await tx.sale_refunds.create({
        data: {
          sale_id: saleId,
          refund_number: number,
          total_amount: total,
          refund_method: method,
          status: refundState(method),
          reason,
          original_reference: req.body.original_reference || null,
          external_reference: req.body.external_reference || null,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          requested_by: req.user.id,
          approved_by: req.user.id,
          confirmed_by: pending ? null : req.user.id,
          confirmed_at: pending ? null : new Date(),
        },
      });
      for (const line of normalized) {
        await tx.sale_refund_items.create({
          data: {
            refund_id: created.id,
            sale_item_id: line.item.id,
            product_id: line.item.product_id,
            product_name_snapshot: line.item.product_name_snapshot || 'Product',
            quantity: line.quantity,
            quantity_base: line.quantityBase,
            disposition: line.disposition,
            refund_amount: line.amount,
          },
        });
        const [stock] = await tx.$queryRaw`
          SELECT id, quantity FROM stock WHERE product_id = ${line.item.product_id} FOR UPDATE
        `;
        if (line.disposition === 'sellable') {
          if (stock) {
            await tx.stock.update({
              where: { product_id: line.item.product_id },
              data: { quantity: { increment: line.quantityBase } },
            });
          } else {
            await tx.stock.create({ data: { product_id: line.item.product_id, quantity: line.quantityBase } });
          }
          await applyBatchDelta(tx, {
            productId: line.item.product_id,
            quantity: line.quantityBase,
            unitCostBase: Number(line.item.cost_at_sale || 0),
            batchNumber: `${number}-RETURN`,
          });
        }
        await tx.stock_movements.create({
          data: {
            product_id: line.item.product_id,
            movement_type: line.disposition === 'sellable' ? 'return' : 'waste',
            quantity: line.disposition === 'sellable' ? line.quantityBase : 0,
            reference_type: 'sale_refund',
            reference_id: created.id,
            unit_cost: line.item.cost_at_sale || 0,
            notes: `${number}: ${line.quantity} returned; disposition=${line.disposition}`,
            created_by: req.user.id,
          },
        });
      }
      if (!pending && method === 'cash') {
        await recordCashMovement(tx, {
          userId: req.user.id,
          movementType: 'refund',
          amount: total,
          referenceType: 'sale_refund',
          referenceId: created.id,
          notes: `${number}: ${reason}`,
          idempotencyKey: `refund:${created.id}:cash`,
        });
      }
      await recordAuditEvent(tx, req, {
        action: pending ? 'sale_refund_pending' : 'sale_refund_confirmed',
        entityType: 'sale_refund',
        entityId: created.id,
        reason,
        after: { sale_id: saleId.toString(), refund_number: number, amount: total, method, status: created.status },
      });
      return created;
    });
    res.status(refund.duplicate ? 200 : 201).json({
      success: true,
      message: refund.status === 'pending' ? 'Refund recorded; external reversal is pending confirmation' : 'Refund completed',
      data: { ...refund, id: refund.id.toString() },
    });
  } catch (err) {
    const conflictMessages = ['Refund exceeds the amount actually received for this sale',
      'Refund quantity exceeds the remaining quantity of', 'Refund idempotency key was already used for a different request',
      'Open a cashier shift before recording a cash transaction', 'Cash movement exceeds the available drawer balance',
      'Cash movement idempotency key was already used for a different request'];
    const badRequestMessages = [
      'Invalid sale item in refund request',
      'Refund items require distinct sale lines, positive quantities, and a valid stock disposition',
      'A refund line does not belong to this sale',
      'Refund amount must be greater than zero',
    ];
    const status = err.code === 'P2002' ? 409 :
      err.message === 'Completed sale not found' ? 404 :
        conflictMessages.some((message) => err.message.startsWith(message)) ? 409 :
          badRequestMessages.includes(err.message) ? 400 : 500;
    if (status === 500) console.error('Sale refund failed:', err);
    res.status(status).json({ success: false, message: status === 500 ? 'Failed to process sale refund' : err.message });
  }
});

router.post('/:refundId/confirm', authenticate, authorize(...managers), async (req, res) => {
  if (!validId(req.params.refundId)) return res.status(400).json({ success: false, message: 'Invalid refund ID' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const refundId = BigInt(req.params.refundId);
      const [refund] = await tx.$queryRaw`
        SELECT id, status, refund_method FROM sale_refunds WHERE id = ${refundId} FOR UPDATE
      `;
      if (!refund) throw new Error('Refund not found');
      if (refund.status !== 'pending' || refund.refund_method !== 'mobile_money') {
        throw new Error('Only pending Mobile Money refunds can be confirmed');
      }
      const updated = await tx.sale_refunds.update({
        where: { id: refundId },
        data: {
          status: 'confirmed',
          confirmed_by: req.user.id,
          confirmed_at: new Date(),
          ...(req.body.external_reference ? { external_reference: String(req.body.external_reference).slice(0, 100) } : {}),
        },
      });
      await recordAuditEvent(tx, req, {
        action: 'sale_refund_external_reversal_confirmed',
        entityType: 'sale_refund',
        entityId: refundId,
        reason: req.body.notes || null,
        after: { status: 'confirmed', external_reference: req.body.external_reference || null },
      });
      return { id: updated.id.toString(), refund_number: updated.refund_number, status: updated.status };
    });
    res.json({ success: true, message: 'External refund reversal confirmed', data: result });
  } catch (err) {
    const status = err.message === 'Refund not found' ? 404 : 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to confirm refund' });
  }
});

router.get('/', authenticate, authorize(...managers), async (req, res) => {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000Z`) : null;
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
  try {
    const refunds = await prisma.sale_refunds.findMany({
      where: {
        ...(from || to ? {
          created_at: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    res.json({
      success: true,
      data: refunds.map((item) => ({ ...item, id: item.id.toString(), sale_id: item.sale_id.toString() })),
    });
  } catch (err) {
    console.error('Refund report lookup failed:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch refunds' });
  }
});

module.exports = router;
