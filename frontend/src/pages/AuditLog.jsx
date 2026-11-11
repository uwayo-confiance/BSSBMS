import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import api from '../services/api';

function formatLabel(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b(id|ip)\b/gi, (match) => match.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value) {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getDetailEntries(log) {
  return [
    ...(log.old_values && typeof log.old_values === 'object' && !Array.isArray(log.old_values)
      ? Object.entries(log.old_values).map(([key, value]) => [`Previous ${formatLabel(key)}`, value])
      : []),
    ...(log.new_values && typeof log.new_values === 'object' && !Array.isArray(log.new_values)
      ? Object.entries(log.new_values).map(([key, value]) => [formatLabel(key), value])
      : []),
  ];
}

export default function AuditLog() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (event) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/audit', {
        params: {
          limit: 150,
          action: filters.action || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
      });
      setLogs(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load audit history.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-slate-200 p-3 text-slate-700"><ClipboardList size={22} /></div>
        <div><h1 className="text-xl font-bold text-slate-800">Audit history</h1><p className="text-sm text-slate-500">Append-only records of sensitive financial and shift actions.</p></div>
      </header>
      <form onSubmit={load} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <label className="text-xs text-slate-600">Action contains<input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
        <label className="text-xs text-slate-600">From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
        <label className="text-xs text-slate-600">To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
        <button className="inline-flex items-center justify-center gap-2 self-end rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"><Search size={16} />Filter</button>
      </form>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Details</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading…</td></tr>
                : logs.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">No audit entries found.</td></tr>
                  : logs.map((log) => <tr key={log.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{log.actor?.full_name || log.actor?.username || 'System'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{log.action}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatLabel(log.entity_type) || '—'}{log.entity_id ? ` #${log.entity_id}` : ''}
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-slate-600">
                      {getDetailEntries(log).length ? (
                        <dl className="space-y-1">
                          {getDetailEntries(log).map(([label, value]) => (
                            <div key={label} className="flex flex-wrap gap-x-1">
                              <dt className="font-medium">{label}:</dt>
                              <dd className="break-all">{formatValue(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : '—'}
                    </td>
                  </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
