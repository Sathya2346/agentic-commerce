import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { accountApi, cartApi, catalogApi, type CartDto, type CartItemDto } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { calculatePricingBreakdown } from '../domain/commercePolicy';

const GUEST_CART_KEY = 'ac_guest_cart_v1';
const COMPARE_KEY = 'ac_compare_slugs_v1';

interface GuestCartEntry {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;
  unitPricePaise: number;
  mrpPaise: number;
  quantity: number;
  availableToSell: number;
}

interface CartContextValue {
  cart: CartDto;
  loading: boolean;
  wishlistIds: Set<string>;
  compareSlugs: string[];
  unreadNotifications: number;
  refreshCart: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  addToCart: (item: {
    variantId: string;
    productId: string;
    slug: string;
    name: string;
    brand?: string;
    variantTitle?: string;
    sku?: string;
    imageUrl?: string | null;
    unitPricePaise: number;
    mrpPaise?: number;
    quantity?: number;
    availableToSell?: number;
  }) => Promise<boolean>;
  updateQuantity: (itemIdOrVariantId: string, quantity: number) => Promise<void>;
  removeItem: (itemIdOrVariantId: string) => Promise<void>;
  toggleWishlist: (productId: string, productName?: string) => Promise<void>;
  toggleCompare: (slug: string, productName?: string) => void;
  clearCompare: () => void;
}

const emptyCart: CartDto = {
  cartId: 'guest',
  items: [],
  itemCount: 0,
  subtotalPaise: 0,
  discountPaise: 0,
  shippingPaise: 0,
  taxPaise: 0,
  grandTotalPaise: 0,
};

