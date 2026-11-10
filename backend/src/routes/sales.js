const express = require('express');
const router = express.Router();
const { prisma } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { toBaseUnit, generateReceiptNumber, money } = require('../utils/helpers');

router.post('/', authenticate, authorize('admin', 'manager', 'cashier'), async (req, res) => {
  try {
    const {
      customer_id, items, payment_method, amount_paid,
      discount_amount, notes, payment_status,
    } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    const sale = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const processedItems = [];
      for (const item of items) {
        const { product_id, quantity, unit_id, unit_price, discount = 0 } = item;
        if (!product_id || !quantity || !unit_id || unit_price == null) {
          throw new Error('Each item must have product_id, quantity, unit_id and unit_price');
        }

        const quantityBase = await toBaseUnit(tx, product_id, quantity, unit_id);
        const [stockRow] = await tx.$queryRaw`
          SELECT quantity FROM stock WHERE product_id = ${Number(product_id)} FOR UPDATE
        `;
        if (!stockRow || Number(stockRow.quantity) < quantityBase) {
          const product = await tx.products.findUnique({
            where: { id: Number(product_id) },
            select: { name: true },
          });
          throw new Error(`Insufficient stock for ${product?.name || 'product'}`);
        }
        const lineTotal = money(quantity * unit_price - (discount || 0));
        subtotal = money(subtotal + lineTotal);
        const product = await tx.products.findUnique({
          where: { id: Number(product_id) },
          select: { cost_price: true },
        });
        processedItems.push({
          product_id: Number(product_id),
          quantity,
          unit_id: Number(unit_id),
          quantity_base: quantityBase,
          unit_price,
          discount: discount || 0,
          total_price: lineTotal,
          cost_at_sale: product?.cost_price || 0,
        });
      }

      const discountAmount = money(discount_amount || 0);
      const totalAmount = money(subtotal - discountAmount);
      const paid = money(amount_paid == null ? totalAmount : amount_paid);
      const change = money(Math.max(0, paid - totalAmount));
      const status = payment_status || (paid >= totalAmount ? 'paid' : (customer_id ? 'credit' : 'partial'));
      const receiptNumber = await generateReceiptNumber(tx);
      const created = await tx.sales.create({
        data: {
          receipt_number: receiptNumber,
          customer_id: customer_id ? Number(customer_id) : null,
          status: 'completed',
          subtotal,
          discount_amount: discountAmount,
          total_amount: totalAmount,
          amount_paid: paid,
          change_given: change,
          payment_method: payment_method || 'cash',
          payment_status: status,
          notes: notes || null,
          created_by: req.user.id,
        },
        select: { id: true },
      });

      for (const item of processedItems) {
        await tx.sale_items.create({
          data: { sale_id: created.id, ...item },
        });
        await tx.stock.update({
          where: { product_id: item.product_id },
          data: { quantity: { decrement: item.quantity_base } },
        });
        await tx.stock_movements.create({
          data: {
            product_id: item.product_id,
            movement_type: 'sale',
            quantity: -item.quantity_base,
            reference_type: 'sale',
            reference_id: created.id,
            unit_cost: item.cost_at_sale,
            created_by: req.user.id,
          },
        });
      }
      await tx.sale_payments.create({
        data: { sale_id: created.id, payment_method: payment_method || 'cash', amount: paid },
      });

      if (status === 'credit' || (customer_id && paid < totalAmount)) {
        const remaining = money(totalAmount - paid);
        await tx.customer_debts.create({
          data: {
            customer_id: Number(customer_id),
            sale_id: created.id,
            original_amount: remaining,
            remaining_amount: remaining,
            status: remaining === totalAmount ? 'open' : 'partial',
          },
        });
      }
      return { id: created.id, receipt_number: receiptNumber, total_amount: totalAmount, amount_paid: paid, change_given: change, payment_status: status };
    });

    res.status(201).json({ success: true, message: 'Sale completed', data: sale });
  } catch (err) {
    console.error('Sale error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to process sale' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { from, to, limit = 50 } = req.query;
    const dateFilter = {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
    const sales = await prisma.sales.findMany({
      where: {
        status: 'completed',
        ...(Object.keys(dateFilter).length ? { sale_date: dateFilter } : {}),
      },
      orderBy: { sale_date: 'desc' },
      take: parseInt(limit, 10),
    });
    const customerIds = [...new Set(sales.map(({ customer_id }) => customer_id).filter(Boolean))];
    const userIds = [...new Set(sales.map(({ created_by }) => created_by).filter(Boolean))];
    const [customers, users] = await Promise.all([
      prisma.customers.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }),
      prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
    ]);
    const customerNames = new Map(customers.map(({ id, name }) => [id, name]));
    const userNames = new Map(users.map(({ id, full_name }) => [id, full_name]));
    res.json({
      success: true,
      data: sales.map((sale) => ({
        ...sale,
        customer_name: customerNames.get(sale.customer_id) ?? null,
        cashier_name: userNames.get(sale.created_by) ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch sales' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const saleId = BigInt(req.params.id);
    const sale = await prisma.sales.findUnique({ where: { id: saleId } });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    const [customer, cashier, items] = await Promise.all([
      sale.customer_id ? prisma.customers.findUnique({ where: { id: sale.customer_id }, select: { name: true } }) : null,
      sale.created_by ? prisma.users.findUnique({ where: { id: sale.created_by }, select: { full_name: true } }) : null,
      prisma.sale_items.findMany({ where: { sale_id: saleId } }),
    ]);
    const productIds = [...new Set(items.map(({ product_id }) => product_id))];
    const unitIds = [...new Set(items.map(({ unit_id }) => unit_id))];
    const [products, units] = await Promise.all([
      prisma.products.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
      prisma.units.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }),
    ]);
    const productNames = new Map(products.map(({ id, name }) => [id, name]));
    const unitNames = new Map(units.map(({ id, name }) => [id, name]));
    res.json({
      success: true,
      data: {
        ...sale,
        customer_name: customer?.name ?? null,
        cashier_name: cashier?.full_name ?? null,
        items: items.map((item) => ({
          ...item,
          product_name: productNames.get(item.product_id),
          unit_name: unitNames.get(item.unit_id),
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
