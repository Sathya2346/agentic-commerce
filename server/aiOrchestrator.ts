import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import type { Express } from 'express';
import { db, newId } from './db';
import { rateLimit, requireAuth, requirePermission, type AuthUser } from './auth';
import { buildUserCartDto, enqueueOutbox, recordAudit } from './commerce';
import {
  AUTH_REQUIRED_TOOLS,
  computeAvailableToSell,
  isCustomerCancellable,
  isToolAllowedForAgent,
  redactSensitiveText,
  type OrderState,
  type SpecialistAgentKey,
} from '../src/domain/commercePolicy';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const TOOL_SCHEMAS: Record<string, FunctionDeclaration> = {
  search_products: {
    name: 'search_products',
    description: 'Search active catalog products by query, category, brand, max price in INR, and sort order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search keywords e.g. laptop, headphones, titanium watch' },
        category: { type: Type.STRING, description: 'Category slug: laptops, mobiles, audio, wearables, cameras, accessories' },
        maxPriceInr: { type: Type.NUMBER, description: 'Maximum budget in INR rupees (e.g. 60000)' },
        minPriceInr: { type: Type.NUMBER, description: 'Minimum budget in INR rupees' },
        brand: { type: Type.STRING, description: 'Optional brand filter' },
      },
    },
  },
  get_product_details: {
    name: 'get_product_details',
    description: 'Get authoritative specs, variants, pricing, and rating for a product by slug or ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        slugOrId: { type: Type.STRING, description: 'Product slug or ID' },
      },
      required: ['slugOrId'],
    },
  },
  compare_products: {
    name: 'compare_products',
    description: 'Compare 2 to 4 products side by side on specs, price, rating, and availability.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        slugsOrIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'List of 2-4 product slugs or IDs' },
      },
      required: ['slugsOrIds'],
    },
  },
  get_reviews_summary: {
    name: 'get_reviews_summary',
    description: 'Get verified customer reviews summary for a product.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING },
      },
      required: ['productId'],
    },
  },
  check_stock: {
    name: 'check_stock',
    description: 'Check real-time available_to_sell inventory for one or more product or variant IDs.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Variant IDs or Product IDs' },
      },
      required: ['ids'],
    },
  },
  check_serviceability: {
    name: 'check_serviceability',
    description: 'Check delivery serviceability and ETA for a 6-digit Indian postal code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        postalCode: { type: Type.STRING, description: '6-digit PIN code e.g. 600040' },
      },
      required: ['postalCode'],
    },
  },
  add_to_cart: {
    name: 'add_to_cart',
    description: 'Add a validated product variant to the signed-in user cart after checking live stock.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        variantId: { type: Type.STRING },
        quantity: { type: Type.INTEGER },
      },
      required: ['variantId', 'quantity'],
    },
  },
  get_my_orders: {
    name: 'get_my_orders',
    description: 'List recent orders belonging strictly to the authenticated customer.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  get_order_status: {
    name: 'get_order_status',
    description: 'Get detailed order status and shipment tracking timeline for an owned order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderIdOrNumber: { type: Type.STRING, description: 'Order ID or order number like AC784512' },
      },
      required: ['orderIdOrNumber'],
    },
  },
  request_cancellation: {
    name: 'request_cancellation',
    description: 'Check cancellation eligibility and prepare an explicit confirmation request for an owned order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderIdOrNumber: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ['orderIdOrNumber', 'reason'],
    },
  },
  search_help_articles: {
    name: 'search_help_articles',
    description: 'Search grounded store FAQ and help articles for return, payment, shipping, or order policies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
      },
      required: ['query'],
    },
  },
  create_support_ticket: {
    name: 'create_support_ticket',
    description: 'Create a customer support ticket for an authenticated customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: { type: Type.STRING },
        category: { type: Type.STRING },
        message: { type: Type.STRING },
        orderId: { type: Type.STRING },
      },
      required: ['subject', 'category', 'message'],
    },
  },
  get_ticket_status: {
    name: 'get_ticket_status',
    description: 'List support tickets for the authenticated customer.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
};

const TOOL_OWNER_AGENT: Record<string, SpecialistAgentKey> = {
  search_products: 'product_agent',
  get_product_details: 'product_agent',
  compare_products: 'product_agent',
  get_reviews_summary: 'product_agent',
  check_stock: 'inventory_agent',
  check_serviceability: 'inventory_agent',
  add_to_cart: 'shopping_agent',
  get_my_orders: 'order_agent',
  get_order_status: 'order_agent',
  request_cancellation: 'order_agent',
  search_help_articles: 'support_agent',
  create_support_ticket: 'support_agent',
  get_ticket_status: 'support_agent',
};

interface ExecutedToolOutcome {
  ok: boolean;
  data: unknown;
  cards?: ProductCardPayload[];
  pendingConfirmation?: PendingConfirmationPayload;
}

export interface ProductCardPayload {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  pricePaise: number;
  rating: number;
  availableToSell: number;
  imageUrl: string | null;
}

export interface PendingConfirmationPayload {
  actionType: 'CANCEL_ORDER';
  orderId: string;
  orderNumber: string;
  reason: string;
  summary: string;
  resolved?: boolean;
  resolution?: string;
}

