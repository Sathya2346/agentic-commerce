import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeftRight, Heart, Package, ShoppingCart, Star, X } from 'lucide-react';
import { formatINR } from '../../domain/commercePolicy';
import type { ProductDto } from '../../services/api';

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg width="32" height="32" viewBox="0 0 36 36" fill="none" aria-hidden="true" className="shrink-0">
        <defs>
          <linearGradient id="ac_logo_grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        <rect width="36" height="36" rx="10" fill={light ? '#FFFFFF' : 'url(#ac_logo_grad)'} />
        <path
          d="M12.5 13.5C9.7 13.5 7.5 15.5 7.5 18C7.5 20.5 9.7 22.5 12.5 22.5C15.8 22.5 18 18 18 18C18 18 20.2 13.5 23.5 13.5C26.3 13.5 28.5 15.5 28.5 18C28.5 20.5 26.3 22.5 23.5 22.5C20.2 22.5 18 18 18 18C18 18 15.8 13.5 12.5 13.5Z"
          stroke={light ? '#7C3AED' : '#FFFFFF'}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`${compact ? 'text-[15px]' : 'text-lg'} font-bold tracking-tight ${light ? 'text-white' : 'text-[#1F1647]'}`}>
        Agentic Commerce
      </span>
    </span>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'coral' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer';
  const sizes = {
    sm: 'h-9 px-3.5 text-xs',
    md: 'h-11 px-5 text-sm',
    lg: 'h-12 px-6 text-sm',
  };
  const variants = {
    primary: 'bg-[#7C3AED] text-white hover:bg-[#6D28D9] shadow-sm',
    secondary: 'bg-[#F3F0FA] text-[#5B21B6] hover:bg-[#EDE9FE]',
    coral: 'bg-[#FF6B6B] text-white hover:bg-[#F05252] shadow-sm',
    outline: 'bg-white border border-[#E7E1F2] text-[#211A35] hover:bg-[#F8F7FC]',
    ghost: 'bg-transparent text-[#6B6680] hover:text-[#211A35] hover:bg-[#F3F0FA]',
    danger: 'bg-[#EF4444] text-white hover:bg-[#DC2626]',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}) {
  const styles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-violet-50 text-violet-700 border-violet-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

export function statusToneForOrder(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['CONFIRMED', 'DELIVERED', 'PAID', 'COMPLETED', 'ACTIVE', 'PUBLISHED', 'RESOLVED'].includes(status)) return 'success';
  if (['PENDING_PAYMENT', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'PENDING', 'RUNNING', 'WAITING_FOR_USER'].includes(status)) return 'info';
  if (['RETURN_REQUESTED', 'RETURN_APPROVED', 'LOW_STOCK', 'UNKNOWN'].includes(status)) return 'warning';
  if (['CANCELLED', 'FAILED', 'REFUNDED', 'SUSPENDED', 'ARCHIVED', 'OUT_OF_STOCK'].includes(status)) return 'danger';
  return 'neutral';
}

export function ProductImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#F3F0FA] to-[#E7E1F2] flex flex-col items-center justify-center text-[#6B6680] p-4 text-center">
        <Package className="w-8 h-8 mb-1 text-[#7C3AED]/60" />
        <span className="text-xs font-medium line-clamp-2">{alt}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={className} />;
}

