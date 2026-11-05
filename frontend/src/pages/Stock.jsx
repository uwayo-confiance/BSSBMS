import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { AlertTriangle, Edit2, RotateCcw, Trash2 } from 'lucide-react';

export default function Stock() {
  const [stock, setStock] = useState([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadStock = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/stock?active=all${lowOnly ? '&low_only=true' : ''}`);
      setStock(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load stock levels.');
    } finally {
      setLoading(false);
    }
  }, [lowOnly]);

  useEffect(() => { loadStock(); }, [loadStock]);

  const openEdit = (item) => {
    setEditingItem(item);
    setQuantity(String(item.quantity));
    setError('');
  };

  const saveQuantity = async (e) => {
    e.preventDefault();
    const newQuantity = Number(quantity);
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      setError('Quantity must be a non-negative number.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.put(`/stock/${editingItem.id}/quantity`, { quantity: newQuantity });
      setEditingItem(null);
      await loadStock();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update stock quantity.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (item) => {
    if (!window.confirm(`Delete ${item.name}? This will deactivate the product and keep its stock and sales history.`)) return;
    setError('');
    try {
      await api.patch('/products/bulk/deactivate', { ids: [item.id] });
      await loadStock();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete product.');
    }
  };

  const restoreProduct = async (item) => {
    setError('');
    try {
      await api.patch(`/products/${item.id}/restore`);
      await loadStock();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore product.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Stock Levels</h1>
          <p className="text-sm text-slate-500">Current inventory in base units</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
          Low stock only
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Quantity</th>
                <th className="px-4 py-3 font-medium">Min Level</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : stock.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No stock records</td></tr>
              ) : (
                stock.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600">{s.category_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{Number(s.quantity).toFixed(0)} {s.abbreviation}</td>
                    <td className="px-4 py-3 text-slate-600">{Number(s.min_stock_level).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      {!Number(s.is_active) ? (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">Inactive</span>
                      ) : s.is_low ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle size={12} /> Low
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">OK</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {Number(s.is_active) ? (
                          <>
                            <button onClick={() => openEdit(s)} className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-medium">
                              <Edit2 size={14} /> Edit
                            </button>
                            <button onClick={() => deleteProduct(s)} className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 font-medium">
                              <Trash2 size={14} /> Delete
                            </button>
                          </>
                        ) : (
                          <button onClick={() => restoreProduct(s)} className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-medium">
                            <RotateCcw size={14} /> Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={saveQuantity} className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Edit Stock Quantity</h3>
            <p className="text-sm text-slate-600">{editingItem.name} · Current: {Number(editingItem.quantity)} {editingItem.abbreviation}</p>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <div>
              <label className="text-xs font-medium text-slate-600">New total quantity ({editingItem.abbreviation})</label>
              <input
                type="number"
                min="0"
                step="0.001"
                required
                autoFocus
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditingItem(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Quantity'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
