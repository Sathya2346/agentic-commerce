import React, { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileSpreadsheet,
  GitBranch,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  Settings,
  Shield,
  ShoppingCart,
  Store,
  Terminal,
  Users,
  Wrench,
  X,
  CheckSquare,
  Coins,
} from 'lucide-react';
import { BrandMark } from '../components/ui/DesignSystem';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../domain/commercePolicy';

interface NavGroup {
  group: string;
  items: { to: string; label: string; icon: React.ReactNode; permission?: Permission; end?: boolean }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Overview',
    items: [{ to: '/admin', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, end: true }],
  },
  {
    group: 'Catalog & Stock',
    items: [
      { to: '/admin/products', label: 'Products', icon: <Package className="w-4 h-4" />, permission: 'product:read' },
      { to: '/admin/inventory', label: 'Inventory', icon: <Boxes className="w-4 h-4" />, permission: 'product:read' },
    ],
  },
  {
    group: 'Commerce',
    items: [
      { to: '/admin/orders', label: 'Orders', icon: <ShoppingCart className="w-4 h-4" />, permission: 'order:read' },
      { to: '/admin/payments', label: 'Payments', icon: <CreditCard className="w-4 h-4" />, permission: 'order:read' },
    ],
  },
  {
    group: 'Customers & Care',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: <Users className="w-4 h-4" />, permission: 'order:read' },
      { to: '/admin/support', label: 'Support Queue', icon: <LifeBuoy className="w-4 h-4" />, permission: 'support:assign' },
    ],
  },
  {
    group: 'AI & Agents',
    items: [
      { to: '/admin/ai-overview', label: 'AI Overview', icon: <Activity className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/agents', label: 'AI Agents', icon: <Bot className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/workflows', label: 'Workflow Builder', icon: <GitBranch className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/ai-logs', label: 'Conversation Logs', icon: <Terminal className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/tools', label: 'Tool Registry', icon: <Wrench className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/evaluation', label: 'AI Evaluation', icon: <CheckSquare className="w-4 h-4" />, permission: 'agent:configure' },
      { to: '/admin/ai-usage', label: 'AI Usage & Cost', icon: <Coins className="w-4 h-4" />, permission: 'agent:configure' },
    ],
  },
  {
    group: 'Analytics & Settings',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />, permission: 'report:export' },
      { to: '/admin/exports', label: 'Exports & Audit', icon: <FileSpreadsheet className="w-4 h-4" />, permission: 'report:export' },
      { to: '/admin/settings', label: 'Store Settings', icon: <Settings className="w-4 h-4" />, permission: 'settings:write' },
      { to: '/admin/roles', label: 'Roles & RBAC', icon: <Shield className="w-4 h-4" />, permission: 'user:manage' },
    ],
  },
];

export default function AdminLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const renderNav = (onClickItem?: () => void) => (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {NAV_GROUPS.map((grp) => {
        const visibleItems = grp.items.filter((i) => !i.permission || can(i.permission));
        if (visibleItems.length === 0) return null;
        return (
          <div key={grp.group}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[11px] font-semibold text-[#6B6680] tracking-wide">
                {grp.group}
              </p>
            )}
            <div className="space-y-1">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClickItem}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-[#F3F0FA] text-[#7C3AED] font-semibold'
                        : 'text-[#211A35] hover:bg-[#F8F7FC]'
                    }`
                  }
                >
                  <span className="shrink-0">{item.icon}</span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8F7FC] text-[#211A35]">
      <aside
        className={`hidden lg:flex flex-col bg-white border-r border-[#E7E1F2] shrink-0 transition-all duration-200 sticky top-0 h-screen ${
          collapsed ? 'w-[76px]' : 'w-[272px]'
        }`}
      >
        <div className="h-[72px] px-3.5 border-b border-[#E7E1F2] flex items-center justify-between gap-2">
          {!collapsed && (
            <Link to="/admin" className="min-w-0">
              <BrandMark compact />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-9 h-9 rounded-xl border border-[#E7E1F2] flex items-center justify-center text-[#6B6680] hover:text-[#211A35] hover:bg-[#F3F0FA] shrink-0 cursor-pointer"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {renderNav()}

        <div className="p-3 border-t border-[#E7E1F2] space-y-2">
          <Link
            to="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#7C3AED] bg-[#F3F0FA] hover:bg-[#EDE9FE]"
          >
            <Store className="w-4 h-4 shrink-0" />
            {!collapsed && <span>View Storefront</span>}
          </Link>
          {user && !collapsed && (
            <div className="px-3 py-2 rounded-xl bg-[#F8F7FC] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1F1647] truncate">{user.name}</p>
                <p className="text-[11px] text-[#6B6680] truncate">{user.roles.join(', ')}</p>
              </div>
              <button
                type="button"
                aria-label="Sign out"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
                className="p-1.5 rounded-lg text-[#6B6680] hover:text-[#EF4444] cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-[#1F1647]/40" onClick={() => setMobileOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col shadow-2xl">
            <div className="h-16 px-4 border-b border-[#E7E1F2] flex items-center justify-between">
              <BrandMark />
              <button
                type="button"
                aria-label="Close admin drawer"
                onClick={() => setMobileOpen(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#F3F0FA]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNav(() => setMobileOpen(false))}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[72px] bg-white border-b border-[#E7E1F2] px-4 md:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open admin menu"
              className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[#F3F0FA]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <p className="text-sm font-bold text-[#1F1647]">Admin Control Center</p>
              <p className="text-xs text-[#6B6680] hidden sm:block">
                Authoritative commerce operations & multi-agent governance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/ai"
              className="h-9 px-3.5 rounded-xl bg-[#F3F0FA] text-[#7C3AED] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#EDE9FE]"
            >
              <Bot className="w-4 h-4" />
              <span className="hidden sm:inline">AI Workspace</span>
            </Link>
            <Link
              to="/"
              className="h-9 px-3.5 rounded-xl border border-[#E7E1F2] text-xs font-semibold text-[#211A35] flex items-center gap-1.5 hover:bg-[#F8F7FC]"
            >
              <Store className="w-4 h-4" />
              <span className="hidden sm:inline">Storefront</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
