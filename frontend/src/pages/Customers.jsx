import { useEffect, useState } from 'react';
import api from '../services/api';
import { Edit2, Plus, RotateCcw, Search, Trash2, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}
const newPaymentKey = () => window.crypto.randomUUID();

export default function Customers() {
  const { user } = useAuth();
  const canConfirmPayments = ['admin', 'manager'].includes(user?.role);
  const canAdjustDebt = ['admin', 'manager'].includes(user?.role);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1,
    outstanding_debt: 0, debt_adjustment_reason: '',
  });
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingStatusIds, setUpdatingStatusIds] = useState([]);
  const [repaymentCustomer, setRepaymentCustomer] = useState(null);
  const [repaymentDebts, setRepaymentDebts] = useState([]);
  const [repaymentForm, setRepaymentForm] = useState({ amount: '', payment_method: 'cash', debt_id: '', reference: '', notes: '' });
  const [repaymentKey, setRepaymentKey] = useState('');
  const [repaymentError, setRepaymentError] = useState('');
  const [repaymentSaving, setRepaymentSaving] = useState(false);
  const [repaymentLoading, setRepaymentLoading] = useState(false);
  const [repaymentReceipt, setRepaymentReceipt] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/customers?active=all').then((r) => setCustomers(r.data.data || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openRepayment = async (customer) => {
    setRepaymentCustomer(customer);
    setRepaymentDebts([]);
    setRepaymentForm({ amount: '', payment_method: 'cash', debt_id: '', reference: '', notes: '' });
    setRepaymentKey(newPaymentKey());
    setRepaymentError('');
    setRepaymentLoading(true);
    try {
      const response = await api.get(`/customers/${customer.id}/debts`);
      setRepaymentDebts((response.data.data || []).filter((debt) => ['open', 'partial'].includes(debt.status)));
    } catch (err) {
      setRepaymentError(err.response?.data?.message || 'Could not load customer invoices.');
    } finally {
      setRepaymentLoading(false);
    }
  };

  const submitRepayment = async (event) => {
    event.preventDefault();
    if (!repaymentCustomer) return;
    setRepaymentSaving(true);
    setRepaymentError('');
    try {
      const response = await api.post(`/customers/${repaymentCustomer.id}/payments`, {
        ...repaymentForm,
        amount: Number(repaymentForm.amount),
        debt_id: repaymentForm.debt_id || undefined,
        idempotency_key: repaymentKey,
      });
      setRepaymentReceipt({
        ...response.data.data,
        customer_name: repaymentCustomer.name,
        payment_method: repaymentForm.payment_method,
      });
      setRepaymentKey(newPaymentKey());
      await load();
      const debtsResponse = await api.get(`/customers/${repaymentCustomer.id}/debts`);
      setRepaymentDebts((debtsResponse.data.data || []).filter((debt) => ['open', 'partial'].includes(debt.status)));
    } catch (err) {
      setRepaymentError(err.response?.data?.message || 'Could not record customer repayment.');
      if (err.response && err.response.status < 500) setRepaymentKey(newPaymentKey());
    } finally {
      setRepaymentSaving(false);
    }
  };

  const confirmRepayment = async () => {
    if (!repaymentReceipt?.id || !window.confirm('Confirm that this Mobile Money repayment has been independently verified?')) return;
    setRepaymentSaving(true);
    setRepaymentError('');
    try {
      await api.post(`/customers/payments/${repaymentReceipt.id}/confirm`);
      setRepaymentReceipt((current) => ({ ...current, status: 'confirmed' }));
      const response = await api.get(`/customers/${repaymentCustomer.id}/debts`);
      setRepaymentDebts((response.data.data || []).filter((debt) => ['open', 'partial'].includes(debt.status)));
      await load();
    } catch (err) {
      setRepaymentError(err.response?.data?.message || 'Could not confirm Mobile Money repayment.');
    } finally {
      setRepaymentSaving(false);
    }
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.address || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editingCustomer) {
        const debtChanged = canAdjustDebt &&
          Number(form.outstanding_debt) !== Number(editingCustomer.total_debt || 0);
        if (debtChanged && !form.debt_adjustment_reason.trim()) {
          setFormError('Provide a reason for changing the outstanding debt.');
          setSaving(false);
          return;
        }
        await api.put(`/customers/${editingCustomer.id}`, {
          ...form,
          credit_limit: Number(form.credit_limit) || 0,
          is_active: Number(form.is_active),
          ...(canAdjustDebt ? {
            outstanding_debt: Number(form.outstanding_debt),
            debt_adjustment_reason: form.debt_adjustment_reason,
          } : {}),
        });
      } else {
        await api.post('/customers', { ...form, credit_limit: Number(form.credit_limit) || 0 });
      }
      setShowForm(false);
      setEditingCustomer(null);
      setForm({
        name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1,
        outstanding_debt: 0, debt_adjustment_reason: '',
      });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save customer. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const openAddForm = () => {
    setEditingCustomer(null);
    setForm({
      name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1,
      outstanding_debt: 0, debt_adjustment_reason: '',
    });
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      credit_limit: customer.credit_limit ?? 0,
      is_active: Number(customer.is_active) ? 1 : 0,
      outstanding_debt: Number(customer.total_debt || 0),
      debt_adjustment_reason: '',
    });
    setFormError('');
    setShowForm(true);
  };

  const setCustomerActive = async (customer, isActive) => {
    if (!isActive && !window.confirm(`Delete ${customer.name}? This will deactivate the customer and preserve their sales and debt history.`)) {
      return;
    }

    setUpdatingStatusIds((ids) => [...ids, customer.id]);
    try {
      await api.patch(`/customers/${customer.id}/status`, { is_active: isActive ? 1 : 0 });
      load();
    } catch (err) {
      alert(err.response?.data?.message || `Failed to ${isActive ? 'restore' : 'delete'} customer.`);
    } finally {
      setUpdatingStatusIds((ids) => ids.filter((id) => id !== customer.id));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Customers</h1>
          <p className="text-sm text-slate-500">Manage customers and credit</p>
        </div>
        <button onClick={openAddForm} className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Customer
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email or address..."
          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Credit Limit</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No customers found</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <p>{c.name}</p>
                    {Number(c.total_debt) > 0 && (
                      <button onClick={() => openRepayment(c)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900">
                        <Wallet size={13} /> Repay
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.address || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{formatRWF(c.credit_limit)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${Number(c.is_active) ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                      {Number(c.is_active) ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEditForm(c)} className="inline-flex items-center gap-1.5 text-teal-700 hover:text-teal-900 font-medium">
                        <Edit2 size={14} /> Edit
                      </button>
                      {Number(c.is_active) ? (
                        <button
                          onClick={() => setCustomerActive(c, false)}
                          disabled={updatingStatusIds.includes(c.id)}
                          className="inline-flex items-center gap-1.5 text-rose-600 hover:text-rose-800 font-medium disabled:opacity-60"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      ) : (
                        <button
                          onClick={() => setCustomerActive(c, true)}
                          disabled={updatingStatusIds.includes(c.id)}
                          className="inline-flex items-center gap-1.5 text-teal-700 hover:text-teal-900 font-medium disabled:opacity-60"
                        >
                          <RotateCcw size={14} /> Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold">{editingCustomer ? 'Edit Customer' : 'Add Customer'}</h3>
            {formError && <p role="alert" className="text-sm text-rose-600">{formError}</p>}
            <div>
              <label className="text-xs font-medium text-slate-600">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Address</label>
              <textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Credit Limit (RWF)</label>
              <input type="number" min="0" step="any" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            {editingCustomer && canAdjustDebt && (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-600">Outstanding Debt (RWF)</label>
                  <input type="number" min="0" step="0.01" value={form.outstanding_debt}
                    onChange={(e) => setForm({ ...form, outstanding_debt: e.target.value })}
                    className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                  <p className="mt-1 text-xs text-slate-500">Debt adjustments are recorded in the customer audit history.</p>
                </div>
                {Number(form.outstanding_debt) !== Number(editingCustomer.total_debt || 0) && (
                  <div>
                    <label className="text-xs font-medium text-slate-600">Adjustment reason *</label>
                    <textarea required rows={2} value={form.debt_adjustment_reason}
                      onChange={(e) => setForm({ ...form, debt_adjustment_reason: e.target.value })}
                      className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                )}
              </>
            )}
            {editingCustomer && (
              <div>
                <label className="text-xs font-medium text-slate-600">Status</label>
                <select value={form.is_active} onChange={(e) => setForm({ ...form, is_active: Number(e.target.value) })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={1}>Active</option>
                  <option value={0}>Inactive</option>
                </select>
              </div>
            )}
            {repaymentCustomer && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <section className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                  <header className="flex items-start justify-between gap-3">
                    <div><h2 className="text-lg font-bold text-slate-800">Customer repayments</h2><p className="text-sm text-slate-500">{repaymentCustomer.name} · Outstanding {formatRWF(repaymentCustomer.total_debt)}</p></div>
                    <button onClick={() => { setRepaymentCustomer(null); setRepaymentReceipt(null); }} aria-label="Close repayments" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
                  </header>
                  {repaymentError && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{repaymentError}</p>}
                  {repaymentLoading ? <p className="text-sm text-slate-500">Loading invoices…</p> : (
                    <>
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
                        {repaymentDebts.length ? repaymentDebts.map((debt) => <p key={debt.id} className="flex justify-between gap-3 text-sm"><span>{debt.receipt_number || `Invoice #${debt.id}`}</span><strong>{formatRWF(debt.remaining_amount)}</strong></p>) : <p className="text-sm text-slate-500">No outstanding invoices.</p>}
                      </div>
                      {repaymentDebts.length > 0 && <form onSubmit={submitRepayment} className="space-y-3">
                        <label className="block text-xs text-slate-600">Allocate to
                          <select value={repaymentForm.debt_id} onChange={(event) => setRepaymentForm({ ...repaymentForm, debt_id: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5">
                            <option value="">Oldest outstanding invoices automatically</option>
                            {repaymentDebts.map((debt) => <option key={debt.id} value={debt.id}>{debt.receipt_number || `Invoice #${debt.id}`} · {formatRWF(debt.remaining_amount)}</option>)}
                          </select>
                        </label>
                        <label className="block text-xs text-slate-600">Amount (RWF)
                          <input required type="number" min="0.01" step="0.01" value={repaymentForm.amount} onChange={(event) => setRepaymentForm({ ...repaymentForm, amount: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" />
                        </label>
                        <label className="block text-xs text-slate-600">Payment method
                          <select value={repaymentForm.payment_method} onChange={(event) => setRepaymentForm({ ...repaymentForm, payment_method: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5">{['cash', 'mobile_money', 'bank', 'cheque', 'other'].map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select>
                        </label>
                        <input value={repaymentForm.reference} onChange={(event) => setRepaymentForm({ ...repaymentForm, reference: event.target.value })} placeholder={repaymentForm.payment_method === 'mobile_money' ? 'Mobile Money reference (pending confirmation)' : 'Payment reference (optional)'} className="w-full rounded-lg border border-slate-200 p-2.5 text-sm" />
                        <textarea rows={2} value={repaymentForm.notes} onChange={(event) => setRepaymentForm({ ...repaymentForm, notes: event.target.value })} placeholder="Notes (optional)" className="w-full rounded-lg border border-slate-200 p-2.5 text-sm" />
                        <button disabled={repaymentSaving} className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-medium text-white disabled:opacity-50">{repaymentSaving ? 'Recording…' : 'Record repayment'}</button>
                      </form>}
                    </>
                  )}
                  {repaymentReceipt && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                      <h3 className="font-semibold text-emerald-900">Repayment receipt · #{repaymentReceipt.id}</h3>
                      <p className="mt-1 text-sm text-slate-700">{repaymentReceipt.customer_name} · {formatRWF(repaymentReceipt.amount)} · {repaymentReceipt.payment_method}</p>
                      <p className="text-sm font-medium text-amber-800">Status: {repaymentReceipt.status}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => window.print()} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">Print receipt</button>
                        {canConfirmPayments && repaymentReceipt.status === 'pending' && <button disabled={repaymentSaving} onClick={confirmRepayment} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">Confirm verified payment</button>}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 border rounded-lg text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