export function ProductCard({
  product,
  inWishlist,
  inCompare,
  onAddToCart,
  onToggleWishlist,
  onToggleCompare,
}: {
  product: ProductDto;
  inWishlist: boolean;
  inCompare: boolean;
  onAddToCart: (p: ProductDto) => void;
  onToggleWishlist: (p: ProductDto) => void;
  onToggleCompare: (p: ProductDto) => void;
}) {
  const discountPct =
    product.mrpPaise > product.pricePaise
      ? Math.round(((product.mrpPaise - product.pricePaise) / product.mrpPaise) * 100)
      : 0;
  const outOfStock = product.availableToSell <= 0;

  return (
    <article className="card-surface card-surface-hover flex flex-col overflow-hidden group">
      <div className="relative h-48 bg-[#F3F0FA] overflow-hidden">
        <Link to={`/products/${product.slug}`} className="block w-full h-full">
          <ProductImage
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </Link>
        {product.badge && (
          <span className="absolute top-3 left-3 bg-[#1F1647]/90 text-white text-[11px] font-semibold px-2.5 py-1 rounded-md">
            {product.badge}
          </span>
        )}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onToggleWishlist(product)}
            aria-label={inWishlist ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors cursor-pointer ${
              inWishlist
                ? 'bg-[#FF6B6B] text-white border-[#FF6B6B]'
                : 'bg-white/95 text-[#211A35] border-[#E7E1F2] hover:border-[#7C3AED]'
            }`}
          >
            <Heart className={`w-4 h-4 ${inWishlist ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onToggleCompare(product)}
            aria-label={inCompare ? `Remove ${product.name} from compare` : `Compare ${product.name}`}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors cursor-pointer ${
              inCompare
                ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                : 'bg-white/95 text-[#211A35] border-[#E7E1F2] hover:border-[#7C3AED]'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <p className="text-xs text-[#6B6680] font-medium">
            {product.brand} · {product.categoryName}
          </p>
          <Link
            to={`/products/${product.slug}`}
            className="mt-1 block text-[15px] font-semibold text-[#211A35] hover:text-[#7C3AED] line-clamp-2 leading-snug"
          >
            {product.name}
          </Link>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-[#6B6680] tabular-nums">
            <span className="inline-flex items-center gap-1 font-semibold text-[#211A35]">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {product.rating.toFixed(1)}
            </span>
            <span>({product.reviewCount.toLocaleString('en-IN')})</span>
            <span>·</span>
            <span className={outOfStock ? 'text-[#EF4444] font-semibold' : product.availableToSell <= 5 ? 'text-[#F59E0B] font-semibold' : 'text-[#10B981] font-medium'}>
              {outOfStock ? 'Out of stock' : product.availableToSell <= 5 ? `Only ${product.availableToSell} left` : 'In stock'}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[#E7E1F2]/70 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#1F1647] tabular-nums">{formatINR(product.pricePaise)}</p>
            {discountPct > 0 && (
              <p className="text-xs text-[#6B6680] tabular-nums">
                <span className="line-through mr-1.5">{formatINR(product.mrpPaise)}</span>
                <span className="text-[#10B981] font-semibold">{discountPct}% off</span>
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={outOfStock ? 'outline' : 'primary'}
            disabled={outOfStock}
            onClick={() => onAddToCart(product)}
            aria-label={`Add ${product.name} to cart`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            {outOfStock ? 'Sold Out' : 'Add'}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function KpiCard({
  label,
  value,
  trend,
  icon,
}: {
  label: string;
  value: string;
  trend?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card-surface p-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#6B6680]">{label}</p>
        <p className="mt-2 text-2xl font-bold text-[#1F1647] tabular-nums truncate">{value}</p>
        {trend && <p className="mt-1 text-xs font-semibold text-[#10B981] tabular-nums">{trend}</p>}
      </div>
      <div className="w-10 h-10 rounded-xl bg-[#F3F0FA] text-[#7C3AED] flex items-center justify-center shrink-0">
        {icon}
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card-surface p-4 space-y-3 animate-pulse">
      <div className="h-44 rounded-xl bg-[#F3F0FA]" />
      <div className="h-3 w-1/3 rounded bg-[#F3F0FA]" />
      <div className="h-4 w-3/4 rounded bg-[#F3F0FA]" />
      <div className="h-9 w-full rounded-xl bg-[#F3F0FA]" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card-surface p-10 text-center flex flex-col items-center justify-center max-w-lg mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-[#F3F0FA] text-[#7C3AED] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[#1F1647]">{title}</h3>
      <p className="mt-1.5 text-sm text-[#6B6680] leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card-surface p-8 text-center flex flex-col items-center justify-center max-w-lg mx-auto border-red-200">
      <div className="w-12 h-12 rounded-2xl bg-red-50 text-[#EF4444] flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-[#1F1647]">Unable to load data</h3>
      <p className="mt-1 text-sm text-[#6B6680]">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  maxWidth = 'max-w-[560px]',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1F1647]/45 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-t-[20px] sm:rounded-[20px] shadow-2xl border border-[#E7E1F2] max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E7E1F2] flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-[#1F1647]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[#6B6680] hover:text-[#211A35] hover:bg-[#F3F0FA] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
