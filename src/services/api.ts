export interface ApiFieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors: ApiFieldError[];
  details?: unknown;
  correlationId?: string;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    fieldErrors?: ApiFieldError[];
    details?: unknown;
    correlationId?: string;
  }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.fieldErrors = params.fieldErrors ?? [];
    this.details = params.details;
    this.correlationId = params.correlationId;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Correlation-Id', `web_${Math.random().toString(36).slice(2, 10)}`);

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: data.code || 'API_ERROR',
      message: data.message || `Request failed with status ${res.status}`,
      fieldErrors: data.fieldErrors,
      details: data.details,
      correlationId: data.correlationId,
    });
  }

  return data as T;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
  createdAt: string;
}

export interface ProductVariantDto {
  id: string;
  sku: string;
  title: string;
  attributes: Record<string, string>;
  pricePaise: number;
  mrpPaise: number;
  availableToSell: number;
}

export interface ProductDto {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  slug: string;
  brand: string;
  shortDescription: string;
  description: string;
  specs: Record<string, string>;
  badge: string | null;
  rating: number;
  reviewCount: number;
  featured: boolean;
  pricePaise: number;
  mrpPaise: number;
  defaultVariantId: string | null;
  availableToSell: number;
  imageUrl: string | null;
  images?: { id: string; url: string; alt_text: string }[];
  variants: ProductVariantDto[];
  reviews?: {
    id: string;
    author_name: string;
    rating: number;
    title: string;
    comment: string;
    verified_purchase: number;
    created_at: string;
  }[];
  related?: {
    id: string;
    name: string;
    slug: string;
    brand: string;
    rating: number;
    review_count: number;
    price_paise: number;
    image_url: string | null;
  }[];
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon_name: string;
  image_url: string;
  product_count: number;
}

export interface CartItemDto {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  brand: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;
  unitPricePaise: number;
  mrpPaise: number;
  quantity: number;
  lineTotalPaise: number;
  availableToSell: number;
  inStock: boolean;
}

export interface CartDto {
  cartId: string;
  items: CartItemDto[];
  itemCount: number;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
}

export const authApi = {
  me: () => request<{ user: UserDto | null }>('/api/v1/auth/session'),
  login: (body: { email: string; password: string }) =>
    request<{ user: UserDto }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body: { name: string; email: string; phone?: string; password: string }) =>
    request<{ user: UserDto }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
  updateProfile: (body: { name: string; phone?: string }) =>
    request<{ user: UserDto }>('/api/v1/me', { method: 'PATCH', body: JSON.stringify(body) }),
  forgotPassword: (email: string) =>
    request<{ message: string; previewResetToken?: string }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (body: { token: string; newPassword: string }) =>
    request<{ ok: boolean; message: string }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const catalogApi = {
  categories: () => request<{ categories: CategoryDto[] }>('/api/v1/categories'),
  products: (params: Record<string, string | number | boolean | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== false) sp.set(k, String(v));
    }
    return request<{
      products: ProductDto[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      brands: string[];
    }>(`/api/v1/products?${sp.toString()}`);
  },
  productDetail: (slugOrId: string) => request<{ product: ProductDto }>(`/api/v1/products/${encodeURIComponent(slugOrId)}`),
  addReview: (productId: string, body: { rating: number; title: string; comment: string }) =>
    request<{ ok: boolean }>(`/api/v1/products/${productId}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
  serviceability: (postalCode: string) =>
    request<{
      postalCode: string;
      serviceable: boolean;
      expressAvailable: boolean;
      standardEta: string;
      expressEta: string;
      codAvailable: boolean;
    }>(`/api/v1/serviceability/${encodeURIComponent(postalCode)}`),
};

export const cartApi = {
  get: () => request<CartDto>('/api/v1/cart'),
  addItem: (variantId: string, quantity: number) =>
    request<CartDto>('/api/v1/cart/items', { method: 'POST', body: JSON.stringify({ variantId, quantity }) }),
  updateItem: (itemId: string, quantity: number) =>
    request<CartDto>(`/api/v1/cart/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }),
  removeItem: (itemId: string) => request<CartDto>(`/api/v1/cart/items/${itemId}`, { method: 'DELETE' }),
  merge: (items: { variantId: string; quantity: number }[]) =>
    request<CartDto>('/api/v1/cart/merge', { method: 'POST', body: JSON.stringify({ items }) }),
};

