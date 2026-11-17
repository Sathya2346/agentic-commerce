export type RoleCode =
  | 'CUSTOMER'
  | 'SUPPORT'
  | 'CATALOG_MANAGER'
  | 'ORDER_MANAGER'
  | 'INVENTORY_MANAGER'
  | 'AI_ADMIN'
  | 'ADMIN';

export type Permission =
  | 'product:read'
  | 'product:write'
  | 'inventory:adjust'
  | 'order:read'
  | 'order:transition'
  | 'refund:approve'
  | 'support:assign'
  | 'customer:manage'
  | 'agent:configure'
  | 'agent:publish'
  | 'report:export'
  | 'user:manage'
  | 'settings:write';

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  CUSTOMER: [],
  SUPPORT: ['product:read', 'order:read', 'support:assign'],
  CATALOG_MANAGER: ['product:read', 'product:write'],
  ORDER_MANAGER: ['product:read', 'order:read', 'order:transition'],
  INVENTORY_MANAGER: ['product:read', 'inventory:adjust'],
  AI_ADMIN: ['product:read', 'agent:configure', 'agent:publish', 'report:export'],
  ADMIN: [
    'product:read',
    'product:write',
    'inventory:adjust',
    'order:read',
    'order:transition',
    'refund:approve',
    'support:assign',
    'customer:manage',
    'agent:configure',
    'agent:publish',
    'report:export',
    'user:manage',
    'settings:write',
  ],
};

export function hasPermission(roles: string[], permission: Permission): boolean {
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role as RoleCode];
    if (perms && perms.includes(permission)) {
      return true;
    }
  }
  return false;
}

export function isStaffRole(roles: string[]): boolean {
  return roles.some((r) => r !== 'CUSTOMER');
}

export type OrderState =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURN_APPROVED'
  | 'RETURNED'
  | 'REFUNDED';

export type PaymentState =
  | 'CREATED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED'],
  CANCELLED: ['REFUNDED'],
  RETURN_REQUESTED: ['RETURN_APPROVED', 'DELIVERED'],
  RETURN_APPROVED: ['RETURNED'],
  RETURNED: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getNextOrderTransitions(from: OrderState): OrderState[] {
  return ORDER_TRANSITIONS[from] ?? [];
}

export function isCustomerCancellable(state: OrderState): boolean {
  return state === 'PENDING_PAYMENT' || state === 'CONFIRMED' || state === 'PROCESSING';
}

export function isCustomerReturnable(state: OrderState): boolean {
  return state === 'DELIVERED';
}

export const PAYMENT_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  CREATED: ['PENDING', 'FAILED', 'PAID', 'CANCELLED'],
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  UNKNOWN: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function calculateRefundableRemainingPaise(
  capturedPaise: number,
  alreadyRefundedPaise: number
): number {
  return Math.max(0, capturedPaise - alreadyRefundedPaise);
}

export function canRefundAmount(
  capturedPaise: number,
  alreadyRefundedPaise: number,
  requestedPaise: number
): { ok: boolean; reason?: string } {
  if (!Number.isInteger(requestedPaise) || requestedPaise <= 0) {
    return { ok: false, reason: 'Refund amount must be a positive integer.' };
  }
  const remaining = calculateRefundableRemainingPaise(capturedPaise, alreadyRefundedPaise);
  if (requestedPaise > remaining) {
    return {
      ok: false,
      reason: `Requested refund (${formatINR(requestedPaise)}) exceeds remaining refundable amount (${formatINR(remaining)}).`,
    };
  }
  return { ok: true };
}

export function computeAvailableToSell(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

export function canReserveStock(onHand: number, reserved: number, qty: number): boolean {
  if (!Number.isInteger(qty) || qty <= 0) return false;
  if (onHand < 0 || reserved < 0 || reserved > onHand) return false;
  return onHand - reserved >= qty;
}

export function validateStockAdjustment(
  currentOnHand: number,
  currentReserved: number,
  delta: number
): { ok: boolean; nextOnHand: number; reason?: string } {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, nextOnHand: currentOnHand, reason: 'Adjustment delta must be a non-zero integer.' };
  }
  const nextOnHand = currentOnHand + delta;
  if (nextOnHand < 0) {
    return { ok: false, nextOnHand: currentOnHand, reason: 'On-hand stock cannot become negative.' };
  }
  if (nextOnHand < currentReserved) {
    return {
      ok: false,
      nextOnHand: currentOnHand,
      reason: `On-hand stock (${nextOnHand}) cannot drop below reserved units (${currentReserved}).`,
    };
  }
  return { ok: true, nextOnHand };
}

