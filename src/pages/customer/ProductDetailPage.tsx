import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Bot,
  CheckCircle2,
  Heart,
  MapPin,
  Minus,
  Plus,
  ShoppingCart,
  Star,
  Truck,
  Zap,
} from 'lucide-react';
import {
  Button,
  ErrorState,
  Modal,
  ProductImage,
  SkeletonCard,
  StatusBadge,
} from '../../components/ui/DesignSystem';
import { catalogApi, type ProductDto } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../domain/commercePolicy';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToCart, toggleWishlist, toggleCompare, wishlistIds, compareSlugs } = useCart();
  const { pushToast } = useToast();

  const [product, setProduct] = useState<ProductDto | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<'overview' | 'specs' | 'reviews'>('overview');

  const [pinCode, setPinCode] = useState('600040');
  const [serviceability, setServiceability] = useState<{
    serviceable: boolean;
    expressAvailable: boolean;
    standardEta: string;
    expressEta: string;
  } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const [revRating, setRevRating] = useState(5);
  const [revTitle, setRevTitle] = useState('');
  const [revComment, setRevComment] = useState('');
  const [submittingRev, setSubmittingRev] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProduct = async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const res = await catalogApi.productDetail(slug);
      setProduct(res.product);
      setSelectedVariantId(res.product.variants[0]?.id || '');
      setActiveImage(res.product.images?.[0]?.url || res.product.imageUrl || null);
      setQuantity(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Product not found.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const selectedVariant = product?.variants.find((v) => v.id === selectedVariantId) || product?.variants[0];
  const available = selectedVariant?.availableToSell ?? 0;

  const checkPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    try {
      const res = await catalogApi.serviceability(pinCode);
      setServiceability(res);
    } catch (err) {
      setServiceability(null);
      setPinError(err instanceof Error ? err.message : 'Invalid PIN code');
    }
  };

  const handleAdd = async (goCheckout = false) => {
    if (!product || !selectedVariant) return;
    const ok = await addToCart({
      variantId: selectedVariant.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      variantTitle: selectedVariant.title,
      sku: selectedVariant.sku,
      imageUrl: product.images?.[0]?.url || product.imageUrl,
      unitPricePaise: selectedVariant.pricePaise,
      mrpPaise: selectedVariant.mrpPaise,
      quantity,
      availableToSell: selectedVariant.availableToSell,
    });
    if (ok && goCheckout) {
      navigate(user ? '/checkout' : '/cart');
    }
  };

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setSubmittingRev(true);
    try {
      await catalogApi.addReview(product.id, { rating: revRating, title: revTitle, comment: revComment });
      setRevTitle('');
      setRevComment('');
      pushToast({ variant: 'success', title: 'Review published', description: 'Thank you for sharing your verified feedback.' });
      await loadProduct();
    } catch (err) {
      pushToast({ variant: 'error', title: 'Unable to submit review', description: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setSubmittingRev(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error || !product || !selectedVariant) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-12">
        <ErrorState message={error || 'Product could not be loaded.'} onRetry={() => void loadProduct()} />
      </div>
    );
  }

  const discountPct =
    selectedVariant.mrpPaise > selectedVariant.pricePaise
      ? Math.round(((selectedVariant.mrpPaise - selectedVariant.pricePaise) / selectedVariant.mrpPaise) * 100)
      : 0;

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-10">
      <nav aria-label="Breadcrumb" className="text-xs text-[#6B6680] flex items-center gap-2 flex-wrap">
        <Link to="/" className="hover:text-[#7C3AED]">Home</Link>
        <span>/</span>
        <Link to={`/categories/${product.categorySlug}`} className="hover:text-[#7C3AED]">{product.categoryName}</Link>
        <span>/</span>
        <span className="text-[#1F1647] font-semibold truncate">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Image Gallery */}
        <div className="lg:col-span-6 space-y-3">
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="w-full h-[340px] sm:h-[440px] card-surface overflow-hidden block cursor-zoom-in"
            aria-label={`Zoom image of ${product.name}`}
          >
            <ProductImage src={activeImage} alt={product.name} className="w-full h-full object-cover" />
          </button>
          {product.images && product.images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto">
              {product.images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActiveImage(img.url)}
                  className={`w-20 h-20 rounded-xl overflow-hidden border-2 shrink-0 cursor-pointer ${
                    activeImage === img.url ? 'border-[#7C3AED]' : 'border-[#E7E1F2]'
                  }`}
                >
                  <ProductImage src={img.url} alt={img.alt_text} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Purchase Panel */}
        <div className="lg:col-span-6 card-surface p-6 sm:p-8 space-y-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#7C3AED]">
                {product.brand} · SKU <span className="font-mono-tabular">{selectedVariant.sku}</span>
              </p>
              <StatusBadge
                label={available <= 0 ? 'Out of Stock' : available <= 5 ? `Only ${available} left` : `${available} in stock`}
                tone={available <= 0 ? 'danger' : available <= 5 ? 'warning' : 'success'}
              />
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-[#1F1647]">{product.name}</h1>
            <p className="mt-2 text-sm text-[#6B6680]">{product.shortDescription}</p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 font-bold text-[#1F1647]">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                {product.rating.toFixed(1)}
              </span>
              <span className="text-[#6B6680]">({product.reviewCount.toLocaleString('en-IN')} verified reviews)</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F8F7FC] border border-[#E7E1F2]">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-bold text-[#1F1647] tabular-nums">{formatINR(selectedVariant.pricePaise)}</span>
              {discountPct > 0 && (
                <>
                  <span className="text-base text-[#6B6680] line-through tabular-nums">{formatINR(selectedVariant.mrpPaise)}</span>
                  <span className="text-sm font-bold text-[#10B981]">{discountPct}% off</span>
                </>
              )}
            </div>
            <p className="text-xs text-[#6B6680] mt-1">Inclusive of all taxes (18% GST). Authoritative INR pricing.</p>
          </div>

          {/* Variants */}
          {product.variants.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#1F1647] mb-2">Configuration / Variant</p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(v.id);
                      setQuantity(1);
                    }}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                      v.id === selectedVariant.id
                        ? 'border-[#7C3AED] bg-[#F3F0FA] text-[#7C3AED]'
                        : 'border-[#E7E1F2] bg-white text-[#211A35] hover:border-[#7C3AED]/50'
                    }`}
                  >
                    {v.title} · {formatINR(v.pricePaise)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity & Action Buttons */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center border border-[#E7E1F2] rounded-xl bg-white h-11">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-10 h-full flex items-center justify-center text-[#211A35] disabled:opacity-40 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center text-sm font-bold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  disabled={quantity >= Math.min(10, available)}
                  onClick={() => setQuantity((q) => Math.min(10, available, q + 1))}
                  className="w-10 h-full flex items-center justify-center text-[#211A35] disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <Button
                className="flex-1"
                disabled={available <= 0}
                onClick={() => void handleAdd(false)}
              >
                <ShoppingCart className="w-4 h-4" />
                {available <= 0 ? 'Out of Stock' : 'Add to Cart'}
              </Button>

              <Button
                variant="coral"
                disabled={available <= 0}
                onClick={() => void handleAdd(true)}
              >
                <Zap className="w-4 h-4" /> Buy Now
              </Button>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void toggleWishlist(product.id, product.name)}
              >
                <Heart className={`w-4 h-4 ${wishlistIds.has(product.id) ? 'fill-[#FF6B6B] text-[#FF6B6B]' : ''}`} />
                {wishlistIds.has(product.id) ? 'Saved in Wishlist' : 'Save to Wishlist'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggleCompare(product.slug, product.name)}
              >
                <ArrowLeftRight className="w-4 h-4" />
                {compareSlugs.includes(product.slug) ? 'In Compare' : 'Compare'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/ai?prompt=${encodeURIComponent(`Tell me pros, cons, and live stock for ${product.name}`)}`)}
              >
                <Bot className="w-4 h-4" /> Ask AI About This
              </Button>
            </div>
          </div>

          {/* PIN Code Serviceability */}
          <div className="pt-4 border-t border-[#E7E1F2]">
            <p className="text-xs font-bold text-[#1F1647] mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#7C3AED]" /> Check Delivery & PIN Serviceability
            </p>
            <form onSubmit={checkPin} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit PIN (e.g. 600040)"
                className="flex-1 h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular"
              />
              <Button type="submit" size="sm" variant="outline">
                Check
              </Button>
            </form>
            {pinError && <p className="text-xs text-[#EF4444] mt-1.5">{pinError}</p>}
            {serviceability && (
              <div className="mt-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" />
                  {serviceability.serviceable ? `Deliverable to ${pinCode}` : `Currently unserviceable at ${pinCode}`}
                </p>
                {serviceability.serviceable && (
                  <p>
                    Standard: {serviceability.standardEta} · Express: {serviceability.expressEta}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs: Overview / Specs / Reviews */}
      <div className="card-surface overflow-hidden">
        <div className="border-b border-[#E7E1F2] px-6 flex gap-6 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'specs', label: 'Technical Specifications' },
            { id: 'reviews', label: `Verified Reviews (${product.reviews?.length || 0})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-4 text-sm font-semibold border-b-2 whitespace-nowrap cursor-pointer ${
                activeTab === tab.id ? 'border-[#7C3AED] text-[#7C3AED]' : 'border-transparent text-[#6B6680] hover:text-[#211A35]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 sm:p-8">
          {activeTab === 'overview' && (
            <div className="max-w-3xl space-y-4">
              <h2 className="text-lg font-bold text-[#1F1647]">Product Highlights</h2>
              <p className="text-sm text-[#211A35] leading-relaxed">{product.description}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {Object.entries(product.specs || {}).slice(0, 4).map(([k, v]) => (
                  <div key={k} className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2]">
                    <p className="text-xs text-[#6B6680]">{k}</p>
                    <p className="text-sm font-semibold text-[#1F1647] mt-0.5">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'specs' && (
            <div className="max-w-2xl divide-y divide-[#E7E1F2] border border-[#E7E1F2] rounded-xl overflow-hidden">
              {Object.entries(product.specs || {}).map(([k, v]) => (
                <div key={k} className="grid grid-cols-2 p-3.5 text-sm bg-white">
                  <span className="font-semibold text-[#6B6680]">{k}</span>
                  <span className="text-[#1F1647] font-medium">{v}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 space-y-4">
                {(product.reviews || []).length === 0 ? (
                  <p className="text-sm text-[#6B6680]">No written reviews yet. Be the first verified customer to review this item.</p>
                ) : (
                  product.reviews!.map((rev) => (
                    <div key={rev.id} className="p-4 rounded-xl border border-[#E7E1F2] bg-[#F8F7FC]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[#1F1647]">{rev.title}</p>
                        <span className="text-xs font-bold text-amber-600">{rev.rating}★</span>
                      </div>
                      <p className="text-sm text-[#211A35] mt-1.5">{rev.comment}</p>
                      <p className="text-xs text-[#6B6680] mt-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                        {rev.author_name} · {new Date(rev.created_at).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="lg:col-span-5">
                <div className="p-5 rounded-2xl border border-[#E7E1F2] bg-white">
                  <h3 className="text-base font-bold text-[#1F1647]">Write a Review</h3>
                  {user ? (
                    <form onSubmit={submitReview} className="mt-4 space-y-3">
                      <div>
                        <label className="block text-xs font-semibold mb-1">Rating</label>
                        <select
                          value={revRating}
                          onChange={(e) => setRevRating(Number(e.target.value))}
                          className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
                        >
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>{n} Stars</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Review Title</label>
                        <input
                          type="text"
                          required
                          value={revTitle}
                          onChange={(e) => setRevTitle(e.target.value)}
                          placeholder="Great performance & battery"
                          className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Comment</label>
                        <textarea
                          rows={3}
                          required
                          value={revComment}
                          onChange={(e) => setRevComment(e.target.value)}
                          placeholder="Share how you use this device..."
                          className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm"
                        />
                      </div>
                      <Button type="submit" disabled={submittingRev} className="w-full">
                        {submittingRev ? 'Publishing...' : 'Submit Review'}
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm text-[#6B6680] mt-2">
                      <Link to="/login" className="text-[#7C3AED] font-semibold hover:underline">Sign in</Link> to publish a verified product review.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Related Products */}
      {product.related && product.related.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-[#1F1647] mb-4">Related Products</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {product.related.map((rel) => (
              <Link key={rel.id} to={`/products/${rel.slug}`} className="card-surface card-surface-hover overflow-hidden flex flex-col">
                <div className="h-40 bg-[#F3F0FA]">
                  <ProductImage src={rel.image_url} alt={rel.name} />
                </div>
                <div className="p-4">
                  <p className="text-xs text-[#6B6680]">{rel.brand}</p>
                  <p className="text-sm font-bold text-[#1F1647] mt-0.5 line-clamp-1">{rel.name}</p>
                  <p className="text-base font-bold text-[#7C3AED] mt-2 tabular-nums">{formatINR(rel.price_paise)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Modal open={lightboxOpen} onClose={() => setLightboxOpen(false)} title={product.name} maxWidth="max-w-3xl">
        <div className="h-[60vh] rounded-xl overflow-hidden bg-[#F3F0FA]">
          <ProductImage src={activeImage} alt={product.name} className="w-full h-full object-contain" />
        </div>
      </Modal>
    </div>
  );
}
