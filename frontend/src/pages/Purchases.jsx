import { useEffect, useState } from 'react';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const emptyItem = { product_id: '', quantity: '1', unit_id: '', unit_cost: '' };

export default function Purchases() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState(null);
  const [editingHasPayments, setEditingHasPayments] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const canManagePurchases = ['admin', 'manager', 'stock_keeper'].includes(user?.role);

  const loadPurchases = async () => {
    try {
      const response = await api.get('/purchases');
      setPurchases(response.data.data || []);
      setLoadError('');
    } catch (error) {
      setLoadError(error.response?.data?.message || 'Could not load purchases. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/purchases'), api.get('/suppliers'), api.get('/products'), api.get('/units')])
      .then(([purchaseResponse, supplierResponse, productResponse, unitResponse]) => {
        if (!active) return;
        setPurchases(purchaseResponse.data.data || []);
        setSuppliers(supplierResponse.data.data || []);
        setProducts(productResponse.data.data || []);
        setUnits(unitResponse.data.data?.units || []);
      })
      .catch((error) => {
        if (active) setLoadError(error.response?.data?.message || 'Could not load purchase data. Please reload and try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const total = items.reduce((sum, item) => {
    const lineTotal = Number(item.quantity) * Number(item.unit_cost);
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0);

  const openForm = () => {
    setEditingPurchase(null);
    setEditingHasPayments(false);
    setSupplierId('');
    setInvoiceNumber('');
    setPurchaseDate(today());
    setAmountPaid('');
    setNotes('');
    setItems([{ ...emptyItem }]);
    setFormError('');
    setShowForm(true);
  };

  const editPurchase = async (purchase) => {
    setFormError('');
    setActionError('');
    try {
      const response = await api.get(`/purchases/${purchase.id}`);
      const detail = response.data.data;
      setEditingPurchase(detail);
      setEditingHasPayments(detail.has_supplier_payments);
      setSupplierId(detail.supplier_id ? String(detail.supplier_id) : '');
      setInvoiceNumber(detail.invoice_number || '');
      setPurchaseDate(String(detail.purchase_date).slice(0, 10));
      setAmountPaid(String(detail.amount_paid || 0));
      setNotes(detail.notes || '');
      setItems(detail.items.map((item) => ({
        product_id: String(item.product_id),
        quantity: String(item.quantity),
        unit_id: String(item.unit_id),
        unit_cost: String(item.unit_cost),
      })));
      setShowForm(true);
    } catch (error) {
      setActionError(error.response?.data?.message || 'Could not load this purchase for editing.');
    }
  };

  const deletePurchase = async (purchase) => {
    if (!window.confirm(`Delete purchase ${purchase.invoice_number || `#${purchase.id}`}? This cancels the purchase and reverses its stock while preserving its history.`)) {
      return;
    }
    setActionError('');
    try {
      await api.delete(`/purchases/${purchase.id}`);
      await loadPurchases();
    } catch (error) {
      setActionError(error.response?.data?.message || 'Could not delete this purchase.');
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPurchase(null);
    setEditingHasPayments(false);
  };

  const updateItem = (index, key, value) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (key === 'unit_id') {
        const product = products.find((candidate) => String(candidate.id) === item.product_id);
        const selectedUnit = (product?.product_units || []).find(
          (unit) => String(unit.unit_id) === String(value) && Number(unit.is_active) && Number(unit.is_purchase_enabled)
        );
        return {
          ...item,
          unit_id: value,
          ...(selectedUnit?.purchase_price != null ? { unit_cost: String(selectedUnit.purchase_price) } : {}),
        };
      }
      if (key !== 'product_id') return { ...item, [key]: value };
      const product = products.find((candidate) => String(candidate.id) === value);
      const purchaseUnits = (product?.product_units || []).filter(
        (unit) => Number(unit.is_active) && Number(unit.is_purchase_enabled)
      );
      const defaultUnit = purchaseUnits.find((unit) => Number(unit.is_default_purchase)) || purchaseUnits[0];
      return {
        ...item,
        product_id: value,
        unit_id: product ? String(defaultUnit?.unit_id || product.purchase_unit_id || product.base_unit_id) : '',
        unit_cost: product ? String(defaultUnit?.purchase_price ?? product.cost_price ?? '') : '',
      };
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    const invalidItem = items.some((item) =>
      !item.product_id || !item.unit_id || !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) < 0
    );
    if (invalidItem) {
      setFormError('Choose a product and enter a valid quantity and unit cost for every item.');
      return;
    }
    const paid = Number(amountPaid || 0);
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      setFormError('Amount paid must be between zero and the purchase total.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId ? Number(supplierId) : null,
        invoice_number: invoiceNumber.trim() || null,
        purchase_date: purchaseDate,
        amount_paid: paid,
        notes: notes.trim() || null,
        items: items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          unit_id: Number(item.unit_id),
          unit_cost: Number(item.unit_cost),
        })),
      };
      if (editingPurchase) {
        await api.put(`/purchases/${editingPurchase.id}`, payload);
      } else {
        await api.post('/purchases', payload);
      }
      closeForm();
      await loadPurchases();
    } catch (error) {
      setFormError(error.response?.data?.message || 'Could not save the purchase. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Purchases</h1>
          <p className="text-sm text-slate-500">Supplier purchases and stock receipts</p>
        </div>
        {canManagePurchases && (
          <button onClick={openForm} className="inline-flex items-center gap-2 rounded-lg bg-bms-primary px-4 py-2 text-sm font-medium text-white hover:bg-bms-primary-hover">
            <Plus size={16} /> Record Purchase
          </button>
        )}
      </div>

      {loadError && <p role="alert" className="text-sm text-rose-600">{loadError}</p>}
      {actionError && <p role="alert" className="text-sm text-rose-600">{actionError}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">Balance</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canManagePurchases && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={canManagePurchases ? 8 : 7} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : purchases.length === 0 ? (
                <tr><td colSpan={canManagePurchases ? 8 : 7} className="px-4 py-8 text-center text-slate-400">No purchases yet</td></tr>
              ) : (
                purchases.map((purchase) => (
                  <tr key={purchase.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{String(purchase.purchase_date).slice(0, 10)}</td>
                    <td className="px-4 py-3 font-medium">{purchase.supplier_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{purchase.invoice_number || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{formatRWF(purchase.total_amount)}</td>
                    <td className="px-4 py-3">{formatRWF(purchase.amount_paid)}</td>
                    <td className="px-4 py-3 text-rose-600">{formatRWF(purchase.balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        purchase.status === 'cancelled' ? 'bg-slate-100 text-slate-600' :
                        purchase.payment_status === 'paid' ? 'bg-teal-50 text-teal-700' :
                        purchase.payment_status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                      }`}>{purchase.status === 'cancelled' ? 'cancelled' : purchase.payment_status}</span>
                    </td>
                    {canManagePurchases && (
                      <td className="px-4 py-3">
                        {purchase.status !== 'cancelled' && (
                          <div className="flex items-center gap-3">
                            <button onClick={() => editPurchase(purchase)} className="inline-flex items-center gap-1 text-sm font-medium text-bms-primary hover:text-bms-primary-hover">
                              <Edit2 size={14} /> Edit
                            </button>
                            <button onClick={() => deletePurchase(purchase)} className="inline-flex items-center gap-1 text-sm font-medium text-rose-600 hover:text-rose-800">
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
          <form onSubmit={handleSubmit} className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{editingPurchase ? 'Edit Purchase' : 'Record Purchase'}</h2>
                <p className="text-sm text-slate-500">Received products will be added to stock.</p>
              </div>
              <button type="button" aria-label="Close" onClick={closeForm} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>

            {formError && <p role="alert" className="text-sm text-rose-600">{formError}</p>}
            {(suppliers.length === 0 || products.length === 0) && (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {suppliers.length === 0 ? 'Add a supplier before recording a purchase. ' : ''}
                {products.length === 0 ? 'Add an active product before recording a purchase.' : ''}
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs font-medium text-slate-600">
                Supplier
                <select disabled={editingHasPayments} value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal disabled:bg-slate-100">
                  <option value="">Select supplier (optional)</option>
                  {suppliers.filter((supplier) => Number(supplier.is_active) || String(supplier.id) === supplierId).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Supplier Invoice Number
                <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Purchase Date *
                <input required type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">Products</h3>
                <button type="button" onClick={() => setItems((current) => [...current, { ...emptyItem }])} className="inline-flex items-center gap-1 text-sm font-medium text-bms-primary hover:text-bms-primary-hover">
                  <Plus size={15} /> Add item
                </button>
              </div>
              {items.map((item, index) => {
                const product = products.find((candidate) => String(candidate.id) === item.product_id);
                const purchaseUnits = (product?.product_units || []).filter(
                  (unit) => Number(unit.is_active) && Number(unit.is_purchase_enabled)
                );
                return (
                  <div key={index} className="grid items-end gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(75px,0.8fr)_minmax(110px,1fr)_minmax(110px,1fr)_auto]">
                    <label className="text-xs font-medium text-slate-600">
                      Product
                      <select required value={item.product_id} onChange={(event) => updateItem(index, 'product_id', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal">
                        <option value="">Select product</option>
                        {products.filter((option) => Number(option.is_active) || String(option.id) === item.product_id).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Quantity
                      <input required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Unit
                      <select required value={item.unit_id} onChange={(event) => updateItem(index, 'unit_id', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal">
                        <option value="">Select unit</option>
                        {(purchaseUnits.length ? purchaseUnits.map(({ unit }) => unit).filter(Boolean) : units)
                          .map((unit) => <option key={unit.id} value={unit.id}>{unit.name} {unit.abbreviation ? `(${unit.abbreviation})` : ''}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Unit Cost (RWF)
                      <input required type="number" min="0" step="any" value={item.unit_cost} onChange={(event) => updateItem(index, 'unit_cost', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal" />
                    </label>
                    <button type="button" disabled={items.length === 1} aria-label={`Remove item ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="mb-1 rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                      <Trash2 size={16} />
                    </button>
                    {product && <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-5">Current stock: {Number(product.stock_qty || 0)} {product.base_unit_abbr || ''}</p>}
                  </div>
                );
              })}
            </div>

            <label className="block text-xs font-medium text-slate-600">
              Notes
              <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" />
            </label>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="text-xs font-medium text-slate-600">
                Amount Paid (RWF)
                <input type="number" min="0" max={total} step="any" disabled={editingHasPayments} value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} placeholder="0" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal disabled:bg-slate-100 sm:w-52" />
                {editingHasPayments && <span className="mt-1 block text-xs font-normal text-slate-500">Recorded supplier payments cannot be changed here.</span>}
              </label>
              <div className="text-right">
                <p className="text-sm text-slate-500">Purchase Total</p>
                <p className="text-xl font-bold text-slate-800">{formatRWF(total)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={closeForm} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving || products.length === 0} className="flex-1 rounded-lg bg-bms-primary py-2.5 text-sm font-medium text-white hover:bg-bms-primary-hover disabled:opacity-60">
                {saving ? (editingPurchase ? 'Updating...' : 'Recording...') : editingPurchase ? 'Save Changes' : 'Record Purchase'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
