import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { db, newId } from './db';
import { requireAuth, requirePermission } from './auth';
import {
  calculatePricingBreakdown,
  canRefundAmount,
  canTransitionOrder,
  canTransitionPayment,
  computeAvailableToSell,
  isCustomerCancellable,
  isCustomerReturnable,
  validateStockAdjustment,
  type CouponPolicyInput,
  type OrderState,
  type PaymentState,
} from '../src/domain/commercePolicy';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'aurora_pay_webhook_dev_secret_2026';

export function signWebhookPayload(rawJson: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawJson).digest('hex');
}

export function verifyWebhookSignature(rawJson: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = signWebhookPayload(rawJson);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function recordAudit(params: {
  actorUserId?: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  beforeSummary?: string | null;
  afterSummary?: string | null;
  reason?: string | null;
}): void {
  db.prepare(
    'INSERT INTO audit_logs (id, occurred_at, actor_user_id, actor_type, action, entity_type, entity_id, correlation_id, before_summary, after_summary, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    newId('aud'),
    new Date().toISOString(),
    params.actorUserId ?? null,
    params.actorType,
    params.action,
    params.entityType,
    params.entityId,
    params.correlationId,
    params.beforeSummary ?? null,
    params.afterSummary ?? null,
    params.reason ?? null
  );
}

export function enqueueOutbox(eventType: string, payload: Record<string, unknown>): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO outbox_events (id, event_type, payload_json, status, retries, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(newId('out'), eventType, JSON.stringify(payload), 'PENDING', now, now);
}

function getStoreConfig() {
  const row = db.prepare('SELECT value_json FROM store_settings WHERE key = ?').get('general') as
    | { value_json: string }
    | undefined;
  const parsed = row ? JSON.parse(row.value_json) : {};
  return {
    freeShippingThresholdPaise: Number(parsed.freeShippingThresholdPaise ?? 99900),
    gstRateBps: Number(parsed.gstRateBps ?? 1800),
    taxInclusive: parsed.taxInclusive !== false,
  };
}

function loadCouponForUser(code: string, userId: string): CouponPolicyInput | null {
  const row = db
    .prepare('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?)')
    .get(code.trim()) as
    | {
        id: string;
        code: string;
        discount_type: 'PERCENT' | 'FLAT';
        discount_value: number;
        max_discount_paise: number | null;
        min_order_paise: number;
        starts_at: string | null;
        expires_at: string | null;
        usage_limit: number | null;
        used_count: number;
        per_user_limit: number;
        active: number;
      }
    | undefined;
  if (!row) return null;
  const userUsed = (
    db
      .prepare('SELECT COUNT(*) as c FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?')
      .get(row.id, userId) as { c: number }
  ).c;
  return {
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    maxDiscountPaise: row.max_discount_paise,
    minOrderPaise: row.min_order_paise,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    active: Boolean(row.active),
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    userUsedCount: userUsed,
    perUserLimit: row.per_user_limit,
  };
}

function getOrCreateCartId(userId: string): string {
  const existing = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(userId) as { id: string } | undefined;
  if (existing) return existing.id;
  const cartId = newId('cart');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO carts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    cartId,
    userId,
    now,
    now
  );
  return cartId;
}

