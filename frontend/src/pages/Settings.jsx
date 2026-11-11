import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Boxes, ChevronRight, Layers3, LayoutGrid,
  Save, ShieldCheck, SlidersHorizontal, Users, Plus, Pencil, RotateCcw,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const sections = [
  { id: 'business', label: 'Business Information', icon: Building2, description: 'Name, contact details, currency and time zone' },
  { id: 'units', label: 'Product Units & Conversions', icon: Boxes, description: 'Product-specific purchase/sale units and prices' },
  { id: 'floor', label: 'Floor & Seating', icon: LayoutGrid, description: 'Areas, tables, order and display positions' },
  { id: 'receipt', label: 'Receipt & POS', icon: SlidersHorizontal, description: 'Receipt format, information and footer' },
  { id: 'inventory', label: 'Inventory Configuration', icon: Layers3, description: 'Low-stock defaults, batches and adjustments' },
  { id: 'users', label: 'Users & Permissions', icon: Users, description: 'Accounts, roles, status and password resets', adminOnly: true },
  { id: 'security', label: 'Security & Audit', icon: ShieldCheck, description: 'Review sensitive activity and conversion history', adminOnly: true },
];

const defaultBusiness = {
  name: 'Umucyo Bar', address: '', phone: '', email: '', tin: '', currency: 'RWF',
  logo_url: '', timezone: 'Africa/Kigali', receipt_footer: '',
};
const defaultConfiguration = {
  receipt: {
    paper_format: '80mm', show_cashier: true, show_table_number: true,
    show_payment_breakdown: true, show_open_table_balance: true, footer: '',
  },
  inventory: {
    default_low_stock_threshold: 0, require_adjustment_approval: true,
    track_expiry_by_default: false, require_batch_by_default: false,
  },
};

const textInput = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-bms-primary px-4 py-2 text-sm font-medium text-white hover:bg-bms-primary-hover disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

