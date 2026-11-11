import { useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Search, Table2, Users, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const money = (value) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(value || 0));
const receiptMoney = (value, currency) => new Intl.NumberFormat('en-RW', {
  style: 'currency', currency: currency || 'RWF', maximumFractionDigits: 0,
}).format(Number(value || 0));
const statusClass = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  occupied: 'border-blue-200 bg-blue-50 text-blue-800',
  bill_pending: 'border-amber-200 bg-amber-50 text-amber-800',
  inactive: 'border-slate-200 bg-slate-100 text-slate-500',
};

function saleUnits(product) {
  return (product.product_units || []).filter((unit) => Number(unit.is_active) && Number(unit.is_sale_enabled));
}
const newPaymentKey = () => window.crypto.randomUUID();

export default function Floor() {
  const { user } = useAuth();
  const canManage = ['admin', 'manager'].includes(user?.role);
  const [floor, setFloor] = useState({ areas: [], tables: [], waiters: [] });
  const [products, setProducts] = useState([]);
  const [sessionTab, setSessionTab] = useState(null);
  const [sessionEvents, setSessionEvents] = useState([]);
  const [showEvents, setShowEvents] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedTable, setSelectedTable] = useState(null);
  const [areaFilter, setAreaFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newTable, setNewTable] = useState({ table_name: '', area_id: '', capacity: '2' });
  const [opening, setOpening] = useState(false);
  const [openForm, setOpenForm] = useState({ waiter_id: '', guest_count: '' });
  const [transferId, setTransferId] = useState('');
  const [mergeId, setMergeId] = useState('');
  const [draftCart, setDraftCart] = useState([]);
  const [draftNotes, setDraftNotes] = useState('');
  const [editingRoundId, setEditingRoundId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [paymentForm, setPaymentForm] = useState(() => ({ amount: '', payment_method: 'cash', reference: '', idempotency_key: newPaymentKey() }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receiptSettings, setReceiptSettings] = useState({
    business: { name: 'Umucyo Bar', currency: 'RWF', timezone: 'Africa/Kigali' },
    receipt: { paper_format: '80mm', show_cashier: true, show_table_number: true, show_payment_breakdown: true, show_open_table_balance: true, footer: '' },
  });

  const loadFloor = async () => {
    setError('');
    try {
      const response = await api.get('/floor');
      setFloor(response.data.data);
      if (selectedTable) {
        const freshTable = response.data.data.tables.find((table) => table.id === selectedTable.id);
        if (freshTable) setSelectedTable(freshTable);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load floor status.');
    } finally {
      setLoading(false);
    }
  };

  const loadTab = async (session) => {
    if (!session) {
      setSessionTab(null);
      return;
    }
    try {
      const response = await api.get(`/table-orders/${session.id}`);
      setSessionTab(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load table tab.');
    }
  };

  const loadEvents = async (session) => {
    try {
      const response = await api.get(`/floor/sessions/${session.id}/events`);
      setSessionEvents(response.data.data || []);
      setShowEvents(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load session assignment history.');
    }
  };

  const loadHistory = async () => {
    try {
      const response = await api.get('/floor/sessions?status=closed');
      setHistory(response.data.data || []);
      setShowHistory((visible) => !visible);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load table session history.');
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/floor'), api.get('/products?active=true')])
      .then(([floorResponse, productResponse]) => {
        if (!active) return;
        setFloor(floorResponse.data.data);
        setProducts(productResponse.data.data || []);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'Could not load floor and product data.');
      })
      .finally(() => { if (active) setLoading(false); });
      api.get('/settings/receipt')
        .then((response) => setReceiptSettings(response.data.data))
        .catch((err) => setError(err.response?.data?.message || 'Could not load receipt settings.'));
      return () => { active = false; };
  }, []);

  const visibleTables = useMemo(() => floor.tables.filter((table) =>
    (areaFilter === 'all' || String(table.area_id) === areaFilter) &&
    (statusFilter === 'all' || table.status === statusFilter) &&
    table.table_name.toLowerCase().includes(search.toLowerCase())
  ), [floor.tables, areaFilter, statusFilter, search]);

  const openTable = (table) => {
    setSelectedTable(table);
    setError('');
    setDraftCart([]);
    setEditingRoundId('');
    if (table.session) loadTab(table.session);
    else {
      setSessionTab(null);
      setOpenForm({ waiter_id: String(user?.id || ''), guest_count: '' });
      setOpening(true);
    }
  };

  const createArea = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/floor/areas', { name: newArea });
      setNewArea('');
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create area.');
    } finally {
      setSaving(false);
    }
  };

  const createTable = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/floor/tables', { ...newTable, area_id: Number(newTable.area_id), capacity: Number(newTable.capacity) });
      setNewTable({ table_name: '', area_id: '', capacity: '2' });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create table.');
    } finally {
      setSaving(false);
    }
  };

  const toggleArea = async (area) => {
    const name = window.prompt('Edit area name:', area.name);
    if (name == null || !name.trim()) return;
    setSaving(true);
    try {
      await api.put(`/floor/areas/${area.id}`, { name });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update area.');
    } finally {
      setSaving(false);
    }
  };

  const setAreaActive = async (area) => {
    const active = Number(area.is_active) === 1;
    if (active && !window.confirm(`Deactivate ${area.name} and its tables?`)) return;
    setSaving(true);
    try {
      await api.put(`/floor/areas/${area.id}`, { name: area.name, is_active: !active });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change area status.');
    } finally {
      setSaving(false);
    }
  };

  const toggleTable = async (table) => {
    const tableName = window.prompt('Edit table name:', table.table_name);
    if (tableName == null || !tableName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/floor/tables/${table.id}`, {
        area_id: table.area_id,
        table_name: tableName,
        capacity: table.capacity,
        description: table.description || '',
        is_active: Number(table.is_active),
      });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update table.');
    } finally {
      setSaving(false);
    }
  };

  const deactivateTable = async (table) => {
    if (!window.confirm(`Deactivate ${table.table_name}?`)) return;
    setSaving(true);
    try {
      await api.put(`/floor/tables/${table.id}`, {
        area_id: table.area_id,
        table_name: table.table_name,
        capacity: table.capacity,
        description: table.description || '',
        is_active: false,
      });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not deactivate table.');
    } finally {
      setSaving(false);
    }
  };

  const activateTable = async (table) => {
    setSaving(true);
    try {
      await api.put(`/floor/tables/${table.id}`, {
        area_id: table.area_id,
        table_name: table.table_name,
        capacity: table.capacity,
        description: table.description || '',
        is_active: true,
      });
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not activate table.');
    } finally {
      setSaving(false);
    }
  };

  const confirmOpen = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api.post(`/floor/tables/${selectedTable.id}/sessions`, {
        waiter_id: Number(openForm.waiter_id || user.id),
        guest_count: openForm.guest_count ? Number(openForm.guest_count) : null,
      });
      setOpening(false);
      await loadFloor();
      await loadTab(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open this table.');
    } finally {
      setSaving(false);
    }
  };

  const assignWaiter = async (event) => {
    const waiterId = Number(event.target.value);
    if (!sessionTab || !waiterId) return;
    try {
      await api.patch(`/floor/sessions/${sessionTab.id}/waiter`, { waiter_id: waiterId });
      await loadFloor();
      await loadTab(sessionTab);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update waiter.');
    }
  };

  const transferTable = async () => {
    if (!sessionTab || !transferId) return;
    setSaving(true);
    try {
      await api.post(`/floor/sessions/${sessionTab.id}/transfer`, { to_table_id: Number(transferId) });
      setTransferId('');
      await loadFloor();
      await loadTab(sessionTab);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not transfer table session.');
    } finally {
      setSaving(false);
    }
  };

  const mergeTable = async () => {
    if (!sessionTab || !mergeId) return;
    if (!window.confirm('Merge the selected table bill into this table? Order and payment history will be preserved.')) return;
    setSaving(true);
    try {
      await api.post(`/floor/sessions/${mergeId}/merge`, { destination_session_id: sessionTab.id });
      setMergeId('');
      await loadFloor();
      await loadTab(sessionTab);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not merge table sessions.');
    } finally {
      setSaving(false);
    }
  };

  const addProduct = (product) => {
    const options = saleUnits(product);
    const unit = options.find((row) => Number(row.is_default_sale)) || options[0];
    setDraftCart((current) => [...current, {
      product_id: product.id,
      name: product.name,
      unit_id: unit?.unit_id || product.sale_unit_id || product.base_unit_id,
      unit_name: unit?.unit?.name || product.base_unit_name || 'unit',
      unit_price: Number(unit?.selling_price ?? product.selling_price ?? 0),
      quantity: 1,
      discount: 0,
      sale_units: options,
    }]);
  };

  const updateCart = (index, key, value) => {
    setDraftCart((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (key === 'unit_id') {
        const unit = item.sale_units.find((row) => String(row.unit_id) === String(value));
        return {
          ...item,
          unit_id: Number(value),
          unit_name: unit?.unit?.name || 'unit',
          unit_price: Number(unit?.selling_price || 0),
        };
      }
      return { ...item, [key]: value };
    }));
  };

  const saveDraft = async () => {
    if (!draftCart.length || !sessionTab) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        notes: draftNotes,
        items: draftCart.map((item) => ({
          product_id: item.product_id,
          unit_id: item.unit_id,
          quantity: Number(item.quantity),
          discount: Number(item.discount || 0),
        })),
      };
      const response = editingRoundId
        ? await api.put(`/table-orders/rounds/${editingRoundId}`, payload)
        : await api.post(`/table-orders/${sessionTab.id}/rounds`, payload);
      setDraftCart([]);
      setDraftNotes('');
      setEditingRoundId('');
      await loadTab(sessionTab);
      await loadFloor();
      return response;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save draft order.');
    } finally {
      setSaving(false);
    }
  };

  const editDraft = (round) => {
    setEditingRoundId(round.id);
    setDraftNotes(round.notes || '');
    setDraftCart(round.items.map((item) => ({
      product_id: item.product_id,
      name: item.product_name_snapshot,
      unit_id: item.unit_id,
      unit_name: item.unit_name_snapshot,
      unit_price: Number(item.unit_price),
      quantity: Number(item.quantity),
      discount: Number(item.discount),
      sale_units: saleUnits(products.find((product) => product.id === item.product_id) || {}),
    })));
  };

  const serveRound = async (round) => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/table-orders/rounds/${round.id}/serve`, { idempotency_key: crypto.randomUUID() });
      await loadTab(sessionTab);
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not confirm the order as served.');
    } finally {
      setSaving(false);
    }
  };

  const voidRound = async (round) => {
    const reason = window.prompt('Reason for voiding this draft order:');
    if (!reason?.trim()) return;
    try {
      await api.patch(`/table-orders/rounds/${round.id}/void`, { reason });
      await loadTab(sessionTab);
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not void the draft order.');
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`/table-orders/${sessionTab.id}/payments`, {
        ...paymentForm,
        amount: Number(paymentForm.amount),
      });
      setPaymentForm({ amount: '', payment_method: 'cash', reference: '', idempotency_key: newPaymentKey() });
      await loadTab(sessionTab);
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record table payment.');
    } finally {
      setSaving(false);
    }
  };

  const confirmPayment = async (payment) => {
    if (!window.confirm('Confirm that this Mobile Money payment has been independently verified?')) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/table-orders/${sessionTab.id}/payments/${payment.id}/confirm`, {
        external_reference: payment.external_reference || payment.reference,
      });
      await loadTab(sessionTab);
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not confirm Mobile Money payment.');
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async () => {
    if (!sessionTab || !window.confirm('Close this table session?')) return;
    setSaving(true);
    try {
      await api.post(`/floor/sessions/${sessionTab.id}/close`, {});
      setSessionTab(null);
      setSelectedTable(null);
      await loadFloor();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not close the table session.');
    } finally {
      setSaving(false);
    }
  };

  const filteredProducts = products.filter((product) => product.name.toLowerCase().includes(productSearch.toLowerCase()));
  const availableTables = floor.tables.filter((table) => table.is_active && table.status === 'available' &&
    (!sessionTab || table.id !== sessionTab.dining_table_id));
  const otherSessions = floor.tables.filter((table) => table.session && table.session.id !== sessionTab?.id);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-xl font-bold text-slate-800">Floor & Open Tabs</h1><p className="text-sm text-slate-500">Manage areas, tables, service rounds and anonymous table bills.</p></div>
      </header>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {canManage && (
        <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <form onSubmit={createArea} className="flex gap-2">
            <input required value={newArea} onChange={(event) => setNewArea(event.target.value)} placeholder="New area name" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm text-white"><Plus size={15} /> Area</button>
          </form>
          <form onSubmit={createTable} className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_auto]">
            <select required value={newTable.area_id} onChange={(event) => setNewTable({ ...newTable, area_id: event.target.value })} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
              <option value="">Area</option>{floor.areas.filter((area) => Number(area.is_active)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
            <input required value={newTable.table_name} onChange={(event) => setNewTable({ ...newTable, table_name: event.target.value })} placeholder="Table name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input required type="number" min="1" value={newTable.capacity} onChange={(event) => setNewTable({ ...newTable, capacity: event.target.value })} aria-label="Table capacity" className="rounded-lg border border-slate-200 px-2 py-2 text-sm" />
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm text-white"><Plus size={15} /> Table</button>
          </form>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            {floor.areas.map((area) => <span key={area.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs">{area.name}<button type="button" aria-label={`Rename ${area.name}`} onClick={() => toggleArea(area)} className="text-teal-700">Edit</button><button type="button" onClick={() => setAreaActive(area)} className="text-slate-500">{Number(area.is_active) ? 'Deactivate' : 'Activate'}</button></span>)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex justify-end">
          <button type="button" onClick={loadHistory} className="text-sm font-medium text-teal-700 hover:underline">
            {showHistory ? 'Hide session history' : 'View session history'}
          </button>
        </div>
        {showHistory && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
            <h2 className="mb-2 font-semibold text-slate-800">Closed table sessions</h2>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="p-2">Session</th><th className="p-2">Table</th><th className="p-2">Guests</th><th className="p-2">Opened</th><th className="p-2">Closed</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{history.map((item) => <tr key={item.id}><td className="p-2">{item.session_number}</td><td className="p-2">{item.table?.table_name || '—'}</td><td className="p-2">{item.guest_count || '—'}</td><td className="p-2">{new Date(item.opened_at).toLocaleString()}</td><td className="p-2">{item.closed_at ? new Date(item.closed_at).toLocaleString() : '—'}</td></tr>)}</tbody>
              {history.length === 0 && <tbody><tr><td colSpan={5} className="p-3 text-center text-slate-500">No closed sessions.</td></tr></tbody>}
            </table>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tables" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" /></label>
          <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">All areas</option>{floor.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="available">Available</option><option value="occupied">Occupied</option><option value="bill_pending">Bill pending</option><option value="inactive">Inactive</option></select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading ? <p className="text-sm text-slate-500">Loading floor…</p> : visibleTables.map((table) => (
            <article key={table.id} className={`rounded-xl border p-4 shadow-sm ${statusClass[table.status] || statusClass.available}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openTable(table)} className="text-left">
                  <h2 className="text-lg font-bold">{table.table_name}</h2><p className="text-xs opacity-80">{table.area_name} · capacity {table.capacity}</p>
                </button>
                <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] capitalize">{table.status.replaceAll('_', ' ')}</span>
              </div>
              {table.session ? (
                <button type="button" onClick={() => openTable(table)} className="mt-3 block w-full text-left text-xs">
                  <span className="block">Waiter: {floor.waiters.find((waiter) => waiter.id === table.session.waiter_id)?.full_name || 'Unassigned'}</span>
                  <span className="mt-1 flex justify-between"><span><Users size={12} className="mr-1 inline" />{table.session.guest_count || '—'} guests</span><strong>{money(table.session.balance)} due</strong></span>
                  <span className="mt-1 block">Opened {new Date(table.session.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ) : <p className="mt-3 text-xs">Ready for guests</p>}
              {canManage && <div className="mt-3 flex gap-3 border-t border-current/10 pt-2 text-xs"><button type="button" onClick={() => toggleTable(table)} className="underline">Edit</button>{Number(table.is_active) ? <button type="button" onClick={() => deactivateTable(table)} className="underline">Deactivate</button> : <button type="button" onClick={() => activateTable(table)} className="underline">Activate</button>}</div>}
            </article>
          ))}
          {!loading && visibleTables.length === 0 && <p className="text-sm text-slate-500">No tables match these filters.</p>}
        </div>
      </section>

      {sessionTab && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold text-slate-800">Table {selectedTable?.table_name || sessionTab.table?.table_name} · {sessionTab.session_number}</h2><p className="text-xs text-slate-500">Open since {new Date(sessionTab.opened_at).toLocaleString()} · {sessionTab.guest_count || '—'} guests</p></div>
            <div className="flex items-center gap-2"><button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline"><Printer size={15} /> Print table bill</button><button type="button" onClick={() => loadEvents(sessionTab)} className="no-print text-sm font-medium text-teal-700 hover:underline">Session history</button><button type="button" onClick={() => { setSessionTab(null); setSelectedTable(null); }} aria-label="Close table details" className="no-print rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div>
          </div>
          <div id="table-receipt" data-format={receiptSettings.receipt.paper_format} className="hidden bg-white p-6">
            <div className="text-center border-b border-dashed border-slate-300 pb-4">
              {receiptSettings.business.logo_url && <img src={receiptSettings.business.logo_url} alt={`${receiptSettings.business.name} logo`} className="mx-auto mb-2 max-h-16 max-w-36 object-contain" />}
              <h2 className="text-xl font-bold text-slate-800">{receiptSettings.business.name || 'Umucyo Bar'}</h2>
              {receiptSettings.business.address && <p className="text-xs text-slate-500">{receiptSettings.business.address}</p>}
              {receiptSettings.business.phone && <p className="text-xs text-slate-500">{receiptSettings.business.phone}</p>}
              {receiptSettings.business.email && <p className="text-xs text-slate-500">{receiptSettings.business.email}</p>}
              {receiptSettings.business.tin && <p className="text-xs text-slate-500">TIN: {receiptSettings.business.tin}</p>}
              <p className="mt-2 text-xs font-semibold tracking-widest text-slate-500">TABLE BILL</p>
              {receiptSettings.receipt.show_table_number && <p className="text-sm font-semibold">Table {sessionTab.table?.table_name || selectedTable?.table_name}</p>}
              <p className="text-xs text-slate-500">{sessionTab.session_number} · {new Intl.DateTimeFormat('en-RW', {
                dateStyle: 'medium', timeStyle: 'short',
                timeZone: receiptSettings.business.timezone || 'Africa/Kigali',
              }).format(new Date(sessionTab.opened_at))}</p>
            </div>
            {receiptSettings.receipt.show_cashier && sessionTab.waiter_name && <p className="border-b border-dashed border-slate-300 py-2 text-xs">Served by: {sessionTab.waiter_name}</p>}
            <div className="border-b border-dashed border-slate-300 py-3">
              {sessionTab.rounds.filter((round) => round.status === 'served').flatMap((round) => round.items).map((item) => (
                <p key={item.id} className="flex justify-between gap-3 py-1 text-xs">
                  <span>{item.quantity} × {item.product_name_snapshot} ({item.unit_name_snapshot})</span>
                  <span>{receiptMoney(item.line_total, receiptSettings.business.currency)}</span>
                </p>
              ))}
            </div>
            <div className="space-y-1 py-3 text-sm">
              <p className="flex justify-between font-bold"><span>Total</span><span>{receiptMoney(sessionTab.total, receiptSettings.business.currency)}</span></p>
              {receiptSettings.receipt.show_payment_breakdown && <p className="flex justify-between"><span>Paid</span><span>{receiptMoney(sessionTab.paid, receiptSettings.business.currency)}</span></p>}
              {receiptSettings.receipt.show_open_table_balance && <p className="flex justify-between font-semibold"><span>Balance due</span><span>{receiptMoney(sessionTab.balance, receiptSettings.business.currency)}</span></p>}
              {receiptSettings.receipt.show_payment_breakdown && sessionTab.payments.filter((payment) => payment.status === 'confirmed').map((payment) => (
                <p key={payment.id} className="flex justify-between text-xs text-slate-600"><span>{payment.payment_method.replaceAll('_', ' ')}</span><span>{receiptMoney(payment.amount, receiptSettings.business.currency)}</span></p>
              ))}
            </div>
            <p className="border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-500">{receiptSettings.receipt.footer || receiptSettings.business.receipt_footer || 'Thank you for your visit!'}</p>
          </div>
          {showEvents && (
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex justify-between"><h3 className="text-sm font-semibold">Assignment and table events</h3><button type="button" onClick={() => setShowEvents(false)} aria-label="Hide session history" className="text-slate-500"><X size={15} /></button></div>
              {sessionEvents.length === 0 ? <p className="mt-2 text-xs text-slate-500">No reassignment or transfer history.</p> : sessionEvents.map((event) => (
                <p key={event.id} className="mt-2 text-xs text-slate-600">{new Date(event.created_at).toLocaleString()} · {event.event_type.replaceAll('_', ' ')}{event.from_waiter_name || event.to_waiter_name ? ` · ${event.from_waiter_name || 'Unassigned'} → ${event.to_waiter_name || 'Unassigned'}` : ''}{event.from_table_name || event.to_table_name ? ` · ${event.from_table_name || '—'} → ${event.to_table_name || '—'}` : ''}{event.performed_by_name ? ` · by ${event.performed_by_name}` : ''}</p>
              ))}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
                <label className="text-xs text-slate-500">Waiter<select disabled={!canManage} value={sessionTab.waiter_id || ''} onChange={assignWaiter} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-70">{floor.waiters.map((waiter) => <option key={waiter.id} value={waiter.id}>{waiter.full_name}</option>)}</select></label>
                {canManage && <>
                  <label className="text-xs text-slate-500">Transfer to<select value={transferId} onChange={(event) => setTransferId(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"><option value="">Available table</option>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.table_name} · {table.area_name}</option>)}</select></label>
                  <button type="button" disabled={!transferId || saving} onClick={transferTable} className="rounded bg-slate-700 px-3 py-2 text-xs text-white">Transfer</button>
                  <label className="text-xs text-slate-500">Merge bill from<select value={mergeId} onChange={(event) => setMergeId(event.target.value)} className="mt-1 block rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"><option value="">Another open table</option>{otherSessions.map((table) => <option key={table.session.id} value={table.session.id}>{table.table_name}</option>)}</select></label>
                  <button type="button" disabled={!mergeId || saving} onClick={mergeTable} className="rounded bg-slate-700 px-3 py-2 text-xs text-white">Merge</button>
                </>}
              </div>
              <div className="space-y-3">
                {sessionTab.rounds.map((round) => (
                  <article key={round.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">Round {round.round_number} · <span className="text-xs font-normal capitalize text-slate-500">{round.status}</span></h3>{round.status === 'draft' && <div className="flex gap-2"><button type="button" onClick={() => editDraft(round)} className="text-xs text-teal-700 underline">Edit</button><button type="button" onClick={() => serveRound(round)} disabled={saving} className="rounded bg-teal-700 px-2 py-1 text-xs text-white">Confirm served</button><button type="button" onClick={() => voidRound(round)} className="text-xs text-rose-600 underline">Void</button></div>}</div>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">{round.items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{item.quantity} × {item.product_name_snapshot} ({item.unit_name_snapshot})</span><span>{money(item.line_total)}</span></li>)}</ul>
                    {round.status !== 'void' && <p className="mt-2 text-right text-sm font-semibold">{money(round.items.reduce((sum, item) => sum + Number(item.line_total), 0))}</p>}
                  </article>
                ))}
                {sessionTab.rounds.length === 0 && <p className="text-sm text-slate-500">No order rounds yet.</p>}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <h3 className="font-semibold text-slate-800">{editingRoundId ? 'Edit draft round' : 'Add order round'}</h3>
                <label className="relative mt-2 block"><Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={14} /><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search products" className="w-full rounded border border-slate-200 py-2 pl-8 pr-2 text-sm" /></label>
                <div className="mt-2 max-h-36 overflow-y-auto divide-y divide-slate-100">
                  {filteredProducts.slice(0, 20).map((product) => <button key={product.id} type="button" onClick={() => addProduct(product)} className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-slate-50"><span>{product.name}</span><span className="text-xs text-teal-700">{money(product.selling_price)} +</span></button>)}
                </div>
                {draftCart.map((item, index) => (
                  <div key={`${item.product_id}-${index}`} className="mt-2 grid grid-cols-[1fr_70px_90px_auto] items-center gap-2 text-sm">
                    <span className="truncate">{item.name}
                      {item.sale_units.length > 1 && <select value={item.unit_id} onChange={(event) => updateCart(index, 'unit_id', event.target.value)} className="mt-1 block max-w-full rounded border border-slate-200 px-1 py-1 text-xs">{item.sale_units.map((unit) => <option key={unit.id} value={unit.unit_id}>{unit.unit?.name}</option>)}</select>}
                    </span>
                    <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateCart(index, 'quantity', event.target.value)} aria-label={`Quantity ${item.name}`} className="w-full rounded border border-slate-200 px-1 py-1" />
                    <span className="text-right text-xs">{money(item.unit_price)}</span>
                    <button type="button" onClick={() => setDraftCart((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${item.name}`} className="text-rose-600">×</button>
                  </div>
                ))}
                <textarea rows={2} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} placeholder="Order notes" className="mt-3 w-full rounded border border-slate-200 p-2 text-sm" />
                <div className="mt-2 flex gap-2"><button type="button" onClick={saveDraft} disabled={saving || !draftCart.length} className="flex-1 rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : editingRoundId ? 'Update draft' : 'Save draft round'}</button>{editingRoundId && <button type="button" onClick={() => { setEditingRoundId(''); setDraftCart([]); }} className="rounded border border-slate-200 px-3 py-2 text-sm">Cancel edit</button>}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-sm"><span>Served total</span><strong>{money(sessionTab.total)}</strong></div>
                <div className="mt-1 flex justify-between text-sm"><span>Paid</span><span>{money(sessionTab.paid)}</span></div>
                <div className="mt-1 flex justify-between text-base font-bold"><span>Balance</span><span>{money(sessionTab.balance)}</span></div>
                {sessionTab.balance > 0 && <form onSubmit={recordPayment} className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input required type="number" min="0.01" max={sessionTab.balance} step="any" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} placeholder="Amount" className="min-w-0 rounded border border-slate-200 px-2 py-2 text-sm" />
                  <select value={paymentForm.payment_method} onChange={(event) => setPaymentForm({ ...paymentForm, payment_method: event.target.value })} className="min-w-0 rounded border border-slate-200 px-2 py-2 text-sm">{['cash', 'mobile_money', 'card', 'bank', 'other'].map((method) => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select>
                  <button type="submit" disabled={saving} className="rounded bg-blue-700 px-3 py-2 text-sm text-white">Pay</button>
                  {paymentForm.payment_method === 'mobile_money' && <input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} placeholder="Mobile Money reference (pending verification)" className="col-span-full min-w-0 rounded border border-slate-200 px-2 py-2 text-sm" />}
                </form>}
                <button type="button" onClick={closeSession} disabled={saving || sessionTab.balance > 0 || sessionTab.pending_rounds > 0} className="mt-3 w-full rounded border border-slate-300 py-2 text-sm font-medium disabled:opacity-50">Close settled table</button>
              </div>
              {sessionTab.payments.length > 0 && <div className="rounded-lg border border-slate-200 p-3"><h3 className="text-sm font-semibold">Payments</h3>{sessionTab.payments.map((payment) => <div key={payment.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>{String(payment.paid_at).slice(0, 10)} · {payment.payment_method} · {payment.status}</span><span className="flex items-center gap-2">{money(payment.amount)}{canManage && payment.status === 'pending' && <button type="button" disabled={saving} onClick={() => confirmPayment(payment)} className="rounded bg-emerald-700 px-2 py-1 text-white disabled:opacity-50">Confirm</button>}</span></div>)}</div>}
            </div>
          </div>
        </section>
      )}

      {opening && selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={confirmOpen} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-slate-800">Open {selectedTable.table_name}</h2>
            <label className="block text-xs text-slate-600">Assigned waiter<select value={openForm.waiter_id} onChange={(event) => setOpenForm({ ...openForm, waiter_id: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm"><option value={user?.id}>Assign to me — {user?.full_name}</option>{floor.waiters.map((waiter) => <option key={waiter.id} value={waiter.id}>{waiter.full_name}</option>)}</select></label>
            <label className="block text-xs text-slate-600">Guests (optional)<input type="number" min="1" value={openForm.guest_count} onChange={(event) => setOpenForm({ ...openForm, guest_count: event.target.value })} className="mt-1 w-full rounded border border-slate-200 p-2 text-sm" /></label>
            <div className="flex gap-2"><button type="button" onClick={() => setOpening(false)} className="flex-1 rounded border border-slate-200 py-2 text-sm">Cancel</button><button type="submit" disabled={saving} className="flex-1 rounded bg-teal-700 py-2 text-sm font-medium text-white disabled:opacity-60">Open table</button></div>
          </form>
        </div>
      )}
      {!canManage && floor.tables.length === 0 && !loading && <p className="text-sm text-slate-500"><Table2 className="mr-1 inline" size={16} />Ask a manager to configure areas and tables.</p>}
    </div>
  );
}
