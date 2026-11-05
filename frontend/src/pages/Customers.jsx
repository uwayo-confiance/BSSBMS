import { useEffect, useState } from 'react';
import api from '../services/api';
import { Edit2, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1 });
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingStatusIds, setUpdatingStatusIds] = useState([]);

  const load = () => {
    setLoading(true);
    api.get('/customers?active=all').then((r) => setCustomers(r.data.data || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

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
        await api.put(`/customers/${editingCustomer.id}`, {
          ...form,
          credit_limit: Number(form.credit_limit) || 0,
          is_active: Number(form.is_active),
        });
      } else {
        await api.post('/customers', { ...form, credit_limit: Number(form.credit_limit) || 0 });
      }
      setShowForm(false);
      setEditingCustomer(null);
      setForm({ name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1 });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save customer. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const openAddForm = () => {
    setEditingCustomer(null);
    setForm({ name: '', phone: '', email: '', address: '', credit_limit: 0, is_active: 1 });
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
                <th className="px-4 py-3 font-medium">Outstanding Debt</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No customers found</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.address || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{formatRWF(c.credit_limit)}</td>
                  <td className="px-4 py-3">
                    <span className={Number(c.total_debt) > 0 ? 'text-rose-600 font-semibold' : 'text-slate-600'}>
                      {formatRWF(c.total_debt)}
                    </span>
                  </td>
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
