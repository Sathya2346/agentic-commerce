import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Heart,
  HelpCircle,
  LifeBuoy,
  MapPin,
  Package,
  Search,
  Send,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  Modal,
  ProductImage,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { accountApi, authApi, ordersApi, supportApi } from '../../services/api';
import { formatINR } from '../../domain/commercePolicy';

export function OrdersPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ status: statusFilter, q: q.trim() || undefined });
      setOrders(res.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch orders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Order History</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">My Orders</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="flex gap-2"
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order # (e.g. AC784512)"
            className="h-10 px-3.5 rounded-xl border border-[#E7E1F2] bg-white text-sm font-mono-tabular"
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['ALL', 'PENDING_PAYMENT', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap cursor-pointer ${
              statusFilter === st
                ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                : 'bg-white text-[#211A35] border-[#E7E1F2] hover:bg-[#F3F0FA]'
            }`}
          >
            {st.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="card-surface h-28 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Package className="w-7 h-7" />}
          title="No orders match this view"
          description="Place an order from the storefront or clear your status filter."
          actionLabel="Explore Catalog"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <div className="space-y-4">
          {orders.map((ord) => {
            const items = (ord.items as Record<string, unknown>[]) || [];
            return (
              <div key={String(ord.id)} className="card-surface p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Link to={`/orders/${String(ord.id)}`} className="text-base font-bold text-[#1F1647] font-mono-tabular hover:text-[#7C3AED]">
                      #{String(ord.order_number)}
                    </Link>
                    <StatusBadge label={String(ord.status).replace(/_/g, ' ')} tone={statusToneForOrder(String(ord.status))} />
                    <span className="text-xs text-[#6B6680]">
                      {new Date(String(ord.created_at)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <p className="text-sm text-[#211A35]">
                    {items.map((it) => `${String(it.product_name)} ×${String(it.quantity)}`).join(', ')}
                  </p>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-4 shrink-0">
                  <p className="text-lg font-bold text-[#1F1647] tabular-nums">
                    {formatINR(Number(ord.grand_total_paise))}
                  </p>
                  <Link to={`/orders/${String(ord.id)}`}>
                    <Button size="sm" variant="outline">View & Track</Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { pushToast } = useToast();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadOrder = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.detail(id);
      setOrder(res.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load order.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    try {
      await ordersApi.cancel(id, reason || 'Customer requested cancellation');
      setCancelOpen(false);
      setReason('');
      pushToast({ variant: 'success', title: 'Order cancelled', description: 'Inventory and refund status updated.' });
      await loadOrder();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Cancellation blocked', description: err instanceof Error ? err.message : 'Try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    try {
      await ordersApi.requestReturn(id, reason);
      setReturnOpen(false);
      setReason('');
      pushToast({ variant: 'success', title: 'Return requested' });
      await loadOrder();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Return unavailable', description: err instanceof Error ? err.message : 'Try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto px-4 py-10"><div className="card-surface h-64 animate-pulse" /></div>;
  }
  if (error || !order) {
    return <div className="max-w-4xl mx-auto px-4 py-10"><ErrorState message={error || 'Order not found.'} onRetry={() => void loadOrder()} /></div>;
  }

  const items = (order.items as Record<string, unknown>[]) || [];
  const addr = (order.address as Record<string, unknown>) || {};
  const payment = (order.payment as Record<string, unknown>) || {};
  const shipment = (order.shipment as Record<string, unknown>) || {};
  const timeline = (shipment.timeline as { state: string; label: string; timestamp: string; detail: string }[]) || [];

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/orders" className="text-xs font-semibold text-[#7C3AED] hover:underline">← Back to My Orders</Link>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] font-mono-tabular">
              Order #{String(order.order_number)}
            </h1>
            <StatusBadge label={String(order.status).replace(/_/g, ' ')} tone={statusToneForOrder(String(order.status))} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {Boolean(order.cancellable) && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              Cancel Order
            </Button>
          )}
          {Boolean(order.returnable) && (
            <Button variant="outline" size="sm" onClick={() => setReturnOpen(true)}>
              Request Return
            </Button>
          )}
          <Link to="/support/tickets">
            <Button variant="outline" size="sm">
              <LifeBuoy className="w-4 h-4" /> Need Help
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* Shipment Tracking Timeline */}
          <section className="card-surface p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
                <Truck className="w-5 h-5 text-[#7C3AED]" /> Shipment & Tracking Timeline
              </h2>
              <span className="text-xs font-mono-tabular text-[#6B6680]">
                {String(shipment.carrier || 'Carrier')} · {String(shipment.tracking_reference || 'Pending')}
              </span>
            </div>

            <div className="space-y-4 border-l-2 border-[#E7E1F2] ml-2.5 pl-5">
              {timeline.map((step, idx) => (
                <div key={idx} className="relative">
                  <span className="w-3 h-3 rounded-full bg-[#7C3AED] border-2 border-white absolute -left-[27px] top-1" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-[#1F1647]">{step.label}</p>
                    <span className="text-xs text-[#6B6680]">
                      {new Date(step.timestamp).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <p className="text-xs text-[#6B6680] mt-0.5">{step.detail}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Items */}
          <section className="card-surface p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#1F1647]">Items Ordered</h2>
            <div className="divide-y divide-[#E7E1F2]">
              {items.map((it) => (
                <div key={String(it.id)} className="py-3 flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#F3F0FA] shrink-0">
                    <ProductImage src={it.image_url ? String(it.image_url) : null} alt={String(it.product_name)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1F1647]">{String(it.product_name)}</p>
                    <p className="text-xs text-[#6B6680]">
                      {String(it.variant_title)} · Qty {String(it.quantity)} · SKU {String(it.sku)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-[#1F1647] tabular-nums">
                    {formatINR(Number(it.line_total_paise))}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="lg:col-span-4 space-y-6">
          <div className="card-surface p-6 space-y-3">
            <h2 className="text-base font-bold text-[#1F1647]">Payment & Totals</h2>
            <div className="text-sm space-y-2 border-b border-[#E7E1F2] pb-3">
              <div className="flex justify-between"><span className="text-[#6B6680]">Method</span><span className="font-semibold">{String(payment.method || 'UPI')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B6680]">Payment Status</span><StatusBadge label={String(payment.status || 'PENDING')} tone={statusToneForOrder(String(payment.status || 'PENDING'))} /></div>
              <div className="flex justify-between"><span className="text-[#6B6680]">Subtotal</span><span className="tabular-nums">{formatINR(Number(order.subtotal_paise))}</span></div>
              {Number(order.discount_paise) > 0 && (
                <div className="flex justify-between text-[#10B981]"><span>Discount</span><span className="tabular-nums">-{formatINR(Number(order.discount_paise))}</span></div>
              )}
              <div className="flex justify-between"><span className="text-[#6B6680]">Shipping</span><span className="tabular-nums">{formatINR(Number(order.shipping_paise))}</span></div>
              <div className="flex justify-between"><span className="text-[#6B6680]">GST (incl.)</span><span className="tabular-nums">{formatINR(Number(order.tax_paise))}</span></div>
            </div>
            <div className="flex justify-between text-base font-bold text-[#1F1647]">
              <span>Grand Total</span>
              <span className="text-[#7C3AED] tabular-nums">{formatINR(Number(order.grand_total_paise))}</span>
            </div>
          </div>

          <div className="card-surface p-6 space-y-2">
            <h2 className="text-base font-bold text-[#1F1647]">Shipping Address</h2>
            <p className="text-sm font-semibold">{String(addr.recipientName || '')}</p>
            <p className="text-xs text-[#6B6680] leading-relaxed">
              {String(addr.line1 || '')}, {String(addr.city || '')}, {String(addr.state || '')} - {String(addr.postalCode || '')}
            </p>
            <p className="text-xs text-[#6B6680]">{String(addr.phone || '')}</p>
          </div>
        </aside>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel Order">
        <form onSubmit={handleCancel} className="space-y-4">
          <p className="text-sm text-[#6B6680]">
            Cancelling order #{String(order.order_number)} will immediately release reserved inventory and refund any captured payment.
          </p>
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for cancellation..."
            className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>Keep Order</Button>
            <Button type="submit" variant="danger" disabled={submitting}>Confirm Cancellation</Button>
          </div>
        </form>
      </Modal>

      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Request Order Return">
        <form onSubmit={handleReturn} className="space-y-4">
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe issue (e.g., wrong item, defective, changed mind within 7 days)..."
            className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>Submit Return Request</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function WishlistPage() {
  const { user } = useAuth();
  const { addToCart, toggleWishlist } = useCart();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await accountApi.wishlist();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={<Heart className="w-7 h-7" />}
          title="Sign in to view your saved wishlist"
          description="Your wishlist items sync across devices once you sign in."
          actionLabel="Sign In"
          onAction={() => navigate('/login')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div>
        <p className="text-xs font-semibold text-[#7C3AED]">Saved Items</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Wishlist</h1>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><div className="card-surface h-48 animate-pulse" /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart className="w-7 h-7" />}
          title="Your wishlist is empty"
          description="Tap the heart icon on any product to bookmark it for later."
          actionLabel="Browse Products"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {items.map((it) => (
            <div key={String(it.id)} className="card-surface overflow-hidden flex flex-col">
              <Link to={`/products/${String(it.slug)}`} className="h-44 bg-[#F3F0FA] block">
                <ProductImage src={it.image_url ? String(it.image_url) : null} alt={String(it.name)} />
              </Link>
              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs text-[#6B6680]">{String(it.brand)}</p>
                  <Link to={`/products/${String(it.slug)}`} className="text-sm font-bold text-[#1F1647] hover:text-[#7C3AED] mt-0.5 block">
                    {String(it.name)}
                  </Link>
                  <p className="text-base font-bold text-[#7C3AED] mt-1 tabular-nums">{formatINR(Number(it.price_paise))}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={Number(it.available_to_sell) <= 0}
                    onClick={() =>
                      void addToCart({
                        variantId: String(it.default_variant_id),
                        productId: String(it.id),
                        slug: String(it.slug),
                        name: String(it.name),
                        brand: String(it.brand),
                        imageUrl: it.image_url ? String(it.image_url) : null,
                        unitPricePaise: Number(it.price_paise),
                        mrpPaise: Number(it.mrp_paise),
                        quantity: 1,
                        availableToSell: Number(it.available_to_sell),
                      })
                    }
                  >
                    Move to Cart
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Remove from wishlist"
                    onClick={async () => {
                      await toggleWishlist(String(it.id), String(it.name));
                      await load();
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-[#EF4444]" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountPage() {
  const { user, refreshUser } = useAuth();
  const { pushToast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [addresses, setAddresses] = useState<Record<string, unknown>[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Record<string, unknown>[]>([]);
  const [addrForm, setAddrForm] = useState({ label: 'Home', recipientName: '', phone: '', line1: '', city: '', state: '', postalCode: '' });

  const loadAll = async () => {
    const [aRes, pRes] = await Promise.all([accountApi.addresses(), accountApi.paymentMethods()]);
    setAddresses(aRes.addresses);
    setPaymentMethods(pRes.methods);
  };

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone || '');
      void loadAll();
    }
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await authApi.updateProfile({ name, phone });
    await refreshUser();
    pushToast({ variant: 'success', title: 'Profile updated' });
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await accountApi.addAddress(addrForm);
      setAddrForm({ label: 'Home', recipientName: '', phone: '', line1: '', city: '', state: '', postalCode: '' });
      await loadAll();
      pushToast({ variant: 'success', title: 'Address saved' });
    } catch (err) {
      pushToast({ variant: 'error', title: 'Invalid address', description: err instanceof Error ? err.message : 'Check fields.' });
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-8">
      <div>
        <p className="text-xs font-semibold text-[#7C3AED]">Account Settings</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Profile, Addresses & Payment Tokens</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 card-surface p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
            <User className="w-5 h-5 text-[#7C3AED]" /> Personal Profile
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Full Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Email (Verified)</label>
              <input value={user?.email || ''} disabled className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] bg-[#F8F7FC] text-sm text-[#6B6680]" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Phone Number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <Button type="submit">Save Profile</Button>
          </form>

          <div className="pt-4 border-t border-[#E7E1F2]">
            <h3 className="text-sm font-bold text-[#1F1647] flex items-center gap-2 mb-3">
              <CreditCard className="w-4 h-4 text-[#7C3AED]" /> Saved Payment Tokens
            </h3>
            {paymentMethods.length === 0 ? (
              <p className="text-xs text-[#6B6680]">No saved tokenized payment instruments.</p>
            ) : (
              <div className="space-y-2">
                {paymentMethods.map((m) => (
                  <div key={String(m.id)} className="p-3 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-[#1F1647]">{String(m.provider)} · {String(m.method_type)}</p>
                      <p className="text-[#6B6680] font-mono-tabular">{String(m.masked_label)}</p>
                    </div>
                    {Boolean(m.is_default) && <StatusBadge label="Default" tone="info" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-7 card-surface p-6 space-y-5">
          <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#7C3AED]" /> Saved Delivery Addresses
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {addresses.map((a) => (
              <div key={String(a.id)} className="p-4 rounded-xl border border-[#E7E1F2] bg-[#F8F7FC] flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#7C3AED]">{String(a.label)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await accountApi.deleteAddress(String(a.id));
                        await loadAll();
                      }}
                      className="text-xs text-[#EF4444] hover:underline cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-sm font-bold text-[#1F1647] mt-1">{String(a.recipient_name)}</p>
                  <p className="text-xs text-[#6B6680] mt-0.5">
                    {String(a.line1)}, {String(a.city)}, {String(a.state)} - {String(a.postal_code)}
                  </p>
                </div>
                <p className="text-xs text-[#6B6680]">{String(a.phone)}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddAddress} className="pt-4 border-t border-[#E7E1F2] space-y-3">
            <p className="text-sm font-bold text-[#1F1647]">Add New Address</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input required placeholder="Label" value={addrForm.label} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
              <input required placeholder="Recipient Name" value={addrForm.recipientName} onChange={(e) => setAddrForm({ ...addrForm, recipientName: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
              <input required placeholder="Phone" value={addrForm.phone} onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            </div>
            <input required placeholder="Street Address" value={addrForm.line1} onChange={(e) => setAddrForm({ ...addrForm, line1: e.target.value })} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
            <div className="grid grid-cols-3 gap-3">
              <input required placeholder="City" value={addrForm.city} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
              <input required placeholder="State" value={addrForm.state} onChange={(e) => setAddrForm({ ...addrForm, state: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
              <input required maxLength={6} placeholder="6-digit PIN" value={addrForm.postalCode} onChange={(e) => setAddrForm({ ...addrForm, postalCode: e.target.value.replace(/\D/g, '') })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular" />
            </div>
            <Button type="submit" size="sm">Add Address</Button>
          </form>
        </section>
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const { refreshNotifications } = useCart();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await accountApi.notifications();
      setItems(res.notifications);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Inbox</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Notifications</h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await accountApi.markAllRead();
            await load();
            await refreshNotifications();
          }}
        >
          Mark All Read
        </Button>
      </div>

      {loading ? (
        <div className="card-surface h-40 animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell className="w-7 h-7" />} title="You are all caught up" description="Order confirmations, shipping milestones, and support replies appear here." />
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <div key={String(n.id)} className={`card-surface p-4 flex items-start justify-between gap-4 ${!n.read_at ? 'border-[#7C3AED]' : ''}`}>
              <div>
                <div className="flex items-center gap-2">
                  {!n.read_at && <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />}
                  <p className="text-sm font-bold text-[#1F1647]">{String(n.title)}</p>
                </div>
                <p className="text-sm text-[#6B6680] mt-1">{String(n.body)}</p>
                <p className="text-xs text-[#6B6680] mt-1.5">{new Date(String(n.created_at)).toLocaleString('en-IN')}</p>
              </div>
              {!n.read_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await accountApi.markRead(String(n.id));
                    await load();
                    await refreshNotifications();
                  }}
                >
                  Mark Read
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HelpPage() {
  const [articles, setArticles] = useState<{ id: string; category: string; question: string; answer: string }[]>([]);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async (query?: string) => {
    const res = await supportApi.articles(query);
    setArticles(res.articles);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="aurora-hero-gradient rounded-2xl p-6 sm:p-8 text-white">
        <p className="text-xs font-semibold text-[#A78BFA]">Help Center</p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-1">How Can We Help You Today?</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(q);
          }}
          className="mt-4 flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search returns, refunds, UPI payments, delivery..."
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-white text-[#211A35] text-sm"
            />
          </div>
          <Button type="submit" variant="coral">Search</Button>
        </form>
      </div>

      <div className="space-y-3">
        {articles.map((art) => {
          const open = openId === art.id;
          return (
            <div key={art.id} className="card-surface overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : art.id)}
                className="w-full p-5 flex items-center justify-between gap-4 text-left cursor-pointer"
              >
                <div>
                  <span className="text-xs font-semibold text-[#7C3AED]">{art.category}</span>
                  <h2 className="text-sm sm:text-base font-bold text-[#1F1647] mt-0.5">{art.question}</h2>
                </div>
                <ChevronDown className={`w-5 h-5 text-[#6B6680] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && <div className="px-5 pb-5 text-sm text-[#6B6680] leading-relaxed border-t border-[#E7E1F2] pt-3">{art.answer}</div>}
            </div>
          );
        })}
      </div>

      <div className="card-surface p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-8 h-8 text-[#7C3AED] shrink-0" />
          <div>
            <p className="text-sm font-bold text-[#1F1647]">Still need assistance?</p>
            <p className="text-xs text-[#6B6680]">Open a support ticket or ask our AI Support Agent directly.</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Link to="/support/tickets"><Button size="sm">Support Tickets</Button></Link>
          <Link to="/ai"><Button size="sm" variant="outline">Ask AI Support</Button></Link>
        </div>
      </div>
    </div>
  );
}