export function formatINR(paise: number): string {
  const rupees = Math.round(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(rupees);
}

export interface CouponPolicyInput {
  code: string;
  discountType: 'PERCENT' | 'FLAT';
  discountValue: number; // percent integer (e.g. 10) or flat paise
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  usageLimit: number | null;
  usedCount: number;
  userUsedCount: number;
  perUserLimit: number;
}

export interface PricingLineInput {
  variantId: string;
  unitPricePaise: number;
  quantity: number;
}

export interface PricingBreakdown {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  appliedCouponCode: string | null;
  couponError: string | null;
}

export function calculatePricingBreakdown(params: {
  lines: PricingLineInput[];
  shippingMethod: 'STANDARD' | 'EXPRESS';
  coupon?: CouponPolicyInput | null;
  freeShippingThresholdPaise?: number;
  taxRateBps?: number; // e.g., 1800 = 18%, or inclusive/exclusive policy. We treat prices as tax-inclusive MRP or additive per store settings; let's use exclusive 0 or configurable GST! Wait: in Indian retail UI boards (MacBook Pro ₹1,49,990, Travel Backpack ₹1,299 -> Total ₹1,57,989 with Discount ₹20,290 & Free Delivery), prices are GST-inclusive! So taxPaise is extracted as included GST metadata (18% included) OR additive 0 unless taxMode === 'EXCLUSIVE'. Let's support taxInclusive!
  taxInclusive?: boolean;
  nowIso?: string;
}): PricingBreakdown {
  const now = params.nowIso ? Date.parse(params.nowIso) : Date.now();
  const freeThreshold = params.freeShippingThresholdPaise ?? 99900; // ₹999
  const taxRateBps = params.taxRateBps ?? 1800; // 18% GST
  const taxInclusive = params.taxInclusive ?? true;

  let subtotalPaise = 0;
  for (const line of params.lines) {
    if (line.quantity < 0 || !Number.isInteger(line.unitPricePaise)) {
      throw new Error('Invalid pricing line item');
    }
    subtotalPaise += line.unitPricePaise * line.quantity;
  }

  let discountPaise = 0;
  let appliedCouponCode: string | null = null;
  let couponError: string | null = null;

  if (params.coupon) {
    const c = params.coupon;
    if (!c.active) {
      couponError = `Coupon ${c.code} is currently inactive.`;
    } else if (c.startsAt && Date.parse(c.startsAt) > now) {
      couponError = `Coupon ${c.code} is not active yet.`;
    } else if (c.expiresAt && Date.parse(c.expiresAt) < now) {
      couponError = `Coupon ${c.code} has expired.`;
    } else if (c.usageLimit !== null && c.usedCount >= c.usageLimit) {
      couponError = `Coupon ${c.code} has reached its global redemption limit.`;
    } else if (c.userUsedCount >= c.perUserLimit) {
      couponError = `You have already used coupon ${c.code} the maximum number of times.`;
    } else if (subtotalPaise < c.minOrderPaise) {
      couponError = `Minimum order of ${formatINR(c.minOrderPaise)} required for ${c.code}.`;
    } else {
      if (c.discountType === 'PERCENT') {
        discountPaise = Math.round((subtotalPaise * c.discountValue) / 100);
        if (c.maxDiscountPaise !== null && discountPaise > c.maxDiscountPaise) {
          discountPaise = c.maxDiscountPaise;
        }
      } else {
        discountPaise = Math.min(subtotalPaise, c.discountValue);
      }
      appliedCouponCode = c.code;
    }
  }

  const discountedSubtotal = Math.max(0, subtotalPaise - discountPaise);

  let shippingPaise = 0;
  if (params.lines.length > 0) {
    if (params.shippingMethod === 'EXPRESS') {
      shippingPaise = 19900; // ₹199
    } else {
      shippingPaise = discountedSubtotal >= freeThreshold ? 0 : 9900; // ₹99 below ₹999
    }
  }

  let taxPaise = 0;
  let grandTotalPaise = discountedSubtotal + shippingPaise;
  if (taxInclusive) {
    // Included GST portion for invoice breakdown
    taxPaise = Math.round((discountedSubtotal * taxRateBps) / (10000 + taxRateBps));
  } else {
    taxPaise = Math.round((discountedSubtotal * taxRateBps) / 10000);
    grandTotalPaise = discountedSubtotal + shippingPaise + taxPaise;
  }

  return {
    subtotalPaise,
    discountPaise,
    shippingPaise,
    taxPaise,
    grandTotalPaise,
    appliedCouponCode,
    couponError,
  };
}

export type SpecialistAgentKey =
  | 'shopping_agent'
  | 'product_agent'
  | 'inventory_agent'
  | 'order_agent'
  | 'support_agent';

export const DEFAULT_AGENT_TOOL_ALLOWLIST: Record<SpecialistAgentKey, string[]> = {
  shopping_agent: [
    'search_products',
    'get_product_details',
    'compare_products',
    'check_stock',
    'check_serviceability',
    'add_to_cart',
    'get_my_orders',
    'get_order_status',
    'request_cancellation',
    'search_help_articles',
    'create_support_ticket',
    'get_ticket_status',
  ],
  product_agent: ['search_products', 'get_product_details', 'compare_products', 'get_reviews_summary'],
  inventory_agent: ['check_stock', 'check_serviceability'],
  order_agent: ['get_my_orders', 'get_order_status', 'request_cancellation'],
  support_agent: ['search_help_articles', 'create_support_ticket', 'get_ticket_status'],
};

export const AUTH_REQUIRED_TOOLS = new Set([
  'get_my_orders',
  'get_order_status',
  'request_cancellation',
  'create_support_ticket',
  'get_ticket_status',
]);

export const CONFIRMATION_REQUIRED_TOOLS = new Set(['request_cancellation']);

export function isToolAllowedForAgent(
  agentKey: SpecialistAgentKey,
  toolName: string,
  customAllowlist?: string[]
): boolean {
  const list = customAllowlist ?? DEFAULT_AGENT_TOOL_ALLOWLIST[agentKey] ?? [];
  return list.includes(toolName);
}

export function redactSensitiveText(input: string): string {
  if (!input) return input;
  return input
    // Redact 12-19 digit card numbers
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
    // Redact CVV labels
    .replace(/\b(cvv|cvc|pin)\s*[:=]?\s*\d{3,4}\b/gi, '$1: [REDACTED]')
    // Redact Bearer tokens / API keys
    .replace(/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/\b(sk-|AIza)[A-Za-z0-9\-_]{10,}\b/g, '[REDACTED_KEY]')
    // Redact password fields in JSON-like strings
    .replace(/("password"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3');
}
