import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Save } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function StockCounts() {
  const { user } = useAuth();
  const [counts, setCounts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canApprove = ['admin', 'manager'].includes(user?.role);

  const load = async (id = selectedId) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/stock-counts');
      const rows = response.data.data || [];
      setCounts(rows);
      const selected = rows.find((row) => String(row.id) === String(id)) || rows[0] || null;
      setSelectedId(selected ? String(selected.id) : '');
      setDraftItems(selected?.items || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load stock counts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(''); }, []);

  const selected = counts.find((row) => String(row.id) === selectedId);

  const createCount = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await api.post('/stock-counts', {});
      await load(response.data.data.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start a stock count.');
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (id, field, value) => {
    setDraftItems((items) => items.map((item) => String(item.id) === String(id) ? { ...item, [field]: value } : item));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/stock-counts/${selectedId}/items`, {
        items: draftItems.map((item) => ({
          id: item.id,
          physical_quantity: item.physical_quantity,
          reason: item.reason,
          notes: item.notes,
        })),
      });
      await load(selectedId);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save count progress.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/stock-counts/${selectedId}/submit`);
      await load(selectedId);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit this count.');
    } finally {
      setSaving(false);
    }
  };

  const review = async (decision) => {
    const reviewNotes = decision === 'rejected' ? window.prompt('Reason for rejection:') : '';
    if (decision === 'rejected' && !reviewNotes?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/stock-counts/${selectedId}/review`, { decision, review_notes: reviewNotes || '' });
      await load(selectedId);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not review this count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Stock Counts</h1>
          <p className="text-sm text-slate-500">Record physical counts and submit variances for approval.</p>
        </div>
        <button type="button" disabled={saving} onClick={createCount} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">
          <Plus size={16} /> Start Count
        </button>
      </header>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,2fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="px-2 py-2 text-sm font-semibold text-slate-700">Count sessions</h2>
          {loading ? <p className="p-3 text-sm text-slate-500">Loading…</p> : counts.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No count sessions yet.</p>
          ) : counts.map((count) => (
            <button key={count.id} type="button" onClick={() => { setSelectedId(String(count.id)); setDraftItems(count.items || []); }}
              className={`mb-1 w-full rounded-lg p-3 text-left ${selectedId === String(count.id) ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50'}`}>
              <span className="block text-sm font-medium text-slate-800">{count.count_number}</span>
              <span className="mt-1 block text-xs capitalize text-slate-500">{count.status.replaceAll('_', ' ')} · {count.items?.length || 0} products</span>
            </button>
          ))}
        </section>

        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
          {!selected ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center text-slate-500">
              <ClipboardList size={28} />
              <p className="mt-2 text-sm">Choose or start a count session.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-800">{selected.count_number}</h2>
                  <p className="text-xs capitalize text-slate-500">Status: {selected.status.replaceAll('_', ' ')}</p>
                </div>
                {selected.status === 'draft' && (
                  <div className="flex gap-2">
                    <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60">
                      <Save size={14} /> Save progress
                    </button>
                    <button type="button" onClick={submit} disabled={saving} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                      Submit for approval
                    </button>
                  </div>
                )}
                {selected.status === 'submitted' && canApprove && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => review('rejected')} disabled={saving} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700 disabled:opacity-60">Reject</button>
                    <button type="button" onClick={() => review('approved')} disabled={saving} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Approve & post</button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Product</th><th className="p-2">Expected</th><th className="p-2">Physical count</th><th className="p-2">Variance</th><th className="p-2">Reason</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {draftItems.map((item) => {
                      const variance = item.physical_quantity == null ? null : Number(item.physical_quantity) - Number(item.expected_quantity);
                      return (
                        <tr key={item.id}>
                          <td className="p-2 font-medium text-slate-700">{item.product_name_snapshot}</td>
                          <td className="p-2">{Number(item.expected_quantity).toLocaleString()}</td>
                          <td className="p-2">
                            {selected.status === 'draft' ? (
                              <input aria-label={`Physical count for ${item.product_name_snapshot}`} type="number" min="0" step="0.001"
                                value={item.physical_quantity ?? ''} onChange={(event) => updateLine(item.id, 'physical_quantity', event.target.value)}
                                className="w-28 rounded border border-slate-200 px-2 py-1" />
                            ) : item.physical_quantity == null ? '—' : Number(item.physical_quantity).toLocaleString()}
                          </td>
                          <td className={`p-2 font-medium ${variance < 0 ? 'text-rose-600' : variance > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                            {variance == null ? '—' : `${variance > 0 ? '+' : ''}${variance.toFixed(3)}`}
                          </td>
                          <td className="p-2">
                            {selected.status === 'draft' ? (
                              <select aria-label={`Adjustment reason for ${item.product_name_snapshot}`} value={item.reason || ''}
                                onChange={(event) => updateLine(item.id, 'reason', event.target.value)}
                                className="w-40 rounded border border-slate-200 px-2 py-1">
                                <option value="">Select if variance</option>
                                {['damaged', 'expired', 'lost', 'broken', 'wastage', 'stock_correction', 'opening_balance_correction', 'other']
                                  .map((reason) => <option key={reason} value={reason}>{reason.replaceAll('_', ' ')}</option>)}
                              </select>
                            ) : item.reason || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selected.status === 'rejected' && selected.review_notes && (
                <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">Rejected: {selected.review_notes}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