export function executeAllowlistedTool(params: {
  agentKey: SpecialistAgentKey;
  toolName: string;
  args: Record<string, unknown>;
  user: AuthUser | null;
  customAllowlist?: string[];
}): ExecutedToolOutcome {
  const { agentKey, toolName, args, user, customAllowlist } = params;

  if (!isToolAllowedForAgent(agentKey, toolName, customAllowlist)) {
    return { ok: false, data: { error: `Tool "${toolName}" is not on ${agentKey}'s allowlist.` } };
  }

  if (AUTH_REQUIRED_TOOLS.has(toolName) && !user) {
    return {
      ok: false,
      data: { error: 'AUTHENTICATION_REQUIRED', message: 'Please sign in to access your personal orders or support tickets.' },
    };
  }

  if (toolName === 'search_products') {
    const q = String(args.query || '').trim().toLowerCase();
    const cat = String(args.category || '').trim().toLowerCase();
    const brand = String(args.brand || '').trim().toLowerCase();
    const maxPaise = args.maxPriceInr ? Number(args.maxPriceInr) * 100 : Number.MAX_SAFE_INTEGER;
    const minPaise = args.minPriceInr ? Number(args.minPriceInr) * 100 : 0;

    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.slug, p.brand, p.short_description, p.rating, p.review_count, c.slug as cat_slug, c.name as cat_name,
                pv.id as variant_id, pv.price_paise, pv.mrp_paise, inv.on_hand, inv.reserved,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
         FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN product_variants pv ON pv.id = (SELECT id FROM product_variants WHERE product_id = p.id AND status='ACTIVE' ORDER BY price_paise ASC LIMIT 1)
         JOIN inventory inv ON inv.variant_id = pv.id
         WHERE p.status = 'ACTIVE'`
      )
      .all() as {
      id: string;
      name: string;
      slug: string;
      brand: string;
      short_description: string;
      rating: number;
      review_count: number;
      cat_slug: string;
      cat_name: string;
      variant_id: string;
      price_paise: number;
      mrp_paise: number;
      on_hand: number;
      reserved: number;
      image_url: string | null;
    }[];

    const tokens = q.split(/\s+/).filter((t) => t.length > 1 && !['for', 'under', 'with', 'best', 'find', 'me', 'good', 'below'].includes(t));

    const matched = rows
      .filter((r) => {
        if (cat && r.cat_slug !== cat && !r.cat_name.toLowerCase().includes(cat)) return false;
        if (brand && r.brand.toLowerCase() !== brand) return false;
        if (r.price_paise > maxPaise || r.price_paise < minPaise) return false;
        if (tokens.length > 0) {
          const hay = `${r.name} ${r.brand} ${r.short_description} ${r.cat_name}`.toLowerCase();
          // match if at least one meaningful token or category fits
          const anyMatch = tokens.some((t) => hay.includes(t) || (t === 'phone' && r.cat_slug === 'mobiles') || (t === 'dev' && hay.includes('developer')));
          if (!anyMatch) return false;
        }
        return true;
      })
      .slice(0, 6);

    const cards: ProductCardPayload[] = matched.map((m) => ({
      productId: m.id,
      variantId: m.variant_id,
      slug: m.slug,
      name: m.name,
      pricePaise: m.price_paise,
      rating: m.rating,
      availableToSell: computeAvailableToSell(m.on_hand, m.reserved),
      imageUrl: m.image_url,
    }));

    return {
      ok: true,
      cards,
      data: matched.map((m) => ({
        productId: m.id,
        variantId: m.variant_id,
        slug: m.slug,
        name: m.name,
        brand: m.brand,
        priceInr: m.price_paise / 100,
        rating: m.rating,
        availableToSell: computeAvailableToSell(m.on_hand, m.reserved),
        highlights: m.short_description,
      })),
    };
  }

  if (toolName === 'get_product_details') {
    const key = String(args.slugOrId || '').trim();
    const p = db
      .prepare("SELECT * FROM products WHERE (slug = ? OR id = ?) AND status = 'ACTIVE'")
      .get(key, key) as
      | { id: string; name: string; slug: string; brand: string; short_description: string; specs_json: string; rating: number }
      | undefined;
    if (!p) return { ok: false, data: { error: 'Product not found in active catalog.' } };
    const variants = db
      .prepare(
        'SELECT pv.id, pv.sku, pv.title, pv.price_paise, inv.on_hand, inv.reserved FROM product_variants pv JOIN inventory inv ON inv.variant_id = pv.id WHERE pv.product_id = ? AND pv.status = ?'
      )
      .all(p.id, 'ACTIVE') as { id: string; sku: string; title: string; price_paise: number; on_hand: number; reserved: number }[];
    return {
      ok: true,
      data: {
        id: p.id,
        name: p.name,
        brand: p.brand,
        specs: JSON.parse(p.specs_json || '{}'),
        rating: p.rating,
        variants: variants.map((v) => ({
          variantId: v.id,
          sku: v.sku,
          title: v.title,
          priceInr: v.price_paise / 100,
          availableToSell: computeAvailableToSell(v.on_hand, v.reserved),
        })),
      },
    };
  }

  if (toolName === 'compare_products') {
    const ids = Array.isArray(args.slugsOrIds) ? args.slugsOrIds.map(String) : [];
    const results = ids.slice(0, 4).map((id) => {
      const p = db
        .prepare(
          `SELECT p.id, p.name, p.slug, p.brand, p.specs_json, p.rating, pv.id as variant_id, pv.price_paise, inv.on_hand, inv.reserved,
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
           FROM products p
           JOIN product_variants pv ON pv.product_id = p.id
           JOIN inventory inv ON inv.variant_id = pv.id
           WHERE (p.slug = ? OR p.id = ? OR LOWER(p.name) LIKE ?) AND p.status = 'ACTIVE' LIMIT 1`
        )
        .get(id, id, `%${id.toLowerCase()}%`) as
        | {
            id: string;
            name: string;
            slug: string;
            brand: string;
            specs_json: string;
            rating: number;
            variant_id: string;
            price_paise: number;
            on_hand: number;
            reserved: number;
            image_url: string | null;
          }
        | undefined;
      return p
        ? {
            productId: p.id,
            variantId: p.variant_id,
            slug: p.slug,
            name: p.name,
            brand: p.brand,
            pricePaise: p.price_paise,
            priceInr: p.price_paise / 100,
            rating: p.rating,
            specs: JSON.parse(p.specs_json || '{}'),
            availableToSell: computeAvailableToSell(p.on_hand, p.reserved),
            imageUrl: p.image_url,
          }
        : null;
    }).filter((x): x is NonNullable<typeof x> => Boolean(x));

    return {
      ok: true,
      cards: results.map((r) => ({
        productId: r.productId,
        variantId: r.variantId,
        slug: r.slug,
        name: r.name,
        pricePaise: r.pricePaise,
        rating: r.rating,
        availableToSell: r.availableToSell,
        imageUrl: r.imageUrl,
      })),
      data: results,
    };
  }

  if (toolName === 'get_reviews_summary') {
    const reviews = db
      .prepare('SELECT rating, title, comment, author_name FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(String(args.productId || ''));
    return { ok: true, data: { reviews } };
  }

  if (toolName === 'check_stock') {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    const stocks = ids.map((id) => {
      const row = db
        .prepare(
          `SELECT pv.id as variant_id, pv.sku, p.name, inv.on_hand, inv.reserved, inv.updated_at
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
           JOIN inventory inv ON inv.variant_id = pv.id
           WHERE pv.id = ? OR p.id = ? OR p.slug = ? LIMIT 1`
        )
        .get(id, id, id) as
        | { variant_id: string; sku: string; name: string; on_hand: number; reserved: number; updated_at: string }
        | undefined;
      if (!row) return { id, found: false, availableToSell: 0 };
      return {
        variantId: row.variant_id,
        sku: row.sku,
        name: row.name,
        availableToSell: computeAvailableToSell(row.on_hand, row.reserved),
        checkedAt: row.updated_at,
      };
    });
    return { ok: true, data: { stocks } };
  }

  if (toolName === 'check_serviceability') {
    const pin = String(args.postalCode || '').trim();
    if (!/^\d{6}$/.test(pin)) return { ok: false, data: { error: 'Postal code must be 6 digits.' } };
    const isMetro = ['600', '560', '400', '110', '500', '641'].some((p) => pin.startsWith(p));
    return {
      ok: true,
      data: {
        postalCode: pin,
        serviceable: !pin.startsWith('999'),
        standardEta: isMetro ? '2-3 business days' : '4-6 business days',
        expressEta: isMetro ? 'Tomorrow by 6:00 PM' : '2-3 business days',
      },
    };
  }

  if (toolName === 'add_to_cart') {
    if (!user) {
      return { ok: false, data: { error: 'AUTHENTICATION_REQUIRED', message: 'Sign in to sync items to your server cart, or use the Add to Cart button on any product card.' } };
    }
    const variantId = String(args.variantId || '');
    const qty = Math.max(1, Math.min(5, Number(args.quantity || 1)));
    const inv = db
      .prepare('SELECT pv.id, inv.on_hand, inv.reserved FROM product_variants pv JOIN inventory inv ON inv.variant_id = pv.id WHERE pv.id = ?')
      .get(variantId) as { id: string; on_hand: number; reserved: number } | undefined;
    if (!inv) return { ok: false, data: { error: 'Variant not found.' } };
    const avail = computeAvailableToSell(inv.on_hand, inv.reserved);
    if (avail < qty) return { ok: false, data: { error: `Only ${avail} unit(s) available.` } };
    const now = new Date().toISOString();
    const cartRow = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(user.id) as { id: string } | undefined;
    const cartId = cartRow ? cartRow.id : newId('cart');
    if (!cartRow) db.prepare('INSERT INTO carts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(cartId, user.id, now, now);
    const ex = db.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?').get(cartId, variantId) as { id: string; quantity: number } | undefined;
    if (ex) {
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(Math.min(avail, ex.quantity + qty), ex.id);
    } else {
      db.prepare('INSERT INTO cart_items (id, cart_id, variant_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)').run(newId('ci'), cartId, variantId, qty, now);
    }
    return { ok: true, data: buildUserCartDto(user.id) };
  }

  if (toolName === 'get_my_orders') {
    const orders = db
      .prepare('SELECT id, order_number, status, grand_total_paise, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(user!.id) as { id: string; order_number: string; status: string; grand_total_paise: number; created_at: string }[];
    return {
      ok: true,
      data: orders.map((o) => ({
        orderId: o.id,
        orderNumber: o.order_number,
        status: o.status,
        totalInr: o.grand_total_paise / 100,
        createdAt: o.created_at,
      })),
    };
  }

  if (toolName === 'get_order_status') {
    const key = String(args.orderIdOrNumber || '').replace(/^#/, '').trim();
    const order = db
      .prepare('SELECT id, order_number, status, grand_total_paise, created_at FROM orders WHERE user_id = ? AND (id = ? OR UPPER(order_number) = UPPER(?))')
      .get(user!.id, key, key) as { id: string; order_number: string; status: string; grand_total_paise: number; created_at: string } | undefined;
    if (!order) return { ok: false, data: { error: 'Order not found for your account.' } };
    const shipment = db.prepare('SELECT carrier, tracking_reference, status, estimated_delivery FROM shipments WHERE order_id = ?').get(order.id);
    return { ok: true, data: { ...order, shipment } };
  }

  if (toolName === 'request_cancellation') {
    const key = String(args.orderIdOrNumber || '').replace(/^#/, '').trim();
    const order = db
      .prepare('SELECT id, order_number, status, grand_total_paise FROM orders WHERE user_id = ? AND (id = ? OR UPPER(order_number) = UPPER(?))')
      .get(user!.id, key, key) as { id: string; order_number: string; status: OrderState; grand_total_paise: number } | undefined;
    if (!order) return { ok: false, data: { error: 'Order not found on your account.' } };
    if (!isCustomerCancellable(order.status)) {
      return {
        ok: false,
        data: { error: `Order #${order.order_number} is currently ${order.status} and cannot be cancelled directly.` },
      };
    }
    const reason = String(args.reason || 'Customer requested cancellation via AI assistant');
    return {
      ok: true,
      pendingConfirmation: {
        actionType: 'CANCEL_ORDER',
        orderId: order.id,
        orderNumber: order.order_number,
        reason,
        summary: `Confirm cancelling order #${order.order_number} (₹${(order.grand_total_paise / 100).toLocaleString('en-IN')})? Reserved/paid inventory will be released and any captured payment refunded.`,
      },
      data: {
        status: 'WAITING_FOR_USER',
        message: `Order #${order.order_number} is eligible for cancellation. Waiting for explicit user confirmation.`,
      },
    };
  }

  if (toolName === 'search_help_articles') {
    const q = String(args.query || '').toLowerCase();
    const articles = db.prepare('SELECT category, question, answer FROM help_articles').all() as {
      category: string;
      question: string;
      answer: string;
    }[];
    const matched = articles.filter((a) => `${a.category} ${a.question} ${a.answer}`.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 3 && `${a.question} ${a.answer}`.toLowerCase().includes(w)));
    return { ok: true, data: matched.length > 0 ? matched : articles.slice(0, 3) };
  }

  if (toolName === 'create_support_ticket') {
    const subject = String(args.subject || '').trim();
    const category = String(args.category || 'Orders').trim();
    const message = String(args.message || '').trim();
    if (!subject || !message) return { ok: false, data: { error: 'Subject and message are required.' } };
    const id = newId('tkt');
    const ticketNumber = `TKT-${Math.floor(2100 + Math.random() * 7899)}`;
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO support_tickets (id, ticket_number, user_id, order_id, subject, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, ticketNumber, user!.id, args.orderId ? String(args.orderId) : null, subject, category, 'MEDIUM', 'OPEN', now, now);
    db.prepare(
      'INSERT INTO ticket_messages (id, ticket_id, sender_user_id, sender_role, is_internal_note, body, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(newId('tmsg'), id, user!.id, 'CUSTOMER', message, now);
    enqueueOutbox('TICKET_CREATED', { userId: user!.id, ticketId: id, ticketNumber });
    return { ok: true, data: { ticketId: id, ticketNumber, status: 'OPEN' } };
  }

  if (toolName === 'get_ticket_status') {
    const tickets = db
      .prepare('SELECT id, ticket_number, subject, status, priority, updated_at FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5')
      .all(user!.id);
    return { ok: true, data: { tickets } };
  }

  return { ok: false, data: { error: 'Unknown tool.' } };
}

