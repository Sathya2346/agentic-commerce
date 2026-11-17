import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Lock,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Modal,
  ProductImage,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { accountApi, ApiError, checkoutApi, ordersApi } from '../../services/api';
import { formatINR } from '../../domain/commercePolicy';

export function CartPage() {
  const { user } = useAuth();
  const { cart, updateQuantity, removeItem } = useCart();
  const navigate = useNavigate();

  const handleCheckout = () => {
    if (!user) {
      navigate('/login', { state: { from: '/checkout' } });
    } else {
      navigate('/checkout');
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold text-[#7C3AED]">Shopping Bag</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">
          Your Cart ({cart.itemCount})
        </h1>
      </div>

      {cart.items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-7 h-7" />}
          title="Your shopping cart is empty"
          description="Explore our catalog or ask our AI Shopping Assistant to recommend verified tech within your budget."
          actionLabel="Explore Catalog"
          onAction={() => navigate('/shop')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-4">
            {cart.items.map((item) => (
              <div key={item.id} className="card-surface p-4 sm:p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <Link to={`/products/${item.slug}`} className="w-24 h-24 rounded-xl overflow-hidden bg-[#F3F0FA] shrink-0">
                  <ProductImage src={item.imageUrl} alt={item.name} />
                </Link>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#6B6680] font-medium">
                    {item.brand} · {item.variantTitle}
                  </p>
                  <Link to={`/products/${item.slug}`} className="text-base font-bold text-[#1F1647] hover:text-[#7C3AED] mt-0.5 block">
                    {item.name}
                  </Link>
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <span className="font-semibold text-[#1F1647] tabular-nums">
                      {formatINR(item.unitPricePaise)} each
                    </span>
                    <span className={item.inStock ? 'text-[#10B981] font-medium' : 'text-[#EF4444] font-semibold'}>
                      {item.inStock ? `${item.availableToSell} available` : 'Insufficient stock'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                  <div className="inline-flex items-center border border-[#E7E1F2] rounded-xl bg-white h-10">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.name}`}
                      disabled={item.quantity <= 1}
                      onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                      className="w-9 h-full flex items-center justify-center disabled:opacity-40 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.name}`}
                      disabled={item.quantity >= Math.min(10, item.availableToSell)}
                      onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                      className="w-9 h-full flex items-center justify-center disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-base font-bold text-[#1F1647] tabular-nums min-w-[90px] text-right">
                    {formatINR(item.lineTotalPaise)}
                  </p>

                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => void removeItem(item.id)}
                    className="p-2 rounded-xl text-[#6B6680] hover:text-[#EF4444] hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <aside className="lg:col-span-4 card-surface p-6 space-y-4 sticky top-24">
            <h2 className="text-lg font-bold text-[#1F1647]">Order Summary</h2>
            <div className="space-y-2.5 text-sm border-b border-[#E7E1F2] pb-4">
              <div className="flex justify-between">
                <span className="text-[#6B6680]">Subtotal</span>
                <span className="font-semibold tabular-nums">{formatINR(cart.subtotalPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B6680]">Standard Shipping</span>
                <span className="font-semibold text-[#10B981] tabular-nums">
                  {cart.shippingPaise === 0 ? 'FREE' : formatINR(cart.shippingPaise)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B6680]">Estimated GST (18% incl.)</span>
                <span className="font-semibold tabular-nums">{formatINR(cart.taxPaise)}</span>
              </div>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-base font-bold text-[#1F1647]">Estimated Total</span>
              <span className="text-2xl font-bold text-[#7C3AED] tabular-nums">{formatINR(cart.grandTotalPaise)}</span>
            </div>
            <p className="text-xs text-[#6B6680]">
              Apply coupons like <span className="font-mono-tabular font-semibold text-[#1F1647]">WELCOME10</span> or{' '}
              <span className="font-mono-tabular font-semibold text-[#1F1647]">TECH2000</span> at checkout.
            </p>
            <Button size="lg" className="w-full" onClick={handleCheckout}>
              {user ? 'Proceed to Checkout' : 'Sign In & Checkout'}
              <ArrowRight className="w-4 h-4" />
            </Button>
            {!user && (
              <p className="text-xs text-center text-[#6B6680]">
                Your cart items will automatically merge into your account after signing in.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function CheckoutPage() {
  const { cart, refreshCart, refreshNotifications } = useCart();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<Record<string, unknown>[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [shippingMethod, setShippingMethod] = useState<'STANDARD' | 'EXPRESS'>('STANDARD');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'COD'>('UPI');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [notes, setNotes] = useState('');

  const [quote, setQuote] = useState<{
    quoteId: string;
    subtotalPaise: number;
    discountPaise: number;
    shippingPaise: number;
    taxPaise: number;
    grandTotalPaise: number;
    appliedCouponCode: string | null;
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add Address Modal
  const [addrModalOpen, setAddrModalOpen] = useState(false);
  const [newAddr, setNewAddr] = useState({
    label: 'Home',
    recipientName: '',
    phone: '',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    isDefault: true,
  });

  // Payment Gateway Modal (invokes real signed webhook pipeline on backend)
  const [pendingPay, setPendingPay] = useState<{
    orderId: string;
    orderNumber: string;
    paymentId: string;
    providerReference: string;
    amountPaise: number;
  } | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `idem_${crypto.randomUUID()}`);

  const loadAddresses = async () => {
    const res = await accountApi.addresses();
    setAddresses(res.addresses);
    if (res.addresses.length > 0 && !selectedAddressId) {
      setSelectedAddressId(String(res.addresses[0].id));
    }
  };

  const fetchQuote = async (couponOverride?: string) => {
    setQuoteError(null);
    try {
      const qRes = await checkoutApi.quote({
        addressId: selectedAddressId || undefined,
        shippingMethod,
        couponCode: (couponOverride !== undefined ? couponOverride : appliedCoupon) || undefined,
      });
      setQuote(qRes);
      setIdempotencyKey(`idem_${crypto.randomUUID()}`);
    } catch (err) {
      setQuoteError(err instanceof ApiError ? err.message : 'Unable to generate checkout quote.');
    }
  };

  useEffect(() => {
    void loadAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cart.items.length > 0) {
      void fetchQuote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.items.length, shippingMethod, selectedAddressId, appliedCoupon]);

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await accountApi.addAddress(newAddr);
      await loadAddresses();
      setSelectedAddressId(String(res.address.id));
      setAddrModalOpen(false);
      pushToast({ variant: 'success', title: 'Address added' });
    } catch (err) {
      pushToast({ variant: 'error', title: 'Invalid address', description: err instanceof Error ? err.message : 'Check fields.' });
    }
  };

  const handlePlaceOrder = async () => {
    if (!quote || !selectedAddressId) {
      pushToast({ variant: 'warning', title: 'Select a delivery address first' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await checkoutApi.submit(
        {
          quoteId: quote.quoteId,
          addressId: selectedAddressId,
          paymentMethod,
          notes,
        },
        idempotencyKey
      );
      setPendingPay({
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        paymentId: res.paymentId,
        providerReference: res.providerReference,
        amountPaise: res.amountPaise,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Checkout failed.';
      pushToast({ variant: 'error', title: 'Checkout Conflict', description: msg });
      // Refresh authoritative quote if prices or stock changed
      await refreshCart();
      await fetchQuote();
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentOutcome = async (outcome: 'SUCCESS' | 'FAIL' | 'TIMEOUT') => {
    if (!pendingPay) return;
    setAuthorizing(true);
    try {
      const res = await checkoutApi.authorizePayment(pendingPay.paymentId, outcome);
      await refreshCart();
      await refreshNotifications();
      if (outcome === 'SUCCESS') {
        setPendingPay(null);
        navigate(`/orders/success/${res.orderId}`);
      } else {
        pushToast({
          variant: outcome === 'TIMEOUT' ? 'warning' : 'error',
          title: outcome === 'TIMEOUT' ? 'Gateway Timeout (Reconciling)' : 'Payment Declined',
          description: res.message || `Order status: ${res.orderStatus}`,
        });
        setPendingPay(null);
        navigate(`/orders/${res.orderId}`);
      }
    } catch (err) {
      pushToast({ variant: 'error', title: 'Payment Verification Error', description: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setAuthorizing(false);
    }
  };

  if (cart.items.length === 0 && !pendingPay) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-12">
        <EmptyState
          icon={<ShoppingBag className="w-7 h-7" />}
          title="Nothing in your cart to check out"
          description="Add products to your cart before starting checkout."
          actionLabel="Browse Products"
          onAction={() => navigate('/shop')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Authoritative Checkout</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647] mt-0.5">Review & Pay</h1>
        </div>
        <div className="text-xs font-semibold text-[#6B6680] flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-[#10B981]" />
          Server-verified INR pricing & atomic inventory lock
        </div>
      </div>

      {quoteError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{quoteError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* 1. Delivery Address */}
          <section className="card-surface p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#7C3AED]" /> 1. Delivery Address
              </h2>
              <Button size="sm" variant="outline" onClick={() => setAddrModalOpen(true)}>
                + Add Address
              </Button>
            </div>

            {addresses.length === 0 ? (
              <p className="text-sm text-[#6B6680]">No saved addresses yet. Add a delivery address to continue.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {addresses.map((addr) => {
                  const id = String(addr.id);
                  const active = selectedAddressId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedAddressId(id)}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        active ? 'border-[#7C3AED] bg-[#F3F0FA]/60' : 'border-[#E7E1F2] bg-white hover:border-[#7C3AED]/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#7C3AED] uppercase">{String(addr.label)}</span>
                        {active && <CheckCircle2 className="w-4 h-4 text-[#7C3AED]" />}
                      </div>
                      <p className="text-sm font-bold text-[#1F1647] mt-1">{String(addr.recipient_name)}</p>
                      <p className="text-xs text-[#6B6680] mt-0.5">
                        {String(addr.line1)}, {String(addr.city)}, {String(addr.state)} - {String(addr.postal_code)}
                      </p>
                      <p className="text-xs text-[#6B6680] mt-1">{String(addr.phone)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Delivery Method */}
          <section className="card-surface p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
              <Truck className="w-5 h-5 text-[#7C3AED]" /> 2. Delivery Speed
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: 'STANDARD', title: 'Standard Delivery', desc: '2–4 business days · Free ₹999+', fee: '₹0 / ₹99' },
                { id: 'EXPRESS', title: 'Express Priority Air', desc: 'Next business day by 6 PM', fee: '₹249' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setShippingMethod(opt.id as 'STANDARD' | 'EXPRESS')}
                  className={`p-4 rounded-xl border text-left cursor-pointer ${
                    shippingMethod === opt.id ? 'border-[#7C3AED] bg-[#F3F0FA]/60' : 'border-[#E7E1F2] bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#1F1647]">{opt.title}</span>
                    <span className="text-xs font-bold text-[#7C3AED]">{opt.fee}</span>
                  </div>
                  <p className="text-xs text-[#6B6680] mt-1">{opt.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* 3. Payment Method */}
          <section className="card-surface p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#1F1647] flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#7C3AED]" /> 3. Payment Method
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[
                { id: 'UPI', label: 'UPI / GPay / PhonePe' },
                { id: 'CARD', label: 'Credit / Debit Card' },
                { id: 'NETBANKING', label: 'NetBanking' },
                { id: 'WALLET', label: 'Aurora Wallet' },
                { id: 'COD', label: 'Cash on Delivery' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMethod(m.id as typeof paymentMethod)}
                  className={`p-3 rounded-xl border text-xs font-semibold text-left cursor-pointer ${
                    paymentMethod === m.id ? 'border-[#7C3AED] bg-[#F3F0FA] text-[#7C3AED]' : 'border-[#E7E1F2] bg-white text-[#211A35]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6680] mb-1.5">Delivery Instructions (Optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Call upon arrival at gate..."
                className="w-full h-10 px-3.5 rounded-xl border border-[#E7E1F2] text-sm"
              />
            </div>
          </section>
        </div>

        {/* Right Authoritative Summary */}
        <aside className="lg:col-span-4 card-surface p-6 space-y-5 sticky top-24">
          <h2 className="text-lg font-bold text-[#1F1647]">Authoritative Quote</h2>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {cart.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-[#211A35]">
                  {i.name} × {i.quantity}
                </span>
                <span className="font-semibold tabular-nums shrink-0">{formatINR(i.lineTotalPaise)}</span>
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedCoupon(couponInput.trim());
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Tag className="w-3.5 h-3.5 text-[#6B6680] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Coupon (WELCOME10)"
                className="w-full h-9 pl-8 pr-2.5 rounded-xl border border-[#E7E1F2] text-xs font-mono-tabular uppercase"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
          </form>

          {quote && (
            <div className="space-y-2 text-sm border-t border-b border-[#E7E1F2] py-4">
              <div className="flex justify-between">
                <span className="text-[#6B6680]">Subtotal</span>
                <span className="font-semibold tabular-nums">{formatINR(quote.subtotalPaise)}</span>
              </div>
              {quote.discountPaise > 0 && (
                <div className="flex justify-between text-[#10B981]">
                  <span>Coupon ({quote.appliedCouponCode})</span>
                  <span className="font-semibold tabular-nums">-{formatINR(quote.discountPaise)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#6B6680]">Shipping ({shippingMethod})</span>
                <span className="font-semibold tabular-nums">
                  {quote.shippingPaise === 0 ? 'FREE' : formatINR(quote.shippingPaise)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B6680]">GST (18% incl.)</span>
                <span className="font-semibold tabular-nums">{formatINR(quote.taxPaise)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#E7E1F2] text-base font-bold text-[#1F1647]">
                <span>Total Payable</span>
                <span className="text-xl text-[#7C3AED] tabular-nums">{formatINR(quote.grandTotalPaise)}</span>
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={submitting || !quote || !selectedAddressId}
            onClick={handlePlaceOrder}
          >
            <ShieldCheck className="w-4 h-4" />
            {submitting ? 'Reserving Stock...' : 'Place Order & Verify Payment'}
          </Button>
        </aside>
      </div>

      {/* Add Address Modal */}
      <Modal open={addrModalOpen} onClose={() => setAddrModalOpen(false)} title="Add Delivery Address">
        <form onSubmit={handleSaveAddress} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Label (Home / Office)"
              value={newAddr.label}
              onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })}
              className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
            />
            <input
              required
              placeholder="Recipient Name"
              value={newAddr.recipientName}
              onChange={(e) => setNewAddr({ ...newAddr, recipientName: e.target.value })}
              className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
            />
          </div>
          <input
            required
            placeholder="Phone (+91 ...)"
            value={newAddr.phone}
            onChange={(e) => setNewAddr({ ...newAddr, phone: e.target.value })}
            className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <input
            required
            placeholder="Street Address Line 1"
            value={newAddr.line1}
            onChange={(e) => setNewAddr({ ...newAddr, line1: e.target.value })}
            className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              required
              placeholder="City"
              value={newAddr.city}
              onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
              className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
            />
            <input
              required
              placeholder="State"
              value={newAddr.state}
              onChange={(e) => setNewAddr({ ...newAddr, state: e.target.value })}
              className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
            />
            <input
              required
              maxLength={6}
              placeholder="PIN (6 digits)"
              value={newAddr.postalCode}
              onChange={(e) => setNewAddr({ ...newAddr, postalCode: e.target.value.replace(/\D/g, '') })}
              className="h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular"
            />
          </div>
          <Button type="submit" className="w-full">Save Address</Button>
        </form>
      </Modal>

      {/* Authoritative Payment Gateway Authorization Modal */}
      <Modal
        open={Boolean(pendingPay)}
        onClose={() => {}}
        title="AuroraPay Gateway Authorization"
      >
        {pendingPay && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] space-y-1">
              <p className="text-xs text-[#6B6680]">
                Order <span className="font-mono-tabular font-bold text-[#1F1647]">#{pendingPay.orderNumber}</span>
              </p>
              <p className="text-2xl font-bold text-[#7C3AED] tabular-nums">{formatINR(pendingPay.amountPaise)}</p>
              <p className="text-xs font-mono-tabular text-[#6B6680]">Ref: {pendingPay.providerReference}</p>
            </div>
            <p className="text-sm text-[#6B6680]">
              Inventory has been atomically reserved. Complete payment verification using the HMAC-signed provider webhook flow:
            </p>
            <div className="space-y-2.5">
              <Button
                size="lg"
                className="w-full"
                disabled={authorizing}
                onClick={() => void handlePaymentOutcome('SUCCESS')}
              >
                <CheckCircle2 className="w-4 h-4" />
                {authorizing ? 'Verifying Signature...' : 'Authorize & Confirm Payment'}
              </Button>
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={authorizing}
                  onClick={() => void handlePaymentOutcome('FAIL')}
                >
                  Simulate Declined
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={authorizing}
                  onClick={() => void handlePaymentOutcome('TIMEOUT')}
                >
                  Simulate Timeout
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function OrderSuccessPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (orderId) {
      ordersApi.detail(orderId).then((res) => setOrder(res.order)).catch(() => {});
    }
  }, [orderId]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="card-surface p-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-[#10B981] flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <div>
          <p className="text-xs font-semibold text-[#10B981] uppercase">Payment Verified & Confirmed</p>
          <h1 className="text-3xl font-bold text-[#1F1647] mt-1">Thank You for Your Order!</h1>
          {order && (
            <p className="text-sm text-[#6B6680] mt-2">
              Order <span className="font-mono-tabular font-bold text-[#1F1647]">#{String(order.order_number)}</span> ·{' '}
              <span className="font-bold text-[#7C3AED] tabular-nums">{formatINR(Number(order.grand_total_paise))}</span>
            </p>
          )}
        </div>

        {order && (
          <div className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] text-left flex items-center justify-between">
            <div>
              <p className="text-xs text-[#6B6680]">Current Fulfillment State</p>
              <p className="text-sm font-bold text-[#1F1647] mt-0.5">
                {String((order.shipment as Record<string, unknown> | null)?.carrier || 'Delhivery Air')} ·{' '}
                {String((order.shipment as Record<string, unknown> | null)?.estimated_delivery || '2–4 business days')}
              </p>
            </div>
            <StatusBadge label={String(order.status)} tone={statusToneForOrder(String(order.status))} />
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link
            to={orderId ? `/orders/${orderId}` : '/orders'}
            className="inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 h-11 px-5 text-sm bg-[#7C3AED] text-white hover:bg-[#6D28D9] shadow-sm whitespace-nowrap"
          >
            Track Order & Timeline
          </Link>
          <Link
            to="/shop"
            className="inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 h-11 px-5 text-sm bg-white border border-[#E7E1F2] text-[#211A35] hover:border-[#7C3AED] hover:text-[#7C3AED] whitespace-nowrap"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
