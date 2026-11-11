import { useEffect, useState } from 'react';
import api from '../services/api';
import { AlertCircle, CheckCircle2, Plus, Search, Edit2, Trash2, X } from 'lucide-react';

const emptyForm = {
  name: '',
  category_id: '',
  base_unit_id: '',
  cost_price: '',
  selling_price: '',
  min_stock_level: 0,
  sku: '',
  barcode: '',
  quantity: 0,
  is_active: 1,
  product_units: [],
  track_expiry: 0,
  require_batch: 0,
};

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivatingIds, setDeactivatingIds] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const load = async () => {
    setLoading(true);
    try {
      const [p, c, u] = await Promise.all([
        api.get('/products'),
        api.get('/categories'),
        api.get('/units'),
      ]);
      setProducts(p.data.data || []);
      setCategories(c.data.data || []);
      setUnits(u.data.data?.units || []);
    } catch (err) {
      setToast({ type: 'error', message: err.response?.data?.message || 'Failed to load products.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const wasEditing = Boolean(editingProduct);
      const baseUnitConfig = editingProduct?.product_units?.find(
        (unit) => Number(unit.unit_id) === Number(form.base_unit_id)
      );
      const additionalDefaultPurchase = form.product_units.some((unit) => Number(unit.is_default_purchase));
      const additionalDefaultSale = form.product_units.some((unit) => Number(unit.is_default_sale));
      const configuredUnits = [
        ...form.product_units,
        ...(baseUnitConfig ? [{
          unit_id: String(baseUnitConfig.unit_id),
          conversion_factor: String(baseUnitConfig.conversion_factor),
          purchase_price: String(baseUnitConfig.purchase_price ?? ''),
          selling_price: String(baseUnitConfig.selling_price ?? ''),
          is_purchase_enabled: Number(baseUnitConfig.is_purchase_enabled),
          is_sale_enabled: Number(baseUnitConfig.is_sale_enabled),
          is_active: Number(baseUnitConfig.is_active),
          is_default_purchase: additionalDefaultPurchase ? 0 : Number(baseUnitConfig.is_default_purchase),
          is_default_sale: additionalDefaultSale ? 0 : Number(baseUnitConfig.is_default_sale),
        }] : []),
      ];
      const payload = {
        ...form,
        product_units: configuredUnits
          .filter((unit) => unit.unit_id)
          .map((unit) => ({
            ...unit,
            unit_id: Number(unit.unit_id),
            conversion_factor: Number(unit.conversion_factor),
            purchase_price: Number(unit.unit_id) === Number(form.base_unit_id)
              ? Number(form.cost_price) || 0
              : unit.purchase_price === '' ? null : Number(unit.purchase_price),
            selling_price: Number(unit.is_default_sale)
              ? Number(form.selling_price) || 0
              : unit.selling_price === '' ? null : Number(unit.selling_price),
          })),
        category_id: form.category_id || null,
        base_unit_id: Number(form.base_unit_id),
        cost_price: Number(form.cost_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        min_stock_level: Number(form.min_stock_level) || 0,
        track_expiry: Number(form.track_expiry),
        require_batch: Number(form.require_batch),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
      };
      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, {
          ...payload,
          is_active: Number(form.is_active),
        });
      } else {
        await api.post('/products', {
          ...payload,
          quantity: Number(form.quantity) || 0,
        });
      }
      setShowForm(false);
      setEditingProduct(null);
      setForm(emptyForm);
      setToast({ type: 'success', message: wasEditing ? 'Product updated successfully.' : 'Product added successfully.' });
      await load();
    } catch (err) {
      setToast({ type: 'error', message: err.response?.data?.message || 'Failed to save product.' });
    } finally {
      setSaving(false);
    }
  };

  const openAddForm = () => {
    setEditingProduct(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setForm({
      name: product.name || '',
      category_id: product.category_id || '',
      base_unit_id: product.base_unit_id || '',
      cost_price: product.cost_price ?? '',
      selling_price: product.selling_price ?? '',
      min_stock_level: product.min_stock_level ?? 0,
      sku: product.sku || '',
      barcode: product.barcode || '',
      quantity: 0,
      is_active: Number(product.is_active) ? 1 : 0,
      track_expiry: Number(product.track_expiry) ? 1 : 0,
      require_batch: Number(product.require_batch) ? 1 : 0,
      product_units: (product.product_units || [])
        .filter((unit) => Number(unit.unit_id) !== Number(product.base_unit_id))
        .map((unit) => ({
          unit_id: String(unit.unit_id),
          conversion_factor: String(unit.conversion_factor),
          purchase_price: unit.purchase_price == null ? '' : String(unit.purchase_price),
          selling_price: unit.selling_price == null ? '' : String(unit.selling_price),
          is_purchase_enabled: Number(unit.is_purchase_enabled),
          is_sale_enabled: Number(unit.is_sale_enabled),
          is_active: Number(unit.is_active),
          is_default_purchase: Number(unit.is_default_purchase),
          is_default_sale: Number(unit.is_default_sale),
        })),
    });
    setShowForm(true);
  };

  const updateProductUnit = (index, key, value) => {
    setForm((current) => ({
      ...current,
      product_units: current.product_units.map((unit, unitIndex) => {
        if (unitIndex !== index) {
          if ((key === 'is_default_purchase' || key === 'is_default_sale') && value === 1) {
            return { ...unit, [key]: 0 };
          }
          return unit;
        }
        return { ...unit, [key]: value };
      }),
    }));
  };

  const addProductUnit = () => {
    setForm((current) => ({
      ...current,
      product_units: [...current.product_units, {
        unit_id: '',
        conversion_factor: '1',
        purchase_price: '',
        selling_price: '',
        is_purchase_enabled: 1,
        is_sale_enabled: 0,
        is_active: 1,
        is_default_purchase: 0,
        is_default_sale: 0,
      }],
    }));
  };

  const toggleProductSelection = (productId) => {
    setSelectedIds((ids) =>
      ids.includes(productId) ? ids.filter((id) => id !== productId) : [...ids, productId]
    );
  };

  const toggleVisibleSelection = () => {
    const visibleIds = filtered.map((product) => product.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((ids) => allVisibleSelected
      ? ids.filter((id) => !visibleIds.includes(id))
      : [...new Set([...ids, ...visibleIds])]
    );
  };

  const deactivateProducts = async (ids) => {
    const activeIds = ids.filter((id) => products.some((product) => product.id === id && Number(product.is_active)));
    if (!activeIds.length) return;
    const label = activeIds.length === 1 ? 'this product' : `${activeIds.length} selected products`;
    if (!window.confirm(`Delete ${label}? This will deactivate it and preserve its sales and stock history.`)) return;

    setDeactivatingIds(activeIds);
    try {
      await api.patch('/products/bulk/deactivate', { ids: activeIds });
      setSelectedIds((selected) => selected.filter((id) => !activeIds.includes(id)));
      setToast({
        type: 'success',
        message: activeIds.length === 1 ? 'Product deleted successfully.' : `${activeIds.length} products deleted successfully.`,
      });
      await load();
    } catch (err) {
      setToast({ type: 'error', message: err.response?.data?.message || 'Failed to delete product(s).' });
    } finally {
      setDeactivatingIds([]);
    }
  };

  const restoreProduct = async (productId) => {
    try {
      await api.patch(`/products/${productId}/restore`);
      setSelectedIds((ids) => ids.filter((id) => id !== productId));
      setToast({ type: 'success', message: 'Product restored successfully.' });
      await load();
    } catch (err) {
      setToast({ type: 'error', message: err.response?.data?.message || 'Failed to restore product.' });
    }
  };

  const visibleIds = filtered.map((product) => product.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  return (
    <div className="space-y-4">
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          className={`fixed right-4 top-4 z-[70] flex max-w-sm items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
            toast.type === 'success'
              ? 'border-teal-200 bg-white text-teal-800'
              : 'border-rose-200 bg-white text-rose-800'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={20} className="shrink-0 text-teal-600" /> : <AlertCircle size={20} className="shrink-0 text-rose-600" />}
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification" className="shrink-0 text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Products</h1>
          <p className="text-sm text-slate-500">{products.length} products</p>
        </div>
        <button
          onClick={openAddForm}
          className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products..."
          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-teal-50 border border-teal-100 rounded-lg px-4 py-2">
          <span className="text-sm text-teal-800">{selectedIds.length} product(s) selected</span>
          <button
            type="button"
            onClick={() => deactivateProducts(selectedIds)}
            disabled={deactivatingIds.length > 0}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 hover:text-rose-900 disabled:opacity-60"
          >
            <Trash2 size={15} /> Delete selected
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all visible products"
                    checked={allVisibleSelected}
                    onChange={toggleVisibleSelection}
                    className="accent-teal-600"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Cost</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No products found</td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.name}`}
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleProductSelection(p.id)}
                        className="accent-teal-600"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      {p.sku && <p className="text-xs text-slate-400">{p.sku}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.category_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={Number(p.min_stock_level) > 0 && Number(p.stock_qty) <= Number(p.min_stock_level) ? 'text-rose-600 font-medium' : 'text-slate-700'}>
                        {Number(p.stock_qty).toFixed(0)} {p.base_unit_abbr}
                      </span>
                      {Number(p.is_active) && Number(p.min_stock_level) > 0 && Number(p.stock_qty) <= Number(p.min_stock_level) && (
                        <span className="ml-2 text-xs text-rose-600">Low</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatRWF(p.cost_price)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{formatRWF(p.selling_price)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${Number(p.is_active) ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                        {Number(p.is_active) ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEditForm(p)} className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-medium">
                          <Edit2 size={14} /> Edit
                        </button>
                        {Number(p.is_active) ? (
                          <button
                            onClick={() => deactivateProducts([p.id])}
                            disabled={deactivatingIds.includes(p.id)}
                            className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 font-medium disabled:opacity-60"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        ) : (
                          <button onClick={() => restoreProduct(p.id)} className="text-teal-700 hover:text-teal-900 font-medium">
                            Restore
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

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-600">Name *</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">SKU</label>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Barcode</label>
                <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Category</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">Select...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Base Unit *</label>
                <select required disabled={Boolean(editingProduct)} value={form.base_unit_id} onChange={(e) => setForm({ ...form, base_unit_id: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-500">
                  <option value="">Select...</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {editingProduct && <p className="text-xs text-slate-400 mt-1">Base unit cannot be changed after stock is recorded.</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Cost Price</label>
                <input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Selling Price</label>
                <input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              {!editingProduct && <div>
                <label className="text-xs font-medium text-slate-600">
                  Initial Quantity{form.base_unit_id ? ` (${units.find((u) => String(u.id) === String(form.base_unit_id))?.abbreviation || units.find((u) => String(u.id) === String(form.base_unit_id))?.name || 'base units'})` : ''}
                </label>
                <input type="number" min="0" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
                <p className="text-xs text-slate-400 mt-1">Starting stock for this product.</p>
              </div>}
              <div>
                <label className="text-xs font-medium text-slate-600">Min Stock Level</label>
                <input type="number" value={form.min_stock_level} onChange={(e) => setForm({ ...form, min_stock_level: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              {editingProduct && <div>
                <label className="text-xs font-medium text-slate-600">Status</label>
                <select value={form.is_active} onChange={(e) => setForm({ ...form, is_active: Number(e.target.value) })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500">
                  <option value={1}>Active</option>
                  <option value={0}>Inactive</option>
                </select>
              </div>}
              <label className="col-span-2 inline-flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={Boolean(Number(form.track_expiry))}
                  onChange={(event) => setForm({ ...form, track_expiry: event.target.checked ? 1 : 0 })} />
                Track expiry dates for received batches
              </label>
              <label className="col-span-2 inline-flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={Boolean(Number(form.require_batch))}
                  onChange={(event) => setForm({ ...form, require_batch: event.target.checked ? 1 : 0 })} />
                Require batch number when receiving stock
              </label>
            </div>
            <section className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Product Units & Packaging</h4>
                  <p className="text-xs text-slate-500">
                    Set how each package converts into {units.find((unit) => String(unit.id) === String(form.base_unit_id))?.name || 'the base unit'}.
                  </p>
                </div>
                <button type="button" onClick={addProductUnit} className="inline-flex items-center gap-1 self-start rounded-lg border border-teal-200 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50">
                  <Plus size={14} /> Add unit
                </button>
              </div>
              {form.product_units.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                  The base unit is available automatically. Add a package such as a crate to configure its product-specific conversion.
                </p>
              )}
              {form.product_units.map((unit, index) => {
                const usedUnitIds = form.product_units
                  .filter((_, rowIndex) => rowIndex !== index)
                  .map((row) => String(row.unit_id));
                return (
                  <div key={`${unit.unit_id || 'new'}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-6">
                    <label className="text-xs font-medium text-slate-600 lg:col-span-2">
                      Unit
                      <select required value={unit.unit_id} onChange={(event) => updateProductUnit(index, 'unit_id', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal">
                        <option value="">Select unit</option>
                        {units.filter((option) => String(option.id) !== String(form.base_unit_id) &&
                          (!usedUnitIds.includes(String(option.id)) || String(option.id) === String(unit.unit_id)))
                          .map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Base units per package
                      <input required type="number" min="0.0001" step="0.0001" value={unit.conversion_factor}
                        onChange={(event) => updateProductUnit(index, 'conversion_factor', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Purchase cost
                      <input type="number" min={Number(unit.is_purchase_enabled) && Number(unit.is_active) ? '0.01' : '0'}
                        required={Boolean(Number(unit.is_purchase_enabled) && Number(unit.is_active))}
                        step="any" value={unit.purchase_price}
                        onChange={(event) => updateProductUnit(index, 'purchase_price', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Selling price
                      <input type="number" min={Number(unit.is_sale_enabled) && Number(unit.is_active) ? '0.01' : '0'}
                        required={Boolean(Number(unit.is_sale_enabled) && Number(unit.is_active))}
                        step="any" value={unit.selling_price}
                        onChange={(event) => updateProductUnit(index, 'selling_price', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" />
                    </label>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600 lg:col-span-6">
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(Number(unit.is_purchase_enabled))}
                          onChange={(event) => updateProductUnit(index, 'is_purchase_enabled', event.target.checked ? 1 : 0)} />
                        Allow purchase
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(Number(unit.is_sale_enabled))}
                          onChange={(event) => updateProductUnit(index, 'is_sale_enabled', event.target.checked ? 1 : 0)} />
                        Allow sale
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(Number(unit.is_active))}
                          onChange={(event) => updateProductUnit(index, 'is_active', event.target.checked ? 1 : 0)} />
                        Active
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(Number(unit.is_default_purchase))}
                          onChange={(event) => updateProductUnit(index, 'is_default_purchase', event.target.checked ? 1 : 0)} />
                        Default purchase
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(Number(unit.is_default_sale))}
                          onChange={(event) => updateProductUnit(index, 'is_default_sale', event.target.checked ? 1 : 0)} />
                        Default sale
                      </label>
                      <button type="button" onClick={() => setForm((current) => ({
                        ...current,
                        product_units: current.product_units.filter((_, rowIndex) => rowIndex !== index),
                      }))} aria-label={`Remove product unit ${index + 1}`} className="ml-auto inline-flex items-center gap-1 text-rose-600 hover:text-rose-800">
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditingProduct(null); }} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
                {saving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
