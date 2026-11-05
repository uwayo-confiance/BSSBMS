import { useEffect, useState } from 'react';
import api from '../services/api';
import { TrendingUp, Package, Users, Wallet, ShoppingCart, AlertTriangle } from 'lucide-react';

function StatCard({ title, value, subtitle, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-600 font-medium">{title}</p>
          <p className="text-2xl font-bold text-bms-primary mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/summary')
      .then((res) => setData(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-bms-primary border-t-transparent" />
      </div>
    );
  }

  if (!data) return <p className="text-slate-500">Failed to load dashboard</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Overview of your business today</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.5rem)] xl:basis-[calc(25%-0.75rem)]">
          <StatCard
            title="Sales Today"
            value={formatRWF(data.sales_today?.total)}
            subtitle={`${data.sales_today?.count || 0} transactions`}
            icon={ShoppingCart}
            color="bg-bms-primary"
          />
        </div>
        <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.5rem)] xl:basis-[calc(25%-0.75rem)]">
          <StatCard
            title="Sales This Month"
            value={formatRWF(data.sales_month?.total)}
            subtitle={`${data.sales_month?.count || 0} transactions`}
            icon={TrendingUp}
            color="bg-bms-muted-gold"
          />
        </div>
        <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.5rem)] xl:basis-[calc(25%-0.75rem)]">
          <StatCard
            title="Low Stock Items"
            value={data.low_stock_count || 0}
            subtitle="Need attention"
            icon={AlertTriangle}
            color="bg-bms-warning"
          />
        </div>
        <div className="min-w-0 flex-1 basis-full sm:basis-[calc(50%-0.5rem)] xl:basis-[calc(25%-0.75rem)]">
          <StatCard
            title="Customer Debts"
            value={formatRWF(data.total_customer_debt)}
            subtitle="Outstanding"
            icon={Users}
            color="bg-bms-danger"
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Recent Sales */}
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Recent Sales</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {(data.recent_sales || []).length === 0 ? (
              <p className="p-5 text-sm text-slate-400">No sales yet</p>
            ) : (
              data.recent_sales.map((s) => (
                <div key={s.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-700">{s.receipt_number}</p>
                    <p className="text-xs text-slate-400">{s.customer_name || 'Walk-in'} · {new Date(s.sale_date).toLocaleString()}</p>
                  </div>
                  <span className="font-semibold text-bms-primary">{formatRWF(s.total_amount)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Products */}
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Top Products (30 days)</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {(data.top_products || []).length === 0 ? (
              <p className="p-5 text-sm text-slate-400">No data yet</p>
            ) : (
              data.top_products.map((p, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">{i + 1}</span>
                    <p className="font-medium text-slate-700">{p.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-700">{formatRWF(p.revenue)}</p>
                    <p className="text-xs text-slate-400">{Number(p.qty_sold).toFixed(0)} sold</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
