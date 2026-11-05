import { useEffect, useState } from 'react';
import api from '../services/api';
import { Printer, Search, X } from 'lucide-react';

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatRWF(n) {
  return new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(n || 0);
}

export default function Reports() {
  const [reportDate, setReportDate] = useState(getLocalDate);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productDetails, setProductDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [products, setProducts] = useState([]);
  const [productFrom, setProductFrom] = useState(getLocalMonthStart);
  const [productTo, setProductTo] = useState(getLocalDate);
  const [productFilter, setProductFilter] = useState('');
  const [productReport, setProductReport] = useState(null);
  const [productReportLoading, setProductReportLoading] = useState(false);
  const [productReportError, setProductReportError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get('/reports/daily', { params: { date: reportDate } })
      .then((response) => {
        if (active) setReport(response.data.data);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'Failed to load daily report.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reportDate]);

  useEffect(() => {
    api.get('/products')
      .then((response) => setProducts(response.data.data || []))
      .catch((err) => setProductReportError(err.response?.data?.message || 'Failed to load products for filtering.'));
  }, []);

  const generateProductReport = async (event) => {
    event.preventDefault();
    if (productFrom > productTo) {
      setProductReportError('Start date must be on or before end date.');
      return;
    }

    setProductReportLoading(true);
    setProductReportError('');
    try {
      const response = await api.get('/reports/product-performance', {
        params: {
          from: productFrom,
          to: productTo,
          ...(productFilter ? { product_id: productFilter } : {}),
        },
      });
      setProductReport(response.data.data);
    } catch (err) {
      setProductReportError(err.response?.data?.message || 'Failed to generate product report.');
      setProductReport(null);
    } finally {
      setProductReportLoading(false);
    }
  };

  const showProductDetails = async (product) => {
    setSelectedProduct(product);
    setProductDetails(null);
    setDetailsError('');
    setDetailsLoading(true);
    try {
      const response = await api.get(`/reports/daily/products/${product.product_id}`, {
        params: { date: reportDate },
      });
      setProductDetails(response.data.data);
    } catch (err) {
      setDetailsError(err.response?.data?.message || 'Failed to load product details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeProductDetails = () => {
    setSelectedProduct(null);
    setProductDetails(null);
    setDetailsError('');
  };

  const maxQuantitySold = report?.products.reduce(
    (max, product) => Math.max(max, Number(product.quantity_sold)),
    0
  ) || 0;

  return (
    <div id="report-content" className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Daily Business Report</h1>
          <p className="text-sm text-slate-500">Sales, products sold, and profit for the selected day</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="print:hidden text-sm text-slate-600">
            Report date
            <input
              type="date"
              value={reportDate}
              onChange={(e) => {
                closeProductDetails();
                setReportDate(e.target.value);
              }}
              className="ml-2 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
            />
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="print:hidden inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-800">Product Performance Report</h2>
          <p className="text-sm text-slate-500">Filter by date range and optionally select one product.</p>
        </div>
        <form onSubmit={generateProductReport} className="flex flex-wrap items-end gap-3 print:hidden">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            From
            <input type="date" required value={productFrom} onChange={(e) => setProductFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-teal-500" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            To
            <input type="date" required value={productTo} onChange={(e) => setProductTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-teal-500" />
          </label>
          <label className="flex min-w-48 flex-col gap-1 text-sm text-slate-600">
            Product
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={productReportLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
            <Search size={16} /> {productReportLoading ? 'Generating...' : 'Generate Report'}
          </button>
          <button type="button" onClick={() => window.print()}
            className="print:hidden inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Printer size={16} /> Print
          </button>
        </form>
        {productReportError && <p role="alert" className="mt-3 text-sm text-rose-600">{productReportError}</p>}
        {productReport && (
          <div className="mt-4">
            <p className="mb-3 text-sm text-slate-500">
              {productReport.period.from} to {productReport.period.to} · {productReport.products.length} product(s)
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Transactions</th>
                    <th className="px-4 py-3 font-medium">Quantity Sold</th>
                    <th className="px-4 py-3 font-medium">Revenue</th>
                    <th className="px-4 py-3 font-medium">Cost of Goods</th>
                    <th className="px-4 py-3 font-medium">Gross Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productReport.products.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No products found</td></tr>
                  ) : productReport.products.map((product) => (
                    <tr key={product.product_id}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {product.product_name}
                        {product.sku && <span className="ml-2 text-xs text-slate-400">{product.sku}</span>}
                      </td>
                      <td className="px-4 py-3">{product.sales_count}</td>
                      <td className="px-4 py-3">{Number(product.quantity_sold).toFixed(3)} {product.unit}</td>
                      <td className="px-4 py-3">{formatRWF(product.revenue)}</td>
                      <td className="px-4 py-3">{formatRWF(product.cost_of_goods)}</td>
                      <td className="px-4 py-3 font-semibold">{formatRWF(product.gross_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {loading && <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-4 border-teal-600 border-t-transparent" /></div>}

      {!loading && report && (
        <>
          <p className="text-sm font-medium text-slate-700">Report for {report.date}</p>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {[
            { label: 'Transactions', value: report.totals.transactions, color: 'text-slate-800', formatted: false },
            { label: 'Revenue', value: report.totals.revenue, color: 'text-teal-700', formatted: true },
            { label: 'Cost of Goods', value: report.profit.cost_of_goods, color: 'text-slate-700', formatted: true },
            { label: 'Gross Profit', value: report.profit.gross_profit, color: 'text-blue-700', formatted: true },
            { label: 'Expenses', value: report.profit.expenses, color: 'text-rose-600', formatted: true },
            { label: 'Net Profit', value: report.profit.net_profit, color: report.profit.net_profit >= 0 ? 'text-teal-700' : 'text-rose-600', formatted: true },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className={`text-xl font-bold mt-1 ${item.color}`}>{item.formatted ? formatRWF(item.value) : item.value}</p>
            </div>
          ))}
          </div>

          <section className="rounded-lg border-2 border-blue-200 bg-white p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 px-1 pb-3">
              <div>
                <h2 className="font-bold text-blue-900">5.3 Daily Sales Report</h2>
                <p className="mt-1 text-xs text-slate-500">Sales transactions for {report.date}</p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="print:hidden inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Printer size={14} /> PDF / Print
              </button>
            </div>
            <div className="overflow-x-auto rounded border border-blue-100">
              <table className="w-full text-sm">
                <thead className="bg-blue-50 text-slate-700 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Receipt</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Cashier</th>
                    <th className="px-4 py-3 font-medium">Payment</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-50">
                  {report.transactions.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No sales on this day</td></tr>
                  ) : report.transactions.map((transaction, index) => (
                    <tr key={transaction.id} className="hover:bg-blue-50/50">
                      <td className="px-4 py-3">{index + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3">{new Date(transaction.sale_date).toLocaleTimeString()}</td>
                      <td className="px-4 py-3">{transaction.receipt_number}</td>
                      <td className="px-4 py-3">{transaction.customer_name}</td>
                      <td className="px-4 py-3">{transaction.cashier_name || '—'}</td>
                      <td className="px-4 py-3 capitalize">{transaction.payment_method.split('_').join(' ')}</td>
                      <td className="px-4 py-3 font-semibold">{formatRWF(transaction.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border-2 border-blue-200 bg-white p-3 sm:p-4">
            <div className="px-1 pb-3">
              <h2 className="font-bold text-blue-900">5.4 Product Performance Report</h2>
              <p className="mt-1 text-xs text-slate-500">Quantity sold per product · select a product for details</p>
            </div>
            <div className="rounded border border-blue-100 p-4">
              <h3 className="text-sm font-semibold text-blue-900">Daily Product Sales</h3>
              {report.products.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">No products sold on this day</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <div
                    className="flex h-56 items-end gap-3 border-b border-l border-slate-200 px-3 pt-4"
                    style={{
                      minWidth: `${Math.max(report.products.length * 76, 360)}px`,
                      backgroundImage: 'repeating-linear-gradient(to top, transparent 0, transparent 24%, var(--bms-border) 24.5%, transparent 25%)',
                    }}
                  >
                    {report.products.map((product, index) => {
                      const quantitySold = Number(product.quantity_sold);
                      const barHeight = maxQuantitySold > 0 ? Math.max((quantitySold / maxQuantitySold) * 100, 2) : 0;
                      return (
                        <button
                          key={product.product_id}
                          type="button"
                          title={`${product.product_name}: ${quantitySold.toFixed(3)} ${product.unit}`}
                          onClick={() => showProductDetails(product)}
                          className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                        >
                          <span className="text-[11px] font-medium text-slate-600">{quantitySold.toFixed(1)}</span>
                          <span
                            className={`w-full max-w-12 rounded-t-sm transition-opacity group-hover:opacity-75 ${index % 2 === 0 ? 'bg-bms-muted-gold' : 'bg-bms-primary'}`}
                            style={{ height: `${barHeight}%` }}
                          />
                          <span className="w-full truncate text-center text-[10px] text-slate-600 group-hover:text-blue-700">
                            {product.product_name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 overflow-x-auto rounded border border-blue-100">
              <table className="w-full text-sm">
                <thead className="bg-blue-50 text-slate-700 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Quantity Sold</th>
                    <th className="px-4 py-3 font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-50">
                  {report.products.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No product sales to display</td></tr>
                  ) : report.products.map((product, index) => (
                    <tr key={product.product_id} className="hover:bg-blue-50/50">
                      <td className="px-4 py-3">{index + 1}</td>
                      <td className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => showProductDetails(product)}
                          className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900"
                        >
                          {product.product_name}
                        </button>
                      </td>
                      <td className="px-4 py-3">{Number(product.quantity_sold).toFixed(3)} {product.unit}</td>
                      <td className="px-4 py-3 font-semibold text-teal-700">{formatRWF(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {selectedProduct && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 print:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeProductDetails();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-details-title"
            className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-xl max-h-[90vh] overflow-y-auto space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="product-details-title" className="text-lg font-bold text-slate-800">
                  {productDetails?.product.name || selectedProduct.product_name}
                </h2>
                <p className="text-sm text-slate-500">Sales details for {reportDate}</p>
              </div>
              <button type="button" onClick={closeProductDetails} aria-label="Close product details" className="p-1 text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            {detailsError && <p role="alert" className="text-sm text-rose-600">{detailsError}</p>}
            {detailsLoading && <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-4 border-teal-600 border-t-transparent" /></div>}

            {productDetails && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    ['SKU', productDetails.product.sku || '—'],
                    ['Barcode', productDetails.product.barcode || '—'],
                    ['Category', productDetails.product.category_name || '—'],
                    ['Status', Number(productDetails.product.is_active) ? 'Active' : 'Inactive'],
                    ['Cost Price', formatRWF(productDetails.product.cost_price)],
                    ['Selling Price', formatRWF(productDetails.product.selling_price)],
                    ['Current Stock', `${Number(productDetails.product.current_stock || 0).toFixed(3)} ${productDetails.product.base_unit_abbr || ''}`],
                    ['Minimum Stock', `${Number(productDetails.product.min_stock_level || 0).toFixed(3)} ${productDetails.product.base_unit_abbr || ''}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-sm font-medium text-slate-800 mt-1">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-5 text-sm">
                  <p><span className="text-slate-500">Quantity sold:</span> <strong>{Number(productDetails.summary.quantity_sold).toFixed(3)} {productDetails.product.base_unit_abbr}</strong></p>
                  <p><span className="text-slate-500">Revenue:</span> <strong>{formatRWF(productDetails.summary.revenue)}</strong></p>
                </div>

                <div>
                  <h3 className="font-semibold text-slate-800 mb-2">Sales containing this product</h3>
                  <div className="overflow-x-auto border border-slate-100 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Time</th>
                          <th className="px-3 py-2 font-medium">Receipt</th>
                          <th className="px-3 py-2 font-medium">Customer</th>
                          <th className="px-3 py-2 font-medium">Quantity</th>
                          <th className="px-3 py-2 font-medium">Unit Price</th>
                          <th className="px-3 py-2 font-medium">Discount</th>
                          <th className="px-3 py-2 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {productDetails.sales.length === 0 ? (
                          <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No sales for this product on this day</td></tr>
                        ) : productDetails.sales.map((sale) => (
                          <tr key={sale.sale_item_id}>
                            <td className="px-3 py-2">{new Date(sale.sale_date).toLocaleTimeString()}</td>
                            <td className="px-3 py-2">{sale.receipt_number}</td>
                            <td className="px-3 py-2">{sale.customer_name}</td>
                            <td className="px-3 py-2">{Number(sale.quantity).toFixed(3)} {sale.sale_unit_abbr || sale.sale_unit_name}</td>
                            <td className="px-3 py-2">{formatRWF(sale.unit_price)}</td>
                            <td className="px-3 py-2">{formatRWF(sale.discount)}</td>
                            <td className="px-3 py-2 font-medium">{formatRWF(sale.total_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