export function buildUserCartDto(userId: string) {
  const cartId = getOrCreateCartId(userId);
  const rows = db
    .prepare(
      `SELECT ci.id as cart_item_id, ci.quantity, pv.id as variant_id, pv.sku, pv.title as variant_title,
              pv.price_paise, pv.mrp_paise, pv.status as variant_status,
              p.id as product_id, p.name as product_name, p.slug, p.brand, p.status as product_status,
              inv.on_hand, inv.reserved,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
       FROM cart_items ci
       JOIN product_variants pv ON pv.id = ci.variant_id
       JOIN products p ON p.id = pv.product_id
       JOIN inventory inv ON inv.variant_id = pv.id
       WHERE ci.cart_id = ?
       ORDER BY ci.created_at DESC`
    )
    .all(cartId) as {
    cart_item_id: string;
    quantity: number;
    variant_id: string;
    sku: string;
    variant_title: string;
    price_paise: number;
    mrp_paise: number;
    variant_status: string;
    product_id: string;
    product_name: string;
    slug: string;
    brand: string;
    product_status: string;
    on_hand: number;
    reserved: number;
    image_url: string | null;
  }[];

  const items = rows.map((r) => {
    const availableToSell = computeAvailableToSell(r.on_hand, r.reserved);
    return {
      id: r.cart_item_id,
      productId: r.product_id,
      variantId: r.variant_id,
      slug: r.slug,
      name: r.product_name,
      brand: r.brand,
      variantTitle: r.variant_title,
      sku: r.sku,
      imageUrl: r.image_url,
      unitPricePaise: r.price_paise,
      mrpPaise: r.mrp_paise,
      quantity: r.quantity,
      lineTotalPaise: r.price_paise * r.quantity,
      availableToSell,
      inStock: r.product_status === 'ACTIVE' && r.variant_status === 'ACTIVE' && availableToSell >= r.quantity,
    };
  });

  const cfg = getStoreConfig();
  const pricing = calculatePricingBreakdown({
    lines: items.map((i) => ({ variantId: i.variantId, unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
    shippingMethod: 'STANDARD',
    freeShippingThresholdPaise: cfg.freeShippingThresholdPaise,
    taxRateBps: cfg.gstRateBps,
    taxInclusive: cfg.taxInclusive,
  });

  return {
    cartId,
    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    ...pricing,
  };
}

export function applyPaymentWebhookEvent(params: {
  provider: string;
  providerEventId: string;
  providerReference: string;
  eventType: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED';
  amountPaise: number;
  currency: string;
  rawPayload: string;
  correlationId: string;
}): { duplicate: boolean; paymentStatus: PaymentState; orderStatus: OrderState; orderId: string } {
  const existingEvent = db
    .prepare('SELECT id FROM payment_events WHERE provider_event_id = ?')
    .get(params.providerEventId) as { id: string } | undefined;

  const payment = db
    .prepare('SELECT id, order_id, amount_paise, currency, status FROM payments WHERE provider_reference = ?')
    .get(params.providerReference) as
    | { id: string; order_id: string; amount_paise: number; currency: string; status: PaymentState }
    | undefined;

  if (!payment) {
    throw Object.assign(new Error('Payment reference not found.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  const order = db
    .prepare('SELECT id, order_number, user_id, status, coupon_code FROM orders WHERE id = ?')
    .get(payment.order_id) as
    | { id: string; order_number: string; user_id: string; status: OrderState; coupon_code: string | null }
    | undefined;

  if (!order) {
    throw Object.assign(new Error('Order not found for payment.'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  if (existingEvent) {
    return {
      duplicate: true,
      paymentStatus: payment.status,
      orderStatus: order.status,
      orderId: order.id,
    };
  }

  if (payment.amount_paise !== params.amountPaise || payment.currency !== params.currency) {
    throw Object.assign(new Error('Webhook amount or currency mismatch.'), {
      statusCode: 409,
      code: 'STATE_CONFLICT',
    });
  }

  const now = new Date().toISOString();
  const orderItems = db
    .prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?')
    .all(order.id) as { variant_id: string; quantity: number }[];

  let nextPaymentStatus = payment.status;
  let nextOrderStatus = order.status;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO payment_events (id, payment_id, provider_event_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newId('pev'), payment.id, params.providerEventId, params.eventType, params.rawPayload, now);

    if (params.eventType === 'PAYMENT_SUCCEEDED') {
      if (canTransitionPayment(payment.status, 'PAID')) {
        nextPaymentStatus = 'PAID';
        db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run('PAID', now, payment.id);
      }
      if (canTransitionOrder(order.status, 'CONFIRMED')) {
        nextOrderStatus = 'CONFIRMED';
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('CONFIRMED', now, order.id);

        // Convert stock reservation to sale: on_hand -= qty; reserved -= qty
        for (const item of orderItems) {
          db.prepare(
            'UPDATE inventory SET on_hand = on_hand - ?, reserved = reserved - ?, version = version + 1, updated_at = ? WHERE variant_id = ? AND reserved >= ? AND on_hand >= ?'
          ).run(item.quantity, item.quantity, now, item.variant_id, item.quantity, item.quantity);

          db.prepare(
            'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('mov'), item.variant_id, 'SALE_CONFIRMED', -item.quantity, order.id, `Order #${order.order_number} payment verified`, order.user_id, now);
        }

        // Record coupon redemption if applied
        if (order.coupon_code) {
          const cpn = db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code) as { id: string } | undefined;
          if (cpn) {
            db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(cpn.id);
            db.prepare('INSERT INTO coupon_redemptions (id, coupon_id, user_id, order_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
              newId('cred'),
              cpn.id,
              order.user_id,
              order.id,
              now
            );
          }
        }

        // Clear customer's cart after confirmed order
        const cart = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(order.user_id) as { id: string } | undefined;
        if (cart) {
          db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
        }

        // Update shipment timeline
        const shp = db.prepare('SELECT id, timeline_json FROM shipments WHERE order_id = ?').get(order.id) as
          | { id: string; timeline_json: string }
          | undefined;
        if (shp) {
          const tl = JSON.parse(shp.timeline_json || '[]');
          tl.push({
            state: 'CONFIRMED',
            label: 'Confirmed',
            timestamp: now,
            detail: `Payment verified (${params.providerReference})`,
          });
          db.prepare('UPDATE shipments SET status = ?, timeline_json = ?, updated_at = ? WHERE id = ?').run(
            'AWAITING_DISPATCH',
            JSON.stringify(tl),
            now,
            shp.id
          );
        }

        enqueueOutbox('ORDER_CONFIRMED', {
          userId: order.user_id,
          orderId: order.id,
          orderNumber: order.order_number,
        });
      }
    } else if (params.eventType === 'PAYMENT_FAILED') {
      if (canTransitionPayment(payment.status, 'FAILED')) {
        nextPaymentStatus = 'FAILED';
        db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run('FAILED', now, payment.id);
      }
      if (order.status === 'PENDING_PAYMENT' && canTransitionOrder(order.status, 'CANCELLED')) {
        nextOrderStatus = 'CANCELLED';
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('CANCELLED', now, order.id);
        for (const item of orderItems) {
          db.prepare(
            'UPDATE inventory SET reserved = MAX(0, reserved - ?), version = version + 1, updated_at = ? WHERE variant_id = ?'
          ).run(item.quantity, now, item.variant_id);
          db.prepare(
            'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('mov'), item.variant_id, 'RESERVATION_RELEASED', 0, order.id, `Payment failed for #${order.order_number}`, order.user_id, now);
        }
        enqueueOutbox('PAYMENT_FAILED', {
          userId: order.user_id,
          orderId: order.id,
          orderNumber: order.order_number,
        });
      }
    }

    recordAudit({
      actorUserId: order.user_id,
      actorType: 'PAYMENT_WEBHOOK',
      action: params.eventType,
      entityType: 'ORDER',
      entityId: order.id,
      correlationId: params.correlationId,
      beforeSummary: `${order.status} / ${payment.status}`,
      afterSummary: `${nextOrderStatus} / ${nextPaymentStatus}`,
      reason: `Provider event ${params.providerEventId}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    duplicate: false,
    paymentStatus: nextPaymentStatus,
    orderStatus: nextOrderStatus,
    orderId: order.id,
  };
}

export function registerCommerceRoutes(app: Express): void {
  // ---------------- PUBLIC CATALOG ----------------
  app.get('/api/v1/categories', (_req, res) => {
    const categories = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'ACTIVE') as product_count
         FROM categories c WHERE c.status = 'ACTIVE' ORDER BY c.sort_order ASC`
      )
      .all();
    res.json({ categories });
  });

  app.get('/api/v1/products', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : '';
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : 0;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : Number.MAX_SAFE_INTEGER;
    const minRating = req.query.minRating ? Number(req.query.minRating) : 0;
    const inStockOnly = req.query.inStock === 'true';
    const featuredOnly = req.query.featured === 'true';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'popular';
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize || 12)));

    const rows = db
      .prepare(
        `SELECT p.*, c.name as category_name, c.slug as category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'ACTIVE'`
      )
      .all() as {
      id: string;
      category_id: string;
      category_name: string;
      category_slug: string;
      name: string;
      slug: string;
      brand: string;
      short_description: string;
      description: string;
      specs_json: string;
      badge: string | null;
      rating: number;
      review_count: number;
      featured: number;
      created_at: string;
    }[];

    const enriched = rows
      .map((p) => {
        const variants = db
          .prepare(
            `SELECT pv.*, inv.on_hand, inv.reserved
             FROM product_variants pv
             JOIN inventory inv ON inv.variant_id = pv.id
             WHERE pv.product_id = ? AND pv.status = 'ACTIVE'
             ORDER BY pv.price_paise ASC`
          )
          .all(p.id) as {
          id: string;
          sku: string;
          title: string;
          attributes_json: string;
          price_paise: number;
          mrp_paise: number;
          on_hand: number;
          reserved: number;
        }[];

        const images = db
          .prepare('SELECT id, url, alt_text, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC')
          .all(p.id) as { id: string; url: string; alt_text: string; sort_order: number }[];

        const defaultVar = variants[0];
        const totalAvailable = variants.reduce((s, v) => s + computeAvailableToSell(v.on_hand, v.reserved), 0);

        return {
          id: p.id,
          categoryId: p.category_id,
          categoryName: p.category_name,
          categorySlug: p.category_slug,
          name: p.name,
          slug: p.slug,
          brand: p.brand,
          shortDescription: p.short_description,
          description: p.description,
          specs: JSON.parse(p.specs_json || '{}'),
          badge: p.badge,
          rating: p.rating,
          reviewCount: p.review_count,
          featured: Boolean(p.featured),
          pricePaise: defaultVar?.price_paise ?? 0,
          mrpPaise: defaultVar?.mrp_paise ?? 0,
          defaultVariantId: defaultVar?.id ?? null,
          availableToSell: totalAvailable,
          imageUrl: images[0]?.url ?? null,
          images,
          variants: variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            title: v.title,
            attributes: JSON.parse(v.attributes_json || '{}'),
            pricePaise: v.price_paise,
            mrpPaise: v.mrp_paise,
            availableToSell: computeAvailableToSell(v.on_hand, v.reserved),
          })),
          createdAt: p.created_at,
        };
      })
      .filter((p) => {
        if (q) {
          const hay = `${p.name} ${p.brand} ${p.shortDescription} ${p.categoryName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (category && category !== 'all' && p.categorySlug !== category && p.categoryId !== category) return false;
        if (brand && p.brand.toLowerCase() !== brand.toLowerCase()) return false;
        if (p.pricePaise < minPrice || p.pricePaise > maxPrice) return false;
        if (p.rating < minRating) return false;
        if (inStockOnly && p.availableToSell <= 0) return false;
        if (featuredOnly && !p.featured) return false;
        return true;
      });

    enriched.sort((a, b) => {
      if (sort === 'price_asc') return a.pricePaise - b.pricePaise;
      if (sort === 'price_desc') return b.pricePaise - a.pricePaise;
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
      return b.reviewCount - a.reviewCount;
    });

    const total = enriched.length;
    const start = (page - 1) * pageSize;
    const paged = enriched.slice(start, start + pageSize);
    const brands = Array.from(new Set(rows.map((r) => r.brand))).sort();

    res.json({
      products: paged,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      brands,
    });
  });

  app.get('/api/v1/products/:slugOrId', (req, res) => {
    const key = req.params.slugOrId;
    const p = db
      .prepare(
        `SELECT p.*, c.name as category_name, c.slug as category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE (p.slug = ? OR p.id = ?) AND p.status = 'ACTIVE'`
      )
      .get(key, key) as
      | {
          id: string;
          category_id: string;
          category_name: string;
          category_slug: string;
          name: string;
          slug: string;
          brand: string;
          short_description: string;
          description: string;
          specs_json: string;
          badge: string | null;
          rating: number;
          review_count: number;
        }
      | undefined;

    if (!p) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const variants = (
      db
        .prepare(
          `SELECT pv.*, inv.on_hand, inv.reserved FROM product_variants pv
           JOIN inventory inv ON inv.variant_id = pv.id
           WHERE pv.product_id = ? AND pv.status = 'ACTIVE' ORDER BY pv.price_paise ASC`
        )
        .all(p.id) as {
        id: string;
        sku: string;
        title: string;
        attributes_json: string;
        price_paise: number;
        mrp_paise: number;
        on_hand: number;
        reserved: number;
      }[]
    ).map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      attributes: JSON.parse(v.attributes_json || '{}'),
      pricePaise: v.price_paise,
      mrpPaise: v.mrp_paise,
      availableToSell: computeAvailableToSell(v.on_hand, v.reserved),
    }));

    const images = db
      .prepare('SELECT id, url, alt_text, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order ASC')
      .all(p.id);
    const reviews = db
      .prepare('SELECT id, author_name, rating, title, comment, verified_purchase, created_at FROM product_reviews WHERE product_id = ? ORDER BY created_at DESC')
      .all(p.id);

    const related = db
      .prepare(
        `SELECT p.id, p.name, p.slug, p.brand, p.rating, p.review_count,
                (SELECT price_paise FROM product_variants WHERE product_id = p.id AND status='ACTIVE' ORDER BY price_paise ASC LIMIT 1) as price_paise,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
         FROM products p WHERE p.category_id = ? AND p.id != ? AND p.status = 'ACTIVE' LIMIT 4`
      )
      .all(p.category_id, p.id);

    res.json({
      product: {
        id: p.id,
        categoryId: p.category_id,
        categoryName: p.category_name,
        categorySlug: p.category_slug,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        shortDescription: p.short_description,
        description: p.description,
        specs: JSON.parse(p.specs_json || '{}'),
        badge: p.badge,
        rating: p.rating,
        reviewCount: p.review_count,
        variants,
        images,
        reviews,
        related,
      },
    });
  });

  app.post('/api/v1/products/:id/reviews', requireAuth, (req, res) => {
    const productId = req.params.id;
    const { rating, title, comment } = req.body ?? {};
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5 || !title?.trim() || !comment?.trim()) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Rating (1-5), review title, and comment are required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const prod = db.prepare('SELECT id FROM products WHERE id = ? AND status = ?').get(productId, 'ACTIVE');
    if (!prod) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const now = new Date().toISOString();
    const revId = newId('rev');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'INSERT INTO product_reviews (id, product_id, user_id, author_name, rating, title, comment, verified_purchase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
      ).run(revId, productId, req.authUser!.id, req.authUser!.name, numRating, title.trim(), comment.trim(), now);
      const stats = db
        .prepare('SELECT AVG(rating) as avg_r, COUNT(*) as cnt FROM product_reviews WHERE product_id = ?')
        .get(productId) as { avg_r: number; cnt: number };
      db.prepare('UPDATE products SET rating = ROUND(?, 1), review_count = review_count + 1 WHERE id = ?').run(
        stats.avg_r,
        productId
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(201).json({ ok: true, id: revId });
  });

  app.get('/api/v1/serviceability/:postalCode', (req, res) => {
    const pin = req.params.postalCode.trim();
    if (!/^\d{6}$/.test(pin)) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Please enter a valid 6-digit Indian postal code.',
        fieldErrors: [{ field: 'postalCode', message: '6 digits required.' }],
        correlationId: req.correlationId,
      });
      return;
    }
    const isMetro = ['600', '560', '400', '110', '500', '641'].some((p) => pin.startsWith(p));
    res.json({
      postalCode: pin,
      serviceable: !pin.startsWith('999'),
      expressAvailable: isMetro,
      standardEta: isMetro ? '2–3 business days' : '4–6 business days',
      expressEta: isMetro ? 'Tomorrow by 6:00 PM' : '2–3 business days',
      codAvailable: true,
    });
  });

  // ---------------- CART & GUEST CART MERGE ----------------
  app.get('/api/v1/cart', requireAuth, (req, res) => {
    res.json(buildUserCartDto(req.authUser!.id));
  });

  app.post('/api/v1/cart/items', requireAuth, (req, res) => {
    const { variantId, quantity } = req.body ?? {};
    const qty = Number(quantity ?? 1);
    if (typeof variantId !== 'string' || !Number.isInteger(qty) || qty <= 0 || qty > 10) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Valid variantId and quantity (1-10) are required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const variant = db
      .prepare(
        `SELECT pv.id, pv.status as v_status, p.status as p_status, inv.on_hand, inv.reserved
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         JOIN inventory inv ON inv.variant_id = pv.id
         WHERE pv.id = ?`
      )
      .get(variantId) as
      | { id: string; v_status: string; p_status: string; on_hand: number; reserved: number }
      | undefined;

    if (!variant || variant.v_status !== 'ACTIVE' || variant.p_status !== 'ACTIVE') {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product variant is unavailable.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const available = computeAvailableToSell(variant.on_hand, variant.reserved);
    const cartId = getOrCreateCartId(req.authUser!.id);
    const existing = db
      .prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?')
      .get(cartId, variantId) as { id: string; quantity: number } | undefined;

    const targetQty = (existing?.quantity ?? 0) + qty;
    if (targetQty > available) {
      res.status(409).json({
        code: 'STOCK_UNAVAILABLE',
        message: `Only ${available} unit(s) available in stock.`,
        fieldErrors: [],
        details: [{ variantId, availableQuantity: available }],
        correlationId: req.correlationId,
      });
      return;
    }

    const now = new Date().toISOString();
    if (existing) {
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(targetQty, existing.id);
    } else {
      db.prepare('INSERT INTO cart_items (id, cart_id, variant_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)').run(
        newId('ci'),
        cartId,
        variantId,
        targetQty,
        now
      );
    }
    db.prepare('UPDATE carts SET updated_at = ? WHERE id = ?').run(now, cartId);

    res.status(201).json(buildUserCartDto(req.authUser!.id));
  });

  app.patch('/api/v1/cart/items/:id', requireAuth, (req, res) => {
    const qty = Number(req.body?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Quantity must be between 1 and 10.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    const item = db
      .prepare(
        `SELECT ci.id, ci.variant_id, inv.on_hand, inv.reserved
         FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id
         JOIN inventory inv ON inv.variant_id = ci.variant_id
         WHERE ci.id = ? AND c.user_id = ?`
      )
      .get(req.params.id, req.authUser!.id) as
      | { id: string; variant_id: string; on_hand: number; reserved: number }
      | undefined;

    if (!item) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Cart item not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const available = computeAvailableToSell(item.on_hand, item.reserved);
    if (qty > available) {
      res.status(409).json({
        code: 'STOCK_UNAVAILABLE',
        message: `Only ${available} unit(s) currently available.`,
        fieldErrors: [],
        details: [{ variantId: item.variant_id, availableQuantity: available }],
        correlationId: req.correlationId,
      });
      return;
    }

    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, item.id);
    res.json(buildUserCartDto(req.authUser!.id));
  });

  app.delete('/api/v1/cart/items/:id', requireAuth, (req, res) => {
    const item = db
      .prepare('SELECT ci.id FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE ci.id = ? AND c.user_id = ?')
      .get(req.params.id, req.authUser!.id) as { id: string } | undefined;
    if (!item) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Cart item not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
    res.json(buildUserCartDto(req.authUser!.id));
  });

  app.post('/api/v1/cart/merge', requireAuth, (req, res) => {
    const guestItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const cartId = getOrCreateCartId(req.authUser!.id);
    const now = new Date().toISOString();

    for (const entry of guestItems) {
      const variantId = typeof entry?.variantId === 'string' ? entry.variantId : '';
      const qty = Number(entry?.quantity ?? 0);
      if (!variantId || !Number.isInteger(qty) || qty <= 0) continue;

      const inv = db
        .prepare(
          `SELECT pv.id, inv.on_hand, inv.reserved FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
           JOIN inventory inv ON inv.variant_id = pv.id
           WHERE pv.id = ? AND pv.status = 'ACTIVE' AND p.status = 'ACTIVE'`
        )
        .get(variantId) as { id: string; on_hand: number; reserved: number } | undefined;

      if (!inv) continue;
      const available = computeAvailableToSell(inv.on_hand, inv.reserved);
      if (available <= 0) continue;

      const existing = db
        .prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?')
        .get(cartId, variantId) as { id: string; quantity: number } | undefined;

      const mergedQty = Math.min(available, 10, (existing?.quantity ?? 0) + qty);
      if (existing) {
        db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(mergedQty, existing.id);
      } else {
        db.prepare('INSERT INTO cart_items (id, cart_id, variant_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)').run(
          newId('ci'),
          cartId,
          variantId,
          mergedQty,
          now
        );
      }
    }

    res.json(buildUserCartDto(req.authUser!.id));
  });

  // ---------------- WISHLIST & ADDRESSES & PAYMENTS ----------------
  app.get('/api/v1/wishlist', requireAuth, (req, res) => {
    const items = db
      .prepare(
        `SELECT p.id, p.name, p.slug, p.brand, p.rating, p.review_count,
                (SELECT id FROM product_variants WHERE product_id = p.id AND status='ACTIVE' ORDER BY price_paise ASC LIMIT 1) as default_variant_id,
                (SELECT price_paise FROM product_variants WHERE product_id = p.id AND status='ACTIVE' ORDER BY price_paise ASC LIMIT 1) as price_paise,
                (SELECT mrp_paise FROM product_variants WHERE product_id = p.id AND status='ACTIVE' ORDER BY price_paise ASC LIMIT 1) as mrp_paise,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url,
                (SELECT COALESCE(SUM(MAX(0, inv.on_hand - inv.reserved)), 0) FROM product_variants pv JOIN inventory inv ON inv.variant_id = pv.id WHERE pv.product_id = p.id) as available_to_sell
         FROM wishlist_items w JOIN products p ON p.id = w.product_id
         WHERE w.user_id = ? ORDER BY w.created_at DESC`
      )
      .all(req.authUser!.id);
    res.json({ items });
  });

  app.post('/api/v1/wishlist/:productId', requireAuth, (req, res) => {
    const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.productId);
    if (!exists) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    db.prepare('INSERT OR IGNORE INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, ?)').run(
      req.authUser!.id,
      req.params.productId,
      new Date().toISOString()
    );
    res.status(201).json({ ok: true });
  });

  app.delete('/api/v1/wishlist/:productId', requireAuth, (req, res) => {
    db.prepare('DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?').run(
      req.authUser!.id,
      req.params.productId
    );
    res.json({ ok: true });
  });

  app.get('/api/v1/addresses', requireAuth, (req, res) => {
    const addresses = db
      .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .all(req.authUser!.id);
    res.json({ addresses });
  });

  app.post('/api/v1/addresses', requireAuth, (req, res) => {
    const { label, recipientName, phone, line1, line2, city, state, postalCode, isDefault } = req.body ?? {};
    const fieldErrors: { field: string; message: string }[] = [];
    if (!recipientName?.trim()) fieldErrors.push({ field: 'recipientName', message: 'Recipient name is required.' });
    if (!phone?.trim()) fieldErrors.push({ field: 'phone', message: 'Phone number is required.' });
    if (!line1?.trim()) fieldErrors.push({ field: 'line1', message: 'Address line 1 is required.' });
    if (!city?.trim()) fieldErrors.push({ field: 'city', message: 'City is required.' });
    if (!state?.trim()) fieldErrors.push({ field: 'state', message: 'State is required.' });
    if (!/^\d{6}$/.test(String(postalCode || '').trim())) {
      fieldErrors.push({ field: 'postalCode', message: 'Valid 6-digit postal code is required.' });
    }
    if (fieldErrors.length > 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Address validation failed.', fieldErrors, correlationId: req.correlationId });
      return;
    }
    const id = newId('addr');
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (isDefault) {
        db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.authUser!.id);
      }
      db.prepare(
        'INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, line2, city, state, postal_code, country, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        req.authUser!.id,
        (label || 'Home').trim(),
        recipientName.trim(),
        phone.trim(),
        line1.trim(),
        line2?.trim() || null,
        city.trim(),
        state.trim(),
        String(postalCode).trim(),
        'India',
        isDefault ? 1 : 0,
        now
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(id);
    res.status(201).json({ address });
  });

  app.delete('/api/v1/addresses/:id', requireAuth, (req, res) => {
    const resDel = db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
    if (resDel.changes === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Address not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/v1/payment-methods', requireAuth, (req, res) => {
    const methods = db
      .prepare('SELECT * FROM saved_payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .all(req.authUser!.id);
    res.json({ methods });
  });

  // ---------------- AUTHORITATIVE CHECKOUT & PAYMENTS ----------------
  app.post('/api/v1/checkout/quote', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const { addressId, shippingMethod = 'STANDARD', couponCode } = req.body ?? {};
    const cleanMethod = shippingMethod === 'EXPRESS' ? 'EXPRESS' : 'STANDARD';

    const cart = buildUserCartDto(userId);
    if (cart.items.length === 0) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Your cart is empty.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const stockIssues = cart.items.filter((i) => !i.inStock);
    if (stockIssues.length > 0) {
      res.status(409).json({
        code: 'STOCK_UNAVAILABLE',
        message: 'One or more items in your cart are unavailable in the requested quantity.',
        fieldErrors: [],
        details: stockIssues.map((i) => ({ variantId: i.variantId, name: i.name, availableQuantity: i.availableToSell })),
        correlationId: req.correlationId,
      });
      return;
    }

    let couponInput: CouponPolicyInput | null = null;
    if (typeof couponCode === 'string' && couponCode.trim()) {
      couponInput = loadCouponForUser(couponCode, userId);
      if (!couponInput) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `Coupon code "${couponCode.trim().toUpperCase()}" was not found.`,
          fieldErrors: [{ field: 'couponCode', message: 'Invalid coupon code.' }],
          correlationId: req.correlationId,
        });
        return;
      }
    }

    const cfg = getStoreConfig();
    const breakdown = calculatePricingBreakdown({
      lines: cart.items.map((i) => ({ variantId: i.variantId, unitPricePaise: i.unitPricePaise, quantity: i.quantity })),
      shippingMethod: cleanMethod,
      coupon: couponInput,
      freeShippingThresholdPaise: cfg.freeShippingThresholdPaise,
      taxRateBps: cfg.gstRateBps,
      taxInclusive: cfg.taxInclusive,
    });

    if (couponInput && breakdown.couponError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: breakdown.couponError,
        fieldErrors: [{ field: 'couponCode', message: breakdown.couponError }],
        correlationId: req.correlationId,
      });
      return;
    }

    const linesSnapshot = cart.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      name: i.name,
      variantTitle: i.variantTitle,
      sku: i.sku,
      imageUrl: i.imageUrl,
      unitPricePaise: i.unitPricePaise,
      quantity: i.quantity,
    }));

    const priceHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(linesSnapshot.map((l) => [l.variantId, l.unitPricePaise, l.quantity])))
      .digest('hex');

    const quoteId = newId('qt');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();

    db.prepare(
      'INSERT INTO checkout_quotes (id, user_id, address_id, shipping_method, coupon_code, lines_snapshot_json, subtotal_paise, discount_paise, shipping_paise, tax_paise, grand_total_paise, price_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      quoteId,
      userId,
      String(addressId || ''),
      cleanMethod,
      breakdown.appliedCouponCode,
      JSON.stringify(linesSnapshot),
      breakdown.subtotalPaise,
      breakdown.discountPaise,
      breakdown.shippingPaise,
      breakdown.taxPaise,
      breakdown.grandTotalPaise,
      priceHash,
      expiresAt,
      now.toISOString()
    );

    res.json({
      quoteId,
      expiresAt,
      shippingMethod: cleanMethod,
      items: linesSnapshot,
      ...breakdown,
    });
  });

  app.post('/api/v1/checkout/submit', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const idemKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
    const { quoteId, addressId, paymentMethod = 'UPI', notes } = req.body ?? {};

    if (!idemKey) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required for checkout submission.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ quoteId, addressId, paymentMethod }))
      .digest('hex');

    const existingIdem = db
      .prepare('SELECT * FROM idempotency_records WHERE user_id = ? AND idem_key = ?')
      .get(userId, idemKey) as
      | { id: string; request_hash: string; status: string; response_snapshot_json: string | null }
      | undefined;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        res.status(409).json({
          code: 'STATE_CONFLICT',
          message: 'Idempotency key was reused with different checkout parameters.',
          fieldErrors: [],
          correlationId: req.correlationId,
        });
        return;
      }
      if (existingIdem.status === 'COMPLETED' && existingIdem.response_snapshot_json) {
        res.json(JSON.parse(existingIdem.response_snapshot_json));
        return;
      }
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: 'Checkout submission is already in progress.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const quote = db
      .prepare('SELECT * FROM checkout_quotes WHERE id = ? AND user_id = ?')
      .get(String(quoteId || ''), userId) as
      | {
          id: string;
          shipping_method: 'STANDARD' | 'EXPRESS';
          coupon_code: string | null;
          lines_snapshot_json: string;
          subtotal_paise: number;
          discount_paise: number;
          shipping_paise: number;
          tax_paise: number;
          grand_total_paise: number;
          price_hash: string;
          expires_at: string;
        }
      | undefined;

    if (!quote || Date.parse(quote.expires_at) < Date.now()) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: 'Checkout quote expired or not found. Refreshing quote.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const address = db
      .prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?')
      .get(String(addressId || ''), userId) as
      | {
          label: string;
          recipient_name: string;
          phone: string;
          line1: string;
          line2: string | null;
          city: string;
          state: string;
          postal_code: string;
          country: string;
        }
      | undefined;

    if (!address) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Please select a valid delivery address.',
        fieldErrors: [{ field: 'addressId', message: 'Delivery address required.' }],
        correlationId: req.correlationId,
      });
      return;
    }

    const quotedLines = JSON.parse(quote.lines_snapshot_json) as {
      productId: string;
      variantId: string;
      name: string;
      variantTitle: string;
      sku: string;
      imageUrl: string | null;
      unitPricePaise: number;
      quantity: number;
    }[];

    // Revalidate live prices & stock inside transaction
    const now = new Date().toISOString();
    const orderId = newId('ord');
    const orderNumber = `AC${Math.floor(100000 + Math.random() * 899999)}`;
    const paymentId = newId('pay');
    const providerReference = `TXN-${orderNumber}-${String(paymentMethod).toUpperCase()}`;

    db.exec('BEGIN IMMEDIATE');
    try {
      // Price drift check
      for (const line of quotedLines) {
        const currentVar = db
          .prepare(
            `SELECT pv.price_paise, pv.status as v_status, p.status as p_status
             FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?`
          )
          .get(line.variantId) as { price_paise: number; v_status: string; p_status: string } | undefined;
        if (!currentVar || currentVar.v_status !== 'ACTIVE' || currentVar.p_status !== 'ACTIVE') {
          db.exec('ROLLBACK');
          res.status(409).json({
            code: 'STOCK_UNAVAILABLE',
            message: `${line.name} is no longer available.`,
            fieldErrors: [],
            correlationId: req.correlationId,
          });
          return;
        }
        if (currentVar.price_paise !== line.unitPricePaise) {
          db.exec('ROLLBACK');
          res.status(409).json({
            code: 'PRICE_CHANGED',
            message: `Price for ${line.name} changed since your quote was generated. Please review updated totals.`,
            fieldErrors: [],
            details: [{ variantId: line.variantId, oldPricePaise: line.unitPricePaise, newPricePaise: currentVar.price_paise }],
            correlationId: req.correlationId,
          });
          return;
        }
      }

      // Atomic stock reservation for each item
      for (const line of quotedLines) {
        const resUpdate = db
          .prepare(
            'UPDATE inventory SET reserved = reserved + ?, version = version + 1, updated_at = ? WHERE variant_id = ? AND (on_hand - reserved) >= ?'
          )
          .run(line.quantity, now, line.variantId, line.quantity);
        if (resUpdate.changes !== 1) {
          db.exec('ROLLBACK');
          const inv = db.prepare('SELECT on_hand, reserved FROM inventory WHERE variant_id = ?').get(line.variantId) as
            | { on_hand: number; reserved: number }
            | undefined;
          res.status(409).json({
            code: 'STOCK_UNAVAILABLE',
            message: `Insufficient stock for ${line.name}.`,
            fieldErrors: [],
            details: [{ variantId: line.variantId, availableQuantity: inv ? computeAvailableToSell(inv.on_hand, inv.reserved) : 0 }],
            correlationId: req.correlationId,
          });
          return;
        }
        db.prepare(
          'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('mov'), line.variantId, 'CHECKOUT_RESERVE', 0, orderId, `Reserved for #${orderNumber}`, userId, now);
      }

      const addressSnapshot = {
        label: address.label,
        recipientName: address.recipient_name,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        postalCode: address.postal_code,
        country: address.country,
      };

      db.prepare(
        'INSERT INTO orders (id, order_number, user_id, status, shipping_method, address_snapshot_json, coupon_code, subtotal_paise, discount_paise, shipping_paise, tax_paise, grand_total_paise, currency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        orderId,
        orderNumber,
        userId,
        'PENDING_PAYMENT',
        quote.shipping_method,
        JSON.stringify(addressSnapshot),
        quote.coupon_code,
        quote.subtotal_paise,
        quote.discount_paise,
        quote.shipping_paise,
        quote.tax_paise,
        quote.grand_total_paise,
        'INR',
        typeof notes === 'string' ? notes.trim() : null,
        now,
        now
      );

      for (const line of quotedLines) {
        db.prepare(
          'INSERT INTO order_items (id, order_id, product_id, variant_id, product_name, variant_title, sku, image_url, unit_price_paise, quantity, line_total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          newId('oi'),
          orderId,
          line.productId,
          line.variantId,
          line.name,
          line.variantTitle,
          line.sku,
          line.imageUrl,
          line.unitPricePaise,
          line.quantity,
          line.unitPricePaise * line.quantity
        );
      }

      db.prepare(
        'INSERT INTO payments (id, order_id, provider, method, provider_reference, amount_paise, refunded_paise, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
      ).run(paymentId, orderId, 'AURORA_PAY', String(paymentMethod).toUpperCase(), providerReference, quote.grand_total_paise, 'INR', 'PENDING', now, now);

      db.prepare(
        'INSERT INTO shipments (id, order_id, carrier, tracking_reference, status, source, estimated_delivery, timeline_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId('shp'),
        orderId,
        quote.shipping_method === 'EXPRESS' ? 'Blue Dart Express' : 'Delhivery Air',
        `BD${Math.floor(10000000 + Math.random() * 89999999)}IN`,
        'PENDING_PAYMENT',
        'ADMIN',
        quote.shipping_method === 'EXPRESS' ? 'Tomorrow by 6:00 PM' : 'In 2–4 business days',
        JSON.stringify([{ state: 'PENDING_PAYMENT', label: 'Order Placed', timestamp: now, detail: 'Awaiting payment verification' }]),
        now
      );

      const responsePayload = {
        orderId,
        orderNumber,
        status: 'PENDING_PAYMENT',
        paymentId,
        providerReference,
        paymentMethod: String(paymentMethod).toUpperCase(),
        amountPaise: quote.grand_total_paise,
        currency: 'INR',
      };

      db.prepare(
        'INSERT INTO idempotency_records (id, user_id, idem_key, request_hash, status, resource_id, response_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newId('idem'), userId, idemKey, requestHash, 'COMPLETED', orderId, JSON.stringify(responsePayload), now);

      recordAudit({
        actorUserId: userId,
        actorType: 'CUSTOMER',
        action: 'CHECKOUT_SUBMITTED',
        entityType: 'ORDER',
        entityId: orderId,
        correlationId: req.correlationId,
        afterSummary: `Order #${orderNumber} (${quote.grand_total_paise} paise)`,
      });

      db.exec('COMMIT');
      res.status(201).json(responsePayload);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // Authoritative signed webhook endpoint (external or provider simulator calls this)
  app.post('/api/v1/payments/webhooks/:provider', (req, res) => {
    const sig = req.headers['x-webhook-signature'] as string | undefined;
    const rawBody = JSON.stringify(req.body ?? {});
    if (!verifyWebhookSignature(rawBody, sig)) {
      res.status(401).json({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Invalid webhook signature.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const { providerEventId, providerReference, eventType, amountPaise, currency = 'INR' } = req.body ?? {};
    const result = applyPaymentWebhookEvent({
      provider: req.params.provider,
      providerEventId: String(providerEventId || newId('ev')),
      providerReference: String(providerReference || ''),
      eventType: eventType === 'PAYMENT_FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_SUCCEEDED',
      amountPaise: Number(amountPaise),
      currency: String(currency),
      rawPayload: rawBody,
      correlationId: req.correlationId,
    });
    res.json({ ok: true, ...result });
  });

  // Server-side provider gateway completion endpoint: invokes signed webhook verification pipeline
  app.post('/api/v1/payments/:paymentId/authorize', requireAuth, (req, res) => {
    const payment = db
      .prepare(
        `SELECT p.*, o.user_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?`
      )
      .get(req.params.paymentId) as
      | {
          id: string;
          order_id: string;
          user_id: string;
          provider: string;
          provider_reference: string;
          amount_paise: number;
          currency: string;
          status: PaymentState;
        }
      | undefined;

    if (!payment || payment.user_id !== req.authUser!.id) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Payment record not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const outcome = req.body?.outcome === 'FAIL' ? 'FAIL' : req.body?.outcome === 'TIMEOUT' ? 'TIMEOUT' : 'SUCCESS';
    if (outcome === 'TIMEOUT') {
      db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run(
        'UNKNOWN',
        new Date().toISOString(),
        payment.id
      );
      res.json({
        paymentStatus: 'UNKNOWN',
        orderStatus: 'PENDING_PAYMENT',
        orderId: payment.order_id,
        message: 'Payment gateway timed out; reconciliation queued without duplicate charge.',
      });
      return;
    }

    const payloadObj = {
      providerEventId: `evt_${payment.provider_reference}_${outcome}`,
      providerReference: payment.provider_reference,
      eventType: outcome === 'FAIL' ? ('PAYMENT_FAILED' as const) : ('PAYMENT_SUCCEEDED' as const),
      amountPaise: payment.amount_paise,
      currency: payment.currency,
    };
    const raw = JSON.stringify(payloadObj);
    const signature = signWebhookPayload(raw);
    if (!verifyWebhookSignature(raw, signature)) {
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Signature self-check failed.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const result = applyPaymentWebhookEvent({
      provider: payment.provider,
      ...payloadObj,
      rawPayload: raw,
      correlationId: req.correlationId,
    });
    res.json(result);
  });

  // ---------------- CUSTOMER ORDERS & TRACKING ----------------
  app.get('/api/v1/orders', requireAuth, (req, res) => {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rows = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.authUser!.id) as Record<string, unknown>[];

    const orders = rows
      .map((o) => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(String(o.id));
        const payment = db.prepare('SELECT id, method, status, provider_reference, refunded_paise FROM payments WHERE order_id = ?').get(String(o.id));
        const shipment = db.prepare('SELECT carrier, tracking_reference, status, estimated_delivery, source, updated_at FROM shipments WHERE order_id = ?').get(String(o.id));
        return {
          ...o,
          address: JSON.parse(String(o.address_snapshot_json || '{}')),
          items,
          payment,
          shipment,
        };
      })
      .filter((o: Record<string, unknown>) => {
        if (statusFilter && statusFilter !== 'ALL' && o.status !== statusFilter) return false;
        if (q && !String(o.order_number).toLowerCase().includes(q)) return false;
        return true;
      });

    res.json({ orders });
  });

  app.get('/api/v1/orders/:id', requireAuth, (req, res) => {
    const order = db
      .prepare('SELECT * FROM orders WHERE (id = ? OR order_number = ?)')
      .get(req.params.id, req.params.id) as Record<string, unknown> | undefined;

    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const isOwner = order.user_id === req.authUser!.id;
    const isAdminReader = req.authUser!.roles.some((r) => ['ADMIN', 'ORDER_MANAGER', 'SUPPORT'].includes(r));
    if (!isOwner && !isAdminReader) {
      res.status(403).json({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to view this order.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(String(order.id));
    const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(String(order.id));
    const shipment = db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(String(order.id)) as Record<string, unknown> | undefined;

    res.json({
      order: {
        ...order,
        address: JSON.parse(String(order.address_snapshot_json || '{}')),
        items,
        payment,
        shipment: shipment
          ? {
              ...shipment,
              timeline: JSON.parse(String(shipment.timeline_json || '[]')),
            }
          : null,
        cancellable: isCustomerCancellable(order.status as OrderState),
        returnable: isCustomerReturnable(order.status as OrderState),
      },
    });
  });

  app.post('/api/v1/orders/:id/cancel', requireAuth, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.authUser!.id) as
      | { id: string; order_number: string; status: OrderState; grand_total_paise: number }
      | undefined;

    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    if (!isCustomerCancellable(order.status)) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: `Orders in ${order.status} status cannot be cancelled. Please use Return & Refund after delivery.`,
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const reason = String(req.body?.reason || 'Cancelled by customer').trim();
    const now = new Date().toISOString();
    const items = db.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id) as {
      variant_id: string;
      quantity: number;
    }[];
    const payment = db.prepare('SELECT id, status, amount_paise FROM payments WHERE order_id = ?').get(order.id) as
      | { id: string; status: PaymentState; amount_paise: number }
      | undefined;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('CANCELLED', now, order.id);

      if (order.status === 'PENDING_PAYMENT') {
        for (const it of items) {
          db.prepare('UPDATE inventory SET reserved = MAX(0, reserved - ?), version = version + 1, updated_at = ? WHERE variant_id = ?').run(
            it.quantity,
            now,
            it.variant_id
          );
          db.prepare(
            'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('mov'), it.variant_id, 'RESERVATION_RELEASED', 0, order.id, reason, req.authUser!.id, now);
        }
        if (payment && canTransitionPayment(payment.status, 'CANCELLED')) {
          db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run('CANCELLED', now, payment.id);
        }
      } else {
        // Paid order cancelled before packing/shipment -> restore stock + initiate refund
        for (const it of items) {
          db.prepare('UPDATE inventory SET on_hand = on_hand + ?, version = version + 1, updated_at = ? WHERE variant_id = ?').run(
            it.quantity,
            now,
            it.variant_id
          );
          db.prepare(
            'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('mov'), it.variant_id, 'CANCEL_RESTOCK', it.quantity, order.id, reason, req.authUser!.id, now);
        }
        if (payment && payment.status === 'PAID') {
          db.prepare('UPDATE payments SET status = ?, refunded_paise = amount_paise, updated_at = ? WHERE id = ?').run(
            'REFUNDED',
            now,
            payment.id
          );
          db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('REFUNDED', now, order.id);
        }
      }

      const shp = db.prepare('SELECT id, timeline_json FROM shipments WHERE order_id = ?').get(order.id) as
        | { id: string; timeline_json: string }
        | undefined;
      if (shp) {
        const tl = JSON.parse(shp.timeline_json || '[]');
        tl.push({ state: 'CANCELLED', label: 'Cancelled', timestamp: now, detail: reason });
        db.prepare('UPDATE shipments SET status = ?, timeline_json = ?, updated_at = ? WHERE id = ?').run(
          'CANCELLED',
          JSON.stringify(tl),
          now,
          shp.id
        );
      }

      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'CUSTOMER',
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: order.id,
        correlationId: req.correlationId,
        beforeSummary: order.status,
        afterSummary: payment?.status === 'PAID' ? 'REFUNDED' : 'CANCELLED',
        reason,
      });
      enqueueOutbox('ORDER_CANCELLED', {
        userId: req.authUser!.id,
        orderId: order.id,
        orderNumber: order.order_number,
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json({ ok: true, status: payment?.status === 'PAID' ? 'REFUNDED' : 'CANCELLED' });
  });

  app.post('/api/v1/orders/:id/return', requireAuth, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.authUser!.id) as
      | { id: string; order_number: string; status: OrderState }
      | undefined;
    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    if (!isCustomerReturnable(order.status)) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: 'Only delivered orders can be requested for return.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Return reason is required.', fieldErrors: [{ field: 'reason', message: 'Required' }], correlationId: req.correlationId });
      return;
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('RETURN_REQUESTED', now, order.id);
    recordAudit({
      actorUserId: req.authUser!.id,
      actorType: 'CUSTOMER',
      action: 'RETURN_REQUESTED',
      entityType: 'ORDER',
      entityId: order.id,
      correlationId: req.correlationId,
      beforeSummary: order.status,
      afterSummary: 'RETURN_REQUESTED',
      reason,
    });
    res.json({ ok: true, status: 'RETURN_REQUESTED' });
  });

  // ---------------- HELP & SUPPORT TICKETS & NOTIFICATIONS ----------------
  app.get('/api/v1/help/articles', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const rows = db.prepare('SELECT * FROM help_articles ORDER BY sort_order ASC').all() as {
      id: string;
      category: string;
      question: string;
      answer: string;
    }[];
    const filtered = rows.filter((a) => {
      if (category && category !== 'All' && a.category !== category) return false;
      if (q && !`${a.question} ${a.answer} ${a.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
    res.json({ articles: filtered });
  });

  app.get('/api/v1/support/tickets', requireAuth, (req, res) => {
    const tickets = db
      .prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC')
      .all(req.authUser!.id);
    res.json({ tickets });
  });

  app.post('/api/v1/support/tickets', requireAuth, (req, res) => {
    const { subject, category, priority = 'MEDIUM', orderId, message } = req.body ?? {};
    if (!subject?.trim() || !category?.trim() || !message?.trim()) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Subject, category, and message are required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const id = newId('tkt');
    const ticketNumber = `TKT-${Math.floor(2100 + Math.random() * 7899)}`;
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'INSERT INTO support_tickets (id, ticket_number, user_id, order_id, subject, category, priority, status, assignee_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
      ).run(id, ticketNumber, req.authUser!.id, orderId || null, subject.trim(), category.trim(), String(priority).toUpperCase(), 'OPEN', now, now);

      db.prepare(
        'INSERT INTO ticket_messages (id, ticket_id, sender_user_id, sender_role, is_internal_note, body, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
      ).run(newId('tmsg'), id, req.authUser!.id, 'CUSTOMER', message.trim(), now);

      enqueueOutbox('TICKET_CREATED', { userId: req.authUser!.id, ticketId: id, ticketNumber });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    res.status(201).json({ ticket });
  });

  app.get('/api/v1/support/tickets/:id', requireAuth, (req, res) => {
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;
    if (!ticket) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Ticket not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const isStaff = req.authUser!.roles.some((r) => ['ADMIN', 'SUPPORT'].includes(r));
    if (ticket.user_id !== req.authUser!.id && !isStaff) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Access denied.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const messages = db
      .prepare(
        `SELECT tm.*, u.name as sender_name FROM ticket_messages tm JOIN users u ON u.id = tm.sender_user_id
         WHERE tm.ticket_id = ? ${isStaff ? '' : 'AND tm.is_internal_note = 0'} ORDER BY tm.created_at ASC`
      )
      .all(ticket.id);
    res.json({ ticket, messages });
  });

  app.post('/api/v1/support/tickets/:id/messages', requireAuth, (req, res) => {
    const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string; ticket_number: string }
      | undefined;
    if (!ticket) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Ticket not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const isStaff = req.authUser!.roles.some((r) => ['ADMIN', 'SUPPORT'].includes(r));
    if (ticket.user_id !== req.authUser!.id && !isStaff) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Access denied.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const body = String(req.body?.body || '').trim();
    const isInternalNote = isStaff && Boolean(req.body?.isInternalNote);
    if (!body) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Reply message cannot be empty.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO ticket_messages (id, ticket_id, sender_user_id, sender_role, is_internal_note, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(newId('tmsg'), ticket.id, req.authUser!.id, isStaff ? 'SUPPORT' : 'CUSTOMER', isInternalNote ? 1 : 0, body, now);
    db.prepare('UPDATE support_tickets SET updated_at = ?, status = ? WHERE id = ?').run(
      now,
      isStaff && !isInternalNote ? 'PENDING' : 'OPEN',
      ticket.id
    );
    if (isStaff && !isInternalNote) {
      enqueueOutbox('TICKET_REPLY', { userId: ticket.user_id, ticketId: ticket.id, ticketNumber: ticket.ticket_number });
    }
    res.status(201).json({ ok: true });
  });

  app.get('/api/v1/notifications', requireAuth, (req, res) => {
    const items = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.authUser!.id);
    const unreadCount = (
      db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.authUser!.id) as { c: number }
    ).c;
    res.json({ notifications: items, unreadCount });
  });

  app.post('/api/v1/notifications/:id/read', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(
      new Date().toISOString(),
      req.params.id,
      req.authUser!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/v1/notifications/read-all', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(
      new Date().toISOString(),
      req.authUser!.id
    );
    res.json({ ok: true });
  });

  // ---------------- ADMIN CONSOLE ENDPOINTS ----------------
  app.get('/api/v1/admin/dashboard', requireAuth, (req, res) => {
    if (!req.authUser!.roles.some((r) => r !== 'CUSTOMER')) {
      res.status(403).json({ code: 'PERMISSION_DENIED', message: 'Staff role required.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const salesRow = db
      .prepare("SELECT COALESCE(SUM(grand_total_paise), 0) as total, COUNT(*) as cnt FROM orders WHERE status != 'CANCELLED'")
      .get() as { total: number; cnt: number };
    const custRow = db
      .prepare("SELECT COUNT(DISTINCT u.id) as cnt FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role = 'CUSTOMER'")
      .get() as { cnt: number };
    const aiRow = db.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(tokens_estimated), 0) as tokens FROM agent_runs').get() as {
      cnt: number;
      tokens: number;
    };

    const orderDist = db
      .prepare('SELECT status, COUNT(*) as count FROM orders GROUP BY status')
      .all();

    const categoryMix = db
      .prepare(
        `SELECT c.name as category, COALESCE(SUM(oi.line_total_paise), 0) as revenue_paise, COUNT(oi.id) as units
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id
         LEFT JOIN order_items oi ON oi.product_id = p.id
         GROUP BY c.id ORDER BY revenue_paise DESC`
      )
      .all();

    const recentOrders = db
      .prepare(
        `SELECT o.id, o.order_number, o.status, o.grand_total_paise, o.created_at, u.name as customer_name
         FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 8`
      )
      .all();

    const latestRuns = db
      .prepare('SELECT id, agent_key, status, prompt_summary, duration_ms, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 6')
      .all();

    // Daily trend over last 7 days (seeded baseline + real DB orders)
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const salesSeries = days.map((day, idx) => ({
      day,
      revenuePaise: 14500000 + idx * 2400000 + (idx === 6 ? salesRow.total : 0),
      orders: 140 + idx * 24 + (idx === 6 ? salesRow.cnt : 0),
    }));

    res.json({
      kpis: {
        totalSalesPaise: salesRow.total,
        totalOrders: salesRow.cnt,
        totalCustomers: custRow.cnt,
        aiInteractions: aiRow.cnt,
        aiTokens: aiRow.tokens,
      },
      salesSeries,
      orderDistribution: orderDist,
      categoryMix,
      recentOrders,
      latestRuns,
    });
  });

  app.get('/api/v1/admin/products', requirePermission('product:read'), (_req, res) => {
    const products = db
      .prepare(
        `SELECT p.*, c.name as category_name,
                (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) as variant_count,
                (SELECT MIN(price_paise) FROM product_variants WHERE product_id = p.id) as min_price_paise,
                (SELECT COALESCE(SUM(inv.on_hand - inv.reserved), 0) FROM product_variants pv JOIN inventory inv ON inv.variant_id = pv.id WHERE pv.product_id = p.id) as available_stock,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
         FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.updated_at DESC`
      )
      .all();
    res.json({ products });
  });

  app.post('/api/v1/admin/products', requirePermission('product:write'), (req, res) => {
    const { name, categoryId, brand, shortDescription, description, pricePaise, mrpPaise, sku, initialStock = 10, imageUrl, status = 'ACTIVE' } = req.body ?? {};
    if (!name?.trim() || !categoryId || !brand?.trim() || !sku?.trim() || Number(pricePaise) <= 0) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Product name, category, brand, SKU, and positive price are required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const dupSku = db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku.trim());
    if (dupSku) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: `SKU ${sku.trim()} already exists.`,
        fieldErrors: [{ field: 'sku', message: 'Duplicate SKU' }],
        correlationId: req.correlationId,
      });
      return;
    }

    const now = new Date().toISOString();
    const productId = newId('prod');
    const variantId = newId('var');
    const slug = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(100 + Math.random() * 899)}`;
    const cleanPrice = Math.round(Number(pricePaise));
    const cleanMrp = Math.max(cleanPrice, Math.round(Number(mrpPaise || cleanPrice)));
    const cleanStock = Math.max(0, Math.round(Number(initialStock)));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'INSERT INTO products (id, category_id, name, slug, brand, short_description, description, specs_json, badge, rating, review_count, status, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4.6, 0, ?, 0, ?, ?)'
      ).run(
        productId,
        categoryId,
        name.trim(),
        slug,
        brand.trim(),
        shortDescription?.trim() || name.trim(),
        description?.trim() || name.trim(),
        JSON.stringify({ Brand: brand.trim() }),
        status === 'ACTIVE' ? 'New' : 'Draft',
        status,
        now,
        now
      );

      db.prepare(
        'INSERT INTO product_variants (id, product_id, sku, title, attributes_json, price_paise, mrp_paise, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(variantId, productId, sku.trim(), 'Standard Edition', '{}', cleanPrice, cleanMrp, 'ACTIVE');

      db.prepare('INSERT INTO product_images (id, product_id, url, alt_text, sort_order) VALUES (?, ?, ?, ?, 0)').run(
        newId('img'),
        productId,
        imageUrl?.trim() || '/src/assets/images/prod_slim_laptop_1794850599703.jpg',
        name.trim()
      );

      db.prepare('INSERT INTO inventory (variant_id, on_hand, reserved, reorder_level, version, updated_at) VALUES (?, ?, 0, 5, 1, ?)').run(
        variantId,
        cleanStock,
        now
      );

      if (cleanStock > 0) {
        db.prepare(
          'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId('mov'), variantId, 'INITIAL_STOCK', cleanStock, productId, 'Created via Admin Product Console', req.authUser!.id, now);
      }

      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'PRODUCT_CREATED',
        entityType: 'PRODUCT',
        entityId: productId,
        correlationId: req.correlationId,
        afterSummary: `${name.trim()} (${sku.trim()})`,
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({ id: productId, variantId, slug });
  });

  app.patch('/api/v1/admin/products/:id', requirePermission('product:write'), (req, res) => {
    const existing = db.prepare('SELECT id, name, status FROM products WHERE id = ?').get(req.params.id) as
      | { id: string; name: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const { name, status, pricePaise, shortDescription } = req.body ?? {};
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE products SET name = COALESCE(?, name), status = COALESCE(?, status), short_description = COALESCE(?, short_description), updated_at = ? WHERE id = ?').run(
        name ? String(name).trim() : null,
        status ? String(status) : null,
        shortDescription ? String(shortDescription).trim() : null,
        now,
        existing.id
      );
      if (pricePaise && Number(pricePaise) > 0) {
        db.prepare('UPDATE product_variants SET price_paise = ?, mrp_paise = MAX(mrp_paise, ?) WHERE product_id = ?').run(
          Math.round(Number(pricePaise)),
          Math.round(Number(pricePaise)),
          existing.id
        );
      }
      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'PRODUCT_UPDATED',
        entityType: 'PRODUCT',
        entityId: existing.id,
        correlationId: req.correlationId,
        beforeSummary: `${existing.name} (${existing.status})`,
        afterSummary: `${name || existing.name} (${status || existing.status})`,
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true });
  });

  app.delete('/api/v1/admin/products/:id', requirePermission('product:write'), (req, res) => {
    const existing = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run('ARCHIVED', new Date().toISOString(), existing.id);
    recordAudit({
      actorUserId: req.authUser!.id,
      actorType: 'ADMIN',
      action: 'PRODUCT_ARCHIVED',
      entityType: 'PRODUCT',
      entityId: existing.id,
      correlationId: req.correlationId,
      reason: 'Archived via Admin Console',
    });
    res.json({ ok: true });
  });

  // Inventory Admin
  app.get('/api/v1/admin/inventory', requirePermission('product:read'), (_req, res) => {
    const stock = db
      .prepare(
        `SELECT pv.id as variant_id, pv.sku, pv.title as variant_title, p.id as product_id, p.name as product_name,
                inv.on_hand, inv.reserved, (inv.on_hand - inv.reserved) as available_to_sell, inv.reorder_level, inv.updated_at
         FROM inventory inv
         JOIN product_variants pv ON pv.id = inv.variant_id
         JOIN products p ON p.id = pv.product_id
         ORDER BY available_to_sell ASC`
      )
      .all();

    const movements = db
      .prepare(
        `SELECT m.*, pv.sku, p.name as product_name
         FROM inventory_movements m
         JOIN product_variants pv ON pv.id = m.variant_id
         JOIN products p ON p.id = pv.product_id
         ORDER BY m.created_at DESC LIMIT 40`
      )
      .all();

    res.json({ stock, movements });
  });

  app.post('/api/v1/admin/inventory/adjust', requirePermission('inventory:adjust'), (req, res) => {
    const { variantId, delta, reason, reorderLevel } = req.body ?? {};
    const inv = db.prepare('SELECT * FROM inventory WHERE variant_id = ?').get(String(variantId || '')) as
      | { variant_id: string; on_hand: number; reserved: number; reorder_level: number }
      | undefined;
    if (!inv) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Variant inventory not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const numDelta = Number(delta || 0);
    if (numDelta !== 0) {
      const check = validateStockAdjustment(inv.on_hand, inv.reserved, numDelta);
      if (!check.ok) {
        res.status(409).json({ code: 'STATE_CONFLICT', message: check.reason, fieldErrors: [], correlationId: req.correlationId });
        return;
      }
      if (!String(reason || '').trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Adjustment reason is required.', fieldErrors: [{ field: 'reason', message: 'Reason is required' }], correlationId: req.correlationId });
        return;
      }
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const nextOnHand = inv.on_hand + numDelta;
      const nextReorder = reorderLevel !== undefined ? Math.max(0, Number(reorderLevel)) : inv.reorder_level;
      db.prepare('UPDATE inventory SET on_hand = ?, reorder_level = ?, version = version + 1, updated_at = ? WHERE variant_id = ?').run(
        nextOnHand,
        nextReorder,
        now,
        inv.variant_id
      );
      if (numDelta !== 0) {
        db.prepare(
          'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)'
        ).run(newId('mov'), inv.variant_id, 'MANUAL_ADJUSTMENT', numDelta, String(reason).trim(), req.authUser!.id, now);
      }
      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'INVENTORY_ADJUSTED',
        entityType: 'INVENTORY',
        entityId: inv.variant_id,
        correlationId: req.correlationId,
        beforeSummary: `on_hand=${inv.on_hand}`,
        afterSummary: `on_hand=${nextOnHand}`,
        reason: String(reason || 'Reorder threshold updated'),
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true });
  });

  // Orders Admin
  app.get('/api/v1/admin/orders', requirePermission('order:read'), (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = db
      .prepare(
        `SELECT o.*, u.name as customer_name, u.email as customer_email,
                p.status as payment_status, p.method as payment_method, p.provider_reference, p.id as payment_id, p.refunded_paise
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN payments p ON p.order_id = o.id
         ORDER BY o.created_at DESC`
      )
      .all() as Record<string, unknown>[];

    const filtered = rows
      .filter((r) => !status || status === 'ALL' || r.status === status)
      .map((r) => ({
        ...r,
        address: JSON.parse(String(r.address_snapshot_json || '{}')),
        items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(String(r.id)),
        shipment: db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(String(r.id)),
      }));
    res.json({ orders: filtered });
  });

  app.post('/api/v1/admin/orders/:id/transition', requirePermission('order:transition'), (req, res) => {
    const { targetStatus, reason, trackingReference, carrier } = req.body ?? {};
    const order = db.prepare('SELECT id, order_number, user_id, status FROM orders WHERE id = ?').get(req.params.id) as
      | { id: string; order_number: string; user_id: string; status: OrderState }
      | undefined;
    if (!order) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Order not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    const next = String(targetStatus || '') as OrderState;
    if (!canTransitionOrder(order.status, next)) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: `Transition from ${order.status} to ${next} is not permitted by OrderStatePolicy.`,
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(next, now, order.id);

      const shp = db.prepare('SELECT id, timeline_json, carrier, tracking_reference FROM shipments WHERE order_id = ?').get(order.id) as
        | { id: string; timeline_json: string; carrier: string; tracking_reference: string }
        | undefined;
      if (shp) {
        const tl = JSON.parse(shp.timeline_json || '[]');
        tl.push({
          state: next,
          label: next.replace(/_/g, ' '),
          timestamp: now,
          detail: reason || `Updated by operations (${req.authUser!.name})`,
        });
        db.prepare('UPDATE shipments SET status = ?, carrier = ?, tracking_reference = ?, source = ?, timeline_json = ?, updated_at = ? WHERE id = ?').run(
          next,
          carrier || shp.carrier,
          trackingReference || shp.tracking_reference,
          'ADMIN',
          JSON.stringify(tl),
          now,
          shp.id
        );
      }

      if (next === 'RETURNED') {
        const items = db.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id) as {
          variant_id: string;
          quantity: number;
        }[];
        for (const it of items) {
          db.prepare('UPDATE inventory SET on_hand = on_hand + ?, version = version + 1, updated_at = ? WHERE variant_id = ?').run(
            it.quantity,
            now,
            it.variant_id
          );
          db.prepare(
            'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId('mov'), it.variant_id, 'RETURN_RECEIVED', it.quantity, order.id, reason || 'Return inspected & restocked', req.authUser!.id, now);
        }
      }

      enqueueOutbox('SHIPMENT_UPDATE', { userId: order.user_id, orderId: order.id, orderNumber: order.order_number, status: next });
      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'ORDER_TRANSITIONED',
        entityType: 'ORDER',
        entityId: order.id,
        correlationId: req.correlationId,
        beforeSummary: order.status,
        afterSummary: next,
        reason: reason || 'Fulfilment update',
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, status: next });
  });

  // Payments & Refunds Admin
  app.get('/api/v1/admin/payments', requirePermission('order:read'), (_req, res) => {
    const payments = db
      .prepare(
        `SELECT p.*, o.order_number, o.status as order_status, u.name as customer_name
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         JOIN users u ON u.id = o.user_id
         ORDER BY p.created_at DESC`
      )
      .all();
    const events = db.prepare('SELECT * FROM payment_events ORDER BY created_at DESC LIMIT 30').all();
    res.json({ payments, events });
  });

  app.post('/api/v1/admin/payments/:id/refund', requirePermission('refund:approve'), (req, res) => {
    const { amountPaise, reason } = req.body ?? {};
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id) as
      | { id: string; order_id: string; amount_paise: number; refunded_paise: number; status: PaymentState; provider_reference: string }
      | undefined;

    if (!payment) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Payment not found.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: `Cannot refund payment in ${payment.status} state.`,
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const reqPaise = Math.round(Number(amountPaise ?? payment.amount_paise - payment.refunded_paise));
    const check = canRefundAmount(payment.amount_paise, payment.refunded_paise, reqPaise);
    if (!check.ok) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: check.reason, fieldErrors: [], correlationId: req.correlationId });
      return;
    }

    if (!String(reason || '').trim()) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Refund reason is required.', fieldErrors: [{ field: 'reason', message: 'Required' }], correlationId: req.correlationId });
      return;
    }

    const nextRefunded = payment.refunded_paise + reqPaise;
    const nextPayStatus: PaymentState = nextRefunded >= payment.amount_paise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE payments SET refunded_paise = ?, status = ?, updated_at = ? WHERE id = ?').run(
        nextRefunded,
        nextPayStatus,
        now,
        payment.id
      );
      if (nextPayStatus === 'REFUNDED') {
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run('REFUNDED', now, payment.order_id);
      }
      const order = db.prepare('SELECT user_id, order_number FROM orders WHERE id = ?').get(payment.order_id) as {
        user_id: string;
        order_number: string;
      };
      enqueueOutbox('REFUND_PROCESSED', {
        userId: order.user_id,
        orderId: payment.order_id,
        orderNumber: order.order_number,
        amountPaise: reqPaise,
      });
      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'PAYMENT_REFUNDED',
        entityType: 'PAYMENT',
        entityId: payment.id,
        correlationId: req.correlationId,
        beforeSummary: `refunded=${payment.refunded_paise}`,
        afterSummary: `refunded=${nextRefunded} (${nextPayStatus})`,
        reason: String(reason).trim(),
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, status: nextPayStatus, refundedPaise: nextRefunded });
  });

  // Customers & Support & Roles Admin
  app.get('/api/v1/admin/customers', requirePermission('order:read'), (_req, res) => {
    const customers = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.status, u.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count,
                (SELECT COALESCE(SUM(o.grand_total_paise), 0) FROM orders o WHERE o.user_id = u.id AND o.status != 'CANCELLED') as total_spend_paise
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role = 'CUSTOMER'
         ORDER BY u.created_at DESC`
      )
      .all();
    res.json({ customers });
  });

  app.patch('/api/v1/admin/customers/:id/status', requirePermission('customer:manage'), (req, res) => {
    const status = req.body?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), req.params.id);
    recordAudit({
      actorUserId: req.authUser!.id,
      actorType: 'ADMIN',
      action: 'CUSTOMER_STATUS_CHANGED',
      entityType: 'USER',
      entityId: req.params.id,
      correlationId: req.correlationId,
      afterSummary: status,
    });
    res.json({ ok: true, status });
  });

  app.get('/api/v1/admin/support/tickets', requirePermission('support:assign'), (_req, res) => {
    const tickets = db
      .prepare(
        `SELECT t.*, u.name as customer_name, u.email as customer_email, a.name as assignee_name
         FROM support_tickets t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assignee_user_id
         ORDER BY t.updated_at DESC`
      )
      .all();
    const staff = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role IN ('ADMIN', 'SUPPORT')`
      )
      .all();
    res.json({ tickets, staff });
  });

  app.patch('/api/v1/admin/support/tickets/:id', requirePermission('support:assign'), (req, res) => {
    const { status, priority, assigneeUserId } = req.body ?? {};
    db.prepare(
      'UPDATE support_tickets SET status = COALESCE(?, status), priority = COALESCE(?, priority), assignee_user_id = COALESCE(?, assignee_user_id), updated_at = ? WHERE id = ?'
    ).run(status || null, priority || null, assigneeUserId || null, new Date().toISOString(), req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/v1/admin/roles', requirePermission('user:manage'), (_req, res) => {
    const users = db.prepare('SELECT id, name, email, status, created_at FROM users ORDER BY created_at ASC').all() as {
      id: string;
      name: string;
      email: string;
      status: string;
      created_at: string;
    }[];
    const staff = users.map((u) => ({
      ...u,
      roles: (db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(u.id) as { role: string }[]).map((r) => r.role),
    }));
    res.json({ users: staff });
  });

  app.put('/api/v1/admin/roles/:userId', requirePermission('user:manage'), (req, res) => {
    const roles: string[] = Array.isArray(req.body?.roles) ? req.body.roles : [];
    if (roles.length === 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'At least one role is required.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.userId);
      for (const r of roles) {
        db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(req.params.userId, r);
      }
      recordAudit({
        actorUserId: req.authUser!.id,
        actorType: 'ADMIN',
        action: 'ROLES_UPDATED',
        entityType: 'USER',
        entityId: req.params.userId,
        correlationId: req.correlationId,
        afterSummary: roles.join(','),
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true });
  });

  app.get('/api/v1/admin/settings', requirePermission('settings:write'), (_req, res) => {
    const rows = db.prepare('SELECT key, value_json, updated_at FROM store_settings').all() as {
      key: string;
      value_json: string;
      updated_at: string;
    }[];
    const settings: Record<string, unknown> = {};
    for (const r of rows) settings[r.key] = JSON.parse(r.value_json);
    res.json({ settings });
  });

  app.put('/api/v1/admin/settings', requirePermission('settings:write'), (req, res) => {
    const { key, value } = req.body ?? {};
    if (!key || !value) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Setting key and value are required.', fieldErrors: [], correlationId: req.correlationId });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
    ).run(String(key), JSON.stringify(value), now);
    recordAudit({
      actorUserId: req.authUser!.id,
      actorType: 'ADMIN',
      action: 'SETTINGS_UPDATED',
      entityType: 'SETTINGS',
      entityId: String(key),
      correlationId: req.correlationId,
    });
    res.json({ ok: true });
  });

  app.get('/api/v1/admin/audit-logs', requirePermission('order:read'), (_req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY occurred_at DESC LIMIT 80').all();
    res.json({ logs });
  });

  // Analytics & CSV Exports
  app.get('/api/v1/admin/analytics', requirePermission('report:export'), (_req, res) => {
    const topProducts = db
      .prepare(
        `SELECT p.id, p.name, p.brand, p.rating, COALESCE(SUM(oi.quantity), 0) as units_sold, COALESCE(SUM(oi.line_total_paise), 0) as revenue_paise
         FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
         GROUP BY p.id ORDER BY revenue_paise DESC LIMIT 8`
      )
      .all();

    const funnel = [
      { stage: 'Storefront Visits', count: 14820, conversion: 100 },
      { stage: 'Product Views', count: 8410, conversion: 56.7 },
      { stage: 'Add to Cart', count: 2940, conversion: 19.8 },
      { stage: 'Checkout Initiated', count: 1620, conversion: 10.9 },
      { stage: 'Verified Orders', count: 1268 + (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c, conversion: 8.6 },
    ];

    const exportsList = db.prepare('SELECT id, report_type, format, status, row_count, created_at FROM export_jobs ORDER BY created_at DESC LIMIT 15').all();
    res.json({ topProducts, funnel, exports: exportsList });
  });

  app.post('/api/v1/admin/exports', requirePermission('report:export'), (req, res) => {
    const reportType = String(req.body?.reportType || 'ORDERS').toUpperCase();
    let csv = '';
    let rowCount = 0;

    if (reportType === 'INVENTORY') {
      const rows = db
        .prepare(
          'SELECT pv.sku, p.name, inv.on_hand, inv.reserved, (inv.on_hand - inv.reserved) as available, inv.reorder_level FROM inventory inv JOIN product_variants pv ON pv.id = inv.variant_id JOIN products p ON p.id = pv.product_id'
        )
        .all() as Record<string, unknown>[];
      rowCount = rows.length;
      csv = ['SKU,Product,OnHand,Reserved,Available,ReorderLevel', ...rows.map((r) => `"${r.sku}","${r.name}",${r.on_hand},${r.reserved},${r.available},${r.reorder_level}`)].join('\n');
    } else {
      const rows = db
        .prepare('SELECT order_number, status, shipping_method, grand_total_paise, currency, created_at FROM orders ORDER BY created_at DESC')
        .all() as Record<string, unknown>[];
      rowCount = rows.length;
      csv = ['OrderNumber,Status,Shipping,GrandTotalINR,Currency,CreatedAt', ...rows.map((r) => `"${r.order_number}","${r.status}","${r.shipping_method}",${Number(r.grand_total_paise) / 100},"${r.currency}","${r.created_at}"`)].join('\n');
    }

    const id = newId('exp');
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO export_jobs (id, user_id, report_type, format, status, row_count, csv_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.authUser!.id, reportType, 'CSV', 'READY', rowCount, csv, now);

    res.status(201).json({ id, reportType, status: 'READY', rowCount, csv });
  });
}
