import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Stock from './pages/Stock';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';

const StockCounts = lazy(() => import('./pages/StockCounts'));
const Floor = lazy(() => import('./pages/Floor'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const SupplierDetails = lazy(() => import('./pages/SupplierDetails'));
const CashierShift = lazy(() => import('./pages/CashierShift'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Refunds = lazy(() => import('./pages/Refunds'));
const Settings = lazy(() => import('./pages/Settings'));

function PageLoader() {
  return <div className="p-8 text-center text-sm text-slate-500">Loading page…</div>;
}

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-bms-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      {isAuthenticated ? (
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pos" element={<POS />} />
          <Route path="products" element={<Products />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock-counts" element={<Suspense fallback={<PageLoader />}><StockCounts /></Suspense>} />
          <Route path="floor" element={<Suspense fallback={<PageLoader />}><Floor /></Suspense>} />
          <Route path="customers" element={<Customers />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="suppliers/:supplierId" element={<Suspense fallback={<PageLoader />}><SupplierDetails /></Suspense>} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="purchase-orders" element={<Suspense fallback={<PageLoader />}><PurchaseOrders /></Suspense>} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="cashier-shift" element={<Suspense fallback={<PageLoader />}><CashierShift /></Suspense>} />
          <Route path="audit-log" element={<Suspense fallback={<PageLoader />}><AuditLog /></Suspense>} />
          <Route path="refunds" element={<Suspense fallback={<PageLoader />}><Refunds /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />
          <Route path="reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <>
          <Route path="/" element={<LandingPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
