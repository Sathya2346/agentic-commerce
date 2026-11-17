import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, Package, ShieldCheck, Sparkles, Truck, Zap } from 'lucide-react';
import {
  Button,
  ErrorState,
  ProductCard,
  ProductImage,
  SkeletonCard,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { catalogApi, ordersApi, type CategoryDto, type ProductDto } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { formatINR } from '../../domain/commercePolicy';

export default function HomePage({ customerHome = false }: { customerHome?: boolean }) {
  const { user } = useAuth();
  const { addToCart, toggleWishlist, toggleCompare, wishlistIds, compareSlugs } = useCart();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [trending, setTrending] = useState<ProductDto[]>([]);
  const [recentOrders, setRecentOrders] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, prodRes] = await Promise.all([
        catalogApi.categories(),
        catalogApi.products({ pageSize: 8, sort: 'popular' }),
      ]);
      setCategories(catRes.categories);
      setTrending(prodRes.products);
      if (user) {
        try {
          const ordRes = await ordersApi.list();
          setRecentOrders(ordRes.orders.slice(0, 3));
        } catch {
          // ignore
        }
      } else {
        setRecentOrders([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load storefront catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleAdd = async (p: ProductDto) => {
    if (!p.defaultVariantId) return;
    await addToCart({
      variantId: p.defaultVariantId,
      productId: p.id,
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      imageUrl: p.imageUrl,
      unitPricePaise: p.pricePaise,
      mrpPaise: p.mrpPaise,
      quantity: 1,
      availableToSell: p.availableToSell,
    });
  };

  return (
    <div className="space-y-12 pb-8">
      {/* Customer Personalized Summary Bar on /home */}
      {customerHome && user && (
        <section className="bg-white border-b border-[#E7E1F2]">
          <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[#7C3AED]">Customer Workspace</p>
              <h1 className="text-2xl font-bold text-[#1F1647] mt-0.5">
                Welcome back, {user.name}
              </h1>
              <p className="text-sm text-[#6B6680] mt-1">
                Pick up where you left off with live order tracking, AI shopping sessions, and curated tech deals.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/ai">
                <Button>
                  <Bot className="w-4 h-4" /> Ask AI Shopping Agent
                </Button>
              </Link>
              <Link to="/orders">
                <Button variant="outline">
                  <Package className="w-4 h-4" /> My Orders ({recentOrders.length})
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Hero Section */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-10 pt-6 md:pt-8">
        <div className="aurora-hero-gradient rounded-[24px] overflow-hidden text-white shadow-xl grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center">
            <p className="text-xs font-semibold tracking-wider uppercase text-[#A78BFA]">
              Multi-Agent Intelligent Retail
            </p>
            <h1 className="mt-3 text-3xl sm:text-4xl lg:text-[44px] font-bold leading-[1.12] tracking-tight text-balance">
              Shop Smarter with Collaborating AI Specialists
            </h1>
            <p className="mt-4 text-sm sm:text-base text-white/85 max-w-xl leading-relaxed">
              Describe your budget and workflow. Five specialized AI agents compare live specs, verify real warehouse stock, check PIN delivery, and guide you to a transparent INR checkout.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button variant="coral" size="lg" onClick={() => navigate('/ai')}>
                <Sparkles className="w-4 h-4" />
                Ask AI Assistant
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate('/shop')}
                className="!bg-white/10 !border-white/25 !text-white hover:!bg-white/20"
              >
                Explore Products
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5 relative min-h-[240px] lg:min-h-[380px] bg-[#1F1647]/40">
            <ProductImage
              src="/src/assets/images/hero_ai_commerce_1794850599231.jpg"
              alt="Agentic Commerce curated laptops, wireless headphones, and smart devices"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1F1647]/65 via-transparent to-transparent lg:bg-gradient-to-r lg:from-[#37237E]/55 lg:to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* 4-Item Trust Strip (Zero-pill clean layout) */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: <Bot className="w-5 h-5 text-[#7C3AED]" />, title: '5 Specialist AI Agents', desc: 'Product, Inventory, Order & Support tools' },
            { icon: <CheckCircle2 className="w-5 h-5 text-[#10B981]" />, title: 'Live Stock Reservations', desc: 'Authoritative available-to-sell checks' },
            { icon: <Truck className="w-5 h-5 text-[#7C3AED]" />, title: 'Free Delivery ₹999+', desc: 'Same-day dispatch across metro PIN codes' },
            { icon: <ShieldCheck className="w-5 h-5 text-[#7C3AED]" />, title: 'GST Verified Checkout', desc: 'Signed payment verification & instant refunds' },
          ].map((item) => (
            <div key={item.title} className="card-surface p-4 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#F3F0FA] flex items-center justify-center shrink-0">
                {item.icon}
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#1F1647]">{item.title}</h2>
                <p className="text-xs text-[#6B6680] mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Orders Widget for Authenticated Customers */}
      {recentOrders.length > 0 && (
        <section className="max-w-[1440px] mx-auto px-4 md:px-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#1F1647]">Your Recent Orders</h2>
            <Link to="/orders" className="text-sm font-semibold text-[#7C3AED] hover:underline">
              View all orders →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentOrders.map((ord) => (
              <Link
                key={String(ord.id)}
                to={`/orders/${String(ord.id)}`}
                className="card-surface card-surface-hover p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1F1647] font-mono-tabular">#{String(ord.order_number)}</p>
                  <p className="text-xs text-[#6B6680] mt-0.5">
                    {new Date(String(ord.created_at)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-sm font-bold text-[#7C3AED] mt-1.5 tabular-nums">
                    {formatINR(Number(ord.grand_total_paise))}
                  </p>
                </div>
                <StatusBadge label={String(ord.status).replace(/_/g, ' ')} tone={statusToneForOrder(String(ord.status))} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Categories Strip */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold text-[#1F1647]">Shop by Category</h2>
            <p className="text-sm text-[#6B6680]">Curated electronics, wearables, audio, and workspace gear</p>
          </div>
          <Link to="/categories" className="text-sm font-semibold text-[#7C3AED] hover:underline whitespace-nowrap">
            All Categories →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/categories/${cat.slug}`}
              className="card-surface card-surface-hover overflow-hidden flex flex-col"
            >
              <div className="h-28 bg-[#F3F0FA] overflow-hidden">
                <ProductImage src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" />
              </div>
              <div className="p-3.5">
                <h3 className="text-sm font-bold text-[#1F1647] truncate">{cat.name}</h3>
                <p className="text-xs text-[#6B6680] mt-0.5 tabular-nums">{cat.product_count} products</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Trending Catalog Grid */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold text-[#1F1647]">Trending Products</h2>
            <p className="text-sm text-[#6B6680]">Live prices and real-time warehouse availability</p>
          </div>
          <Link to="/shop" className="text-sm font-semibold text-[#7C3AED] hover:underline whitespace-nowrap">
            View All →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadData()} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {trending.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                inWishlist={wishlistIds.has(p.id)}
                inCompare={compareSlugs.includes(p.slug)}
                onAddToCart={handleAdd}
                onToggleWishlist={(item) => void toggleWishlist(item.id, item.name)}
                onToggleCompare={(item) => toggleCompare(item.slug, item.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* AI Feature Collaboration Banner */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-10">
        <div className="aurora-soft-gradient border border-[#E7E1F2] rounded-[24px] p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7">
            <p className="text-xs font-semibold text-[#7C3AED] flex items-center gap-1.5">
              <Zap className="w-4 h-4" /> Real-Time Multi-Agent Orchestration
            </p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-bold text-[#1F1647]">
              Not Sure Which Device Fits Your Budget?
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#6B6680] leading-relaxed">
              Ask our AI Workspace anything — from “Best laptop under ₹60,000 for coding” to “Check delivery ETA to 600040” or “Track my order”. Every tool call is grounded in live catalog, stock, and order databases.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/ai?prompt=' + encodeURIComponent('Best laptop under 60000 for coding'))}>
                Try “Best laptop under ₹60,000”
              </Button>
              <Button variant="outline" onClick={() => navigate('/ai/activity')}>
                Inspect Agent Runs
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { name: 'Shopping Agent', role: 'Coordinator & Cart' },
              { name: 'Product Agent', role: 'Specs & Comparisons' },
              { name: 'Inventory Agent', role: 'Live Stock & PIN ETA' },
              { name: 'Order & Support', role: 'Tracking & Policies' },
            ].map((ag) => (
              <div key={ag.name} className="bg-white rounded-2xl p-4 border border-[#E7E1F2] shadow-sm">
                <p className="text-sm font-bold text-[#1F1647]">{ag.name}</p>
                <p className="text-xs text-[#6B6680] mt-1">{ag.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