function SectionTitle({ title, description }) {
  return <div><h2 className="text-lg font-bold text-slate-800">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

function Field({ label, children }) {
  return <label className="block text-sm font-medium text-slate-600">{label}{children}</label>;
}

function Toggle({ label, checked, onChange, help }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 accent-teal-700" />
      <span><span className="block text-sm font-medium text-slate-700">{label}</span>
        {help && <span className="mt-0.5 block text-xs text-slate-500">{help}</span>}</span>
    </label>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManage = ['admin', 'manager'].includes(user?.role);
  const visibleSections = sections.filter((section) => !section.adminOnly || isAdmin);
  const [activeSection, setActiveSection] = useState('business');
  const [business, setBusiness] = useState(defaultBusiness);
  const [configuration, setConfiguration] = useState(defaultConfiguration);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [floor, setFloor] = useState({ areas: [], tables: [] });
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [unitHistory, setUnitHistory] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [unitRows, setUnitRows] = useState([]);
  const [unitReason, setUnitReason] = useState('');
  const [businessReason, setBusinessReason] = useState('');
  const [configurationReason, setConfigurationReason] = useState('');
  const [newArea, setNewArea] = useState({ name: '', sort_order: 0, reason: '' });
  const [newTable, setNewTable] = useState({ area_id: '', table_name: '', capacity: 2, sort_order: 0, reason: '' });
  const [userForm, setUserForm] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsResponse, floorResponse] = await Promise.all([
        api.get('/settings'),
        api.get('/floor'),
      ]);
      setBusiness({ ...defaultBusiness, ...settingsResponse.data.data.business });
      setConfiguration({
        receipt: { ...defaultConfiguration.receipt, ...settingsResponse.data.data.configuration.receipt },
        inventory: { ...defaultConfiguration.inventory, ...settingsResponse.data.data.configuration.inventory },
      });
      setFloor(floorResponse.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, [setBusiness, setConfiguration]);

  const loadProducts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [productResponse, unitResponse] = await Promise.all([
        api.get('/products?active=true'),
        api.get('/units'),
      ]);
      setProducts(productResponse.data.data || []);
      setUnits(unitResponse.data.data.units || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load product unit settings.');
    }
  }, [isAdmin]);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const response = await api.get('/settings/users');
      setUsers(response.data.data.users || []);
      setRoles(response.data.data.roles || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load users.');
    }
  }, [isAdmin]);

  const loadHistory = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [auditResponse, unitsResponse] = await Promise.all([
        api.get('/audit', { params: { limit: 150 } }),
        api.get('/settings/unit-history'),
      ]);
      setAuditLogs(auditResponse.data.data || []);
      setUnitHistory(unitsResponse.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load settings history.');
    }
  }, [isAdmin]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => {
    if (activeSection === 'units') loadProducts();
    if (activeSection === 'users') loadUsers();
    if (activeSection === 'security') loadHistory();
  }, [activeSection, loadProducts, loadUsers, loadHistory]);

  const selectedProduct = products.find((product) => String(product.id) === selectedProductId);
  const filteredProducts = useMemo(() => products.filter((product) => {
    const query = search.toLowerCase();
    return product.name.toLowerCase().includes(query) ||
      String(product.sku || '').toLowerCase().includes(query) ||
      String(product.barcode || '').toLowerCase().includes(query);
  }), [products, search]);

  const notifyError = (err, fallback) => {
    setError(err.response?.data?.message || fallback);
    setSuccess('');
  };
  const notifySuccess = (message) => {
    setSuccess(message);
    setError('');
  };

  const saveBusiness = async (event) => {
    event.preventDefault();
    if (!businessReason.trim()) return setError('Enter a reason for changing business information.');
    setSaving(true);
    try {
      await api.put('/settings/business', { ...business, reason: businessReason });
      setBusinessReason('');
      notifySuccess('Business information saved.');
    } catch (err) {
      notifyError(err, 'Could not save business information.');
    } finally {
      setSaving(false);
    }
  };

  const saveConfiguration = async (event) => {
    event.preventDefault();
    if (!configurationReason.trim()) return setError('Enter a reason for changing settings.');
    setSaving(true);
    try {
      await api.put('/settings/configuration', { configuration, reason: configurationReason });
      setConfigurationReason('');
      notifySuccess('Settings saved.');
    } catch (err) {
      notifyError(err, 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const selectProduct = (product) => {
    setSelectedProductId(String(product.id));
    setUnitRows((product.product_units || []).map((row) => ({
      unit_id: Number(row.unit_id),
      conversion_factor: String(row.conversion_factor),
      purchase_price: row.purchase_price == null ? '' : String(row.purchase_price),
      selling_price: row.selling_price == null ? '' : String(row.selling_price),
      is_purchase_enabled: Number(row.is_purchase_enabled) === 1,
      is_sale_enabled: Number(row.is_sale_enabled) === 1,
      is_active: Number(row.is_active) === 1,
      is_default_purchase: Number(row.is_default_purchase) === 1,
      is_default_sale: Number(row.is_default_sale) === 1,
      unit: row.unit,
    })));
    setUnitReason('');
  };

  const saveProductUnits = async (event) => {
    event.preventDefault();
    if (!selectedProduct || !unitReason.trim()) return setError('Select a product and enter a reason for changing its units.');
    if (!window.confirm(`Save future purchase and sale unit settings for ${selectedProduct.name}? Historical transactions will not change.`)) return;
    setSaving(true);
    try {
      const response = await api.put(`/products/${selectedProduct.id}/units`, {
        product_units: unitRows.map(({ unit: _unit, ...row }) => ({
          ...row,
          conversion_factor: Number(row.conversion_factor),
          purchase_price: row.purchase_price === '' ? null : Number(row.purchase_price),
          selling_price: row.selling_price === '' ? null : Number(row.selling_price),
        })),
        reason: unitReason,
      });
      setProducts((current) => current.map((product) => product.id === selectedProduct.id
        ? { ...product, product_units: response.data.data } : product));
      setUnitRows(response.data.data.map((row) => ({
        ...row,
        conversion_factor: String(row.conversion_factor),
        purchase_price: row.purchase_price == null ? '' : String(row.purchase_price),
        selling_price: row.selling_price == null ? '' : String(row.selling_price),
        is_purchase_enabled: Number(row.is_purchase_enabled) === 1,
        is_sale_enabled: Number(row.is_sale_enabled) === 1,
        is_active: Number(row.is_active) === 1,
        is_default_purchase: Number(row.is_default_purchase) === 1,
        is_default_sale: Number(row.is_default_sale) === 1,
      })));
      setUnitReason('');
      notifySuccess('Product units and prices saved. Past transactions remain unchanged.');
      loadHistory();
    } catch (err) {
      notifyError(err, 'Could not save product unit settings.');
    } finally {
      setSaving(false);
    }
  };

  const addUnitRow = (unitId) => {
    const id = Number(unitId);
    if (!id || unitRows.some((row) => row.unit_id === id)) return;
    setUnitRows((rows) => [...rows, {
      unit_id: id, conversion_factor: '1', purchase_price: '', selling_price: '',
      is_purchase_enabled: false, is_sale_enabled: false, is_active: true,
      is_default_purchase: false, is_default_sale: false,
      unit: units.find((unit) => unit.id === id),
    }]);
  };

  const updateUnitRow = (index, key, value) => {
    setUnitRows((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  };

  const createArea = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/floor/areas', newArea);
      setNewArea({ name: '', sort_order: 0, reason: '' });
      await loadBase();
      notifySuccess('Area created.');
    } catch (err) {
      notifyError(err, 'Could not create area.');
    } finally { setSaving(false); }
  };

  const editArea = async (area) => {
    const name = window.prompt('Area name', area.name);
    if (name == null || !name.trim()) return;
    const sortOrder = window.prompt('Display order (lower numbers appear first)', area.sort_order ?? 0);
    if (sortOrder == null || !Number.isInteger(Number(sortOrder)) || Number(sortOrder) < 0) return;
    const reason = window.prompt('Reason for this floor setting change');
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      await api.put(`/floor/areas/${area.id}`, { name: name.trim(), sort_order: Number(sortOrder), reason });
      await loadBase();
      notifySuccess('Area updated.');
    } catch (err) { notifyError(err, 'Could not update area.'); }
    finally { setSaving(false); }
  };

  const createTable = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/floor/tables', {
        ...newTable, area_id: Number(newTable.area_id), capacity: Number(newTable.capacity),
        sort_order: Number(newTable.sort_order),
      });
      setNewTable({ area_id: '', table_name: '', capacity: 2, sort_order: 0, reason: '' });
      await loadBase();
      notifySuccess('Table created.');
    } catch (err) { notifyError(err, 'Could not create table.'); }
    finally { setSaving(false); }
  };

  const editTable = async (table) => {
    const tableName = window.prompt('Table name/code', table.table_name);
    if (tableName == null || !tableName.trim()) return;
    const capacity = window.prompt('Seating capacity', table.capacity);
    if (capacity == null || !Number.isInteger(Number(capacity)) || Number(capacity) < 1) return;
    const sortOrder = window.prompt('Display order (lower numbers appear first)', table.sort_order ?? 0);
    if (sortOrder == null || !Number.isInteger(Number(sortOrder)) || Number(sortOrder) < 0) return;
    const reason = window.prompt('Reason for this floor setting change');
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      await api.put(`/floor/tables/${table.id}`, {
        area_id: table.area_id, table_name: tableName.trim(), capacity: Number(capacity),
        sort_order: Number(sortOrder), display_x: table.display_x, display_y: table.display_y,
        description: table.description || '', is_active: Number(table.is_active),
        reason,
      });
      await loadBase();
      notifySuccess('Table updated.');
    } catch (err) { notifyError(err, 'Could not update table.'); }
    finally { setSaving(false); }
  };

  const setTableActive = async (table) => {
    const nextActive = !Number(table.is_active);
    const reason = window.prompt(`Reason to ${nextActive ? 'activate' : 'deactivate'} ${table.table_name}`);
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      await api.put(`/floor/tables/${table.id}`, {
        area_id: table.area_id, table_name: table.table_name, capacity: table.capacity,
        sort_order: table.sort_order ?? 0, display_x: table.display_x, display_y: table.display_y,
        description: table.description || '', is_active: nextActive, reason,
      });
      await loadBase();
      notifySuccess(`Table ${nextActive ? 'activated' : 'deactivated'}.`);
    } catch (err) { notifyError(err, 'Could not change table status.'); }
    finally { setSaving(false); }
  };

  const startNewUser = () => {
    setEditingUserId(null);
    setUserForm({ full_name: '', username: '', email: '', phone: '', role_id: '', password: '', is_active: 1 });
  };
  const startEditUser = (entry) => {
    setEditingUserId(entry.id);
    setUserForm({
      full_name: entry.full_name, username: entry.username, email: entry.email || '',
      phone: entry.phone || '', role_id: String(entry.role_id), is_active: Number(entry.is_active),
      password: '',
    });
  };
  const saveUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...userForm, role_id: Number(userForm.role_id), is_active: Number(userForm.is_active),
      };
      if (editingUserId) {
        delete payload.username;
        if (!payload.password) delete payload.password;
        payload.new_password = payload.password;
        delete payload.password;
        await api.put(`/settings/users/${editingUserId}`, payload);
      } else {
        payload.password = userForm.password;
        await api.post('/settings/users', payload);
      }
      setUserForm(null);
      await loadUsers();
      notifySuccess(editingUserId ? 'User updated.' : 'User created.');
    } catch (err) { notifyError(err, 'Could not save user.'); }
    finally { setSaving(false); }
  };

  if (!canManage) return <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">You do not have permission to access Settings.</p>;
  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Loading settings…</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-bms-primary p-3 text-white"><SlidersHorizontal size={22} /></div>
        <div><h1 className="text-xl font-bold text-slate-800">Settings</h1><p className="text-sm text-slate-500">Configure Umucyo Bar operations and business information.</p></div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Settings categories" className="h-fit space-y-1 rounded-xl border border-slate-200 bg-white p-2">
          {visibleSections.map(({ id, label, icon: Icon, description }) => (
            <button key={id} onClick={() => { setActiveSection(id); setError(''); setSuccess(''); }}
              aria-current={activeSection === id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-lg p-3 text-left ${activeSection === id ? 'bg-bms-dark text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              <Icon size={18} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className={`mt-0.5 block text-xs ${activeSection === id ? 'text-white/70' : 'text-slate-500'}`}>{description}</span></span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {activeSection === 'business' && (
            <form onSubmit={saveBusiness} className="space-y-5">
              <SectionTitle title="Business Information" description="These details are used on future receipts. Existing sales remain unchanged." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name"><input required maxLength={150} className={textInput} value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} /></Field>
                <Field label="Currency code"><input required maxLength={3} className={textInput} value={business.currency || ''} onChange={(e) => setBusiness({ ...business, currency: e.target.value.toUpperCase() })} /></Field>
                <Field label="Telephone"><input maxLength={20} className={textInput} value={business.phone || ''} onChange={(e) => setBusiness({ ...business, phone: e.target.value })} /></Field>
                <Field label="Email"><input type="email" maxLength={120} className={textInput} value={business.email || ''} onChange={(e) => setBusiness({ ...business, email: e.target.value })} /></Field>
                <Field label="TIN"><input maxLength={50} className={textInput} value={business.tin || ''} onChange={(e) => setBusiness({ ...business, tin: e.target.value })} /></Field>
                <Field label="Time zone"><input required maxLength={60} className={textInput} value={business.timezone} onChange={(e) => setBusiness({ ...business, timezone: e.target.value })} placeholder="Africa/Kigali" /></Field>
                <Field label="Logo URL"><input type="url" className={textInput} value={business.logo_url || ''} onChange={(e) => setBusiness({ ...business, logo_url: e.target.value })} placeholder="https://" /></Field>
                <Field label="Receipt footer"><input maxLength={255} className={textInput} value={business.receipt_footer || ''} onChange={(e) => setBusiness({ ...business, receipt_footer: e.target.value })} /></Field>
                <Field label="Address"><textarea rows={3} className={textInput} value={business.address || ''} onChange={(e) => setBusiness({ ...business, address: e.target.value })} /></Field>
                <Field label="Reason for change *"><textarea required rows={3} className={textInput} value={businessReason} onChange={(e) => setBusinessReason(e.target.value)} /></Field>
              </div>
              {!isAdmin && <p className="text-sm text-amber-700">Only administrators can change business information.</p>}
              <button disabled={saving || !isAdmin} className={button}><Save size={16} />Save business information</button>
            </form>
          )}

          {activeSection === 'units' && (
            <div className="space-y-5">
              <SectionTitle title="Product Units & Conversions" description="Each product has its own conversion factor and unit prices. Changes apply to future transactions only." />
              {!isAdmin ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Only administrators can change product conversions.</p> : (
                <div className="grid gap-4 xl:grid-cols-[minmax(230px,0.75fr)_minmax(0,1.5fr)]">
                  <div className="space-y-3">
                    <input className={textInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products, SKU or barcode" />
                    <div className="max-h-[520px] divide-y overflow-y-auto rounded-lg border border-slate-200">
                      {filteredProducts.map((product) => (
                        <button key={product.id} onClick={() => selectProduct(product)}
                          className={`w-full p-3 text-left hover:bg-slate-50 ${selectedProductId === String(product.id) ? 'bg-teal-50' : ''}`}>
                          <span className="block text-sm font-semibold text-slate-800">{product.name}</span>
                          <span className="text-xs text-slate-500">{product.sku || product.barcode || 'No SKU'} · {product.category_name || 'Uncategorized'}</span>
                        </button>
                      ))}
                      {!filteredProducts.length && <p className="p-4 text-sm text-slate-500">No products found.</p>}
                    </div>
                  </div>
                  {selectedProduct ? (
                    <form onSubmit={saveProductUnits} className="space-y-4">
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">
                        <p className="font-semibold text-slate-800">{selectedProduct.name}</p>
                        <p className="text-slate-500">{selectedProduct.sku || selectedProduct.barcode || 'No SKU'} · Base stock unit: {selectedProduct.base_unit_name || units.find((item) => item.id === selectedProduct.base_unit_id)?.name}</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Unit</th><th className="p-2">Base units per</th><th className="p-2">Purchase cost</th><th className="p-2">Selling price</th><th className="p-2">Purchase</th><th className="p-2">Sale</th><th className="p-2">Active</th></tr></thead>
                          <tbody className="divide-y">
                            {unitRows.map((row, index) => {
                              const isBase = row.unit_id === Number(selectedProduct.base_unit_id);
                              return <tr key={`${row.unit_id}-${index}`}>
                                <td className="p-2 font-medium">{row.unit?.name || units.find((unit) => unit.id === row.unit_id)?.name || 'Unit'}</td>
                                <td className="p-2"><input aria-label="Conversion factor" type="number" min={isBase ? '1' : '0.0001'} step={isBase ? '1' : 'any'} disabled={isBase} value={isBase ? '1' : row.conversion_factor} onChange={(e) => updateUnitRow(index, 'conversion_factor', e.target.value)} className="w-24 rounded border p-1.5 disabled:bg-slate-100" /></td>
                                <td className="p-2"><input aria-label="Purchase cost" type="number" min="0" step="0.01" value={row.purchase_price} onChange={(e) => updateUnitRow(index, 'purchase_price', e.target.value)} className="w-28 rounded border p-1.5" /></td>
                                <td className="p-2"><input aria-label="Selling price" type="number" min="0" step="0.01" value={row.selling_price} onChange={(e) => updateUnitRow(index, 'selling_price', e.target.value)} className="w-28 rounded border p-1.5" /></td>
                                <td className="p-2"><input aria-label="Purchase enabled" type="checkbox" checked={row.is_purchase_enabled} onChange={(e) => updateUnitRow(index, 'is_purchase_enabled', e.target.checked)} /></td>
                                <td className="p-2"><input aria-label="Sale enabled" type="checkbox" checked={row.is_sale_enabled} onChange={(e) => updateUnitRow(index, 'is_sale_enabled', e.target.checked)} /></td>
                                <td className="p-2"><input aria-label="Unit active" type="checkbox" disabled={isBase} checked={row.is_active} onChange={(e) => updateUnitRow(index, 'is_active', e.target.checked)} /></td>
                              </tr>;
                            })}
                          </tbody>
                        </table>
                      </div>
                      <Field label="Add available unit">
                        <select className={textInput} value="" onChange={(e) => addUnitRow(e.target.value)}>
                          <option value="">Select unit to add</option>
                          {units.filter((unit) => !unitRows.some((row) => row.unit_id === unit.id)).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Reason for changing product units *"><textarea required rows={2} className={textInput} value={unitReason} onChange={(e) => setUnitReason(e.target.value)} /></Field>
                      <button disabled={saving} className={button}><Save size={16} />Save product units</button>
                    </form>
                  ) : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">Select a product to configure its units and prices.</p>}
                </div>
              )}
            </div>
          )}

          {activeSection === 'floor' && (
            <div className="space-y-6">
              <SectionTitle title="Floor & Seating" description="Manage floor areas and tables. Historical table sessions, orders and payments are retained." />
              {canManage && <>
                <form onSubmit={createArea} className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4">
                  <input required maxLength={100} className={textInput} placeholder="New area name" value={newArea.name} onChange={(e) => setNewArea({ ...newArea, name: e.target.value })} />
                  <input type="number" min="0" className={textInput} placeholder="Display order" value={newArea.sort_order} onChange={(e) => setNewArea({ ...newArea, sort_order: e.target.value })} />
                  <input required className={textInput} placeholder="Reason" value={newArea.reason} onChange={(e) => setNewArea({ ...newArea, reason: e.target.value })} />
                  <button disabled={saving} className={button}><Plus size={15} />Add area</button>
                </form>
                <div className="space-y-2">
                  {floor.areas.map((area) => <div key={area.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div><p className="font-semibold text-slate-800">{area.name}</p><p className="text-xs text-slate-500">Display order {area.sort_order ?? 0} · {Number(area.is_active) ? 'Active' : 'Inactive'}</p></div>
                    <button disabled={saving} onClick={() => editArea(area)} className={secondaryButton}><Pencil size={14} />Edit</button>
                  </div>)}
                </div>
                <form onSubmit={createTable} className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-6">
                  <select required className={textInput} value={newTable.area_id} onChange={(e) => setNewTable({ ...newTable, area_id: e.target.value })}>
                    <option value="">Choose area</option>{floor.areas.filter((area) => Number(area.is_active)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                  <input required maxLength={50} className={textInput} placeholder="Table code" value={newTable.table_name} onChange={(e) => setNewTable({ ...newTable, table_name: e.target.value })} />
                  <input required type="number" min="1" className={textInput} placeholder="Capacity" value={newTable.capacity} onChange={(e) => setNewTable({ ...newTable, capacity: e.target.value })} />
                  <input type="number" min="0" className={textInput} placeholder="Display order" value={newTable.sort_order} onChange={(e) => setNewTable({ ...newTable, sort_order: e.target.value })} />
                  <input required className={textInput} placeholder="Reason" value={newTable.reason} onChange={(e) => setNewTable({ ...newTable, reason: e.target.value })} />
                  <button disabled={saving || !floor.areas.some((area) => Number(area.is_active))} className={button}><Plus size={15} />Add table</button>
                </form>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Table</th><th className="p-3">Area</th><th className="p-3">Capacity</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
                    <tbody className="divide-y">{floor.tables.map((table) => <tr key={table.id}>
                      <td className="p-3 font-medium">{table.table_name}</td><td className="p-3">{table.area_name}</td><td className="p-3">{table.capacity}</td>
                      <td className="p-3 capitalize">{table.status?.replaceAll('_', ' ')}</td>
                      <td className="p-3"><div className="flex gap-2"><button disabled={saving} onClick={() => editTable(table)} className={secondaryButton}><Pencil size={14} />Edit</button>
                        <button disabled={saving || Boolean(table.session)} onClick={() => setTableActive(table)} className={secondaryButton}>{Number(table.is_active) ? 'Deactivate' : <><RotateCcw size={14} />Activate</>}</button></div></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </>}
            </div>
          )}

          {activeSection === 'receipt' && (
            <form onSubmit={saveConfiguration} className="space-y-5">
              <SectionTitle title="Receipt & POS Configuration" description="Control receipt presentation. Sale totals and payment values remain calculated by the backend." />
              {isAdmin ? <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Receipt paper format"><select className={textInput} value={configuration.receipt.paper_format} onChange={(e) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, paper_format: e.target.value } })}><option value="80mm">80 mm thermal</option><option value="A4">A4</option></select></Field>
                  <Field label="Receipt footer"><input maxLength={255} className={textInput} value={configuration.receipt.footer} onChange={(e) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, footer: e.target.value } })} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Show cashier identity" checked={configuration.receipt.show_cashier} onChange={(value) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, show_cashier: value } })} />
                  <Toggle label="Show table number" checked={configuration.receipt.show_table_number} onChange={(value) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, show_table_number: value } })} />
                  <Toggle label="Show payment breakdown" checked={configuration.receipt.show_payment_breakdown} onChange={(value) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, show_payment_breakdown: value } })} />
                  <Toggle label="Show open-table balance" checked={configuration.receipt.show_open_table_balance} onChange={(value) => setConfiguration({ ...configuration, receipt: { ...configuration.receipt, show_open_table_balance: value } })} />
                </div>
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="font-bold">{business.name || 'Umucyo Bar'}</p><p className="text-xs text-slate-500">{business.phone} {business.email}</p>
                  <p className="my-2 text-xs uppercase tracking-widest">Sales Invoice · {configuration.receipt.paper_format}</p>
                  <p className="text-sm">{configuration.receipt.footer || business.receipt_footer || 'Thank you for your purchase!'}</p>
                </div>
                <Field label="Reason for change *"><textarea required rows={2} className={textInput} value={configurationReason} onChange={(e) => setConfigurationReason(e.target.value)} /></Field>
                <button disabled={saving} className={button}><Save size={16} />Save receipt settings</button>
              </> : <p className="text-sm text-amber-700">Only administrators can change receipt settings.</p>}
            </form>
          )}

          {activeSection === 'inventory' && (
            <form onSubmit={saveConfiguration} className="space-y-5">
              <SectionTitle title="Inventory Configuration" description="Set defaults for new products. Product-specific stock thresholds remain configured on each product." />
              {isAdmin ? <>
                <Field label="Default low-stock threshold (base units)"><input type="number" min="0" step="0.001" className={textInput} value={configuration.inventory.default_low_stock_threshold} onChange={(e) => setConfiguration({ ...configuration, inventory: { ...configuration.inventory, default_low_stock_threshold: e.target.value } })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Require manager approval for stock adjustments" checked={configuration.inventory.require_adjustment_approval} onChange={(value) => setConfiguration({ ...configuration, inventory: { ...configuration.inventory, require_adjustment_approval: value } })} help="Does not disable negative-stock protection." />
                  <Toggle label="Track expiry by default on new products" checked={configuration.inventory.track_expiry_by_default} onChange={(value) => setConfiguration({ ...configuration, inventory: { ...configuration.inventory, track_expiry_by_default: value } })} />
                  <Toggle label="Require batches by default on new products" checked={configuration.inventory.require_batch_by_default} onChange={(value) => setConfiguration({ ...configuration, inventory: { ...configuration.inventory, require_batch_by_default: value } })} />
                </div>
                <Field label="Reason for change *"><textarea required rows={2} className={textInput} value={configurationReason} onChange={(e) => setConfigurationReason(e.target.value)} /></Field>
                <button disabled={saving} className={button}><Save size={16} />Save inventory settings</button>
              </> : <p className="text-sm text-amber-700">Only administrators can change default inventory settings.</p>}
            </form>
          )}

          {activeSection === 'users' && isAdmin && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle title="Users & Permissions" description="Manage staff accounts and supported roles. Passwords are stored as salted hashes." /><button onClick={startNewUser} className={button}><Plus size={15} />Add user</button></div>
              {userForm && <form onSubmit={saveUser} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                <Field label="Full name"><input required maxLength={120} className={textInput} value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} /></Field>
                {!editingUserId && <Field label="Username"><input required minLength={3} maxLength={60} className={textInput} value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></Field>}
                <Field label="Email"><input type="email" className={textInput} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></Field>
                <Field label="Phone"><input className={textInput} value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} /></Field>
                <Field label="Role"><select required className={textInput} value={userForm.role_id} onChange={(e) => setUserForm({ ...userForm, role_id: e.target.value })}><option value="">Select role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
                <Field label={editingUserId ? 'Reset password (optional, min 12 characters)' : 'Password (min 12 characters)'}><input required={!editingUserId} minLength={12} type="password" className={textInput} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></Field>
                {editingUserId && <Field label="Account status"><select className={textInput} value={userForm.is_active} onChange={(e) => setUserForm({ ...userForm, is_active: Number(e.target.value) })}><option value={1}>Active</option><option value={0}>Inactive</option></select></Field>}
                <div className="flex items-end gap-2"><button disabled={saving} className={button}><Save size={15} />Save user</button><button type="button" onClick={() => setUserForm(null)} className={secondaryButton}>Cancel</button></div>
              </form>}
              <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Username</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Last login</th><th className="p-3">Action</th></tr></thead>
                <tbody className="divide-y">{users.map((entry) => <tr key={entry.id}><td className="p-3">{entry.full_name}</td><td className="p-3">{entry.username}</td><td className="p-3 capitalize">{entry.role?.replaceAll('_', ' ')}</td><td className="p-3">{Number(entry.is_active) ? 'Active' : 'Inactive'}</td><td className="p-3">{entry.last_login ? new Date(entry.last_login).toLocaleString() : '—'}</td><td className="p-3"><button onClick={() => startEditUser(entry)} className={secondaryButton}><Pencil size={14} />Edit</button></td></tr>)}</tbody>
              </table></div>
            </div>
          )}

          {activeSection === 'security' && isAdmin && (
            <div className="space-y-6">
              <SectionTitle title="Security & Audit" description="Review append-only audit events and product conversion history." />
              <div><h3 className="mb-2 font-semibold text-slate-800">Product conversion history</h3>
                <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Product</th><th className="p-3">Unit ID</th><th className="p-3">Changed by</th><th className="p-3">Reason</th></tr></thead>
                  <tbody className="divide-y">{unitHistory.map((entry) => <tr key={entry.id}><td className="p-3">{new Date(entry.created_at).toLocaleString()}</td><td className="p-3">{products.find((item) => item.id === entry.product_id)?.name || `#${entry.product_id}`}</td><td className="p-3">{entry.unit_id}</td><td className="p-3">{entry.actor}</td><td className="p-3">{entry.reason}</td></tr>)}
                    {!unitHistory.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No conversion changes recorded.</td></tr>}</tbody>
                </table></div>
              </div>
              <div><h3 className="mb-2 font-semibold text-slate-800">Recent sensitive activity</h3>
                <div className="max-h-80 space-y-2 overflow-y-auto">{auditLogs.slice(0, 100).map((entry) => <div key={entry.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2"><strong>{entry.action.replaceAll('_', ' ')}</strong><span className="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()}</span></div>
                  <p className="mt-1 text-xs text-slate-500">{entry.actor?.full_name || entry.actor?.username || 'System'} · {entry.entity_type || 'record'} {entry.entity_id ? `#${entry.entity_id}` : ''} {entry.new_values?.reason ? `· ${entry.new_values.reason}` : ''}</p>
                </div>)}
                  {!auditLogs.length && <p className="rounded-lg border p-4 text-sm text-slate-500">No audit activity found.</p>}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
