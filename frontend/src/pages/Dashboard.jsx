import { useEffect, useState } from 'react';
import api from '../services/api';
import { AlertTriangle, Beer, ShoppingCart, TrendingUp, Users } from 'lucide-react';

const money = (value) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number(value || 0));

function Summary({ title, value, note, icon: Icon, color }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-600">{title}</p><p className="mt-1 text-2xl font-bold text-slate-800">{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div><span className={`rounded-lg p-2.5 text-white ${color}`}><Icon size={19}/></span></div></div>;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/dashboard/summary').then((res) => setData(res.data.data)).catch((err) => setError(err.response?.data?.message || 'Could not load dashboard information.')).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-bms-primary border-t-transparent"/></div>;
  if (!data) return <p role="alert" className="rounded-xl border border-rose-200 bg-white p-5 text-sm text-rose-700">{error || 'Could not load dashboard information.'}</p>;
  return <div className="space-y-6">
    <header className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-green-100 text-green-700"><Beer size={23}/></span><div><p className="text-xs font-semibold uppercase tracking-wider text-green-700">Umucyo Bar</p><h1 className="text-2xl font-bold text-slate-800">Dashboard</h1><p className="text-sm text-slate-500">Business activity at a glance</p></div></header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Summary title="Sales today" value={money(data.sales_today?.total)} note={`${data.sales_today?.count || 0} completed orders`} icon={ShoppingCart} color="bg-green-600"/>
      <Summary title="Sales this month" value={money(data.sales_month?.total)} note={`${data.sales_month?.count || 0} completed orders`} icon={TrendingUp} color="bg-sky-600"/>
      <Summary title="Low-stock products" value={data.low_stock_count || 0} note="Items that may need attention" icon={AlertTriangle} color="bg-orange-500"/>
      <Summary title="Customer balances" value={money(data.total_customer_debt)} note="Outstanding customer debt" icon={Users} color="bg-rose-600"/>
    </section>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-800">Recent sales</h2><p className="mt-1 text-xs text-slate-500">Latest completed receipts</p></div><div className="divide-y divide-slate-100">{(data.recent_sales || []).length ? data.recent_sales.map((sale)=><div key={sale.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div className="min-w-0"><p className="truncate font-medium text-slate-700">{sale.receipt_number}</p><p className="text-xs text-slate-400">{sale.customer_name || 'Walk-in'} · {new Date(sale.sale_date).toLocaleString()}</p></div><span className="shrink-0 font-semibold text-slate-800">{money(sale.total_amount)}</span></div>) : <p className="p-5 text-sm text-slate-500">No completed sales yet.</p>}</div></section>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-800">Best-selling products</h2><p className="mt-1 text-xs text-slate-500">Sales over the last 30 days</p></div><div className="divide-y divide-slate-100">{(data.top_products || []).length ? data.top_products.map((product,index)=><div key={product.name} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><div className="flex min-w-0 items-center gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{index+1}</span><span className="truncate font-medium text-slate-700">{product.name}</span></div><div className="shrink-0 text-right"><p className="font-semibold text-slate-800">{money(product.revenue)}</p><p className="text-xs text-slate-400">{Number(product.qty_sold || 0).toLocaleString()} sold</p></div></div>) : <p className="p-5 text-sm text-slate-500">No product sales to show yet.</p>}</div></section>
    </div>
  </div>;
}
