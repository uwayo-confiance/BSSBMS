import { useState } from 'react';
import { Banknote, RotateCcw, Search } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const money = (value) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(value || 0));
const newPaymentKey = () => window.crypto.randomUUID();

export default function Refunds() {
  const { user } = useAuth();
  const canApprove = ['admin', 'manager'].includes(user?.role);
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState([]);
  const [sale, setSale] = useState(null);
  const [lines, setLines] = useState({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [requestKey, setRequestKey] = useState(newPaymentKey());
  const [refund, setRefund] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const searchSales = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSale(null);
    try {
      const response = await api.get('/refunds/sales', { params: { search: search || undefined } });
      setSales(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not search completed sales.');
    } finally {
      setLoading(false);
    }
  };

  const selectSale = async (selected) => {
    setLoading(true);
    setError('');
    setRefund(null);
    try {
      const response = await api.get(`/refunds/sales/${selected.id}`);
      setSale(response.data.data);
      setLines(Object.fromEntries(response.data.data.items.map((item) => [item.id, {
        quantity: '',
        disposition: 'sellable',
      }])));
      setRequestKey(newPaymentKey());
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load sale details.');
    } finally {
      setLoading(false);
    }
  };

  const submitRefund = async (event) => {
    event.preventDefault();
    if (!sale) return;
    const items = Object.entries(lines)
      .filter(([, line]) => Number(line.quantity) > 0)
      .map(([sale_item_id, line]) => ({
        sale_item_id,
        quantity: Number(line.quantity),
        disposition: line.disposition,
      }));
    if (!items.length) {
      setError('Enter a returned quantity for at least one sale line.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await api.post(`/refunds/sales/${sale.id}`, {
        idempotency_key: requestKey,
        reason,
        refund_method: method,
        original_reference: reference || undefined,
        external_reference: method === 'mobile_money' ? reference || undefined : undefined,
        items,
      });
      setRefund(response.data.data);
      setRequestKey(newPaymentKey());
      const updatedSale = await api.get(`/refunds/sales/${sale.id}`);
      setSale(updatedSale.data.data);
      setLines(Object.fromEntries(updatedSale.data.data.items.map((item) => [item.id, {
        quantity: '',
        disposition: 'sellable',
      }])));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not process refund.');
      if (err.response && err.response.status < 500) setRequestKey(newPaymentKey());
    } finally {
      setSaving(false);
    }
  };

  const confirmExternalRefund = async () => {
    if (!refund || !window.confirm('Confirm that the external payment reversal has completed?')) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.post(`/refunds/${refund.id}/confirm`, {
        external_reference: reference || undefined,
        notes: reason,
      });
      setRefund({ ...refund, status: response.data.data.status });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not confirm external refund.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-rose-100 p-3 text-rose-800"><RotateCcw size={22} /></div>
        <div><h1 className="text-xl font-bold text-slate-800">Refunds and returns</h1><p className="text-sm text-slate-500">Find the original receipt, record returned items, and document the money returned. The original sale stays in your records.</p></div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <form onSubmit={searchSales} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
        <label className="relative min-w-0 flex-1"><span className="mb-1 block text-xs font-medium text-slate-600">Receipt number or sale ID</span><Search className="absolute left-3 top-9 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="For example, the number printed on the receipt" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm" /></label>
        <button disabled={loading} className="self-end rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white">{loading ? 'Searching…' : 'Find sale'}</button>
      </form>

      {sales.length === 0 && !sale && !loading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No sales to show yet. Search using a receipt number or sale ID. Only completed sales can be refunded.</p>}
      {sales.length > 0 && !sale && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Receipt</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Sale total</th><th className="px-4 py-3">Amount paid</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{sales.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.receipt_number}</td><td className="px-4 py-3">{new Date(item.sale_date).toLocaleString()}</td><td className="px-4 py-3">{money(item.total_amount)}</td><td className="px-4 py-3">{money(item.amount_paid)}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => selectSale(item)} className="rounded bg-teal-700 px-3 py-1.5 text-xs text-white">Review sale</button></td></tr>)}</tbody></table></div>}

      {sale && (
        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap justify-between gap-2"><h2 className="font-semibold text-slate-800">{sale.receipt_number}</h2><span className="text-sm text-slate-500">Total {money(sale.total_amount)} · Paid {money(sale.amount_paid)}</span></div>
            <table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-slate-600"><tr><th className="py-2">Product</th><th className="py-2">Sold</th><th className="py-2">Already returned</th><th className="py-2">Still returnable</th><th className="py-2">Return quantity</th><th className="py-2">Item condition</th></tr></thead><tbody className="divide-y divide-slate-100">{sale.items.map((item) => <tr key={item.id}><td className="py-2 pr-2">{item.product_name} · {item.unit_name}</td><td className="py-2">{item.quantity}</td><td className="py-2">{item.refunded_quantity}</td><td className="py-2">{item.available_quantity}</td><td className="py-2"><input aria-label={`Return quantity for ${item.product_name}`} type="number" min="0" max={item.available_quantity} step="0.001" value={lines[item.id]?.quantity || ''} onChange={(event) => setLines({ ...lines, [item.id]: { ...lines[item.id], quantity: event.target.value } })} className="w-24 rounded border border-slate-200 px-2 py-1.5" placeholder="0" /></td><td className="py-2"><select aria-label={`Condition for ${item.product_name}`} value={lines[item.id]?.disposition || 'sellable'} onChange={(event) => setLines({ ...lines, [item.id]: { ...lines[item.id], disposition: event.target.value } })} className="rounded border border-slate-200 px-2 py-1.5"><option value="sellable">Good · return to stock</option><option value="damaged">Damaged · do not restock</option><option value="quarantine">Needs checking · keep aside</option><option value="dispose">Unusable · discard</option></select></td></tr>)}</tbody></table>
            {sale.refunds?.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><h3 className="text-sm font-semibold">Previous refunds</h3>{sale.refunds.map((item) => <p key={item.id} className="mt-1 flex justify-between text-xs text-slate-600"><span>{item.refund_number} · {item.status} · {item.reason}</span><span>{money(item.total_amount)}</span></p>)}</div>}
          </div>
          <form onSubmit={submitRefund} className="h-fit space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-800">Return details</h2><p className="text-xs text-slate-500">Choose a quantity above for at least one item. The refund amount is calculated from the original sale.</p>
            <label className="block text-sm font-medium text-slate-700">Reason for return<textarea required maxLength={255} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain why the item is being returned" rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm font-normal" /></label>
            <label className="block text-xs text-slate-600">Refund method<select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm">{['cash', 'mobile_money', 'bank', 'card', 'other'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="block text-xs text-slate-600">Payment reference<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></label>
            {method === 'mobile_money' && <p className="text-xs text-amber-700">Mobile Money reversal will remain pending until independently confirmed.</p>}
            <button disabled={saving || !canApprove} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Banknote size={16} />{saving ? 'Processing…' : 'Approve and process refund'}</button>
            {!canApprove && <p className="text-xs text-slate-500">A manager must authorize refunds.</p>}
            {refund && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><p className="font-semibold text-emerald-900">{refund.refund_number} · {money(refund.total_amount)}</p><p className="text-sm text-slate-700">Status: {refund.status}</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => window.print()} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">Print refund</button>{canApprove && refund.status === 'pending' && <button type="button" disabled={saving} onClick={confirmExternalRefund} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">Confirm verified reversal</button>}</div></div>}
          </form>
        </section>
      )}
    </div>
  );
}
