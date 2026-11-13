import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Users, ClipboardList, Table2,
  Wallet, BarChart3, LogOut, Menu, X, Beer, Settings, RotateCcw
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin','manager','cashier','stock_keeper'] },
  { to: '/pos', icon: ShoppingCart, label: 'POS / Sales', roles: ['admin','manager','cashier'] },
  { to: '/products', icon: Package, label: 'Products', roles: ['admin','manager','stock_keeper'] },
  { to: '/stock', icon: Beer, label: 'Stock', roles: ['admin','manager','stock_keeper'] },
  { to: '/stock-counts', icon: ClipboardList, label: 'Stock Counts', roles: ['admin','manager','stock_keeper'] },
  { to: '/floor', icon: Table2, label: 'Floor & Tabs', roles: ['admin','manager','cashier','waiter'] },
  { to: '/purchases', icon: Truck, label: 'Purchases', roles: ['admin','manager','stock_keeper'] },
  { to: '/purchase-orders', icon: ClipboardList, label: 'Purchase Orders', roles: ['admin','manager','stock_keeper'] },
  { to: '/suppliers', icon: Truck, label: 'Suppliers', roles: ['admin','manager'] },
  { to: '/customers', icon: Users, label: 'Customers', roles: ['admin','manager','cashier'] },
  { to: '/expenses', icon: Wallet, label: 'Expenses', roles: ['admin','manager'] },
  { to: '/cashier-shift', icon: Wallet, label: 'Cashier Shift', roles: ['admin','manager','cashier','waiter','stock_keeper'] },
  { to: '/reports', icon: BarChart3, label: 'Reports', roles: ['admin','manager'] },
  { to: '/audit-log', icon: ClipboardList, label: 'Audit History', roles: ['admin'] },
  { to: '/refunds', icon: RotateCcw, label: 'Refunds', roles: ['admin','manager'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const filteredNav = navItems.filter((item) => item.roles.includes(user?.role));
  const pageTitle = filteredNav.find((item) => item.to === location.pathname)?.label ||
    (location.pathname.startsWith('/suppliers/') ? 'Supplier details' : 'Business management');

  return (
    <div className="min-h-screen flex bg-slate-100">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-700 transform transition-transform duration-200
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-100">
          <div className="w-9 h-9 rounded-lg bg-bms-primary flex items-center justify-center font-bold text-lg text-white">U</div>
          <div>
            <h1 className="font-semibold text-sm leading-tight">Umucyo Bar</h1>
            <p className="text-xs text-slate-500">Bar Management</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav
          className="mt-2 flex-1 space-y-1 overflow-y-auto p-3 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {filteredNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive ? 'bg-green-50 text-green-700 font-semibold border-l-[3px] border-green-500' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-shrink-0 border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-semibold text-green-800">
              {user?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-slate-500 capitalize">{user?.role?.replaceAll('_', ' ')}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:ml-64">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 md:px-7 py-3 flex items-center gap-3">
          <button className="lg:hidden p-1.5 rounded-md hover:bg-slate-100" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="min-w-0 flex-1"><p className="truncate text-xs text-slate-400">Umucyo Bar / Workspace</p><h2 className="truncate font-semibold text-slate-800">{pageTitle}</h2></div>
          {['admin', 'manager'].includes(user?.role) && (
            <NavLink
              to="/settings"
              className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-bms-primary text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Settings size={17} />
              <span className="hidden sm:inline">Settings</span>
            </NavLink>
          )}
        </header>

        <main className="flex-1 p-4 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