function readGuestEntries(): GuestCartEntry[] {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function buildGuestCartDto(entries: GuestCartEntry[]): CartDto {
  const items: CartItemDto[] = entries.map((e) => ({
    id: e.variantId,
    productId: e.productId,
    variantId: e.variantId,
    slug: e.slug,
    name: e.name,
    brand: e.brand,
    variantTitle: e.variantTitle,
    sku: e.sku,
    imageUrl: e.imageUrl,
    unitPricePaise: e.unitPricePaise,
    mrpPaise: e.mrpPaise,
    quantity: e.quantity,
    lineTotalPaise: e.unitPricePaise * e.quantity,
    availableToSell: e.availableToSell,
    inStock: e.availableToSell >= e.quantity,
  }));

  const pricing = calculatePricingBreakdown({
    lines: items.map((i) => ({ variantId: i.variantId, unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
    shippingMethod: 'STANDARD',
  });

  return {
    cartId: 'guest',
    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    ...pricing,
  };
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const [cart, setCart] = useState<CartDto>(emptyCart);
  const [loading, setLoading] = useState(false);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [compareSlugs, setCompareSlugs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COMPARE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setUnreadNotifications(0);
      return;
    }
    try {
      const res = await accountApi.notifications();
      setUnreadNotifications(res.unreadCount);
    } catch {
      // ignore
    }
  }, [user]);

  const refreshCart = useCallback(async () => {
    if (!user) {
      setCart(buildGuestCartDto(readGuestEntries()));
      setWishlistIds(new Set());
      return;
    }
    setLoading(true);
    try {
      // Merge any guest cart items upon authentication!
      const guest = readGuestEntries();
      if (guest.length > 0) {
        const merged = await cartApi.merge(guest.map((g) => ({ variantId: g.variantId, quantity: g.quantity })));
        localStorage.removeItem(GUEST_CART_KEY);
        setCart(merged);
        pushToast({
          variant: 'info',
          title: 'Guest cart merged',
          description: 'Your saved items were merged with your account cart.',
        });
      } else {
        const serverCart = await cartApi.get();
        setCart(serverCart);
      }
      const wl = await accountApi.wishlist();
      setWishlistIds(new Set(wl.items.map((w) => String(w.id))));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user, pushToast]);

  useEffect(() => {
    void refreshCart();
    void refreshNotifications();
  }, [refreshCart, refreshNotifications]);

  const addToCart: CartContextValue['addToCart'] = useCallback(
    async (item) => {
      const qty = item.quantity ?? 1;
      if (user) {
        try {
          const updated = await cartApi.addItem(item.variantId, qty);
          setCart(updated);
          pushToast({
            variant: 'success',
            title: 'Added to your cart',
            description: `${item.name} (${qty})`,
          });
          return true;
        } catch (err) {
          pushToast({
            variant: 'error',
            title: 'Unable to add item',
            description: err instanceof Error ? err.message : 'Stock unavailable.',
          });
          return false;
        }
      }

      // Guest local cart with authoritative availability check
      try {
        const detail = await catalogApi.productDetail(item.slug);
        const v = detail.product.variants.find((vr) => vr.id === item.variantId) || detail.product.variants[0];
        if (!v || v.availableToSell < qty) {
          pushToast({
            variant: 'error',
            title: 'Insufficient stock',
            description: v ? `Only ${v.availableToSell} left in stock.` : 'Variant unavailable.',
          });
          return false;
        }
        const entries = readGuestEntries();
        const idx = entries.findIndex((e) => e.variantId === v.id);
        const nextQty = (idx >= 0 ? entries[idx].quantity : 0) + qty;
        if (nextQty > v.availableToSell) {
          pushToast({
            variant: 'error',
            title: 'Stock limit reached',
            description: `Only ${v.availableToSell} unit(s) available.`,
          });
          return false;
        }
        if (idx >= 0) {
          entries[idx].quantity = nextQty;
          entries[idx].unitPricePaise = v.pricePaise;
          entries[idx].availableToSell = v.availableToSell;
        } else {
          entries.push({
            variantId: v.id,
            productId: detail.product.id,
            slug: detail.product.slug,
            name: detail.product.name,
            brand: detail.product.brand,
            variantTitle: v.title,
            sku: v.sku,
            imageUrl: detail.product.imageUrl ?? detail.product.images?.[0]?.url ?? null,
            unitPricePaise: v.pricePaise,
            mrpPaise: v.mrpPaise,
            quantity: qty,
            availableToSell: v.availableToSell,
          });
        }
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(entries));
        setCart(buildGuestCartDto(entries));
        pushToast({
          variant: 'success',
          title: 'Added to your cart',
          description: `${detail.product.name} (${qty})`,
        });
        return true;
      } catch (err) {
        pushToast({
          variant: 'error',
          title: 'Could not add item',
          description: err instanceof Error ? err.message : 'Try again.',
        });
        return false;
      }
    },
    [user, pushToast]
  );

  const updateQuantity = useCallback(
    async (itemIdOrVariantId: string, quantity: number) => {
      if (user) {
        const previous = cart;
        try {
          const updated = await cartApi.updateItem(itemIdOrVariantId, quantity);
          setCart(updated);
        } catch (err) {
          setCart(previous);
          pushToast({
            variant: 'error',
            title: 'Quantity update rejected',
            description: err instanceof Error ? err.message : 'Stock unavailable.',
          });
        }
        return;
      }

      const entries = readGuestEntries();
      const idx = entries.findIndex((e) => e.variantId === itemIdOrVariantId);
      if (idx >= 0) {
        if (quantity > entries[idx].availableToSell) {
          pushToast({ variant: 'error', title: 'Stock limit', description: `Only ${entries[idx].availableToSell} available.` });
          return;
        }
        entries[idx].quantity = Math.max(1, Math.min(10, quantity));
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(entries));
        setCart(buildGuestCartDto(entries));
      }
    },
    [user, cart, pushToast]
  );

  const removeItem = useCallback(
    async (itemIdOrVariantId: string) => {
      if (user) {
        const updated = await cartApi.removeItem(itemIdOrVariantId);
        setCart(updated);
        return;
      }
      const entries = readGuestEntries().filter((e) => e.variantId !== itemIdOrVariantId);
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(entries));
      setCart(buildGuestCartDto(entries));
    },
    [user]
  );

  const toggleWishlist = useCallback(
    async (productId: string, productName?: string) => {
      if (!user) {
        pushToast({ variant: 'info', title: 'Sign in to save wishlist items', description: 'Your wishlist syncs across devices when signed in.' });
        return;
      }
      const next = new Set(wishlistIds);
      if (next.has(productId)) {
        await accountApi.removeWishlist(productId);
        next.delete(productId);
        pushToast({ variant: 'info', title: 'Removed from wishlist', description: productName });
      } else {
        await accountApi.addWishlist(productId);
        next.add(productId);
        pushToast({ variant: 'success', title: 'Saved to wishlist', description: productName });
      }
      setWishlistIds(next);
    },
    [user, wishlistIds, pushToast]
  );

  const toggleCompare = useCallback(
    (slug: string, productName?: string) => {
      setCompareSlugs((prev) => {
        let next: string[];
        if (prev.includes(slug)) {
          next = prev.filter((s) => s !== slug);
          pushToast({ variant: 'info', title: 'Removed from comparison', description: productName });
        } else if (prev.length >= 4) {
          pushToast({ variant: 'warning', title: 'Comparison limit reached', description: 'Compare up to 4 products at a time.' });
          return prev;
        } else {
          next = [...prev, slug];
          pushToast({ variant: 'success', title: 'Added to compare', description: `${productName || slug} (${next.length}/4)` });
        }
        localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [pushToast]
  );

  const clearCompare = useCallback(() => {
    localStorage.removeItem(COMPARE_KEY);
    setCompareSlugs([]);
  }, []);

  return (
    <CartContext.Provider
      value={{
        cart,
        loading,
        wishlistIds,
        compareSlugs,
        unreadNotifications,
        refreshCart,
        refreshNotifications,
        addToCart,
        updateQuantity,
        removeItem,
        toggleWishlist,
        toggleCompare,
        clearCompare,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
