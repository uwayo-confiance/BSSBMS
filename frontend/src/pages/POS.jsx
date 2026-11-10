import { useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, X, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

function getReceiptTimestamp() {
  return new Date().toISOString();
}

const emptyProductForm = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  base_unit_id: '',
  cost_price: '',
  selling_price: '',
  min_stock_level: 0,
  quantity: 0,
};

export default function POS() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [quantityDraft, setQuantityDraft] = useState({});
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [discount, setDiscount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [error, setError] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productFormError, setProductFormError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [productNotice, setProductNotice] = useState('');
  const searchRef = useRef(null);
  const canAddProducts = ['admin', 'manager', 'stock_keeper'].includes(user?.role);

  useEffect(() => {
    api.get('/products?active=true').then((r) => setProducts(r.data.data || []));
    api.get('/customers').then((r) => setCustomers(r.data.data || []));
    Promise.all([api.get('/categories'), api.get('/units')])
      .then(([categoryResponse, unitResponse]) => {
        setCategories(categoryResponse.data.data || []);
        setUnits(unitResponse.data.data?.units || []);
      })
      .catch(() => setCatalogError('Could not load product categories and units. Please reload the POS and try again.'));
    searchRef.current?.focus();
  }, []);

  const saveProduct = async (e) => {
    e.preventDefault();
    setSavingProduct(true);
    setProductFormError('');
    setProductNotice('');
    try {
      await api.post('/products', {
        ...productForm,
        category_id: productForm.category_id || null,
        base_unit_id: Number(productForm.base_unit_id),
        cost_price: Number(productForm.cost_price) || 0,
        selling_price: Number(productForm.selling_price) || 0,
        min_stock_level: Number(productForm.min_stock_level) || 0,
        quantity: Number(productForm.quantity) || 0,
      });
    } catch (err) {
      setProductFormError(err.response?.data?.message || 'Could not save product. Please try again.');
      setSavingProduct(false);
      return;
    }

    setShowProductForm(false);
    setProductForm(emptyProductForm);
    try {
      const response = await api.get('/products?active=true');
      setProducts(response.data.data || []);
      setProductNotice('Product saved to the database and added to the POS list.');
    } catch {
      setProductNotice('Product was saved to the database, but the POS list could not refresh. Reload the POS to see it.');
    } finally {
      setSavingProduct(false);
    }
  };

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode || '').includes(search)
  );

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + 1, total_price: (i.quantity + 1) * i.unit_price }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          unit_id: product.sale_unit_id || product.base_unit_id,
          unit_name: product.base_unit_abbr || 'btl',
          quantity: 1,
          unit_price: Number(product.selling_price),
          discount: 0,
          total_price: Number(product.selling_price),
          stock: Number(product.stock_qty),
        },
      ];
    });
    setSearch('');
    searchRef.current?.focus();
  };

  const updateQty = (productId, delta) => {
    setQuantityDraft((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product_id !== productId) return i;
          const qty = Math.max(0, i.quantity + delta);
          return { ...i, quantity: qty, total_price: qty * i.unit_price - i.discount };
        })
        .filter((i) => i.quantity > 0)
    );
  };

  const changeQuantity = (productId, value) => {
    setQuantityDraft((prev) => ({ ...prev, [productId]: value }));
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setCart((prev) => prev.map((item) =>
      item.product_id === productId
        ? { ...item, quantity, total_price: quantity * item.unit_price - item.discount }
        : item
    ));
  };

  const finishQuantityEdit = (productId) => {
    setQuantityDraft((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const removeItem = (productId) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
    finishQuantityEdit(productId);
  };

  const invalidQuantityDraft = Object.values(quantityDraft).some(
    (value) => !Number.isFinite(Number(value)) || Number(value) <= 0
  );
  const subtotal = cart.reduce((s, i) => s + i.total_price, 0);
  const total = Math.max(0, subtotal - Number(discount || 0));
  const paid = paymentMethod === 'credit' ? 0 : Number(amountPaid || total);
  const change = Math.max(0, paid - total);

  const completeSale = async () => {
    if (cart.length === 0) return;
    if (invalidQuantityDraft) {
      setError('Enter a quantity greater than zero for each product.');
      return;
    }
    if (paymentMethod === 'credit' && !selectedCustomer) {
      setError('Select a customer before completing a credit sale.');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const payload = {
        customer_id: selectedCustomer?.id || null,
        items: cart.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_id: i.unit_id,
          unit_price: i.unit_price,
          discount: i.discount,
        })),
        payment_method: paymentMethod,
        amount_paid: paid,
        discount_amount: Number(discount || 0),
        payment_status: paid >= total ? 'paid' : selectedCustomer ? 'credit' : 'partial',
      };
      const res = await api.post('/sales', payload);
      setLastSale({
        ...res.data.data,
        items: cart.map((item) => ({ ...item })),
        customer_name: selectedCustomer?.name || 'Walk-in Customer',
        cashier_name: user?.full_name || '',
        payment_method: paymentMethod,
        subtotal,
        discount_amount: Number(discount || 0),
        balance_due: Math.max(0, total - Number(res.data.data.amount_paid ?? paid)),
        completed_at: getReceiptTimestamp(),
      });
      setCart([]);
      setQuantityDraft({});
      setDiscount(0);
      setAmountPaid('');
      setSelectedCustomer(null);
      api.get('/products?active=true')
        .then((prods) => setProducts(prods.data.data || []))
        .catch(() => setProductNotice('Sale completed, but stock could not refresh. Reload the POS to see updated stock.'));
    } catch (err) {
      setError(err.response?.data?.message || 'Sale failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col lg:flex-row gap-4">
      {/* Products panel */}
      <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-3 border-b border-slate-100">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-bms-primary" size={18} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product name, SKU or barcode..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-bms-primary outline-none text-sm"
              />
            </div>
            {canAddProducts && (
              <button
                onClick={() => {
                  setProductFormError('');
                  setProductNotice('');
                  setShowProductForm(true);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 bg-bms-primary hover:bg-bms-primary-hover text-white px-3 py-2 rounded-lg text-sm font-medium"
              >
                <Plus size={16} /> Add Product
              </button>
            )}
          </div>
          {productNotice && <p role="status" className="text-xs text-bms-primary mt-2">{productNotice}</p>}
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(0, 40).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">No products found</td>
                </tr>
              ) : filtered.slice(0, 40).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{p.name}</p>
                    {p.sku && <p className="text-xs text-slate-400">{p.sku}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-semibold text-bms-primary">{formatRWF(p.selling_price)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {Number(p.stock_qty).toFixed(0)} {p.base_unit_abbr}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      disabled={Number(p.stock_qty) <= 0}
                      className="inline-flex items-center gap-1 rounded-lg bg-bms-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-bms-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={14} /> Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cart panel */}
      <div className="w-full lg:w-96 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Current Sale</h3>
          {cart.length > 0 && (
            <button onClick={() => { setCart([]); setQuantityDraft({}); }} className="text-xs text-rose-500 hover:underline">Clear</button>
          )}
        </div>

        {/* Customer */}
        <div className="px-4 py-2 border-b border-slate-100">
          <select
            value={selectedCustomer?.id || ''}
            onChange={(e) => {
              const c = customers.find((x) => x.id === Number(e.target.value));
              setSelectedCustomer(c || null);
            }}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-bms-primary"
          >
            <option value="">Walk-in Customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>
            ))}
          </select>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Add products to start a sale</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Quantity</th>
                    <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cart.map((item) => (
                    <tr key={item.product_id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <p className="max-w-28 truncate font-medium text-slate-800" title={item.name}>{item.name}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQty(item.product_id, -1)}
                            aria-label={`Decrease ${item.name} quantity`}
                            className="rounded p-1 text-bms-primary hover:bg-amber-100"
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            aria-label={`Quantity of ${item.name}`}
                            value={quantityDraft[item.product_id] ?? item.quantity}
                            onChange={(e) => changeQuantity(item.product_id, e.target.value)}
                            onBlur={() => finishQuantityEdit(item.product_id)}
                            className="w-14 rounded border border-slate-200 px-1 py-1 text-center text-xs outline-none focus:ring-1 focus:ring-bms-primary"
                          />
                          <button
                            onClick={() => updateQty(item.product_id, 1)}
                            aria-label={`Increase ${item.name} quantity`}
                            className="rounded p-1 text-bms-primary hover:bg-amber-100"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{formatRWF(item.unit_price)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-700">{formatRWF(item.total_price)}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => removeItem(item.product_id)}
                          aria-label={`Remove ${item.name} from sale`}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Totals & Payment */}
        {cart.length > 0 && (
          <div className="border-t border-slate-200 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatRWF(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Discount</span>
              <input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-28 text-right border border-slate-200 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-bms-primary"
                min="0"
              />
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="text-bms-primary">{formatRWF(total)}</span>
            </div>

            {/* Payment method */}
            <div className="flex gap-2">
              {[
                { id: 'cash', icon: Banknote, label: 'Cash' },
                { id: 'mobile_money', icon: Smartphone, label: 'MoMo' },
                { id: 'credit', icon: CreditCard, label: 'Credit' },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setPaymentMethod(id)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border text-xs font-medium transition
                    ${paymentMethod === id ? 'border-bms-primary bg-amber-50 text-bms-primary' : 'border-slate-200 text-bms-primary hover:bg-amber-50'}`}
                >
                  <Icon size={16} className="text-bms-primary" />
                  {label}
                </button>
              ))}
            </div>

            {paymentMethod !== 'credit' && (
              <div>
                <label className="text-xs text-slate-500">Amount Paid</label>
                <input
                  type="number"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder={String(total)}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary"
                />
                {paid > total && (
                  <p className="text-xs text-bms-success mt-1">Change: {formatRWF(change)}</p>
                )}
              </div>
            )}

            {error && <p className="text-sm text-rose-600">{error}</p>}

            {invalidQuantityDraft && <p className="text-sm text-rose-600">Enter a quantity greater than zero for each product.</p>}
            <button
              onClick={completeSale}
              disabled={processing || invalidQuantityDraft}
              className="w-full bg-bms-primary hover:bg-bms-primary-hover text-white font-semibold py-3 rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {processing ? 'Processing...' : `Complete Sale · ${formatRWF(total)}`}
            </button>
          </div>
        )}
      </div>

      {showProductForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={saveProduct} className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Add Product</h3>
                <p className="text-xs text-slate-500 mt-1">Enter the starting stock quantity in the product’s base unit.</p>
              </div>
              <button type="button" onClick={() => setShowProductForm(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            {productFormError && <p role="alert" className="text-sm text-rose-600">{productFormError}</p>}
            {catalogError && <p role="alert" className="text-sm text-rose-600">{catalogError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-600">Name *</label>
                <input required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">SKU</label>
                <input value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Barcode</label>
                <input value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Category</label>
                <select value={productForm.category_id} onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary">
                  <option value="">Select...</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Base Unit *</label>
                <select required value={productForm.base_unit_id} onChange={(e) => setProductForm({ ...productForm, base_unit_id: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary">
                  <option value="">Select...</option>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Cost Price</label>
                <input type="number" min="0" step="any" value={productForm.cost_price} onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Selling Price</label>
                <input type="number" min="0" step="any" value={productForm.selling_price} onChange={(e) => setProductForm({ ...productForm, selling_price: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">
                  Initial Quantity{productForm.base_unit_id ? ` (${units.find((unit) => String(unit.id) === String(productForm.base_unit_id))?.abbreviation || units.find((unit) => String(unit.id) === String(productForm.base_unit_id))?.name || 'base units'})` : ''}
                </label>
                <input type="number" min="0" step="0.001" value={productForm.quantity} onChange={(e) => setProductForm({ ...productForm, quantity: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Min Stock Level</label>
                <input type="number" min="0" step="any" value={productForm.min_stock_level} onChange={(e) => setProductForm({ ...productForm, min_stock_level: e.target.value })}
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-bms-primary" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowProductForm(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={savingProduct} className="flex-1 py-2.5 bg-bms-primary text-white rounded-lg text-sm font-medium hover:bg-bms-primary-hover disabled:opacity-60">
                {savingProduct ? 'Saving...' : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sale receipt */}
      {lastSale && (
        <div id="sale-receipt" className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center overflow-y-auto p-4">
          <div id="receipt-paper" className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="no-print text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 text-bms-success flex items-center justify-center mx-auto mb-4">
                <Check size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Sale Complete</h3>
            </div>
            <div className="text-center border-b border-dashed border-slate-300 pb-4">
              <h2 className="text-xl font-bold text-slate-800">BSSBMS</h2>
              <p className="text-xs font-semibold tracking-widest text-slate-500">FACTURE / SALES INVOICE</p>
              <p className="mt-3 text-xs text-slate-500">Invoice No.</p>
              <p className="text-sm font-semibold text-slate-700">{lastSale.receipt_number}</p>
              <p className="text-xs text-slate-500">{new Date(lastSale.completed_at).toLocaleString()}</p>
            </div>

            <div className="space-y-1 border-b border-dashed border-slate-300 py-3 text-xs">
              <p className="flex justify-between gap-3"><span className="text-slate-500">Customer</span><span className="text-right font-medium">{lastSale.customer_name}</span></p>
              {lastSale.cashier_name && <p className="flex justify-between gap-3"><span className="text-slate-500">Served by</span><span className="text-right font-medium">{lastSale.cashier_name}</span></p>}
              <p className="flex justify-between gap-3"><span className="text-slate-500">Payment</span><span className="text-right font-medium capitalize">{lastSale.payment_method.replace('_', ' ')}</span></p>
            </div>

            <div className="border-b border-dashed border-slate-300 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Price</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lastSale.items.map((item) => (
                    <tr key={item.product_id}>
                      <td className="py-2 pr-2 font-medium text-slate-700">{item.name}</td>
                      <td className="py-2 text-right text-slate-600">{item.quantity}</td>
                      <td className="py-2 text-right text-slate-600">{formatRWF(item.unit_price)}</td>
                      <td className="py-2 text-right font-medium text-slate-700">{formatRWF(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 py-3 text-sm">
              <p className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatRWF(lastSale.subtotal)}</span></p>
              {Number(lastSale.discount_amount) > 0 && <p className="flex justify-between"><span className="text-slate-500">Discount</span><span>-{formatRWF(lastSale.discount_amount)}</span></p>}
              <p className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-800"><span>Total</span><span>{formatRWF(lastSale.total_amount)}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Amount paid</span><span>{formatRWF(lastSale.amount_paid)}</span></p>
              {Number(lastSale.balance_due) > 0 && <p className="flex justify-between font-semibold text-rose-600"><span>Balance due</span><span>{formatRWF(lastSale.balance_due)}</span></p>}
              {Number(lastSale.change_given) > 0 && <p className="flex justify-between font-semibold text-bms-success"><span>Change</span><span>{formatRWF(lastSale.change_given)}</span></p>}
            </div>
            <p className="border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-500">Thank you for your purchase!</p>

            <div className="no-print mt-5 flex gap-3">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-lg bg-bms-primary py-2.5 font-medium text-white transition hover:bg-bms-primary-hover"
              >
                Print Invoice
              </button>
              <button
                onClick={() => setLastSale(null)}
                className="flex-1 rounded-lg bg-bms-dark py-2.5 font-medium text-white transition hover:bg-slate-800"
              >
                New Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
