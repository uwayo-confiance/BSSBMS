import { useEffect, useState } from 'react';
import { Edit2, Plus, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

function formatRWF(amount) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(amount || 0));
}

export default function Suppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const canManageSuppliers = ['admin', 'manager'].includes(user?.role);

  const loadSuppliers = async () => {
    try {
      const response = await api.get('/suppliers');
      setSuppliers(response.data.data || []);
      setLoadError('');
    } catch (error) {
      setLoadError(error.response?.data?.message || 'Could not load suppliers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    api.get('/suppliers')
      .then((response) => {
        if (active) setSuppliers(response.data.data || []);
      })
      .catch((error) => {
        if (active) setLoadError(error.response?.data?.message || 'Could not load suppliers. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredSuppliers = suppliers.filter((supplier) =>
    [supplier.name, supplier.contact_person, supplier.phone, supplier.email, supplier.address]
      .some((value) => (value || '').toLowerCase().includes(search.toLowerCase()))
  );

  const openAddForm = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name || '',
      contact_person: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier.id}`, form);
      } else {
        await api.post('/suppliers', form);
      }
      setShowForm(false);
      await loadSuppliers();
    } catch (error) {
      setFormError(error.response?.data?.message || 'Could not save supplier. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Suppliers</h1>
          <p className="text-sm text-slate-500">Manage supplier contacts and details</p>
        </div>
        {canManageSuppliers && (
          <button onClick={openAddForm} className="inline-flex items-center gap-2 rounded-lg bg-bms-primary px-4 py-2 text-sm font-medium text-white hover:bg-bms-primary-hover">
            <Plus size={16} /> Add Supplier
          </button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search supplier name, contact or phone..."
          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-bms-primary"
        />
      </div>

      {loadError && <p role="alert" className="text-sm text-rose-600">{loadError}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Contact Person</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Purchases</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Credit</th>
                <th className="px-4 py-3 font-medium">Last transaction</th>
                <th className="px-4 py-3 font-medium">Financials</th>
                {canManageSuppliers && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={canManageSuppliers ? 12 : 11} className="px-4 py-8 text-center text-slate-400">Loading suppliers...</td></tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr><td colSpan={canManageSuppliers ? 12 : 11} className="px-4 py-8 text-center text-slate-400">{search ? 'No matching suppliers found' : 'No suppliers yet'}</td></tr>
              ) : filteredSuppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{supplier.name}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.contact_person || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.address || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatRWF(supplier.total_purchases)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatRWF(supplier.total_paid)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatRWF(supplier.outstanding_balance)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatRWF(supplier.credit_balance)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{supplier.last_transaction_date ? String(supplier.last_transaction_date).slice(0, 10) : '—'}</td>
                  <td className="px-4 py-3"><Link to={`/suppliers/${supplier.id}`} className="font-medium text-teal-700 hover:underline">View statement</Link></td>
                  {canManageSuppliers && (
                    <td className="px-4 py-3">
                      <button onClick={() => openEditForm(supplier)} className="inline-flex items-center gap-1.5 font-medium text-bms-primary hover:text-bms-primary-hover">
                        <Edit2 size={14} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSubmit} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">{editingSupplier ? 'Edit Supplier' : 'Add Supplier'}</h2>
            {formError && <p role="alert" className="text-sm text-rose-600">{formError}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">
                Supplier Name *
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Contact Person
                <input value={form.contact_person} onChange={(event) => setForm({ ...form, contact_person: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Phone
                <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Email
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Address
                <textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Notes
                <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-bms-primary" />
              </label>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-bms-primary py-2.5 text-sm font-medium text-white hover:bg-bms-primary-hover disabled:opacity-60">
                {saving ? 'Saving...' : editingSupplier ? 'Save Changes' : 'Save Supplier'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