export function SupportTicketsPage() {
  const { pushToast } = useToast();
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'Delivery', priority: 'MEDIUM', message: '' });

  const load = async () => {
    const res = await supportApi.tickets();
    setTickets(res.tickets);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await supportApi.createTicket(form);
    setCreateOpen(false);
    setForm({ subject: '', category: 'Delivery', priority: 'MEDIUM', message: '' });
    pushToast({ variant: 'success', title: 'Support ticket created' });
    await load();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Customer Care</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Support Tickets</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New Ticket</Button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="w-7 h-7" />}
          title="No support tickets yet"
          description="Create a ticket anytime for delivery, warranty, or refund assistance."
          actionLabel="Create Support Ticket"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Link
              key={String(t.id)}
              to={`/support/tickets/${String(t.id)}`}
              className="card-surface card-surface-hover p-5 flex items-center justify-between gap-4 block"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-mono-tabular font-bold text-[#7C3AED]">{String(t.ticket_number)}</span>
                  <StatusBadge label={String(t.status)} tone={statusToneForOrder(String(t.status))} />
                </div>
                <p className="text-base font-bold text-[#1F1647] mt-1">{String(t.subject)}</p>
                <p className="text-xs text-[#6B6680] mt-0.5">
                  {String(t.category)} · Priority {String(t.priority)} · Updated {new Date(String(t.updated_at)).toLocaleDateString('en-IN')}
                </p>
              </div>
              <Button size="sm" variant="outline">View Thread</Button>
            </Link>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Open Support Ticket">
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            required
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm">
              <option value="Delivery">Delivery</option>
              <option value="Payments">Payments & Refunds</option>
              <option value="Returns">Returns & Warranty</option>
              <option value="Account">Account</option>
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <textarea
            required
            rows={4}
            placeholder="Describe how we can help..."
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <Button type="submit" className="w-full">Submit Ticket</Button>
        </form>
      </Modal>
    </div>
  );
}

