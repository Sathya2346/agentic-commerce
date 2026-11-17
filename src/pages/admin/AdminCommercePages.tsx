import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Boxes,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  LifeBuoy,
  Package,
  Plus,
  RefreshCw,
  ShoppingCart,
  Users,
} from 'lucide-react';
import {
  Button,
  ErrorState,
  KpiCard,
  Modal,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { adminApi, catalogApi, supportApi, type CategoryDto } from '../../services/api';
import { formatINR, getNextOrderTransitions, type OrderState } from '../../domain/commercePolicy';

export function AdminDashboardPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await adminApi.dashboard();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <div className="h-64 card-surface animate-pulse" />;

  const kpis = (data.kpis as Record<string, number>) || {};
  const salesSeries = (data.salesSeries as { day: string; revenuePaise: number; orders: number }[]) || [];
  const categoryMix = (data.categoryMix as { category: string; revenue_paise: number; units: number }[]) || [];
  const recentOrders = (data.recentOrders as Record<string, unknown>[]) || [];
  const latestRuns = (data.latestRuns as Record<string, unknown>[]) || [];
  const maxRev = Math.max(1, ...salesSeries.map((s) => s.revenuePaise));
  const maxCatRev = Math.max(1, ...categoryMix.map((c) => c.revenue_paise));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647]">Commerce Operations Dashboard</h1>
          <p className="text-sm text-[#6B6680]">Real-time INR sales, order fulfillment, and multi-agent telemetry</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Verified Sales Volume" value={formatINR(kpis.totalSalesPaise || 0)} trend="+14.2% vs prior week" icon={<IndianRupee className="w-5 h-5" />} />
        <KpiCard label="Total Orders" value={String(kpis.totalOrders || 0)} trend="Live SQL ledger" icon={<ShoppingCart className="w-5 h-5" />} />
        <KpiCard label="Registered Customers" value={String(kpis.totalCustomers || 0)} icon={<Users className="w-5 h-5" />} />
        <KpiCard label="AI Agent Runs" value={String(kpis.aiInteractions || 0)} trend={`${(kpis.aiTokens || 0).toLocaleString('en-IN')} tokens`} icon={<Bot className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 card-surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1F1647]">Weekly Sales Trajectory (INR)</h2>
            <span className="text-xs text-[#6B6680]">Last 7 days</span>
          </div>
          <div className="h-56 flex items-end justify-between gap-3 pt-4">
            {salesSeries.map((pt) => {
              const pct = Math.max(12, Math.round((pt.revenuePaise / maxRev) * 100));
              return (
                <div key={pt.day} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <span className="text-[11px] font-semibold text-[#6B6680] tabular-nums hidden sm:block">
                    ₹{(pt.revenuePaise / 10_000_000).toFixed(1)}L
                  </span>
                  <div className="w-full max-w-[44px] bg-[#F3F0FA] rounded-t-xl h-40 flex items-end overflow-hidden">
                    <div
                      style={{ height: `${pct}%` }}
                      className="w-full bg-gradient-to-t from-[#7C3AED] to-[#A78BFA] rounded-t-xl transition-all"
                    />
                  </div>
                  <span className="text-xs font-semibold text-[#1F1647]">{pt.day}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lg:col-span-5 card-surface p-6 space-y-4">
          <h2 className="text-base font-bold text-[#1F1647]">Top Categories by Revenue</h2>
          <div className="space-y-3">
            {categoryMix.slice(0, 5).map((cat) => (
              <div key={cat.category} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-[#1F1647]">{cat.category}</span>
                  <span className="text-[#7C3AED] tabular-nums">{formatINR(cat.revenue_paise)}</span>
                </div>
                <div className="h-2 rounded-full bg-[#F3F0FA] overflow-hidden">
                  <div
                    style={{ width: `${Math.max(8, Math.round((cat.revenue_paise / maxCatRev) * 100))}%` }}
                    className="h-full bg-[#7C3AED] rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 card-surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1F1647]">Recent Orders</h2>
            <Link to="/admin/orders" className="text-xs font-semibold text-[#7C3AED] hover:underline">Manage all →</Link>
          </div>
          <div className="divide-y divide-[#E7E1F2]">
            {recentOrders.map((o) => (
              <div key={String(o.id)} className="py-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-bold text-[#1F1647] font-mono-tabular">#{String(o.order_number)}</p>
                  <p className="text-xs text-[#6B6680] truncate">{String(o.customer_name)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-bold tabular-nums">{formatINR(Number(o.grand_total_paise))}</span>
                  <StatusBadge label={String(o.status)} tone={statusToneForOrder(String(o.status))} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-5 card-surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1F1647]">Latest Agent Runs</h2>
            <Link to="/admin/ai-logs" className="text-xs font-semibold text-[#7C3AED] hover:underline">View logs →</Link>
          </div>
          <div className="divide-y divide-[#E7E1F2]">
            {latestRuns.map((r) => (
              <div key={String(r.id)} className="py-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-[#1F1647] truncate">{String(r.prompt_summary)}</p>
                  <p className="text-[#6B6680]">{String(r.agent_key)} · {String(r.duration_ms)} ms</p>
                </div>
                <StatusBadge label={String(r.status)} tone={statusToneForOrder(String(r.status))} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function AdminProductsPage() {
  const { pushToast } = useToast();
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    brand: '',
    sku: '',
    priceInr: '19999',
    mrpInr: '22999',
    initialStock: '15',
    shortDescription: '',
    status: 'ACTIVE',
  });

  const load = async () => {
    const [pRes, cRes] = await Promise.all([adminApi.products(), catalogApi.categories()]);
    setProducts(pRes.products);
    setCategories(cRes.categories);
    if (!form.categoryId && cRes.categories[0]) {
      setForm((f) => ({ ...f, categoryId: cRes.categories[0].id }));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        await adminApi.updateProduct(editId, {
          name: form.name,
          status: form.status,
          pricePaise: Math.round(Number(form.priceInr) * 100),
          shortDescription: form.shortDescription,
        });
        pushToast({ variant: 'success', title: 'Product updated' });
      } else {
        await adminApi.createProduct({
          name: form.name,
          categoryId: form.categoryId,
          brand: form.brand,
          sku: form.sku,
          pricePaise: Math.round(Number(form.priceInr) * 100),
          mrpPaise: Math.round(Number(form.mrpInr) * 100),
          initialStock: Number(form.initialStock),
          shortDescription: form.shortDescription,
          status: form.status,
        });
        pushToast({ variant: 'success', title: 'Product created in catalog' });
      }
      setModalOpen(false);
      setEditId(null);
      await load();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Operation failed', description: err instanceof Error ? err.message : 'Check fields.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647]">Product Catalog Management</h1>
          <p className="text-sm text-[#6B6680]">Manage authoritative INR pricing, SKUs, and active/archived visibility</p>
        </div>
        <Button
          onClick={() => {
            setEditId(null);
            setForm({
              name: '',
              categoryId: categories[0]?.id || '',
              brand: '',
              sku: `SKU-${Math.floor(1000 + Math.random() * 8999)}`,
              priceInr: '24999',
              mrpInr: '29999',
              initialStock: '12',
              shortDescription: '',
              status: 'ACTIVE',
            });
            setModalOpen(true);
          }}
        >
          <Plus className="w-4 h-4" /> Add Product
        </Button>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Product</th>
              <th className="p-4">Category</th>
              <th className="p-4">Price</th>
              <th className="p-4">Available Stock</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {products.map((p) => (
              <tr key={String(p.id)} className="hover:bg-[#F8F7FC]">
                <td className="p-4">
                  <p className="font-bold text-[#1F1647]">{String(p.name)}</p>
                  <p className="text-xs text-[#6B6680]">{String(p.brand)} · {String(p.variant_count)} variants</p>
                </td>
                <td className="p-4 text-[#6B6680]">{String(p.category_name)}</td>
                <td className="p-4 font-bold tabular-nums">{formatINR(Number(p.min_price_paise || 0))}</td>
                <td className="p-4 tabular-nums font-semibold">{String(p.available_stock)}</td>
                <td className="p-4"><StatusBadge label={String(p.status)} tone={statusToneForOrder(String(p.status))} /></td>
                <td className="p-4 text-right space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditId(String(p.id));
                      setForm({
                        name: String(p.name),
                        categoryId: String(p.category_id),
                        brand: String(p.brand),
                        sku: '',
                        priceInr: String(Math.round(Number(p.min_price_paise || 0) / 100)),
                        mrpInr: String(Math.round(Number(p.min_price_paise || 0) / 100)),
                        initialStock: '0',
                        shortDescription: String(p.short_description || ''),
                        status: String(p.status),
                      });
                      setModalOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  {p.status !== 'ARCHIVED' && (
                    <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(p)}>
                      Archive
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Product' : 'Add New Product'}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required placeholder="Product Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
          {!editId && (
            <div className="grid grid-cols-2 gap-3">
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input required placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {!editId && <input required placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular" />}
            <input required type="number" min={1} placeholder="Price (INR)" value={form.priceInr} onChange={(e) => setForm({ ...form, priceInr: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            {!editId && <input required type="number" min={0} placeholder="Initial Stock" value={form.initialStock} onChange={(e) => setForm({ ...form, initialStock: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />}
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm">
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>
          <textarea rows={2} placeholder="Short Description" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm" />
          <Button type="submit" className="w-full">{editId ? 'Save Changes' : 'Create Product'}</Button>
        </form>
      </Modal>

      <Modal open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title="Archive Product">
        {archiveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[#6B6680]">
              Archiving <strong>{String(archiveTarget.name)}</strong> hides it from storefront search while keeping past order snapshots intact.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setArchiveTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await adminApi.archiveProduct(String(archiveTarget.id));
                  setArchiveTarget(null);
                  pushToast({ variant: 'success', title: 'Product archived' });
                  await load();
                }}
              >
                Confirm Archive
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function AdminInventoryPage() {
  const { pushToast } = useToast();
  const [stock, setStock] = useState<Record<string, unknown>[]>([]);
  const [movements, setMovements] = useState<Record<string, unknown>[]>([]);
  const [adjustItem, setAdjustItem] = useState<Record<string, unknown> | null>(null);
  const [delta, setDelta] = useState('5');
  const [reason, setReason] = useState('Warehouse restock');

  const load = async () => {
    const res = await adminApi.inventory();
    setStock(res.stock);
    setMovements(res.movements);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    try {
      await adminApi.adjustInventory({
        variantId: String(adjustItem.variant_id),
        delta: Number(delta),
        reason,
      });
      setAdjustItem(null);
      pushToast({ variant: 'success', title: 'Inventory adjusted' });
      await load();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Adjustment rejected', description: err instanceof Error ? err.message : 'Conflict' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Inventory & Stock Ledger</h1>
        <p className="text-sm text-[#6B6680]">Available-to-sell = On-Hand − Reserved. Negative adjustments below reserved stock are blocked.</p>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">SKU / Product</th>
              <th className="p-4">On Hand</th>
              <th className="p-4">Reserved</th>
              <th className="p-4">Available</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {stock.map((s) => {
              const avail = Number(s.available_to_sell);
              const reorder = Number(s.reorder_level);
              const badge = avail <= 0 ? 'OUT_OF_STOCK' : avail <= reorder ? 'LOW_STOCK' : 'ACTIVE';
              return (
                <tr key={String(s.variant_id)}>
                  <td className="p-4">
                    <p className="font-bold text-[#1F1647]">{String(s.product_name)}</p>
                    <p className="text-xs font-mono-tabular text-[#6B6680]">{String(s.sku)} · {String(s.variant_title)}</p>
                  </td>
                  <td className="p-4 tabular-nums">{String(s.on_hand)}</td>
                  <td className="p-4 tabular-nums">{String(s.reserved)}</td>
                  <td className="p-4 tabular-nums font-bold">{avail}</td>
                  <td className="p-4"><StatusBadge label={badge.replace(/_/g, ' ')} tone={statusToneForOrder(badge)} /></td>
                  <td className="p-4 text-right">
                    <Button size="sm" variant="outline" onClick={() => setAdjustItem(s)}>Adjust Stock</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-6 space-y-3">
        <h2 className="text-base font-bold text-[#1F1647] flex items-center gap-2">
          <Boxes className="w-4 h-4 text-[#7C3AED]" /> Recent Stock Movements
        </h2>
        <div className="divide-y divide-[#E7E1F2] text-xs">
          {movements.slice(0, 12).map((m) => (
            <div key={String(m.id)} className="py-2.5 flex items-center justify-between gap-3">
              <div>
                <span className="font-mono-tabular font-bold text-[#1F1647]">{String(m.sku)}</span> ·{' '}
                <span className="font-semibold">{String(m.movement_type)}</span> — {String(m.reason)}
              </div>
              <span className={`font-bold tabular-nums ${Number(m.quantity_delta) >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                {Number(m.quantity_delta) >= 0 ? `+${String(m.quantity_delta)}` : String(m.quantity_delta)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={Boolean(adjustItem)} onClose={() => setAdjustItem(null)} title="Adjust Inventory">
        {adjustItem && (
          <form onSubmit={handleAdjust} className="space-y-4">
            <p className="text-sm font-semibold text-[#1F1647]">
              {String(adjustItem.product_name)} ({String(adjustItem.sku)}) — On Hand: {String(adjustItem.on_hand)}, Reserved: {String(adjustItem.reserved)}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Quantity Delta (+ restock, - shrink)</label>
              <input type="number" required value={delta} onChange={(e) => setDelta(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Audit Reason</label>
              <input type="text" required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <Button type="submit" className="w-full">Apply Stock Adjustment</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminOrdersPage() {
  const { pushToast } = useToast();
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [targetStatus, setTargetStatus] = useState('');
  const [carrier, setCarrier] = useState('Blue Dart Express');
  const [tracking, setTracking] = useState('');
  const [reason, setReason] = useState('Fulfillment update');

  const load = async () => {
    const res = await adminApi.orders(statusFilter === 'ALL' ? undefined : statusFilter);
    setOrders(res.orders);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !targetStatus) return;
    try {
      await adminApi.transitionOrder(String(selected.id), {
        targetStatus,
        reason,
        carrier,
        trackingReference: tracking || undefined,
      });
      setSelected(null);
      pushToast({ variant: 'success', title: `Order transitioned to ${targetStatus}` });
      await load();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Transition blocked', description: err instanceof Error ? err.message : 'Invalid state.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647]">Order Fulfillment Console</h1>
          <p className="text-sm text-[#6B6680]">Enforces OrderStatePolicy transitions and dispatches shipment tracking updates</p>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-xl border border-[#E7E1F2] bg-white text-xs font-semibold">
          {['ALL', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[740px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Order #</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Total</th>
              <th className="p-4">Payment</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Fulfillment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {orders.map((o) => {
              const nextStates = getNextOrderTransitions(String(o.status) as OrderState);
              return (
                <tr key={String(o.id)}>
                  <td className="p-4 font-mono-tabular font-bold text-[#1F1647]">#{String(o.order_number)}</td>
                  <td className="p-4">
                    <p className="font-semibold">{String(o.customer_name)}</p>
                    <p className="text-xs text-[#6B6680]">{String(o.customer_email)}</p>
                  </td>
                  <td className="p-4 font-bold tabular-nums">{formatINR(Number(o.grand_total_paise))}</td>
                  <td className="p-4 text-xs">{String(o.payment_method || '')} · {String(o.payment_status || '')}</td>
                  <td className="p-4"><StatusBadge label={String(o.status)} tone={statusToneForOrder(String(o.status))} /></td>
                  <td className="p-4 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={nextStates.length === 0}
                      onClick={() => {
                        setSelected(o);
                        setTargetStatus(nextStates[0] || '');
                        setTracking(String((o.shipment as Record<string, unknown> | undefined)?.tracking_reference || ''));
                      }}
                    >
                      {nextStates.length > 0 ? 'Update Status' : 'Final State'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Transition Order Status">
        {selected && (
          <form onSubmit={handleTransition} className="space-y-4">
            <p className="text-sm text-[#6B6680]">
              Order <strong className="font-mono-tabular text-[#1F1647]">#{String(selected.order_number)}</strong> is currently{' '}
              <strong>{String(selected.status)}</strong>.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Next Valid State</label>
              <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm">
                {getNextOrderTransitions(String(selected.status) as OrderState).map((ns) => (
                  <option key={ns} value={ns}>{ns}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
              <input placeholder="Tracking Reference" value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular" />
            </div>
            <input required placeholder="Audit Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            <Button type="submit" className="w-full">Apply State Transition</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminPaymentsPage() {
  const { can } = useAuth();
  const { pushToast } = useToast();
  const [payments, setPayments] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [refundTarget, setRefundTarget] = useState<Record<string, unknown> | null>(null);
  const [amountInr, setAmountInr] = useState('');
  const [reason, setReason] = useState('Customer requested refund');

  const load = async () => {
    const res = await adminApi.payments();
    setPayments(res.payments);
    setEvents(res.events);
  };

  useEffect(() => {
    void load();
  }, []);

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTarget) return;
    try {
      await adminApi.refundPayment(String(refundTarget.id), {
        amountPaise: Math.round(Number(amountInr) * 100),
        reason,
      });
      setRefundTarget(null);
      pushToast({ variant: 'success', title: 'Refund approved & recorded' });
      await load();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Refund rejected', description: err instanceof Error ? err.message : 'Check amount/permission.' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Payments, Webhooks & Refunds</h1>
        <p className="text-sm text-[#6B6680]">Refunds require `refund:approve` RBAC permission and never exceed remaining captured INR balance.</p>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[740px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Reference</th>
              <th className="p-4">Order / Customer</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Refunded</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {payments.map((p) => {
              const remaining = Number(p.amount_paise) - Number(p.refunded_paise);
              const refundable = can('refund:approve') && ['PAID', 'PARTIALLY_REFUNDED'].includes(String(p.status)) && remaining > 0;
              return (
                <tr key={String(p.id)}>
                  <td className="p-4 font-mono-tabular text-xs font-bold">{String(p.provider_reference)}</td>
                  <td className="p-4">
                    <p className="font-bold font-mono-tabular">#{String(p.order_number)}</p>
                    <p className="text-xs text-[#6B6680]">{String(p.customer_name)} · {String(p.method)}</p>
                  </td>
                  <td className="p-4 font-bold tabular-nums">{formatINR(Number(p.amount_paise))}</td>
                  <td className="p-4 tabular-nums">{formatINR(Number(p.refunded_paise))}</td>
                  <td className="p-4"><StatusBadge label={String(p.status)} tone={statusToneForOrder(String(p.status))} /></td>
                  <td className="p-4 text-right">
                    {refundable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRefundTarget(p);
                          setAmountInr(String(remaining / 100));
                        }}
                      >
                        <CreditCard className="w-3.5 h-3.5" /> Refund
                      </Button>
                    ) : (
                      <span className="text-xs text-[#6B6680]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-6 space-y-3">
        <h2 className="text-base font-bold text-[#1F1647]">Verified Webhook Event Ledger</h2>
        <div className="divide-y divide-[#E7E1F2] text-xs">
          {events.map((ev) => (
            <div key={String(ev.id)} className="py-2.5 flex items-center justify-between gap-3">
              <span className="font-mono-tabular font-semibold">{String(ev.provider_event_id)}</span>
              <span>{String(ev.event_type)}</span>
              <span className="text-[#6B6680]">{new Date(String(ev.created_at)).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={Boolean(refundTarget)} onClose={() => setRefundTarget(null)} title="Issue Payment Refund">
        {refundTarget && (
          <form onSubmit={submitRefund} className="space-y-4">
            <p className="text-sm text-[#6B6680]">
              Refunding order <strong>#{String(refundTarget.order_number)}</strong> (Max remaining:{' '}
              {formatINR(Number(refundTarget.amount_paise) - Number(refundTarget.refunded_paise))})
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Refund Amount (INR)</label>
              <input type="number" step="0.01" required value={amountInr} onChange={(e) => setAmountInr(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Reason</label>
              <input type="text" required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <Button type="submit" variant="danger" className="w-full">Approve & Process Refund</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function AdminCustomersPage() {
  const { can } = useAuth();
  const { pushToast } = useToast();
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([]);

  const load = async () => {
    const res = await adminApi.customers();
    setCustomers(res.customers);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Customer Directory</h1>
        <p className="text-sm text-[#6B6680]">Review lifetime order spend and account standing</p>
      </div>
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[680px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Customer</th>
              <th className="p-4">Orders</th>
              <th className="p-4">Lifetime Spend</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {customers.map((c) => {
              const suspended = c.status === 'SUSPENDED';
              return (
                <tr key={String(c.id)}>
                  <td className="p-4">
                    <p className="font-bold text-[#1F1647]">{String(c.name)}</p>
                    <p className="text-xs text-[#6B6680]">{String(c.email)}</p>
                  </td>
                  <td className="p-4 tabular-nums">{String(c.order_count)}</td>
                  <td className="p-4 font-bold tabular-nums">{formatINR(Number(c.total_spend_paise))}</td>
                  <td className="p-4"><StatusBadge label={String(c.status)} tone={statusToneForOrder(String(c.status))} /></td>
                  <td className="p-4 text-right">
                    {can('customer:manage') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await adminApi.setCustomerStatus(String(c.id), suspended ? 'ACTIVE' : 'SUSPENDED');
                          pushToast({ variant: 'success', title: suspended ? 'Customer reactivated' : 'Customer suspended' });
                          await load();
                        }}
                      >
                        {suspended ? 'Reactivate' : 'Suspend'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminSupportQueuePage() {
  const { pushToast } = useToast();
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([]);
  const [staff, setStaff] = useState<Record<string, unknown>[]>([]);
  const [active, setActive] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);

  const load = async () => {
    const res = await adminApi.supportTickets();
    setTickets(res.tickets);
    setStaff(res.staff);
  };

  useEffect(() => {
    void load();
  }, []);

  const openTicket = async (t: Record<string, unknown>) => {
    setActive(t);
    const detail = await supportApi.ticketDetail(String(t.id));
    setMessages(detail.messages);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Support Escalation Queue</h1>
        <p className="text-sm text-[#6B6680]">Assign agents, publish customer replies, or add private internal staff notes</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 space-y-3">
          {tickets.map((t) => (
            <button
              key={String(t.id)}
              type="button"
              onClick={() => void openTicket(t)}
              className="w-full card-surface card-surface-hover p-4 text-left flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono-tabular font-bold text-[#7C3AED]">{String(t.ticket_number)}</span>
                  <StatusBadge label={String(t.status)} tone={statusToneForOrder(String(t.status))} />
                </div>
                <p className="text-sm font-bold text-[#1F1647] mt-1 truncate">{String(t.subject)}</p>
                <p className="text-xs text-[#6B6680]">{String(t.customer_name)} · Assignee: {String(t.assignee_name || 'Unassigned')}</p>
              </div>
              <LifeBuoy className="w-4 h-4 text-[#7C3AED] shrink-0" />
            </button>
          ))}
        </div>

        <div className="lg:col-span-6 card-surface p-6 space-y-4">
          {!active ? (
            <p className="text-sm text-[#6B6680]">Select a ticket to reply or update assignment.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E7E1F2]">
                <div>
                  <h2 className="text-base font-bold text-[#1F1647]">{String(active.subject)}</h2>
                  <p className="text-xs text-[#6B6680]">{String(active.ticket_number)} · {String(active.customer_email)}</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={String(active.assignee_user_id || '')}
                    onChange={async (e) => {
                      await adminApi.updateSupportTicket(String(active.id), { assigneeUserId: e.target.value });
                      pushToast({ variant: 'success', title: 'Ticket assigned' });
                      await load();
                    }}
                    className="h-8 px-2 rounded-lg border border-[#E7E1F2] text-xs"
                  >
                    <option value="">Assign Staff...</option>
                    {staff.map((st) => <option key={String(st.id)} value={String(st.id)}>{String(st.name)}</option>)}
                  </select>
                  <select
                    value={String(active.status)}
                    onChange={async (e) => {
                      await adminApi.updateSupportTicket(String(active.id), { status: e.target.value });
                      setActive({ ...active, status: e.target.value });
                      await load();
                    }}
                    className="h-8 px-2 rounded-lg border border-[#E7E1F2] text-xs"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="PENDING">PENDING</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto">
                {messages.map((m) => (
                  <div key={String(m.id)} className={`p-3 rounded-xl border text-xs ${m.is_internal_note ? 'bg-amber-50 border-amber-200' : 'bg-[#F8F7FC] border-[#E7E1F2]'}`}>
                    <p className="font-bold text-[#1F1647]">
                      {String(m.sender_name)} {m.is_internal_note ? '(Internal Staff Note)' : `(${String(m.sender_role)})`}
                    </p>
                    <p className="mt-1 text-[#211A35]">{String(m.body)}</p>
                  </div>
                ))}
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!reply.trim()) return;
                  await supportApi.replyTicket(String(active.id), reply.trim(), internalNote);
                  setReply('');
                  await openTicket(active);
                  await load();
                  pushToast({ variant: 'success', title: internalNote ? 'Internal note saved' : 'Reply sent to customer' });
                }}
                className="space-y-2 pt-2 border-t border-[#E7E1F2]"
              >
                <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write customer reply or internal note..." className="w-full p-2.5 rounded-xl border border-[#E7E1F2] text-xs" />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-[#6B6680] cursor-pointer">
                    <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
                    Internal note (hidden from customer)
                  </label>
                  <Button type="submit" size="sm">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Post
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