export const checkoutApi = {
  quote: (body: { addressId?: string; shippingMethod: 'STANDARD' | 'EXPRESS'; couponCode?: string }) =>
    request<{
      quoteId: string;
      expiresAt: string;
      shippingMethod: 'STANDARD' | 'EXPRESS';
      subtotalPaise: number;
      discountPaise: number;
      shippingPaise: number;
      taxPaise: number;
      grandTotalPaise: number;
      appliedCouponCode: string | null;
      couponError: string | null;
    }>('/api/v1/checkout/quote', { method: 'POST', body: JSON.stringify(body) }),
  submit: (
    body: { quoteId: string; addressId: string; paymentMethod: string; notes?: string },
    idempotencyKey: string
  ) =>
    request<{
      orderId: string;
      orderNumber: string;
      status: string;
      paymentId: string;
      providerReference: string;
      paymentMethod: string;
      amountPaise: number;
    }>('/api/v1/checkout/submit', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  authorizePayment: (paymentId: string, outcome: 'SUCCESS' | 'FAIL' | 'TIMEOUT' = 'SUCCESS') =>
    request<{ paymentStatus: string; orderStatus: string; orderId: string; message?: string }>(
      `/api/v1/payments/${paymentId}/authorize`,
      { method: 'POST', body: JSON.stringify({ outcome }) }
    ),
};

export const ordersApi = {
  list: (params?: { status?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.q) sp.set('q', params.q);
    return request<{ orders: Record<string, unknown>[] }>(`/api/v1/orders?${sp.toString()}`);
  },
  detail: (id: string) => request<{ order: Record<string, unknown> }>(`/api/v1/orders/${encodeURIComponent(id)}`),
  cancel: (id: string, reason: string) =>
    request<{ ok: boolean; status: string }>(`/api/v1/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  requestReturn: (id: string, reason: string) =>
    request<{ ok: boolean; status: string }>(`/api/v1/orders/${id}/return`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export const accountApi = {
  wishlist: () => request<{ items: Record<string, unknown>[] }>('/api/v1/wishlist'),
  addWishlist: (productId: string) => request<{ ok: boolean }>(`/api/v1/wishlist/${productId}`, { method: 'POST' }),
  removeWishlist: (productId: string) => request<{ ok: boolean }>(`/api/v1/wishlist/${productId}`, { method: 'DELETE' }),
  addresses: () => request<{ addresses: Record<string, unknown>[] }>('/api/v1/addresses'),
  addAddress: (body: Record<string, unknown>) =>
    request<{ address: Record<string, unknown> }>('/api/v1/addresses', { method: 'POST', body: JSON.stringify(body) }),
  deleteAddress: (id: string) => request<{ ok: boolean }>(`/api/v1/addresses/${id}`, { method: 'DELETE' }),
  paymentMethods: () => request<{ methods: Record<string, unknown>[] }>('/api/v1/payment-methods'),
  notifications: () => request<{ notifications: Record<string, unknown>[]; unreadCount: number }>('/api/v1/notifications'),
  markRead: (id: string) => request<{ ok: boolean }>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ ok: boolean }>('/api/v1/notifications/read-all', { method: 'POST' }),
};

export const supportApi = {
  articles: (q?: string, category?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (category) sp.set('category', category);
    return request<{ articles: { id: string; category: string; question: string; answer: string }[] }>(
      `/api/v1/help/articles?${sp.toString()}`
    );
  },
  tickets: () => request<{ tickets: Record<string, unknown>[] }>('/api/v1/support/tickets'),
  createTicket: (body: { subject: string; category: string; priority: string; orderId?: string; message: string }) =>
    request<{ ticket: Record<string, unknown> }>('/api/v1/support/tickets', { method: 'POST', body: JSON.stringify(body) }),
  ticketDetail: (id: string) =>
    request<{ ticket: Record<string, unknown>; messages: Record<string, unknown>[] }>(`/api/v1/support/tickets/${id}`),
  replyTicket: (id: string, body: string, isInternalNote = false) =>
    request<{ ok: boolean }>(`/api/v1/support/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, isInternalNote }),
    }),
};

export const aiApi = {
  agents: () => request<{ agents: Record<string, unknown>[] }>('/api/v1/ai/agents'),
  conversations: (guestToken?: string) =>
    request<{ conversations: Record<string, unknown>[] }>(
      `/api/v1/ai/conversations${guestToken ? `?guestToken=${encodeURIComponent(guestToken)}` : ''}`
    ),
  createConversation: (title?: string, guestToken?: string) =>
    request<{ conversation: Record<string, unknown> }>('/api/v1/ai/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, guestToken }),
    }),
  deleteConversation: (id: string, guestToken?: string) =>
    request<{ ok: boolean }>(
      `/api/v1/ai/conversations/${id}${guestToken ? `?guestToken=${encodeURIComponent(guestToken)}` : ''}`,
      { method: 'DELETE' }
    ),
  getConversation: (id: string, guestToken?: string) =>
    request<{ conversation: Record<string, unknown>; messages: Record<string, unknown>[] }>(
      `/api/v1/ai/conversations/${id}${guestToken ? `?guestToken=${encodeURIComponent(guestToken)}` : ''}`
    ),
  sendMessage: (id: string, content: string, guestToken?: string) =>
    request<{ message: Record<string, unknown>; run: { id: string; status: string; durationMs: number; tokensEstimated: number; events: Record<string, unknown>[] } }>(
      `/api/v1/ai/conversations/${id}/messages`,
      { method: 'POST', body: JSON.stringify({ content, guestToken }) }
    ),
  confirmAction: (conversationId: string, messageId: string, decision: 'APPROVE' | 'DECLINE') =>
    request<{ ok: boolean; pendingConfirmation: Record<string, unknown>; message: Record<string, unknown> }>(
      `/api/v1/ai/conversations/${conversationId}/confirm`,
      { method: 'POST', body: JSON.stringify({ messageId, decision }) }
    ),
  savedRecommendations: () => request<{ items: Record<string, unknown>[] }>('/api/v1/ai/saved'),
  saveRecommendation: (body: { productId: string; variantId: string; reason: string; pricePaise: number }) =>
    request<{ ok: boolean }>('/api/v1/ai/saved', { method: 'POST', body: JSON.stringify(body) }),
  removeSaved: (id: string) => request<{ ok: boolean }>(`/api/v1/ai/saved/${id}`, { method: 'DELETE' }),
  runs: () => request<{ runs: Record<string, unknown>[] }>('/api/v1/ai/runs'),
  runDetail: (id: string) => request<{ run: Record<string, unknown>; events: Record<string, unknown>[] }>(`/api/v1/ai/runs/${id}`),
};