export function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { pushToast } = useToast();
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const [reply, setReply] = useState('');

  const load = async () => {
    if (!id) return;
    const res = await supportApi.ticketDetail(id);
    setTicket(res.ticket);
    setMessages(res.messages);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !reply.trim()) return;
    await supportApi.replyTicket(id, reply.trim());
    setReply('');
    pushToast({ variant: 'success', title: 'Reply sent' });
    await load();
  };

  if (!ticket) {
    return <div className="max-w-4xl mx-auto px-4 py-10"><div className="card-surface h-48 animate-pulse" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-10 py-8 space-y-6">
      <div>
        <Link to="/support/tickets" className="text-xs font-semibold text-[#7C3AED] hover:underline">← All Tickets</Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-[#1F1647]">{String(ticket.subject)}</h1>
          <StatusBadge label={String(ticket.status)} tone={statusToneForOrder(String(ticket.status))} />
        </div>
        <p className="text-xs text-[#6B6680] mt-1 font-mono-tabular">
          {String(ticket.ticket_number)} · {String(ticket.category)}
        </p>
      </div>

      <div className="card-surface p-6 space-y-4">
        {messages.map((m) => (
          <div key={String(m.id)} className={`p-4 rounded-xl border ${m.sender_role === 'CUSTOMER' ? 'bg-[#F8F7FC] border-[#E7E1F2]' : 'bg-violet-50/60 border-violet-200'}`}>
            <div className="flex items-center justify-between text-xs text-[#6B6680]">
              <span className="font-bold text-[#1F1647]">
                {String(m.sender_name || m.sender_role)} ({String(m.sender_role)})
              </span>
              <span>{new Date(String(m.created_at)).toLocaleString('en-IN')}</span>
            </div>
            <p className="text-sm text-[#211A35] mt-1.5 whitespace-pre-wrap">{String(m.body)}</p>
          </div>
        ))}

        <form onSubmit={sendReply} className="pt-3 border-t border-[#E7E1F2] flex gap-2.5">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply..."
            className="flex-1 h-11 px-4 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <Button type="submit">
            <Send className="w-4 h-4" /> Send
          </Button>
        </form>
      </div>
    </div>
  );
}
