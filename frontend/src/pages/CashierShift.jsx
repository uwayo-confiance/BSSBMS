import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, Plus, Wallet } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const money = (value) => new Intl.NumberFormat('en-RW', {
  style: 'currency', currency: 'RWF', maximumFractionDigits: 0,
}).format(Number(value || 0));
const movementOptions = [
  ['cash_drop', 'Cash drop'],
  ['cash_deposit', 'Cash deposit'],
  ['cash_withdrawal', 'Cash withdrawal'],
  ['cash_adjustment_in', 'Cash adjustment in'],
  ['cash_adjustment_out', 'Cash adjustment out'],
];

export default function CashierShift() {
  const { user } = useAuth();
  const canManage = ['admin', 'manager'].includes(user?.role);
  const [registers, setRegisters] = useState([]);
  const [session, setSession] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [opening, setOpening] = useState({ register_id: '', opening_balance: '0', notes: '' });
  const [closing, setClosing] = useState({ actual_cash: '', notes: '' });
  const [movement, setMovement] = useState({ movement_type: 'cash_drop', amount: '', reason: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const movementRequest = useRef(null);
  const closeRequest = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [registerResponse, sessionResponse, shiftsResponse] = await Promise.all([
        api.get('/cash/registers'),
        api.get('/cash/sessions/current'),
        canManage ? api.get('/cash/sessions', { params: { status: 'closed' } }) : Promise.resolve({ data: { data: [] } }),
      ]);
      const nextRegisters = registerResponse.data.data || [];
      setRegisters(nextRegisters);
      setSession(sessionResponse.data.data);
      setShifts(shiftsResponse.data.data || []);
      setOpening((value) => ({ ...value, register_id: value.register_id || String(nextRegisters[0]?.id || '') }));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load cashier shift data.');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { load(); }, [load]);

  const expectedCash = useMemo(() => Number(session?.expected_cash ?? session?.opening_balance ?? 0), [session]);

  const openShift = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/cash/sessions/open', {
        ...opening,
        register_id: Number(opening.register_id),
        opening_balance: Number(opening.opening_balance),
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open cashier shift.');
    } finally {
      setSaving(false);
    }
  };

  const closeShift = async (event) => {
    event.preventDefault();
    if (!session) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        actual_cash: Number(closing.actual_cash),
        notes: closing.notes,
      };
      const signature = JSON.stringify(payload);
      if (closeRequest.current?.signature !== signature) {
        closeRequest.current = { signature, key: window.crypto.randomUUID() };
      }
      await api.post(`/cash/sessions/${session.id}/close`, {
        ...payload,
        idempotency_key: closeRequest.current.key,
      });
      closeRequest.current = null;
      setClosing({ actual_cash: '', notes: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not close cashier shift.');
    } finally {
      setSaving(false);
    }
  };

  const addMovement = async (event) => {
    event.preventDefault();
    if (!session) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...movement,
        amount: Number(movement.amount),
      };
      const signature = JSON.stringify(payload);
      if (movementRequest.current?.signature !== signature) {
        movementRequest.current = { signature, key: window.crypto.randomUUID() };
      }
      await api.post(`/cash/sessions/${session.id}/movements`, {
        ...payload,
        idempotency_key: movementRequest.current.key,
      });
      movementRequest.current = null;
      setMovement({ ...movement, amount: '', reason: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record cash movement.');
    } finally {
      setSaving(false);
    }
  };

  const review = async (shiftId, decision) => {
    const notes = window.prompt(`Review notes for ${decision === 'approved' ? 'approval' : 'flag'}:`);
    if (!notes?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/cash/sessions/${shiftId}/review`, { decision, notes });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not review cashier shift.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Loading cashier shift…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-teal-100 p-3 text-teal-800"><Wallet size={22} /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cashier shift</h1>
          <p className="text-sm text-slate-500">Open, reconcile, and review cash drawer activity.</p>
        </div>
      </header>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {!session ? (
        <form onSubmit={openShift} className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800">Open a shift</h2>
          {registers.length === 0 ? <p className="text-sm text-amber-700">No active cash register is configured. Ask a manager to configure one.</p> : (
            <>
              <label className="block text-sm text-slate-600">Register
                <select required value={opening.register_id} onChange={(event) => setOpening({ ...opening, register_id: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5">
                  {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
                </select>
              </label>
              <label className="block text-sm text-slate-600">Opening float (RWF)
                <input required type="number" min="0" step="1" value={opening.opening_balance} onChange={(event) => setOpening({ ...opening, opening_balance: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" />
              </label>
              <label className="block text-sm text-slate-600">Opening notes
                <textarea value={opening.notes} onChange={(event) => setOpening({ ...opening, notes: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5" />
              </label>
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Plus size={16} />{saving ? 'Opening…' : 'Open shift'}</button>
            </>
          )}
        </form>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Cashier', user?.full_name || 'Current user'],
              ['Register', session.register_name || registers.find((item) => item.id === session.register_id)?.name || 'Register'],
              ['Opened', new Date(session.opened_at).toLocaleString()],
              ['Expected cash', money(expectedCash)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-semibold text-slate-800">{value}</p></div>)}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <form onSubmit={addMovement} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-800">Record drawer movement</h2>
              <select value={movement.movement_type} onChange={(event) => setMovement({ ...movement, movement_type: event.target.value })} className="w-full rounded-lg border border-slate-200 p-2.5">
                {movementOptions.filter(([value]) => !value.startsWith('cash_adjustment_') || canManage).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input required type="number" min="0.01" step="0.01" value={movement.amount} onChange={(event) => setMovement({ ...movement, amount: event.target.value })} placeholder="Amount in RWF" className="w-full rounded-lg border border-slate-200 p-2.5" />
              <textarea required value={movement.reason} onChange={(event) => setMovement({ ...movement, reason: event.target.value })} rows={2} placeholder="Reason" className="w-full rounded-lg border border-slate-200 p-2.5" />
              <button disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Record movement'}</button>
            </form>

            <form onSubmit={closeShift} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-800">Close and reconcile</h2>
              <p className="text-sm text-slate-600">Expected drawer cash: <strong>{money(expectedCash)}</strong></p>
              <input required type="number" min="0" step="0.01" value={closing.actual_cash} onChange={(event) => setClosing({ ...closing, actual_cash: event.target.value })} placeholder="Counted cash (RWF)" className="w-full rounded-lg border border-slate-200 p-2.5" />
              <textarea value={closing.notes} onChange={(event) => setClosing({ ...closing, notes: event.target.value })} rows={2} placeholder="Explain any cash difference" className="w-full rounded-lg border border-slate-200 p-2.5" />
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"><Clock3 size={16} />{saving ? 'Closing…' : 'Close shift'}</button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">Cash drawer movements</h2>
            {session.movements?.length ? <div className="mt-3 divide-y divide-slate-100">{session.movements.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{item.movement_type.replaceAll('_', ' ')} · {item.notes || 'No notes'}</span><strong>{money(item.amount)}</strong></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No cash movements have been recorded for this shift.</p>}
          </section>
        </div>
      )}

      {canManage && shifts.some((shift) => shift.review_status === 'pending') && (
        <section className="rounded-xl border border-amber-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Shifts requiring review</h2>
          <div className="mt-3 space-y-2">
            {shifts.filter((shift) => shift.review_status === 'pending').map((shift) => (
              <div key={shift.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3">
                <div className="text-sm"><p className="font-medium">Shift #{shift.id} · difference {money(shift.difference)}</p><p className="text-slate-600">{shift.notes || 'No cashier explanation'} · {new Date(shift.closed_at).toLocaleString()}</p></div>
                <div className="flex gap-2"><button disabled={saving} onClick={() => review(shift.id, 'approved')} className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-2 text-xs text-white"><Check size={14} />Approve</button><button disabled={saving} onClick={() => review(shift.id, 'flagged')} className="rounded border border-rose-300 px-3 py-2 text-xs text-rose-700">Flag</button></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
