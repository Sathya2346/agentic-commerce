import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Bell,
  Bot,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  ShoppingBag,
  ShoppingCart,
  User,
  X,
} from 'lucide-react';
import { BrandMark } from '../components/ui/DesignSystem';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { catalogApi, type ProductDto } from '../services/api';
import { formatINR } from '../domain/commercePolicy';

export default function CustomerLayout() {
  const { user, isStaff, logout } = useAuth();
  const { cart, compareSlugs, wishlistIds, unreadNotifications } = useCart();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProductDto[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await catalogApi.products({ q: trimmed, pageSize: 5 });
        setSuggestions(res.products);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    navigate(`/shop${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ''}`);
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
      isActive ? 'text-[#7C3AED] border-[#7C3AED]' : 'text-[#211A35] border-transparent hover:text-[#7C3AED]'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7FC] text-[#211A35]">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E7E1F2]">
        <div className="max-w-[1440px] mx-auto px-4 md:px-10 h-14 md:h-[76px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center text-[#211A35] hover:bg-[#F3F0FA] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link to="/" aria-label="Agentic Commerce home">
              <BrandMark />
            </Link>
          </div>

          <nav aria-label="Primary navigation" className="hidden lg:flex items-center gap-6">
            <NavLink to="/" end className={navLinkClass}>
              Home
            </NavLink>
            <NavLink to="/shop" className={navLinkClass}>
              Shop
            </NavLink>
            <NavLink to="/ai" className={navLinkClass}>
              AI Assistant
            </NavLink>
            <NavLink to="/categories" className={navLinkClass}>
              Categories
            </NavLink>
            <NavLink to="/help" className={navLinkClass}>
              Help
            </NavLink>
          </nav>

          <div ref={searchRef} className="hidden md:block relative flex-1 max-w-[340px]">
            <form onSubmit={handleSearchSubmit} className="relative">
              <Search className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder="Search laptops, audio, watches..."
                aria-label="Search products"
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#F3F0FA] border border-transparent focus:border-[#7C3AED] focus:bg-white text-sm text-[#211A35] placeholder:text-[#6B6680] focus:outline-none transition-colors"
              />
            </form>

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-2 bg-white border border-[#E7E1F2] rounded-2xl shadow-xl overflow-hidden z-50">
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setShowSuggestions(false);
                      navigate(`/products/${item.slug}`);
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-[#F3F0FA] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#211A35] truncate">{item.name}</p>
                      <p className="text-xs text-[#6B6680]">{item.brand} · {item.categoryName}</p>
                    </div>
                    <span className="text-sm font-bold text-[#7C3AED] tabular-nums shrink-0">
                      {formatINR(item.pricePaise)}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleSearchSubmit}
                  className="w-full px-3.5 py-2 text-xs font-semibold text-[#7C3AED] bg-[#F8F7FC] border-t border-[#E7E1F2] hover:bg-[#F3F0FA] text-center cursor-pointer"
                >
                  View all results for "{searchQuery}"
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {compareSlugs.length > 0 && (
              <Link
                to="/compare"
                aria-label={`Compare ${compareSlugs.length} products`}
                className="relative w-10 h-10 rounded-xl flex items-center justify-center text-[#211A35] hover:bg-[#F3F0FA] transition-colors"
              >
                <ArrowLeftRight className="w-5 h-5" />
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#1F1647] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {compareSlugs.length}
                </span>
              </Link>
            )}

            <Link
              to="/wishlist"
              aria-label="Wishlist"
              className="relative hidden sm:flex w-10 h-10 rounded-xl items-center justify-center text-[#211A35] hover:bg-[#F3F0FA] transition-colors"
            >
              <Heart className="w-5 h-5" />
              {wishlistIds.size > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF6B6B] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {wishlistIds.size}
                </span>
              )}
            </Link>

            {user && (
              <Link
                to="/notifications"
                aria-label="Notifications"
                className="relative hidden sm:flex w-10 h-10 rounded-xl items-center justify-center text-[#211A35] hover:bg-[#F3F0FA] transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadNotifications}
                  </span>
                )}
              </Link>
            )}

            <Link
              to="/cart"
              aria-label={`Shopping cart with ${cart.itemCount} items`}
              className="relative w-10 h-10 rounded-xl flex items-center justify-center text-[#211A35] hover:bg-[#F3F0FA] transition-colors"
            >
              <ShoppingCart className="w-5 h-5" />
              {cart.itemCount > 0 && (
                <span
                  data-testid="cart-badge"
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold flex items-center justify-center tabular-nums"
                >
                  {cart.itemCount}
                </span>
              )}
            </Link>

            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((o) => !o)}
                  aria-label="Account menu"
                  className="h-10 pl-2 pr-3 rounded-xl border border-[#E7E1F2] bg-white hover:bg-[#F3F0FA] flex items-center gap-2 text-sm font-semibold text-[#1F1647] cursor-pointer"
                >
                  <span className="w-6 h-6 rounded-lg bg-[#7C3AED] text-white text-xs font-bold flex items-center justify-center">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline max-w-[100px] truncate">{user.name.split(' ')[0]}</span>
                </button>
                {userMenuOpen && (
                  <div
                    onMouseLeave={() => setUserMenuOpen(false)}
                    className="absolute right-0 mt-2 w-56 bg-white border border-[#E7E1F2] rounded-2xl shadow-xl py-2 z-50"
                  >
                    <div className="px-4 py-2 border-b border-[#E7E1F2]">
                      <p className="text-sm font-bold text-[#1F1647] truncate">{user.name}</p>
                      <p className="text-xs text-[#6B6680] truncate">{user.email}</p>
                    </div>
                    <Link to="/home" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#F3F0FA]">
                      <Home className="w-4 h-4 text-[#7C3AED]" /> Customer Home
                    </Link>
                    <Link to="/orders" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#F3F0FA]">
                      <Package className="w-4 h-4 text-[#7C3AED]" /> My Orders
                    </Link>
                    <Link to="/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#F3F0FA]">
                      <User className="w-4 h-4 text-[#7C3AED]" /> Account & Addresses
                    </Link>
                    <Link to="/support/tickets" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#F3F0FA]">
                      <Bell className="w-4 h-4 text-[#7C3AED]" /> Support Tickets
                    </Link>
                    {isStaff && (
                      <Link
                        to="/admin"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-sm font-semibold text-[#7C3AED] hover:bg-[#F3F0FA] border-t border-[#E7E1F2] mt-1 pt-2"
                      >
                        <LayoutDashboard className="w-4 h-4" /> Admin Console
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                        navigate('/');
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-[#EF4444] hover:bg-red-50 text-left mt-1 cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold flex items-center whitespace-nowrap shrink-0 transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-[#1F1647]/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-white h-full p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E7E1F2]">
              <BrandMark />
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#F3F0FA]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                handleSearchSubmit(e);
                setMobileMenuOpen(false);
              }}
              className="relative"
            >
              <Search className="w-4 h-4 text-[#6B6680] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products..."
                aria-label="Mobile search"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#F3F0FA] text-sm"
              />
            </form>
            <nav className="flex flex-col gap-1 text-sm font-semibold">
              <Link to="/" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                Home
              </Link>
              <Link to="/shop" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                Shop All Products
              </Link>
              <Link to="/categories" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                Categories
              </Link>
              <Link to="/ai" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA] text-[#7C3AED]">
                AI Shopping Assistant
              </Link>
              <Link to="/wishlist" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                Wishlist
              </Link>
              <Link to="/orders" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                My Orders
              </Link>
              <Link to="/help" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl hover:bg-[#F3F0FA]">
                Help & Support
              </Link>
              {isStaff && (
                <Link to="/admin" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 rounded-xl bg-[#F3F0FA] text-[#7C3AED]">
                  Admin Console
                </Link>
              )}
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-[#E7E1F2] mt-16 pb-20 md:pb-0">
        <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <BrandMark />
            <p className="mt-3 text-sm text-[#6B6680] leading-relaxed">
              Multi-agent AI commerce platform pairing verified inventory, authoritative pricing, and transparent checkout.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1F1647]">Storefront</h3>
            <ul className="mt-3 space-y-2 text-sm text-[#6B6680]">
              <li><Link to="/shop" className="hover:text-[#7C3AED]">All Products</Link></li>
              <li><Link to="/categories" className="hover:text-[#7C3AED]">Categories</Link></li>
              <li><Link to="/compare" className="hover:text-[#7C3AED]">Compare Products</Link></li>
              <li><Link to="/cart" className="hover:text-[#7C3AED]">Shopping Cart</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1F1647]">AI & Customer Care</h3>
            <ul className="mt-3 space-y-2 text-sm text-[#6B6680]">
              <li><Link to="/ai" className="hover:text-[#7C3AED]">AI Shopping Workspace</Link></li>
              <li><Link to="/ai/activity" className="hover:text-[#7C3AED]">Live Agent Activity</Link></li>
              <li><Link to="/help" className="hover:text-[#7C3AED]">Help Center & FAQs</Link></li>
              <li><Link to="/support/tickets" className="hover:text-[#7C3AED]">Support Tickets</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1F1647]">Account & Operations</h3>
            <ul className="mt-3 space-y-2 text-sm text-[#6B6680]">
              <li><Link to="/orders" className="hover:text-[#7C3AED]">Track Orders</Link></li>
              <li><Link to="/account" className="hover:text-[#7C3AED]">Profile & Addresses</Link></li>
              <li><Link to="/login" className="hover:text-[#7C3AED]">Sign In / Register</Link></li>
              <li><Link to="/admin" className="hover:text-[#7C3AED]">Admin Console</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#E7E1F2] py-4 px-4 md:px-10 max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#6B6680]">
          <span>© 2026 Agentic Commerce. All rights reserved.</span>
          <span>INR Authoritative Pricing · Real-Time Inventory · 5 Specialist AI Agents</span>
        </div>
      </footer>

      {/* Mobile 5-item bottom navigation */}
      <nav
        aria-label="Mobile bottom navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-[#E7E1F2] grid grid-cols-5"
      >
        <NavLink to={user ? '/home' : '/'} end className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] font-medium ${isActive ? 'text-[#7C3AED]' : 'text-[#6B6680]'}`}>
          <Home className="w-4 h-4 mb-0.5" />
          Home
        </NavLink>
        <NavLink to="/shop" className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] font-medium ${isActive ? 'text-[#7C3AED]' : 'text-[#6B6680]'}`}>
          <ShoppingBag className="w-4 h-4 mb-0.5" />
          Shop
        </NavLink>
        <NavLink to="/ai" className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] font-medium ${isActive ? 'text-[#7C3AED]' : 'text-[#6B6680]'}`}>
          <Bot className="w-4 h-4 mb-0.5" />
          AI
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] font-medium ${isActive ? 'text-[#7C3AED]' : 'text-[#6B6680]'}`}>
          <Package className="w-4 h-4 mb-0.5" />
          Orders
        </NavLink>
        <NavLink to={user ? '/account' : '/login'} className={({ isActive }) => `flex flex-col items-center justify-center text-[11px] font-medium ${isActive ? 'text-[#7C3AED]' : 'text-[#6B6680]'}`}>
          <User className="w-4 h-4 mb-0.5" />
          Profile
        </NavLink>
      </nav>
    </div>
  );
}
