import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, Wallet } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const today = () => new Date().toISOString().slice(0, 10);
const formatMoney = (value) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(value || 0));

export default function SupplierDetails() {
  const { supplierId } = useParams();
  const { user } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [statement, setStatement] = useState(null);
  const [payments, setPayments] = useState([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', payment_date: today(), reference: '', notes: '', allocations: {} });
  const [returnPurchaseId, setReturnPurchaseId] = useState('');
  const [returnItems, setReturnItems] = useState([]);
  const [returnForm, setReturnForm] = useState({ reason: '', settlement_type: 'credit', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canManage = ['admin', 'manager', 'stock_keeper'].includes(user?.role);

  const load = useCallback(async () => {
    setError('');
    try {
      const [supplierResponse, purchaseResponse, paymentResponse, statementResponse] = await Promise.all([
        api.get('/suppliers'),
        api.get('/purchases'),
        api.get(`/supplier-finance/${supplierId}/payments`),
        api.get(`/supplier-finance/${supplierId}/statement`, { params: { from: from || undefined, to: to || undefined } }),
      ]);
      setSupplier((supplierResponse.data.data || []).find((row) => String(row.id) === String(supplierId)) || null);
      setPurchases((purchaseResponse.data.data || []).filter((row) => String(row.supplier_id) === String(supplierId)));
      setPayments(paymentResponse.data.data || []);
      setStatement(statementResponse.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load supplier details.');
    }
  }, [from, supplierId, to]);

  useEffect(() => { load(); }, [load]);

  const balances = useMemo(() => ({
    purchases: purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount || 0), 0),
    paid: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    outstanding: purchases.reduce((sum, purchase) => sum + Number(purchase.balance || 0), 0),
  }), [purchases, payments]);

  const openPayment = () => {
    setPaymentForm({ amount: '', payment_method: 'cash', payment_date: today(), reference: '', notes: '', allocations: {} });
    setShowPayment(true);
    setError('');
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    const allocations = Object.entries(paymentForm.allocations)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([purchase_id, amount]) => ({ purchase_id, amount: Number(amount) }));
    setSaving(true);
    setError('');
    try {
      await api.post('/supplier-finance/payments', {
        ...paymentForm,
        supplier_id: Number(supplierId),
        amount: Number(paymentForm.amount),
        allocations,
      });
      setShowPayment(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record supplier payment.');
    } finally {
      setSaving(false);
    }
  };

  const selectPurchaseForReturn = async (purchaseId) => {
    setReturnPurchaseId(purchaseId);
    setReturnItems([]);
    if (!purchaseId) return;
    try {
      const response = await api.get(`/purchases/${purchaseId}`);
      setReturnItems(response.data.data.items.map((item) => ({
        purchase_item_id: item.id,
        product_name: item.product_name_snapshot || `Product ${item.product_id}`,
        unit_name: item.unit_name_snapshot || `Unit ${item.unit_id}`,
        quantity: '',
        max_quantity: Number(item.quantity),
      })));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load purchase lines for return.');
    }
  };

  const submitReturn = async (event) => {
    event.preventDefault();
    const items = returnItems.filter((item) => Number(item.quantity) > 0)
      .map((item) => ({ purchase_item_id: item.purchase_item_id, quantity: Number(item.quantity) }));
    if (!items.length) {
      setError('Enter a return quantity for at least one product.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/supplier-finance/returns', {
        ...returnForm,
        purchase_id: returnPurchaseId,
        items,
      });
      setShowReturn(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record supplier return.');
    } finally {
      setSaving(false);
    }
  };

  if (!supplier && !error) return <p className="text-sm text-slate-500">Loading supplier…</p>;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/suppliers" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><ArrowLeft size={15} /> Suppliers</Link>
          <h1 className="mt-1 text-xl font-bold text-slate-800">{supplier?.name || 'Supplier details'}</h1>
          <p className="text-sm text-slate-500">{supplier?.phone || 'No phone'} · {supplier?.email || 'No email'} · {supplier?.address || 'No address'}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" onClick={openPayment} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white"><Wallet size={15} /> Record payment</button>
            <button type="button" onClick={() => { setShowReturn(true); setReturnPurchaseId(''); setReturnItems([]); setError(''); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Record return</button>
          </div>
        )}
      </header>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Total purchases', balances.purchases],
          ['Total payments', balances.paid],
          ['Outstanding', balances.outstanding],
          ['Supplier credit', statement?.credit_balance || 0],
        ].map(([label, amount]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-800">{formatMoney(amount)}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-semibold text-slate-800">Supplier statement</h2><p className="text-xs text-slate-500">Opening: {formatMoney(statement?.opening_balance)} · Closing: {formatMoney(statement?.closing_balance)}</p></div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="ml-1 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700" /></label>
            <label className="text-xs text-slate-500">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="ml-1 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700" /></label>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-sm"><Printer size={14} /> Print</button>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Reference</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2">Balance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(statement?.entries || []).map((entry, index) => (
                <tr key={`${entry.type}-${index}`}><td className="p-2">{String(entry.date).slice(0, 10)}</td><td className="p-2 capitalize">{entry.type.replaceAll('_', ' ')}</td><td className="p-2">{entry.reference}</td><td className="p-2">{formatMoney(entry.debit)}</td><td className="p-2">{formatMoney(entry.credit)}</td><td className="p-2">{formatMoney(entry.balance)}</td></tr>
              ))}
              {(statement?.entries || []).length === 0 && <tr><td colSpan={6} className="p-5 text-center text-slate-500">No statement activity in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-800">Purchase history</h2>
          <div className="mt-3 space-y-2">
            {purchases.map((purchase) => <div key={purchase.id} className="flex justify-between gap-3 border-b border-slate-100 pb-2 text-sm"><span>{purchase.invoice_number || `Purchase ${purchase.id}`} · {String(purchase.purchase_date).slice(0, 10)}</span><span className="text-right">{formatMoney(purchase.total_amount)}<span className="block text-xs text-slate-500">Balance {formatMoney(purchase.balance)}</span></span></div>)}
            {purchases.length === 0 && <p className="text-sm text-slate-500">No purchases recorded.</p>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-800">Payment history</h2>
          <div className="mt-3 space-y-2">
            {payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 border-b border-slate-100 pb-2 text-sm"><span>{String(payment.payment_date).slice(0, 10)} · {payment.payment_method}<span className="block text-xs text-slate-500">{payment.reference || 'No reference'}</span></span><strong>{formatMoney(payment.amount)}</strong></div>)}
            {payments.length === 0 && <p className="text-sm text-slate-500">No supplier payments recorded.</p>}
          </div>
        </div>
      </section>

      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <form onSubmit={submitPayment} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Record supplier payment</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">Amount<input required type="number" min="0.01" step="any" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Date<input required type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Method<select value={paymentForm.payment_method} onChange={(event) => setPaymentForm({ ...paymentForm, payment_method: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm">{['cash', 'bank', 'mobile_money', 'cheque', 'other'].map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select></label>
              <label className="text-xs text-slate-600">Reference<input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm" /></label>
            </div>
            <h3 className="text-sm font-semibold text-slate-700">Invoice allocations <span className="font-normal text-slate-500">(unallocated amount becomes supplier credit)</span></h3>
            {purchases.filter((purchase) => Number(purchase.balance) > 0).map((purchase) => (
              <label key={purchase.id} className="grid grid-cols-[1fr_130px] items-center gap-3 text-sm">
                <span>{purchase.invoice_number || `Purchase ${purchase.id}`} · balance {formatMoney(purchase.balance)}</span>
                <input type="number" min="0" max={purchase.balance} step="any" value={paymentForm.allocations[purchase.id] || ''}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, allocations: { ...current.allocations, [purchase.id]: event.target.value } }))}
                  className="rounded border border-slate-200 p-2" />
              </label>
            ))}
            <textarea rows={2} placeholder="Notes" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} className="w-full rounded border border-slate-200 p-2 text-sm" />
            <div className="flex gap-2"><button type="button" onClick={() => setShowPayment(false)} className="flex-1 rounded border border-slate-200 py-2 text-sm">Cancel</button><button type="submit" disabled={saving} className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save payment'}</button></div>
          </form>
        </div>
      )}

      {showReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <form onSubmit={submitReturn} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Supplier return / credit note</h2>
            <label className="block text-xs text-slate-600">Original purchase
              <select required value={returnPurchaseId} onChange={(event) => selectPurchaseForReturn(event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm">
                <option value="">Select purchase</option>{purchases.filter((purchase) => purchase.status !== 'cancelled').map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.invoice_number || `Purchase ${purchase.id}`}</option>)}
              </select>
            </label>
            {returnItems.map((item, index) => (
              <label key={item.purchase_item_id} className="grid grid-cols-[1fr_120px] items-center gap-3 text-sm">
                <span>{item.product_name} · bought {item.max_quantity} {item.unit_name}</span>
                <input type="number" min="0" max={item.max_quantity} step="0.001" value={item.quantity}
                  onChange={(event) => setReturnItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))}
                  className="rounded border border-slate-200 p-2" />
              </label>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-600">Reason<input required value={returnForm.reason} onChange={(event) => setReturnForm({ ...returnForm, reason: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Settlement<select value={returnForm.settlement_type} onChange={(event) => setReturnForm({ ...returnForm, settlement_type: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm"><option value="credit">Supplier credit</option><option value="refund">Refund received</option></select></label>
            </div>
            <textarea rows={2} placeholder="Notes" value={returnForm.notes} onChange={(event) => setReturnForm({ ...returnForm, notes: event.target.value })} className="w-full rounded border border-slate-200 p-2 text-sm" />
            <div className="flex gap-2"><button type="button" onClick={() => setShowReturn(false)} className="flex-1 rounded border border-slate-200 py-2 text-sm">Cancel</button><button type="submit" disabled={saving} className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? 'Saving…' : 'Record return'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
