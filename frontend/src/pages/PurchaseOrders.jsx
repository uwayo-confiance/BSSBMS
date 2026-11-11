import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Truck } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const blankLine = { product_id: '', unit_id: '', quantity: '1', expected_unit_cost: '' };
const today = () => new Date().toISOString().slice(0, 10);

function money(value) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(value || 0));
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [receivingOrder, setReceivingOrder] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...blankLine }]);
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptMeta, setReceiptMeta] = useState({ invoice_reference: '', delivery_note: '', notes: '', received_at: today() });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canApprove = ['admin', 'manager'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [orderResponse, supplierResponse, productResponse] = await Promise.all([
        api.get('/purchase-orders'),
        api.get('/suppliers'),
        api.get('/products?active=true'),
      ]);
      setOrders(orderResponse.data.data || []);
      setSuppliers((supplierResponse.data.data || []).filter((supplier) => Number(supplier.is_active)));
      setProducts(productResponse.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load purchase order data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createTotal = useMemo(() => lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.expected_unit_cost || 0), 0
  ), [lines]);

  const updateLine = (index, key, value) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (key !== 'product_id') return { ...line, [key]: value };
      const product = products.find((candidate) => String(candidate.id) === value);
      const units = (product?.product_units || []).filter((unit) => Number(unit.is_active) && Number(unit.is_purchase_enabled));
      const defaultUnit = units.find((unit) => Number(unit.is_default_purchase)) || units[0];
      return {
        ...line,
        product_id: value,
        unit_id: String(defaultUnit?.unit_id || product?.base_unit_id || ''),
        expected_unit_cost: String(defaultUnit?.purchase_price ?? product?.cost_price ?? ''),
      };
    }));
  };

  const createOrder = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/purchase-orders', {
        supplier_id: Number(supplierId),
        expected_date: expectedDate || null,
        notes,
        items: lines.map((line) => ({
          product_id: Number(line.product_id),
          unit_id: Number(line.unit_id),
          quantity: Number(line.quantity),
          expected_unit_cost: Number(line.expected_unit_cost),
        })),
      });
      setShowCreate(false);
      setLines([{ ...blankLine }]);
      setNotes('');
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save purchase order.');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (order, status) => {
    const reason = status === 'cancelled' ? window.prompt('Reason for cancelling this order:') : '';
    if (status === 'cancelled' && !reason?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/purchase-orders/${order.id}/status`, { status, reason });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update purchase order.');
    } finally {
      setSaving(false);
    }
  };

  const openReceipt = (order) => {
    setReceivingOrder(order);
    setReceiptMeta({ invoice_reference: '', delivery_note: '', notes: '', received_at: today() });
    setReceiptLines(order.items.map((item) => ({
      purchase_order_item_id: item.id,
      product_name: item.product_name_snapshot,
      unit_name: item.unit_name_snapshot,
      quantity_outstanding: Math.max(0, Number(item.quantity) - Number(item.quantity_received_base) / Number(item.conversion_factor_snapshot)),
      accepted_quantity: '',
      damaged_quantity: '',
      missing_quantity: '',
      unit_cost: String(item.expected_unit_cost),
      batch_number: '',
      expires_at: '',
      manufactured_at: '',
    })));
  };

  const recordReceipt = async (event) => {
    event.preventDefault();
    const received = receiptLines.filter((line) =>
      Number(line.accepted_quantity || 0) + Number(line.damaged_quantity || 0) + Number(line.missing_quantity || 0) > 0
    );
    if (!received.length) {
      setError('Enter an accepted, damaged or missing quantity for at least one item.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post(`/purchase-orders/${receivingOrder.id}/receipts`, {
        ...receiptMeta,
        items: received.map((line) => ({
          purchase_order_item_id: line.purchase_order_item_id,
          accepted_quantity: Number(line.accepted_quantity || 0),
          damaged_quantity: Number(line.damaged_quantity || 0),
          missing_quantity: Number(line.missing_quantity || 0),
          unit_cost: Number(line.unit_cost),
          batch_number: line.batch_number,
          expires_at: line.expires_at || null,
          manufactured_at: line.manufactured_at || null,
        })),
      });
      setReceivingOrder(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record goods receipt.');
    } finally {
      setSaving(false);
    }
  };

  const updateReceiptLine = (index, key, value) => {
    setReceiptLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Purchase Orders</h1>
          <p className="text-sm text-slate-500">Order stock first, then receive full or partial deliveries.</p>
        </div>
        <button type="button" onClick={() => { setError(''); setShowCreate(true); }} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
          <Plus size={16} /> New purchase order
        </button>
      </header>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-3">Order</th><th className="p-3">Supplier</th><th className="p-3">Expected date</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading…</td></tr>
              : orders.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">No purchase orders yet.</td></tr>
                : orders.map((order) => (
                  <tr key={order.id}>
                    <td className="p-3 font-medium text-slate-800">{order.order_number}<span className="mt-1 block text-xs font-normal text-slate-500">{order.items?.length || 0} items</span></td>
                    <td className="p-3">{order.supplier_name || '—'}</td>
                    <td className="p-3">{order.expected_date ? String(order.expected_date).slice(0, 10) : '—'}</td>
                    <td className="p-3">{money(order.total_amount)}</td>
                    <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize text-slate-700">{order.status.replaceAll('_', ' ')}</span></td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {order.status === 'draft' && <button type="button" onClick={() => changeStatus(order, 'submitted')} disabled={saving} className="text-teal-700 hover:underline">Submit</button>}
                        {order.status === 'submitted' && canApprove && <button type="button" onClick={() => changeStatus(order, 'approved')} disabled={saving} className="inline-flex items-center gap-1 text-teal-700 hover:underline"><Check size={14} /> Approve</button>}
                        {['approved', 'partially_received'].includes(order.status) && <button type="button" onClick={() => openReceipt(order)} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Truck size={14} /> Receive</button>}
                        {!['cancelled', 'fully_received'].includes(order.status) && <button type="button" onClick={() => changeStatus(order, 'cancelled')} disabled={saving} className="text-rose-600 hover:underline">Cancel</button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <form onSubmit={createOrder} className="max-h-[92vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Create purchase order</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">Supplier *
                <select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal">
                  <option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">Expected date
                <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
              </label>
              <label className="text-xs font-medium text-slate-600">Notes
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
              </label>
            </div>
            {lines.map((line, index) => {
              const product = products.find((candidate) => String(candidate.id) === line.product_id);
              const units = (product?.product_units || []).filter((unit) => Number(unit.is_active) && Number(unit.is_purchase_enabled));
              return (
                <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1fr_1fr_auto]">
                  <label className="text-xs font-medium text-slate-600">Product
                    <select required value={line.product_id} onChange={(event) => updateLine(index, 'product_id', event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal">
                      <option value="">Select product</option>{products.map((productOption) => <option key={productOption.id} value={productOption.id}>{productOption.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Purchase unit
                    <select required value={line.unit_id} onChange={(event) => updateLine(index, 'unit_id', event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal">
                      <option value="">Select unit</option>{units.map((unit) => <option key={unit.id} value={unit.unit_id}>{unit.unit?.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Quantity
                    <input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Expected unit cost
                    <input required type="number" min="0.01" step="any" value={line.expected_unit_cost} onChange={(event) => updateLine(index, 'expected_unit_cost', event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal" />
                  </label>
                  <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="self-end rounded px-2 py-2 text-rose-600 disabled:opacity-30">Remove</button>
                </div>
              );
            })}
            <button type="button" onClick={() => setLines((current) => [...current, { ...blankLine }])} className="text-sm font-medium text-teal-700">+ Add product</button>
            <p className="text-right font-semibold text-slate-700">Expected total: {money(createTotal)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm">Close</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save as draft'}</button>
            </div>
          </form>
        </div>
      )}

      {receivingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <form onSubmit={recordReceipt} className="max-h-[92vh] w-full max-w-5xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Receive {receivingOrder.order_number}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['invoice_reference', 'Supplier invoice'],
                ['delivery_note', 'Delivery note'],
                ['received_at', 'Received date'],
                ['notes', 'Notes'],
              ].map(([key, label]) => (
                <label key={key} className="text-xs font-medium text-slate-600">{label}
                  <input type={key === 'received_at' ? 'date' : 'text'} value={receiptMeta[key]}
                    onChange={(event) => setReceiptMeta((current) => ({ ...current, [key]: event.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal" />
                </label>
              ))}
            </div>
            {receiptLines.map((line, index) => (
              <div key={line.purchase_order_item_id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="text-sm font-medium text-slate-800">{line.product_name}<span className="mt-1 block text-xs font-normal text-slate-500">Outstanding: {line.quantity_outstanding.toFixed(3)} {line.unit_name}</span></div>
                {[
                  ['accepted_quantity', 'Accepted'],
                  ['damaged_quantity', 'Damaged'],
                  ['missing_quantity', 'Missing'],
                  ['unit_cost', 'Actual unit cost'],
                  ['batch_number', 'Batch number'],
                  ['expires_at', 'Expiry date'],
                  ['manufactured_at', 'Manufactured date'],
                ].map(([key, label]) => (
                  <label key={key} className="text-xs font-medium text-slate-600">{label}
                    <input type={key.endsWith('_at') ? 'date' : key.includes('quantity') ? 'number' : 'text'}
                      min={key.includes('quantity') ? '0' : undefined} step={key.includes('quantity') ? '0.001' : undefined}
                      value={line[key]} onChange={(event) => updateReceiptLine(index, key, event.target.value)}
                      className="mt-1 w-full rounded border border-slate-200 p-2 text-sm font-normal" />
                  </label>
                ))}
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => setReceivingOrder(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? 'Receiving…' : 'Confirm receipt'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