export const adminApi = {
  dashboard: () => request<Record<string, unknown>>('/api/v1/admin/dashboard'),
  products: () => request<{ products: Record<string, unknown>[] }>('/api/v1/admin/products'),
  createProduct: (body: Record<string, unknown>) =>
    request<{ id: string; variantId: string; slug: string }>('/api/v1/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/v1/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveProduct: (id: string) => request<{ ok: boolean }>(`/api/v1/admin/products/${id}`, { method: 'DELETE' }),
  inventory: () => request<{ stock: Record<string, unknown>[]; movements: Record<string, unknown>[] }>('/api/v1/admin/inventory'),
  adjustInventory: (body: { variantId: string; delta: number; reason: string; reorderLevel?: number }) =>
    request<{ ok: boolean }>('/api/v1/admin/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
  orders: (status?: string) =>
    request<{ orders: Record<string, unknown>[] }>(`/api/v1/admin/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  transitionOrder: (id: string, body: { targetStatus: string; reason: string; trackingReference?: string; carrier?: string }) =>
    request<{ ok: boolean; status: string }>(`/api/v1/admin/orders/${id}/transition`, { method: 'POST', body: JSON.stringify(body) }),
  payments: () => request<{ payments: Record<string, unknown>[]; events: Record<string, unknown>[] }>('/api/v1/admin/payments'),
  refundPayment: (id: string, body: { amountPaise: number; reason: string }) =>
    request<{ ok: boolean; status: string; refundedPaise: number }>(`/api/v1/admin/payments/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  customers: () => request<{ customers: Record<string, unknown>[] }>('/api/v1/admin/customers'),
  setCustomerStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    request<{ ok: boolean }>(`/api/v1/admin/customers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  supportTickets: () => request<{ tickets: Record<string, unknown>[]; staff: Record<string, unknown>[] }>('/api/v1/admin/support/tickets'),
  updateSupportTicket: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/v1/admin/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  roles: () => request<{ users: Record<string, unknown>[] }>('/api/v1/admin/roles'),
  updateRoles: (userId: string, roles: string[]) =>
    request<{ ok: boolean }>(`/api/v1/admin/roles/${userId}`, { method: 'PUT', body: JSON.stringify({ roles }) }),
  settings: () => request<{ settings: Record<string, unknown> }>('/api/v1/admin/settings'),
  saveSettings: (key: string, value: Record<string, unknown>) =>
    request<{ ok: boolean }>('/api/v1/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  auditLogs: () => request<{ logs: Record<string, unknown>[] }>('/api/v1/admin/audit-logs'),
  analytics: () => request<{ topProducts: Record<string, unknown>[]; funnel: Record<string, unknown>[]; exports: Record<string, unknown>[] }>('/api/v1/admin/analytics'),
  createExport: (reportType: string) =>
    request<{ id: string; reportType: string; status: string; rowCount: number; csv: string }>('/api/v1/admin/exports', {
      method: 'POST',
      body: JSON.stringify({ reportType }),
    }),
  aiOverview: () => request<Record<string, unknown>>('/api/v1/admin/ai/overview'),
  updateAgent: (key: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; version: number }>(`/api/v1/admin/agents/${key}`, { method: 'PATCH', body: JSON.stringify(body) }),
  workflow: () => request<{ workflow: Record<string, unknown> | null }>('/api/v1/admin/workflows'),
  saveWorkflow: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; version: number }>(`/api/v1/admin/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  aiLogs: () => request<{ runs: Record<string, unknown>[]; events: Record<string, unknown>[] }>('/api/v1/admin/ai-logs'),
  tools: () => request<{ tools: Record<string, unknown>[] }>('/api/v1/admin/tools'),
  testTool: (name: string, args: Record<string, unknown>, agentKey?: string) =>
    request<{ outcome: Record<string, unknown> }>(`/api/v1/admin/tools/${name}/test`, {
      method: 'POST',
      body: JSON.stringify({ args, agentKey }),
    }),
  evaluations: () => request<{ evaluations: Record<string, unknown>[] }>('/api/v1/admin/ai/evaluations'),
  runEvaluation: () => request<Record<string, unknown>>('/api/v1/admin/ai/evaluations', { method: 'POST' }),
};