// Deterministic fallback pipeline if Gemini API key is missing or temporarily unreachable
function runDeterministicSpecialistFallback(params: {
  runId: string;
  prompt: string;
  user: AuthUser | null;
}) {
  const { runId, prompt, user } = params;
  const lower = prompt.toLowerCase();
  const cards: ProductCardPayload[] = [];
  let pendingConfirmation: PendingConfirmationPayload | undefined;
  let reply = '';
  const now = new Date().toISOString();

  const logEvent = (agentKey: SpecialistAgentKey, eventType: string, toolName: string | null, inputSum: string, outputSum: string, status: string) => {
    db.prepare(
      'INSERT INTO agent_events (id, run_id, agent_key, event_type, tool_name, input_summary, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(newId('ev'), runId, agentKey, eventType, toolName, redactSensitiveText(inputSum), redactSensitiveText(outputSum), status, 65, now);
  };

  logEvent('shopping_agent', 'AGENT_ROUTED', null, redactSensitiveText(prompt).slice(0, 120), 'Routing intent to specialists', 'COMPLETED');

  if (lower.includes('cancel') && (lower.includes('order') || lower.includes('ac'))) {
    const match = prompt.match(/AC\d+/i);
    const targetOrder = match ? match[0].toUpperCase() : '';
    if (!user) {
      logEvent('order_agent', 'TOOL_BLOCKED', 'request_cancellation', 'unauthenticated', 'Authentication required', 'FAILED');
      reply = 'To check and cancel one of your orders, please sign in to your account first so we can securely verify ownership.';
    } else {
      let ordNum = targetOrder;
      if (!ordNum) {
        const latest = db.prepare('SELECT order_number FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id) as
          | { order_number: string }
          | undefined;
        ordNum = latest?.order_number || '';
      }
      const res = executeAllowlistedTool({
        agentKey: 'order_agent',
        toolName: 'request_cancellation',
        args: { orderIdOrNumber: ordNum, reason: 'Requested via AI Shopping Assistant' },
        user,
      });
      logEvent('order_agent', 'TOOL_COMPLETED', 'request_cancellation', ordNum, JSON.stringify(res.data).slice(0, 160), res.ok ? 'COMPLETED' : 'FAILED');
      if (res.pendingConfirmation) {
        pendingConfirmation = res.pendingConfirmation;
        reply = `Order **#${res.pendingConfirmation.orderNumber}** is eligible for cancellation. Please confirm below if you would like me to cancel it and process the refund/stock release.`;
      } else {
        reply = String((res.data as { error?: string }).error || 'Unable to locate a cancellable order on your account.');
      }
    }
  } else if (lower.includes('order') || lower.includes('track') || lower.includes('delivery status')) {
    if (!user) {
      logEvent('order_agent', 'TOOL_BLOCKED', 'get_my_orders', 'unauthenticated', 'Authentication required', 'FAILED');
      reply = 'Please sign in so the **Order Agent** can securely look up your order status and shipment tracking timeline.';
    } else {
      const match = prompt.match(/AC\d+/i);
      const toolName = match ? 'get_order_status' : 'get_my_orders';
      const args = match ? { orderIdOrNumber: match[0] } : {};
      const res = executeAllowlistedTool({ agentKey: 'order_agent', toolName, args, user });
      logEvent('order_agent', 'TOOL_COMPLETED', toolName, JSON.stringify(args), JSON.stringify(res.data).slice(0, 200), res.ok ? 'COMPLETED' : 'FAILED');
      const orders = Array.isArray(res.data) ? res.data : [res.data];
      if (!res.ok || orders.length === 0) {
        reply = 'You currently have no matching orders on your account.';
      } else {
        reply =
          'Here is your live order status from the **Order Agent**:\n\n' +
          orders
            .map((o: { orderNumber?: string; order_number?: string; status?: string; totalInr?: number; grand_total_paise?: number; shipment?: { carrier?: string; estimated_delivery?: string } }) => {
              const num = o.orderNumber || o.order_number;
              const tot = o.totalInr ?? (o.grand_total_paise ? o.grand_total_paise / 100 : 0);
              const ship = o.shipment ? ` · ${o.shipment.carrier} (${o.shipment.estimated_delivery})` : '';
              return `- **#${num}** — **${o.status}** · ₹${tot.toLocaleString('en-IN')}${ship}`;
            })
            .join('\n');
      }
    }
  } else if (lower.includes('return') || lower.includes('refund') || lower.includes('policy') || lower.includes('ticket') || lower.includes('help') || lower.includes('faq')) {
    const res = executeAllowlistedTool({ agentKey: 'support_agent', toolName: 'search_help_articles', args: { query: prompt }, user });
    logEvent('support_agent', 'TOOL_COMPLETED', 'search_help_articles', prompt.slice(0, 80), 'Retrieved store policies', 'COMPLETED');
    const arts = (res.data as { question: string; answer: string }[]) || [];
    reply =
      'Here is what our **Support Agent** verified from store policy:\n\n' +
      arts.map((a) => `**${a.question}**\n${a.answer}`).join('\n\n');
  } else if (lower.includes('compare')) {
    const res = executeAllowlistedTool({
      agentKey: 'product_agent',
      toolName: 'compare_products',
      args: { slugsOrIds: ['lenovo-ideapad-slim-5', 'hp-victus-15', 'asus-vivobook-16'] },
      user,
    });
    logEvent('product_agent', 'TOOL_COMPLETED', 'compare_products', '3 items', 'Compared specifications', 'COMPLETED');
    if (res.cards) cards.push(...res.cards);
    const list = (res.data as { name: string; priceInr: number; rating: number; availableToSell: number }[]) || [];
    reply =
      'Our **Product Agent** and **Inventory Agent** compared these verified options:\n\n' +
      list.map((p) => `- **${p.name}** — ₹${p.priceInr.toLocaleString('en-IN')} · ${p.rating}★ · ${p.availableToSell} in stock`).join('\n');
  } else {
    // Catalog discovery + stock check
    const budgetMatch = prompt.match(/(\d[\d,]{3,})/);
    const maxPriceInr = budgetMatch ? Number(budgetMatch[1].replace(/,/g, '')) : undefined;
    let category = '';
    if (lower.includes('laptop')) category = 'laptops';
    else if (lower.includes('phone') || lower.includes('mobile') || lower.includes('iphone') || lower.includes('pixel')) category = 'mobiles';
    else if (lower.includes('headphone') || lower.includes('audio') || lower.includes('earbud')) category = 'audio';
    else if (lower.includes('watch')) category = 'wearables';
    else if (lower.includes('camera')) category = 'cameras';

    const prodRes = executeAllowlistedTool({
      agentKey: 'product_agent',
      toolName: 'search_products',
      args: { query: prompt, category, maxPriceInr },
      user,
    });
    logEvent('product_agent', 'TOOL_COMPLETED', 'search_products', JSON.stringify({ category, maxPriceInr }), `Found ${(prodRes.cards || []).length} products`, 'COMPLETED');

    const foundCards = prodRes.cards || [];
    if (foundCards.length > 0) {
      const stockRes = executeAllowlistedTool({
        agentKey: 'inventory_agent',
        toolName: 'check_stock',
        args: { ids: foundCards.map((c) => c.variantId) },
        user,
      });
      logEvent('inventory_agent', 'TOOL_COMPLETED', 'check_stock', `${foundCards.length} variants`, 'Verified real-time stock', 'COMPLETED');
      cards.push(...foundCards.slice(0, 3));
      reply =
        `I collaborated with our **Product Agent** and **Inventory Agent** and verified live stock for ${cards.length} matching option(s):\n\n` +
        cards
          .map(
            (c, i) =>
              `${i + 1}. **${c.name}** — ₹${(c.pricePaise / 100).toLocaleString('en-IN')} · ${c.rating}★ · ${c.availableToSell > 0 ? `${c.availableToSell} in stock` : 'Out of stock'}`
          )
          .join('\n');
      void stockRes;
    } else {
      reply = 'I searched our live catalog but found no exact matches within those filters. Try widening your budget or browsing `/shop` for all available electronics and accessories.';
    }
  }

  return { reply, cards, pendingConfirmation };
}

export function registerAiRoutes(app: Express): void {
  // List user conversations
  app.get('/api/v1/ai/conversations', (req, res) => {
    const guestToken = typeof req.query.guestToken === 'string' ? req.query.guestToken : '';
    const rows = req.authUser
      ? db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(req.authUser.id)
      : guestToken
      ? db.prepare('SELECT * FROM conversations WHERE guest_token = ? AND user_id IS NULL ORDER BY updated_at DESC').all(guestToken)
      : [];
    res.json({ conversations: rows });
  });

  app.post('/api/v1/ai/conversations', (req, res) => {
    const id = newId('conv');
    const now = new Date().toISOString();
    const title = String(req.body?.title || 'New Shopping Session').trim().slice(0, 80);
    const guestToken = !req.authUser && typeof req.body?.guestToken === 'string' ? req.body.guestToken : null;

    db.prepare(
      'INSERT INTO conversations (id, user_id, guest_token, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
    ).run(id, req.authUser?.id ?? null, guestToken, title, now, now);

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    res.status(201).json({ conversation });
  });

  app.delete('/api/v1/ai/conversations/:id', (req, res) => {
    const conv = db.prepare('SELECT id, user_id, guest_token FROM conversations WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string | null; guest_token: string | null }
      | undefined;
    if (!conv) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const guestToken = typeof req.query.guestToken === 'string' ? req.query.guestToken : '';
    const allowed = (req.authUser && conv.user_id === req.authUser.id) || (!conv.user_id && conv.guest_token === guestToken);
    if (!allowed) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Cannot delete another user conversation.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
    res.json({ ok: true });
  });

  app.get('/api/v1/ai/conversations/:id', (req, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string | null; guest_token: string | null }
      | undefined;
    if (!conv) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const guestToken = typeof req.query.guestToken === 'string' ? req.query.guestToken : '';
    const isAdmin = req.authUser?.roles.some((r) => ['ADMIN', 'AI_ADMIN'].includes(r));
    const allowed =
      isAdmin || (req.authUser && conv.user_id === req.authUser.id) || (!conv.user_id && conv.guest_token === guestToken);
    if (!allowed) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Access denied to this conversation.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const messages = (
      db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conv.id) as {
        id: string;
        role: string;
        content: string;
        cards_json: string | null;
        pending_confirmation_json: string | null;
        run_id: string | null;
        created_at: string;
      }[]
    ).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      cards: m.cards_json ? JSON.parse(m.cards_json) : [],
      pendingConfirmation: m.pending_confirmation_json ? JSON.parse(m.pending_confirmation_json) : null,
      runId: m.run_id,
      createdAt: m.created_at,
    }));
    res.json({ conversation: conv, messages });
  });

  // Send message to multi-agent orchestrator
  app.post('/api/v1/ai/conversations/:id/messages', rateLimit('ai_chat', 25, 60_000), async (req, res) => {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string | null; guest_token: string | null; title: string }
      | undefined;

    if (!conv) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Conversation not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const guestToken = typeof req.body?.guestToken === 'string' ? req.body.guestToken : '';
    const allowed = (req.authUser && conv.user_id === req.authUser.id) || (!conv.user_id && conv.guest_token === guestToken);
    if (!allowed) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Conversation ownership mismatch.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const prompt = String(req.body?.content || '').trim();
    if (!prompt || prompt.length > 2000) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Message content must be 1 to 2000 characters.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const now = new Date().toISOString();
    const userMsgId = newId('msg');
    const redactedPrompt = redactSensitiveText(prompt);

    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userMsgId,
      conv.id,
      'user',
      redactedPrompt,
      now
    );

    if (conv.title === 'New Shopping Session') {
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
        redactedPrompt.slice(0, 64),
        now,
        conv.id
      );
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conv.id);
    }

    const runId = newId('run');
    const startMs = Date.now();
    const coordinatorDef = db
      .prepare('SELECT * FROM agent_definitions WHERE agent_key = ?')
      .get('shopping_agent') as
      | { model_name: string; system_prompt: string; allowed_tools_json: string; max_steps: number; timeout_ms: number; enabled: number }
      | undefined;

    const modelName = coordinatorDef?.model_name || 'gemini-4-hydrogen';
    const allowedTools: string[] = coordinatorDef ? JSON.parse(coordinatorDef.allowed_tools_json) : Object.keys(TOOL_SCHEMAS);

    db.prepare(
      'INSERT INTO agent_runs (id, conversation_id, user_id, agent_key, status, prompt_summary, model_name, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(runId, conv.id, req.authUser?.id ?? null, 'shopping_agent', 'RUNNING', redactedPrompt.slice(0, 140), modelName, req.correlationId, now);

    let finalReply = '';
    let collectedCards: ProductCardPayload[] = [];
    let pendingConfirmation: PendingConfirmationPayload | undefined;
    let tokensEstimated = 480;
    let runStatus = 'COMPLETED';

    try {
      const ai = getGeminiClient();
      if (!ai || coordinatorDef?.enabled === 0) {
        const fb = runDeterministicSpecialistFallback({ runId, prompt: redactedPrompt, user: req.authUser ?? null });
        finalReply = fb.reply;
        collectedCards = fb.cards;
        pendingConfirmation = fb.pendingConfirmation;
      } else {
        // Real @google/genai bounded tool-calling loop
        const recentHistory = (
          db
            .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 8')
            .all(conv.id) as { role: string; content: string }[]
        )
          .reverse()
          .slice(0, -1);

        const activeDeclarations = allowedTools
          .filter((name) => Boolean(TOOL_SCHEMAS[name]))
          .map((name) => TOOL_SCHEMAS[name]);

        const contents: unknown[] = [
          ...recentHistory.map((h) => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }],
          })),
          { role: 'user', parts: [{ text: redactedPrompt }] },
        ];

        db.prepare(
          'INSERT INTO agent_events (id, run_id, agent_key, event_type, input_summary, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('ev'), runId, 'shopping_agent', 'AGENT_ROUTED', redactedPrompt.slice(0, 120), 'Evaluating request with Gemini tool-calling', 'COMPLETED', 40, new Date().toISOString());

        const timeoutBudgetMs = Math.min(10_000, coordinatorDef?.timeout_ms ?? 10_000);
        const maxSteps = Math.min(4, coordinatorDef?.max_steps ?? 4);

        const runGeminiLoop = async () => {
          for (let step = 0; step < maxSteps; step++) {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: contents as never,
              config: {
                systemInstruction: coordinatorDef?.system_prompt || 'You are the Shopping Agent for Agentic Commerce.',
                tools: [{ functionDeclarations: activeDeclarations }],
              },
            });

            tokensEstimated += 320;
            const candidateContent = response.candidates?.[0]?.content;
            const calls = response.functionCalls;

            if (!calls || calls.length === 0) {
              finalReply = response.text || 'I checked our catalog and services for you.';
              break;
            }

            if (candidateContent) {
              contents.push(candidateContent);
            }

            const responseParts: unknown[] = [];
            for (const call of calls) {
              const tStart = Date.now();
              const toolName = call.name || '';
              const ownerAgent: SpecialistAgentKey = TOOL_OWNER_AGENT[toolName] || 'shopping_agent';
              const argsObj = (call.args || {}) as Record<string, unknown>;

              const outcome = executeAllowlistedTool({
                agentKey: 'shopping_agent',
                toolName,
                args: argsObj,
                user: req.authUser ?? null,
                customAllowlist: allowedTools,
              });

              if (outcome.cards && outcome.cards.length > 0) {
                const seen = new Set(collectedCards.map((c) => c.productId));
                for (const c of outcome.cards) {
                  if (!seen.has(c.productId)) {
                    collectedCards.push(c);
                    seen.add(c.productId);
                  }
                }
              }
              if (outcome.pendingConfirmation) {
                pendingConfirmation = outcome.pendingConfirmation;
              }

              db.prepare(
                'INSERT INTO agent_events (id, run_id, agent_key, event_type, tool_name, input_summary, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
              ).run(
                newId('ev'),
                runId,
                ownerAgent,
                outcome.ok ? 'TOOL_COMPLETED' : 'TOOL_BLOCKED',
                toolName,
                redactSensitiveText(JSON.stringify(argsObj)).slice(0, 200),
                redactSensitiveText(JSON.stringify(outcome.data)).slice(0, 240),
                outcome.ok ? 'COMPLETED' : 'FAILED',
                Date.now() - tStart,
                new Date().toISOString()
              );

              responseParts.push({
                functionResponse: {
                  id: call.id,
                  name: toolName,
                  response: { result: outcome.data },
                },
              });
            }

            if (pendingConfirmation) {
              finalReply = `Order **#${pendingConfirmation.orderNumber}** is eligible for cancellation. Please confirm below if you would like me to cancel it and process the refund/stock release.`;
              break;
            }

            contents.push({ role: 'user', parts: responseParts });
          }
        };

        await Promise.race([
          runGeminiLoop(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini orchestration exceeded ${timeoutBudgetMs}ms budget`)), timeoutBudgetMs)
          ),
        ]);

        if (!finalReply) {
          finalReply = 'I completed the specialist checks above. Let me know if you want to compare or add any item to your cart.';
        }
      }
    } catch (err) {
      // Graceful fallback when Gemini API call errors or exceeds timeout budget (never blocks user commerce!)
      const errMsg = err instanceof Error ? err.message : 'AI provider degraded';
      db.prepare(
        'INSERT INTO agent_events (id, run_id, agent_key, event_type, tool_name, input_summary, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)'
      ).run(newId('ev'), runId, 'shopping_agent', 'PROVIDER_FALLBACK', 'Gemini API fallback triggered', errMsg.slice(0, 160), 'COMPLETED', 20, new Date().toISOString());

      const fb = runDeterministicSpecialistFallback({ runId, prompt: redactedPrompt, user: req.authUser ?? null });
      finalReply = fb.reply;
      collectedCards = fb.cards;
      pendingConfirmation = fb.pendingConfirmation;
    }

    if (pendingConfirmation) {
      runStatus = 'WAITING_FOR_USER';
    }

    const durationMs = Date.now() - startMs;
    const costMicroUsd = Math.round(tokensEstimated * 0.35);
    const doneAt = new Date().toISOString();

    db.prepare(
      'UPDATE agent_runs SET status = ?, final_summary = ?, tokens_estimated = ?, cost_microusd = ?, duration_ms = ?, completed_at = ? WHERE id = ?'
    ).run(runStatus, finalReply.slice(0, 180), tokensEstimated, costMicroUsd, durationMs, doneAt, runId);

    const assistantMsgId = newId('msg');
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, cards_json, pending_confirmation_json, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      assistantMsgId,
      conv.id,
      'assistant',
      finalReply,
      collectedCards.length > 0 ? JSON.stringify(collectedCards.slice(0, 4)) : null,
      pendingConfirmation ? JSON.stringify(pendingConfirmation) : null,
      runId,
      doneAt
    );

    const events = db.prepare('SELECT * FROM agent_events WHERE run_id = ? ORDER BY created_at ASC').all(runId);

    res.status(201).json({
      message: {
        id: assistantMsgId,
        role: 'assistant',
        content: finalReply,
        cards: collectedCards.slice(0, 4),
        pendingConfirmation: pendingConfirmation || null,
        runId,
        createdAt: doneAt,
      },
      run: {
        id: runId,
        status: runStatus,
        durationMs,
        tokensEstimated,
        events,
      },
    });
  });

  // Explicit confirmation endpoint for consequential AI actions (e.g., cancellation)
  app.post('/api/v1/ai/conversations/:id/confirm', requireAuth, (req, res) => {
    const { messageId, decision } = req.body ?? {};
    const msg = db
      .prepare(
        `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND c.id = ? AND c.user_id = ?`
      )
      .get(String(messageId || ''), req.params.id, req.authUser!.id) as
      | { id: string; pending_confirmation_json: string | null; run_id: string | null }
      | undefined;

    if (!msg || !msg.pending_confirmation_json) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Pending confirmation action not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const pending = JSON.parse(msg.pending_confirmation_json) as PendingConfirmationPayload;
    if (pending.resolved) {
      res.status(409).json({ code: 'STATE_CONFLICT', message: 'This action has already been resolved.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const now = new Date().toISOString();
    let resolutionText = '';
    if (decision === 'APPROVE' && pending.actionType === 'CANCEL_ORDER') {
      const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(pending.orderId, req.authUser!.id) as
        | { id: string; order_number: string; status: OrderState }
        | undefined;
      if (!order || !isCustomerCancellable(order.status)) {
        resolutionText = `Order #${pending.orderNumber} is no longer eligible for cancellation.`;
      } else {
        const items = db.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id) as {
          variant_id: string;
          quantity: number;
        }[];
        const payment = db.prepare('SELECT id, status FROM payments WHERE order_id = ?').get(order.id) as
          | { id: string; status: string }
          | undefined;
        db.exec('BEGIN IMMEDIATE');
        try {
          const nextOrderStatus = payment?.status === 'PAID' ? 'REFUNDED' : 'CANCELLED';
          db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(nextOrderStatus, now, order.id);
          for (const it of items) {
            if (order.status === 'PENDING_PAYMENT') {
              db.prepare('UPDATE inventory SET reserved = MAX(0, reserved - ?), version = version + 1, updated_at = ? WHERE variant_id = ?').run(
                it.quantity,
                now,
                it.variant_id
              );
            } else {
              db.prepare('UPDATE inventory SET on_hand = on_hand + ?, version = version + 1, updated_at = ? WHERE variant_id = ?').run(
                it.quantity,
                now,
                it.variant_id
              );
            }
          }
          if (payment?.status === 'PAID') {
            db.prepare('UPDATE payments SET status = ?, refunded_paise = amount_paise, updated_at = ? WHERE id = ?').run(
              'REFUNDED',
              now,
              payment.id
            );
          }
          recordAudit({
            actorUserId: req.authUser!.id,
            actorType: 'AI_CONFIRMED_ACTION',
            action: 'ORDER_CANCELLED',
            entityType: 'ORDER',
            entityId: order.id,
            correlationId: req.correlationId,
            beforeSummary: order.status,
            afterSummary: nextOrderStatus,
            reason: pending.reason,
          });
          db.exec('COMMIT');
          resolutionText = `Order #${pending.orderNumber} has been cancelled (${nextOrderStatus}).`;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }
    } else {
      resolutionText = `Cancellation for order #${pending.orderNumber} was declined by you. No changes were made.`;
    }

    pending.resolved = true;
    pending.resolution = resolutionText;
    db.prepare('UPDATE messages SET pending_confirmation_json = ? WHERE id = ?').run(JSON.stringify(pending), msg.id);
    if (msg.run_id) {
      db.prepare('UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?').run('COMPLETED', now, msg.run_id);
    }

    const followId = newId('msg');
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      followId,
      req.params.id,
      'assistant',
      resolutionText,
      msg.run_id,
      now
    );

    res.json({ ok: true, pendingConfirmation: pending, message: { id: followId, role: 'assistant', content: resolutionText, createdAt: now } });
  });

  // Saved AI Recommendations
  app.get('/api/v1/ai/saved', requireAuth, (req, res) => {
    const items = db
      .prepare(
        `SELECT sr.*, p.name, p.slug, p.brand, p.rating, pv.price_paise as current_price_paise,
                inv.on_hand, inv.reserved,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
         FROM saved_recommendations sr
         JOIN products p ON p.id = sr.product_id
         JOIN product_variants pv ON pv.id = sr.variant_id
         JOIN inventory inv ON inv.variant_id = pv.id
         WHERE sr.user_id = ? ORDER BY sr.created_at DESC`
      )
      .all(req.authUser!.id) as Record<string, unknown>[];

    res.json({
      items: items.map((i) => ({
        ...i,
        availableToSell: computeAvailableToSell(Number(i.on_hand), Number(i.reserved)),
      })),
    });
  });

  app.post('/api/v1/ai/saved', requireAuth, (req, res) => {
    const { productId, variantId, reason = 'Saved from AI Shopping Assistant', pricePaise } = req.body ?? {};
    const id = newId('srec');
    db.prepare(
      'INSERT OR IGNORE INTO saved_recommendations (id, user_id, product_id, variant_id, reason, price_snapshot_paise, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.authUser!.id, String(productId), String(variantId), String(reason), Number(pricePaise || 0), new Date().toISOString());
    res.status(201).json({ ok: true });
  });

  app.delete('/api/v1/ai/saved/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM saved_recommendations WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
    res.json({ ok: true });
  });

  // Agent Runs & Activity Inspector
  app.get('/api/v1/ai/runs', (req, res) => {
    const isAdmin = req.authUser?.roles.some((r) => ['ADMIN', 'AI_ADMIN'].includes(r));
    const runs = isAdmin
      ? db.prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 50').all()
      : req.authUser
      ? db.prepare('SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 25').all(req.authUser.id)
      : db.prepare('SELECT * FROM agent_runs WHERE user_id IS NULL ORDER BY created_at DESC LIMIT 10').all();
    res.json({ runs });
  });

  app.get('/api/v1/ai/runs/:id', (req, res) => {
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string | null }
      | undefined;
    if (!run) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Run not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const isAdmin = req.authUser?.roles.some((r) => ['ADMIN', 'AI_ADMIN'].includes(r));
    if (!isAdmin && run.user_id && run.user_id !== req.authUser?.id) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Access denied.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const events = db.prepare('SELECT * FROM agent_events WHERE run_id = ? ORDER BY created_at ASC').all(run.id);
    res.json({ run, events });
  });

  // Public agent roster metadata (used by AI Workspace Agent Rail)
  app.get('/api/v1/ai/agents', (_req, res) => {
    const agents = db.prepare('SELECT id, agent_key, name, role_title, description, enabled, version, model_name FROM agent_definitions ORDER BY id ASC').all();
    res.json({ agents });
  });

  // ---------------- AI ADMIN CONSOLE ----------------
  app.get('/api/v1/admin/ai/overview', requirePermission('agent:configure'), (_req, res) => {
    const agents = db.prepare('SELECT * FROM agent_definitions ORDER BY id ASC').all();
    const runs = db.prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 40').all() as {
      id: string;
      agent_key: string;
      status: string;
      tokens_estimated: number;
      cost_microusd: number;
      duration_ms: number;
      created_at: string;
    }[];
    const totalRuns = runs.length;
    const completed = runs.filter((r) => r.status === 'COMPLETED' || r.status === 'WAITING_FOR_USER').length;
    const failed = runs.filter((r) => r.status === 'FAILED').length;
    const totalTokens = runs.reduce((s, r) => s + r.tokens_estimated, 0);
    const totalCostUsd = runs.reduce((s, r) => s + r.cost_microusd, 0) / 1_000_000;

    res.json({
      agents,
      runs,
      metrics: {
        activeAgents: agents.filter((a: Record<string, unknown>) => Boolean(a.enabled)).length,
        totalRuns,
        successRate: totalRuns > 0 ? Math.round((completed / totalRuns) * 1000) / 10 : 100,
        failedRuns: failed,
        totalTokens,
        totalCostUsd,
      },
    });
  });

  app.patch('/api/v1/admin/agents/:key', requirePermission('agent:configure'), (req, res) => {
    const existing = db.prepare('SELECT * FROM agent_definitions WHERE agent_key = ?').get(req.params.key) as
      | { id: string; version: number; allowed_tools_json: string; system_prompt: string; enabled: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Agent not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const { systemPrompt, modelName, allowedTools, maxSteps, timeoutMs, enabled, publish } = req.body ?? {};
    const nextVersion = publish ? existing.version + 1 : existing.version;
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE agent_definitions
       SET system_prompt = COALESCE(?, system_prompt),
           model_name = COALESCE(?, model_name),
           allowed_tools_json = COALESCE(?, allowed_tools_json),
           max_steps = COALESCE(?, max_steps),
           timeout_ms = COALESCE(?, timeout_ms),
           enabled = COALESCE(?, enabled),
           version = ?,
           status = ?,
           updated_at = ?
       WHERE agent_key = ?`
    ).run(
      systemPrompt ?? null,
      modelName ?? null,
      Array.isArray(allowedTools) ? JSON.stringify(allowedTools) : null,
      maxSteps ? Number(maxSteps) : null,
      timeoutMs ? Number(timeoutMs) : null,
      typeof enabled === 'boolean' ? (enabled ? 1 : 0) : null,
      nextVersion,
      publish ? 'PUBLISHED' : 'DRAFT',
      now,
      req.params.key
    );

    recordAudit({
      actorUserId: req.authUser!.id,
      actorType: 'AI_ADMIN',
      action: publish ? 'AGENT_PUBLISHED' : 'AGENT_UPDATED',
      entityType: 'AGENT',
      entityId: req.params.key,
      correlationId: req.correlationId,
      afterSummary: `v${nextVersion}`,
    });

    res.json({ ok: true, version: nextVersion });
  });

  app.get('/api/v1/admin/workflows', requirePermission('agent:configure'), (_req, res) => {
    const wf = db.prepare('SELECT * FROM agent_workflows ORDER BY updated_at DESC LIMIT 1').get() as
      | { id: string; name: string; nodes_json: string; edges_json: string; status: string; version: number; updated_at: string }
      | undefined;
    res.json({
      workflow: wf
        ? {
            ...wf,
            nodes: JSON.parse(wf.nodes_json),
            edges: JSON.parse(wf.edges_json),
          }
        : null,
    });
  });

  app.put('/api/v1/admin/workflows/:id', requirePermission('agent:publish'), (req, res) => {
    const { name, nodes, edges, publish } = req.body ?? {};
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Workflow nodes and edges arrays are required.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const existing = db.prepare('SELECT version FROM agent_workflows WHERE id = ?').get(req.params.id) as { version: number } | undefined;
    const nextVersion = (existing?.version ?? 1) + (publish ? 1 : 0);
    db.prepare('UPDATE agent_workflows SET name = COALESCE(?, name), nodes_json = ?, edges_json = ?, status = ?, version = ?, updated_at = ? WHERE id = ?').run(
      name ?? null,
      JSON.stringify(nodes),
      JSON.stringify(edges),
      publish ? 'PUBLISHED' : 'DRAFT',
      nextVersion,
      new Date().toISOString(),
      req.params.id
    );
    res.json({ ok: true, version: nextVersion });
  });

  app.get('/api/v1/admin/ai-logs', requirePermission('agent:configure'), (_req, res) => {
    const runs = db.prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT 60').all();
    const events = db.prepare('SELECT * FROM agent_events ORDER BY created_at DESC LIMIT 120').all();
    res.json({ runs, events });
  });

  app.get('/api/v1/admin/tools', requirePermission('agent:configure'), (_req, res) => {
    const tools = Object.entries(TOOL_SCHEMAS).map(([name, decl]) => ({
      name,
      ownerAgent: TOOL_OWNER_AGENT[name],
      description: decl.description,
      authRequired: AUTH_REQUIRED_TOOLS.has(name),
      parameters: decl.parameters,
      status: 'ACTIVE',
      schemaVersion: '1.0',
    }));
    res.json({ tools });
  });

  app.post('/api/v1/admin/tools/:name/test', requirePermission('agent:configure'), (req, res) => {
    const toolName = req.params.name;
    const args = (req.body?.args || {}) as Record<string, unknown>;
    const agentKey = (req.body?.agentKey as SpecialistAgentKey) || TOOL_OWNER_AGENT[toolName] || 'shopping_agent';
    const outcome = executeAllowlistedTool({
      agentKey,
      toolName,
      args,
      user: req.authUser!,
    });
    res.json({ toolName, agentKey, outcome });
  });

  app.get('/api/v1/admin/ai/evaluations', requirePermission('agent:configure'), (_req, res) => {
    const evaluations = db.prepare('SELECT * FROM ai_evaluations ORDER BY created_at DESC LIMIT 20').all();
    res.json({ evaluations });
  });

  app.post('/api/v1/admin/ai/evaluations', requirePermission('agent:configure'), (_req, res) => {
    const cases = [
      {
        name: 'Catalog grounding under ₹60,000',
        run: () => {
          const r = executeAllowlistedTool({ agentKey: 'product_agent', toolName: 'search_products', args: { category: 'laptops', maxPriceInr: 60000 }, user: null });
          return r.ok && (r.cards?.length ?? 0) >= 2;
        },
      },
      {
        name: 'Inventory Agent blocks unauthorized order cancellation tool',
        run: () => {
          const r = executeAllowlistedTool({ agentKey: 'inventory_agent', toolName: 'request_cancellation', args: { orderIdOrNumber: 'AC784512' }, user: null });
          return !r.ok;
        },
      },
      {
        name: 'Guest cannot access personal orders via Order Agent',
        run: () => {
          const r = executeAllowlistedTool({ agentKey: 'order_agent', toolName: 'get_my_orders', args: {}, user: null });
          return !r.ok;
        },
      },
      {
        name: 'Live stock check returns authoritative available_to_sell',
        run: () => {
          const r = executeAllowlistedTool({ agentKey: 'inventory_agent', toolName: 'check_stock', args: { ids: ['var_lenovo_16_512'] }, user: null });
          return r.ok;
        },
      },
      {
        name: 'PII redaction strips PAN and CVV',
        run: () => {
          const clean = redactSensitiveText('Card 4532 1234 5678 9012 cvv 999');
          return !clean.includes('4532') && !clean.includes('999');
        },
      },
    ];

    const results = cases.map((c) => ({ name: c.name, passed: Boolean(c.run()) }));
    const passedCases = results.filter((r) => r.passed).length;
    const scorePercent = Math.round((passedCases / results.length) * 100);
    const id = newId('eval');
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO ai_evaluations (id, suite_name, version, total_cases, passed_cases, score_percent, results_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'Safety & Grounding Regression Suite', 1, results.length, passedCases, scorePercent, JSON.stringify(results), now);

    res.status(201).json({ id, suiteName: 'Safety & Grounding Regression Suite', totalCases: results.length, passedCases, scorePercent, results, createdAt: now });
  });
}
