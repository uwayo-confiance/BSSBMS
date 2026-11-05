import { useEffect, useState } from 'react';
import api from '../services/api';

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/purchases').then((r) => setPurchases(r.data.data || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Purchases</h1>
        <p className="text-sm text-slate-500">Supplier purchases and stock receipts</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : purchases.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No purchases yet</td></tr>
            ) : (
              purchases.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{p.purchase_date}</td>
                  <td className="px-4 py-3 font-medium">{p.supplier_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.invoice_number || '—'}</td>
                  <td className="px-4 py-3 font-semibold">{formatRWF(p.total_amount)}</td>
                  <td className="px-4 py-3">{formatRWF(p.amount_paid)}</td>
                  <td className="px-4 py-3 text-rose-600">{formatRWF(p.balance)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      p.payment_status === 'paid' ? 'bg-teal-50 text-teal-700' :
                      p.payment_status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                    }`}>{p.payment_status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
