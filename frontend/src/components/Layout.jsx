import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Users,
  Wallet, BarChart3, LogOut, Menu, X, Beer, Settings
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin','manager','cashier','stock_keeper'] },
  { to: '/pos', icon: ShoppingCart, label: 'POS / Sales', roles: ['admin','manager','cashier'] },
  { to: '/products', icon: Package, label: 'Products', roles: ['admin','manager','stock_keeper'] },
  { to: '/stock', icon: Beer, label: 'Stock', roles: ['admin','manager','stock_keeper'] },
  { to: '/purchases', icon: Truck, label: 'Purchases', roles: ['admin','manager','stock_keeper'] },
  { to: '/customers', icon: Users, label: 'Customers', roles: ['admin','manager','cashier'] },
  { to: '/expenses', icon: Wallet, label: 'Expenses', roles: ['admin','manager'] },
  { to: '/reports', icon: BarChart3, label: 'Reports', roles: ['admin','manager'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const filteredNav = navItems.filter((item) => item.roles.includes(user?.role));

  return (
    <div className="min-h-screen flex bg-slate-100">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col overflow-hidden bg-bms-dark text-white transform transition-transform duration-200
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/20">
          <div className="w-9 h-9 rounded-lg bg-bms-primary flex items-center justify-center font-bold text-lg text-white">B</div>
          <div>
            <h1 className="font-semibold text-sm leading-tight">BSSBMS</h1>
            <p className="text-xs text-white/75">Bar Management</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="mt-2 flex-1 space-y-1 overflow-y-auto p-3">
          {filteredNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive ? 'bg-bms-primary text-white' : 'text-white/90 hover:bg-white/10 hover:text-white'}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-shrink-0 border-t border-white/20 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-bms-primary flex items-center justify-center text-sm font-semibold text-white">
              {user?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-white/75 capitalize">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/90 hover:bg-white/10 hover:text-white rounded-lg transition-colors"
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
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden p-1.5 rounded-md hover:bg-slate-100" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <h2 className="font-semibold text-slate-700 text-lg">Bar Stock & Sales System</h2>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
