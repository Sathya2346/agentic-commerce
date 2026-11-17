import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'agentic_commerce.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
}

export function initSchemaAndSeed(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED')),
      email_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('EMAIL_VERIFY', 'PASSWORD_RESET', 'OTP')),
      token_hash TEXT NOT NULL,
      code_hint TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      line1 TEXT NOT NULL,
      line2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method_type TEXT NOT NULL,
      provider_label TEXT NOT NULL,
      masked_reference TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      icon_name TEXT,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      short_description TEXT NOT NULL,
      description TEXT NOT NULL,
      specs_json TEXT NOT NULL DEFAULT '{}',
      badge TEXT,
      rating REAL NOT NULL DEFAULT 4.5,
      review_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      featured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
      mrp_paise INTEGER NOT NULL CHECK (mrp_paise >= price_paise),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      alt_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title TEXT NOT NULL,
      comment TEXT NOT NULL,
      verified_purchase INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      variant_id TEXT PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
      on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
      reorder_level INTEGER NOT NULL DEFAULT 5,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      reference_id TEXT,
      reason TEXT NOT NULL,
      actor_user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TEXT NOT NULL,
      UNIQUE (cart_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS wishlist_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FLAT')),
      discount_value INTEGER NOT NULL,
      max_discount_paise INTEGER,
      min_order_paise INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      expires_at TEXT,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id TEXT PRIMARY KEY,
      coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkout_quotes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address_id TEXT NOT NULL,
      shipping_method TEXT NOT NULL,
      coupon_code TEXT,
      lines_snapshot_json TEXT NOT NULL,
      subtotal_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      shipping_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      grand_total_paise INTEGER NOT NULL,
      price_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
      resource_id TEXT,
      response_snapshot_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, idem_key)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      shipping_method TEXT NOT NULL,
      address_snapshot_json TEXT NOT NULL,
      coupon_code TEXT,
      subtotal_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      shipping_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      grand_total_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      variant_title TEXT NOT NULL,
      sku TEXT NOT NULL,
      image_url TEXT,
      unit_price_paise INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      line_total_paise INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      provider_reference TEXT NOT NULL UNIQUE,
      amount_paise INTEGER NOT NULL,
      refunded_paise INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      provider_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      carrier TEXT NOT NULL,
      tracking_reference TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'ADMIN',
      estimated_delivery TEXT,
      timeline_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      guest_token TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      cards_json TEXT,
      pending_confirmation_json TEXT,
      run_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      price_snapshot_paise INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      description TEXT NOT NULL,
      model_name TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
      system_prompt TEXT NOT NULL,
      allowed_tools_json TEXT NOT NULL,
      max_steps INTEGER NOT NULL DEFAULT 5,
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      version INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      user_id TEXT,
      agent_key TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt_summary TEXT NOT NULL,
      final_summary TEXT,
      error_message TEXT,
      model_name TEXT NOT NULL,
      tokens_estimated INTEGER NOT NULL DEFAULT 0,
      cost_microusd INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      correlation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      agent_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_name TEXT,
      input_summary TEXT,
      output_summary TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_evaluations (
      id TEXT PRIMARY KEY,
      suite_name TEXT NOT NULL,
      version INTEGER NOT NULL,
      total_cases INTEGER NOT NULL,
      passed_cases INTEGER NOT NULL,
      score_percent REAL NOT NULL,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'OPEN',
      assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id),
      sender_role TEXT NOT NULL,
      is_internal_note INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_path TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      actor_user_id TEXT,
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      before_summary TEXT,
      after_summary TEXT,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'DEAD_LETTER')),
      retries INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS help_articles (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      csv_content TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const now = new Date().toISOString();
  const h1 = new Date(Date.now() - 3600 * 1000 * 48).toISOString();
  const h2 = new Date(Date.now() - 3600 * 1000 * 24).toISOString();
  const h3 = new Date(Date.now() - 3600 * 1000 * 4).toISOString();

  // 1. Seed Users & RBAC Roles
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, phone, password_hash, status, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  );
  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)');

  const users = [
    { id: 'usr_sathya', name: 'Sathya Kumar', email: 'sathya@example.com', phone: '+91 98765 43210', pass: 'Customer@123', roles: ['CUSTOMER'] },
    { id: 'usr_priya', name: 'Priya Ramanathan', email: 'priya@example.com', phone: '+91 98401 11223', pass: 'Customer@123', roles: ['CUSTOMER'] },
    { id: 'usr_arjun', name: 'Arjun Menon', email: 'arjun@example.com', phone: '+91 94432 55667', pass: 'Customer@123', roles: ['CUSTOMER'] },
    { id: 'usr_admin', name: 'Karthik Rajan', email: 'admin@agenticcommerce.in', phone: '+91 90000 10001', pass: 'Admin@123', roles: ['ADMIN'] },
    { id: 'usr_support', name: 'Divya Krishnan', email: 'support@agenticcommerce.in', phone: '+91 90000 10002', pass: 'Support@123', roles: ['SUPPORT'] },
    { id: 'usr_ops', name: 'Vikram Sundar', email: 'ops@agenticcommerce.in', phone: '+91 90000 10003', pass: 'Ops@123', roles: ['CATALOG_MANAGER', 'ORDER_MANAGER', 'INVENTORY_MANAGER'] },
    { id: 'usr_aiadmin', name: 'Meera Natarajan', email: 'aiadmin@agenticcommerce.in', phone: '+91 90000 10004', pass: 'AiAdmin@123', roles: ['AI_ADMIN'] },
  ];

  for (const u of users) {
    insertUser.run(u.id, u.name, u.email, u.phone, hashPassword(u.pass), 'ACTIVE', h1, now);
    for (const r of u.roles) {
      insertRole.run(u.id, r);
    }
  }

  // 2. Seed Addresses & Saved Payment Methods
  const insertAddr = db.prepare(
    'INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, line2, city, state, postal_code, country, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertAddr.run('addr_1', 'usr_sathya', 'Home', 'Sathya Kumar', '+91 98765 43210', '123, Anna Nagar East', 'Near Tower Park', 'Chennai', 'Tamil Nadu', '600040', 'India', 1, h1);
  insertAddr.run('addr_2', 'usr_sathya', 'Office', 'Sathya Kumar', '+91 98765 43210', 'Tech Park Phase II, Sholinganallur', 'OMR IT Corridor', 'Chennai', 'Tamil Nadu', '600119', 'India', 0, h1);
  insertAddr.run('addr_3', 'usr_priya', 'Home', 'Priya Ramanathan', '+91 98401 11223', '45, RS Puram West', 'DB Road', 'Coimbatore', 'Tamil Nadu', '641002', 'India', 1, h1);

  db.prepare(
    'INSERT INTO saved_payment_methods (id, user_id, method_type, provider_label, masked_reference, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('pm_1', 'usr_sathya', 'UPI', 'Google Pay / UPI', 'sathya@okaxis', 1, h1);
  db.prepare(
    'INSERT INTO saved_payment_methods (id, user_id, method_type, provider_label, masked_reference, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('pm_2', 'usr_sathya', 'CARD', 'HDFC Regalia Visa', '•••• 4821', 0, h1);

  // 3. Seed Categories
  const insertCat = db.prepare(
    'INSERT INTO categories (id, parent_id, name, slug, description, icon_name, image_url, status, sort_order) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)'
  );
  const cats = [
    { id: 'cat_laptops', name: 'Laptops', slug: 'laptops', desc: 'Developer ultrabooks, pro workstations, and gaming rigs.', icon: 'Laptop', img: '/src/assets/images/prod_macbook_pro_1794850599772.jpg', order: 1 },
    { id: 'cat_mobiles', name: 'Mobiles', slug: 'mobiles', desc: 'Flagship titanium smartphones with pro camera arrays.', icon: 'Smartphone', img: '/src/assets/images/prod_smartphone_1794850601696.jpg', order: 2 },
    { id: 'cat_audio', name: 'Audio', slug: 'audio', desc: 'Studio-grade noise-cancelling headphones and earbuds.', icon: 'Headphones', img: '/src/assets/images/prod_headphones_1794850601133.jpg', order: 3 },
    { id: 'cat_wearables', name: 'Wearables', slug: 'wearables', desc: 'Precision titanium smartwatches and health trackers.', icon: 'Watch', img: '/src/assets/images/prod_smartwatch_1794850601327.jpg', order: 4 },
    { id: 'cat_cameras', name: 'Cameras', slug: 'cameras', desc: 'Mirrorless full-frame cameras and prime optics.', icon: 'Camera', img: '/src/assets/images/prod_dslr_camera_1794850602226.jpg', order: 5 },
    { id: 'cat_accessories', name: 'Accessories', slug: 'accessories', desc: 'Weatherproof commuter backpacks and desk gear.', icon: 'Briefcase', img: '/src/assets/images/prod_travel_backpack_1794850602170.jpg', order: 6 },
  ];
  for (const c of cats) {
    insertCat.run(c.id, c.name, c.slug, c.desc, c.icon, c.img, 'ACTIVE', c.order);
  }

  // 4. Seed Products, Variants, Images, Inventory
  const insertProd = db.prepare(
    'INSERT INTO products (id, category_id, name, slug, brand, short_description, description, specs_json, badge, rating, review_count, status, featured, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertVar = db.prepare(
    'INSERT INTO product_variants (id, product_id, sku, title, attributes_json, price_paise, mrp_paise, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertImg = db.prepare(
    'INSERT INTO product_images (id, product_id, url, alt_text, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const insertInv = db.prepare(
    'INSERT INTO inventory (variant_id, on_hand, reserved, reorder_level, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  const insertMov = db.prepare(
    'INSERT INTO inventory_movements (id, variant_id, movement_type, quantity_delta, reference_id, reason, actor_user_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)'
  );

  const productsSeed = [
    {
      id: 'prod_macbook_m3',
      cat: 'cat_laptops',
      name: 'MacBook Pro M3',
      slug: 'macbook-pro-m3',
      brand: 'Apple',
      shortDesc: 'M3 Chip · 16GB Unified RAM · 512GB SSD · 14" Liquid Retina XDR',
      desc: 'Engineered for sustained compilation, ML prototyping, and studio grading with a 120Hz Liquid Retina XDR display and all-day 18-hour battery life.',
      specs: { Processor: 'Apple M3 8-Core', RAM: '16GB Unified', Storage: '512GB NVMe SSD', Display: '14.2" Liquid Retina XDR', Battery: 'Up to 18 hrs', Weight: '1.55 kg' },
      badge: 'Best Seller',
      rating: 4.8,
      reviews: 1243,
      featured: 1,
      img: '/src/assets/images/prod_macbook_pro_1794850599772.jpg',
      variants: [
        { id: 'var_mbp_16_512', sku: 'MACM3-16-512', title: '16GB / 512GB · Space Black', attrs: { ram: '16GB', storage: '512GB', color: 'Space Black' }, price: 14999000, mrp: 16990000, stock: 18, reserved: 2 },
        { id: 'var_mbp_24_1tb', sku: 'MACM3-24-1TB', title: '24GB / 1TB · Space Black', attrs: { ram: '24GB', storage: '1TB', color: 'Space Black' }, price: 17999000, mrp: 19990000, stock: 7, reserved: 0 },
      ],
    },
    {
      id: 'prod_ideapad_slim5',
      cat: 'cat_laptops',
      name: 'Lenovo IdeaPad Slim 5',
      slug: 'lenovo-ideapad-slim-5',
      brand: 'Lenovo',
      shortDesc: 'AMD Ryzen 5 · 16GB RAM · 512GB SSD · 14" FHD Anti-Glare',
      desc: 'Featherweight anodized aluminum ultrabook tailored for full-stack development, Docker containers, and quiet thermal efficiency under ₹60,000.',
      specs: { Processor: 'AMD Ryzen 5 7530U', RAM: '16GB DDR4', Storage: '512GB Gen4 SSD', Display: '14" FHD IPS', Battery: 'Up to 11 hrs', Weight: '1.46 kg' },
      badge: 'AI Recommended',
      rating: 4.7,
      reviews: 1203,
      featured: 1,
      img: '/src/assets/images/prod_slim_laptop_1794850599703.jpg',
      variants: [
        { id: 'var_lenovo_16_512', sku: 'LEN-SLIM5-16', title: '16GB / 512GB · Cloud Grey', attrs: { ram: '16GB', storage: '512GB', color: 'Cloud Grey' }, price: 5699000, mrp: 6299000, stock: 24, reserved: 1 },
        { id: 'var_lenovo_16_1tb', sku: 'LEN-SLIM5-1TB', title: '16GB / 1TB · Abyss Blue', attrs: { ram: '16GB', storage: '1TB', color: 'Abyss Blue' }, price: 6199000, mrp: 6899000, stock: 3, reserved: 0 },
      ],
    },
    {
      id: 'prod_hp_victus15',
      cat: 'cat_laptops',
      name: 'HP Victus 15 Developer Edition',
      slug: 'hp-victus-15',
      brand: 'HP',
      shortDesc: 'Intel Core i5-13420H · 16GB RAM · 512GB SSD · 15.6" 144Hz',
      desc: 'High-wattage H-series compute with dual-fan cooling for local Kubernetes clusters, Android Studio emulators, and modern web builds.',
      specs: { Processor: 'Intel Core i5 13th Gen', RAM: '16GB DDR4', Storage: '512GB NVMe SSD', Display: '15.6" FHD 144Hz', Battery: 'Up to 8 hrs', Weight: '2.29 kg' },
      badge: 'Value Pick',
      rating: 4.6,
      reviews: 2400,
      featured: 0,
      img: '/src/assets/images/prod_slim_laptop_1794850599703.jpg',
      variants: [
        { id: 'var_hp_victus_16', sku: 'HP-VIC15-16', title: '16GB / 512GB · Mica Silver', attrs: { ram: '16GB', storage: '512GB', color: 'Mica Silver' }, price: 5449900, mrp: 6499000, stock: 12, reserved: 0 },
      ],
    },
    {
      id: 'prod_asus_vivobook16',
      cat: 'cat_laptops',
      name: 'ASUS Vivobook 16',
      slug: 'asus-vivobook-16',
      brand: 'ASUS',
      shortDesc: 'AMD Ryzen 7 · 16GB RAM · 512GB SSD · 16" WUXGA 16:10',
      desc: 'Expansive 16:10 developer viewport with ErgoSense keyboard, military-grade durability, and physical webcam privacy shield.',
      specs: { Processor: 'AMD Ryzen 7 7730U', RAM: '16GB DDR4', Storage: '512GB SSD', Display: '16" WUXGA 16:10', Battery: 'Up to 12 hrs', Weight: '1.88 kg' },
      badge: 'New',
      rating: 4.8,
      reviews: 1100,
      featured: 0,
      img: '/src/assets/images/prod_macbook_pro_1794850599772.jpg',
      variants: [
        { id: 'var_asus_vivo16', sku: 'ASUS-VV16-R7', title: '16GB / 512GB · Indie Black', attrs: { ram: '16GB', storage: '512GB', color: 'Indie Black' }, price: 5999000, mrp: 6999000, stock: 9, reserved: 0 },
      ],
    },
    {
      id: 'prod_sony_xm5',
      cat: 'cat_audio',
      name: 'Sony WH-1000XM5',
      slug: 'sony-wh-1000xm5',
      brand: 'Sony',
      shortDesc: '8-Mic Adaptive ANC · 30-Hour Battery · Multipoint Bluetooth',
      desc: 'Industry-leading active noise cancellation powered by dual processors for deep focus during coding, travel, and studio listening.',
      specs: { Driver: '30mm Carbon Fiber', ANC: '8-Mic Adaptive', Battery: '30 hrs (ANC On)', Charging: 'USB-C PD Quick Charge', Weight: '250 g' },
      badge: 'Best Seller',
      rating: 4.7,
      reviews: 6100,
      featured: 1,
      img: '/src/assets/images/prod_headphones_1794850601133.jpg',
      variants: [
        { id: 'var_xm5_black', sku: 'SONY-XM5-BLK', title: 'Matte Black', attrs: { color: 'Matte Black' }, price: 2699000, mrp: 3499000, stock: 42, reserved: 3 },
        { id: 'var_xm5_silver', sku: 'SONY-XM5-SLV', title: 'Platinum Silver', attrs: { color: 'Platinum Silver' }, price: 2749000, mrp: 3499000, stock: 1, reserved: 0 },
      ],
    },
    {
      id: 'prod_galaxy_watch7',
      cat: 'cat_wearables',
      name: 'Galaxy Watch 7 Titanium',
      slug: 'galaxy-watch-7',
      brand: 'Samsung',
      shortDesc: '3nm Dual-Frequency GPS · Sapphire Crystal · BioActive Sensor',
      desc: 'Precision wearable engineered with sapphire crystal glass, sleep apnea insights, and dual-band L1+L5 GPS tracking.',
      specs: { Display: '1.5" Super AMOLED', Chipset: 'Exynos W1000 (3nm)', Durability: '5ATM + IP68 + MIL-STD', Battery: '425mAh Fast Charge' },
      badge: 'Low Stock',
      rating: 4.6,
      reviews: 1320,
      featured: 1,
      img: '/src/assets/images/prod_smartwatch_1794850601327.jpg',
      variants: [
        { id: 'var_gw7_44', sku: 'SAM-GW7-44', title: '44mm · Titanium Gray', attrs: { size: '44mm', color: 'Titanium Gray' }, price: 2999900, mrp: 3499900, stock: 4, reserved: 1 },
      ],
    },
    {
      id: 'prod_iphone16_pro',
      cat: 'cat_mobiles',
      name: 'iPhone 16 Pro',
      slug: 'iphone-16-pro',
      brand: 'Apple',
      shortDesc: 'Grade 5 Titanium · A18 Pro · 4K 120fps Dolby Vision',
      desc: 'Forged in aerospace-grade titanium with Camera Control, 5x Telephoto optics, and studio-quality four-microphone array.',
      specs: { Processor: 'A18 Pro 3nm', Display: '6.3" Super Retina XDR 120Hz', Camera: '48MP Fusion + 5x Telephoto', Storage: '256GB NVMe' },
      badge: 'Flagship',
      rating: 4.9,
      reviews: 8740,
      featured: 1,
      img: '/src/assets/images/prod_smartphone_1794850601696.jpg',
      variants: [
        { id: 'var_ip16p_256', sku: 'APL-IP16P-256', title: '256GB · Natural Titanium', attrs: { storage: '256GB', color: 'Natural Titanium' }, price: 12990000, mrp: 13490000, stock: 15, reserved: 0 },
        { id: 'var_ip16p_512', sku: 'APL-IP16P-512', title: '512GB · Desert Titanium', attrs: { storage: '512GB', color: 'Desert Titanium' }, price: 14990000, mrp: 15490000, stock: 6, reserved: 0 },
      ],
    },
    {
      id: 'prod_pixel9_pro',
      cat: 'cat_mobiles',
      name: 'Google Pixel 9 Pro',
      slug: 'google-pixel-9-pro',
      brand: 'Google',
      shortDesc: 'Tensor G4 · 16GB RAM · Super Actua LTPO OLED · 7 Years Updates',
      desc: 'Flagship AI-native smartphone with triple rear camera system, ultrasonic fingerprint sensor, and 3000-nit Super Actua display.',
      specs: { Processor: 'Google Tensor G4', RAM: '16GB', Display: '6.3" Super Actua 120Hz', Camera: '50MP Main + 48MP 5x' },
      badge: 'New',
      rating: 4.7,
      reviews: 2150,
      featured: 0,
      img: '/src/assets/images/prod_smartphone_1794850601696.jpg',
      variants: [
        { id: 'var_pix9p_256', sku: 'GOOG-PIX9P-256', title: '256GB · Hazel', attrs: { storage: '256GB', color: 'Hazel' }, price: 9999900, mrp: 10999900, stock: 11, reserved: 0 },
      ],
    },
    {
      id: 'prod_sony_a7iv',
      cat: 'cat_cameras',
      name: 'Sony Alpha A7 IV Mirrorless',
      slug: 'sony-alpha-a7-iv',
      brand: 'Sony',
      shortDesc: '33MP Full-Frame Exmor R · 4K 60p 10-Bit · Real-Time Eye AF',
      desc: 'Hybrid full-frame powerhouse built for crisp commercial product shoots, 10-bit S-Log3 cinema workflows, and reliable dual-card recording.',
      specs: { Sensor: '33MP Full-Frame BSI CMOS', Video: '4K 60p 10-bit 4:2:2', Stabilization: '5-Axis IBIS (5.5 stops)', Mount: 'Sony E-Mount' },
      badge: 'Creator Pick',
      rating: 4.9,
      reviews: 389,
      featured: 1,
      img: '/src/assets/images/prod_dslr_camera_1794850602226.jpg',
      variants: [
        { id: 'var_a7iv_body', sku: 'SONY-A7IV-BODY', title: 'Body Only · Matte Black', attrs: { kit: 'Body Only', color: 'Matte Black' }, price: 18499000, mrp: 21499000, stock: 5, reserved: 0 },
        { id: 'var_a7iv_kit', sku: 'SONY-A7IV-2870', title: 'With 28-70mm Lens', attrs: { kit: '28-70mm f/3.5-5.6', color: 'Matte Black' }, price: 20499000, mrp: 23499000, stock: 2, reserved: 0 },
      ],
    },
    {
      id: 'prod_travel_backpack',
      cat: 'cat_accessories',
      name: 'Aurora Tech Commuter Backpack',
      slug: 'aurora-tech-backpack',
      brand: 'Aurora Gear',
      shortDesc: '22L Weatherproof Ballistic Nylon · 16" Suspended Laptop Sleeve',
      desc: 'Structured everyday carry engineered with water-resistant YKK AquaGuard zippers, magnetic chest strap, and quick-access tech organizer.',
      specs: { Capacity: '22 Liters', Material: '1680D Ballistic Nylon', LaptopFit: 'Up to 16" MacBook Pro', Weight: '1.15 kg' },
      badge: 'Essential',
      rating: 4.8,
      reviews: 840,
      featured: 1,
      img: '/src/assets/images/prod_travel_backpack_1794850602170.jpg',
      variants: [
        { id: 'var_bag_22l', sku: 'AUR-BAG-22L', title: '22L · Charcoal Slate', attrs: { capacity: '22L', color: 'Charcoal Slate' }, price: 299900, mrp: 399900, stock: 35, reserved: 0 },
      ],
    },
    {
      id: 'prod_smart_watch_pro',
      cat: 'cat_wearables',
      name: 'Aurora Smart Watch Pro',
      slug: 'aurora-smart-watch-pro',
      brand: 'Aurora Gear',
      shortDesc: '1.43" AMOLED · 7-Day Battery · SpO2 & HRV · 5ATM Waterproof',
      desc: 'Accessible everyday fitness and notification companion with crisp always-on AMOLED glass and 7-day real-world battery endurance.',
      specs: { Display: '1.43" AMOLED 466x466', Battery: 'Up to 7 Days', WaterRating: '5ATM', Connectivity: 'Bluetooth 5.3' },
      badge: 'Deal',
      rating: 4.7,
      reviews: 2432,
      featured: 0,
      img: '/src/assets/images/prod_smartwatch_1794850601327.jpg',
      variants: [
        { id: 'var_swp_blk', sku: 'AUR-SWP-BLK', title: '42mm · Obsidian Black', attrs: { size: '42mm', color: 'Obsidian Black' }, price: 499900, mrp: 699900, stock: 60, reserved: 2 },
      ],
    },
    {
      id: 'prod_airpods_pro2',
      cat: 'cat_audio',
      name: 'Aurora Studio Buds ANC',
      slug: 'aurora-studio-buds-anc',
      brand: 'Aurora Gear',
      shortDesc: 'Hybrid ANC · Spatial Audio · Wireless Charging Case',
      desc: 'Pocketable true wireless earbuds tuned for clear voice calls and warm acoustic balance. Currently awaiting restock.',
      specs: { ANC: '42dB Hybrid', Battery: '28 hrs with Case', Codec: 'AAC / LDAC', WaterRating: 'IPX5' },
      badge: 'Out of Stock',
      rating: 4.5,
      reviews: 512,
      featured: 0,
      img: '/src/assets/images/prod_headphones_1794850601133.jpg',
      variants: [
        { id: 'var_buds_01', sku: 'AUR-BUDS-01', title: 'Graphite Matte', attrs: { color: 'Graphite Matte' }, price: 699900, mrp: 899900, stock: 0, reserved: 0 },
      ],
    },
  ];

  for (const p of productsSeed) {
    insertProd.run(
      p.id,
      p.cat,
      p.name,
      p.slug,
      p.brand,
      p.shortDesc,
      p.desc,
      JSON.stringify(p.specs),
      p.badge,
      p.rating,
      p.reviews,
      'ACTIVE',
      p.featured,
      h1,
      now
    );
    insertImg.run(`img_${p.id}_1`, p.id, p.img, p.name, 0);
    for (const v of p.variants) {
      insertVar.run(v.id, p.id, v.sku, v.title, JSON.stringify(v.attrs), v.price, v.mrp, 'ACTIVE');
      insertInv.run(v.id, v.stock, v.reserved, 5, now);
      if (v.stock > 0) {
        insertMov.run(newId('mov'), v.id, 'INITIAL_STOCK', v.stock, 'Initial catalog seed', 'usr_admin', h1);
      }
    }
  }

  // Seed initial product reviews
  const insertRev = db.prepare(
    'INSERT INTO product_reviews (id, product_id, user_id, author_name, rating, title, comment, verified_purchase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
  );
  insertRev.run('rev_1', 'prod_ideapad_slim5', 'usr_sathya', 'Sathya Kumar', 5, 'Ideal full-stack machine under 60K', 'Runs VS Code, Docker, and Vite dev builds effortlessly with cool thermals and bright screen.', h2);
  insertRev.run('rev_2', 'prod_macbook_m3', 'usr_priya', 'Priya Ramanathan', 5, 'Silent powerhouse', 'Battery easily lasts an entire workday. Display sharpness is unmatched for UI work.', h2);
  insertRev.run('rev_3', 'prod_sony_xm5', 'usr_arjun', 'Arjun Menon', 5, 'Blocks open-office chatter completely', 'Multipoint switching between laptop and phone is seamless.', h2);

  // 5. Seed Coupons
  const insertCoupon = db.prepare(
    'INSERT INTO coupons (id, code, description, discount_type, discount_value, max_discount_paise, min_order_paise, starts_at, expires_at, usage_limit, used_count, per_user_limit, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertCoupon.run('cpn_welcome10', 'WELCOME10', '10% off up to ₹5,000 on orders above ₹1,000', 'PERCENT', 10, 500000, 100000, '2025-01-01T00:00:00Z', '2028-12-31T23:59:59Z', 500, 12, 2, 1);
  insertCoupon.run('cpn_tech2000', 'TECH2000', 'Flat ₹2,000 off on orders above ₹25,000', 'FLAT', 200000, null, 2500000, '2025-01-01T00:00:00Z', '2028-12-31T23:59:59Z', 200, 4, 1, 1);
  insertCoupon.run('cpn_aurora15', 'AURORA15', '15% off up to ₹3,000 on accessories & audio', 'PERCENT', 15, 300000, 200000, '2025-01-01T00:00:00Z', '2028-12-31T23:59:59Z', 100, 1, 1, 1);
  insertCoupon.run('cpn_expired', 'EXPIRED50', 'Expired promotional test coupon', 'PERCENT', 50, 1000000, 0, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 100, 0, 1, 1);

  // 6. Seed Sample Orders, Order Items, Payments, Shipments
  const insertOrder = db.prepare(
    'INSERT INTO orders (id, order_number, user_id, status, shipping_method, address_snapshot_json, coupon_code, subtotal_paise, discount_paise, shipping_paise, tax_paise, grand_total_paise, currency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertOrderItem = db.prepare(
    'INSERT INTO order_items (id, order_id, product_id, variant_id, product_name, variant_title, sku, image_url, unit_price_paise, quantity, line_total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPayment = db.prepare(
    'INSERT INTO payments (id, order_id, provider, method, provider_reference, amount_paise, refunded_paise, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
  );
  const insertShipment = db.prepare(
    'INSERT INTO shipments (id, order_id, carrier, tracking_reference, status, source, estimated_delivery, timeline_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const sathyaAddr = JSON.stringify({
    label: 'Home',
    recipientName: 'Sathya Kumar',
    phone: '+91 98765 43210',
    line1: '123, Anna Nagar East',
    line2: 'Near Tower Park',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600040',
    country: 'India',
  });
  const priyaAddr = JSON.stringify({
    label: 'Home',
    recipientName: 'Priya Ramanathan',
    phone: '+91 98401 11223',
    line1: '45, RS Puram West',
    line2: 'DB Road',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    postalCode: '641002',
    country: 'India',
  });

  // Order 1: Sathya - OUT_FOR_DELIVERY (#AC784512)
  insertOrder.run('ord_ac784512', 'AC784512', 'usr_sathya', 'OUT_FOR_DELIVERY', 'EXPRESS', sathyaAddr, 'TECH2000', 14999000, 200000, 19900, 2257475, 14818900, 'INR', 'Leave at reception if unavailable', h2, h3);
  insertOrderItem.run('oi_1', 'ord_ac784512', 'prod_macbook_m3', 'var_mbp_16_512', 'MacBook Pro M3', '16GB / 512GB · Space Black', 'MACM3-16-512', '/src/assets/images/prod_macbook_pro_1794850599772.jpg', 14999000, 1, 14999000);
  insertPayment.run('pay_1', 'ord_ac784512', 'AURORA_PAY', 'UPI', 'TXN-AC784512-UPI', 14818900, 'INR', 'PAID', h2, h2);
  insertShipment.run('shp_1', 'ord_ac784512', 'Blue Dart Express', 'BD80784512IN', 'OUT_FOR_DELIVERY', 'CARRIER_SYNC', 'Today, by 6:00 PM', JSON.stringify([
    { state: 'PENDING_PAYMENT', label: 'Order Placed', timestamp: h2, detail: 'Checkout submitted' },
    { state: 'CONFIRMED', label: 'Confirmed', timestamp: h2, detail: 'UPI payment verified via webhook' },
    { state: 'PACKED', label: 'Packed', timestamp: h2, detail: 'Quality check & tamper-proof seal complete' },
    { state: 'SHIPPED', label: 'Shipped', timestamp: h3, detail: 'Handed over to Blue Dart Express (BD80784512IN)' },
    { state: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', timestamp: now, detail: 'Arriving today at Chennai Anna Nagar hub' },
  ]), now);

  // Order 2: Sathya - CONFIRMED (#AC784515) - eligible for customer cancellation testing!
  insertOrder.run('ord_ac784515', 'AC784515', 'usr_sathya', 'CONFIRMED', 'STANDARD', sathyaAddr, null, 2699000, 0, 0, 411712, 2699000, 'INR', null, h3, h3);
  insertOrderItem.run('oi_2', 'ord_ac784515', 'prod_sony_xm5', 'var_xm5_black', 'Sony WH-1000XM5', 'Matte Black', 'SONY-XM5-BLK', '/src/assets/images/prod_headphones_1794850601133.jpg', 2699000, 1, 2699000);
  insertPayment.run('pay_2', 'ord_ac784515', 'AURORA_PAY', 'CARD', 'TXN-AC784515-CRD', 2699000, 'INR', 'PAID', h3, h3);
  insertShipment.run('shp_2', 'ord_ac784515', 'Delhivery Air', 'DL90784515IN', 'AWAITING_DISPATCH', 'ADMIN', 'Tomorrow, 11:00 AM - 7:00 PM', JSON.stringify([
    { state: 'PENDING_PAYMENT', label: 'Order Placed', timestamp: h3, detail: 'Checkout submitted' },
    { state: 'CONFIRMED', label: 'Confirmed', timestamp: h3, detail: 'Card payment verified' },
  ]), h3);

  // Order 3: Priya - DELIVERED (#AC784511) - isolated to Priya for IDOR testing
  insertOrder.run('ord_ac784511', 'AC784511', 'usr_priya', 'DELIVERED', 'STANDARD', priyaAddr, null, 2999900, 0, 0, 457612, 2999900, 'INR', null, h1, h2);
  insertOrderItem.run('oi_3', 'ord_ac784511', 'prod_galaxy_watch7', 'var_gw7_44', 'Galaxy Watch 7 Titanium', '44mm · Titanium Gray', 'SAM-GW7-44', '/src/assets/images/prod_smartwatch_1794850601327.jpg', 2999900, 1, 2999900);
  insertPayment.run('pay_3', 'ord_ac784511', 'AURORA_PAY', 'NETBANKING', 'TXN-AC784511-NB', 2999900, 'INR', 'PAID', h1, h1);
  insertShipment.run('shp_3', 'ord_ac784511', 'Blue Dart Surface', 'BD80784511IN', 'DELIVERED', 'CARRIER_SYNC', 'Delivered', JSON.stringify([
    { state: 'PENDING_PAYMENT', label: 'Order Placed', timestamp: h1, detail: 'Checkout submitted' },
    { state: 'CONFIRMED', label: 'Confirmed', timestamp: h1, detail: 'Payment verified' },
    { state: 'SHIPPED', label: 'Shipped', timestamp: h1, detail: 'Dispatched from Chennai fulfillment center' },
    { state: 'DELIVERED', label: 'Delivered', timestamp: h2, detail: 'Signed by Priya R.' },
  ]), h2);

  // 7. Seed Wishlist & Saved AI Recommendations for Sathya
  db.prepare('INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, ?)').run('usr_sathya', 'prod_iphone16_pro', h2);
  db.prepare('INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, ?)').run('usr_sathya', 'prod_sony_a7iv', h2);

  db.prepare(
    'INSERT INTO saved_recommendations (id, user_id, product_id, variant_id, reason, price_snapshot_paise, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('srec_1', 'usr_sathya', 'prod_ideapad_slim5', 'var_lenovo_16_512', 'Best full-stack developer laptop under ₹60,000 with 16GB RAM & Ryzen 5', 5699000, h2);

  // 8. Seed 5 Specialist AI Agents & Workflow Graph
  const insertAgent = db.prepare(
    'INSERT INTO agent_definitions (id, agent_key, name, role_title, description, model_name, system_prompt, allowed_tools_json, max_steps, timeout_ms, version, enabled, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)'
  );
  const agents = [
    {
      id: 'agt_shopping',
      key: 'shopping_agent',
      name: 'Shopping Agent',
      role: 'Coordinator & Intent Planner',
      desc: 'Understands shopping intent, budget, and constraints; coordinates Product, Inventory, Order, and Support specialists; summarizes trade-offs.',
      prompt: 'You are the Shopping Agent coordinator for Agentic Commerce. Ground every product recommendation, price, and stock availability strictly in tool outputs from search_products, get_product_details, check_stock, and compare_products. Never invent SKUs, prices, or policies. Prices are in INR (₹). If the user asks about personal orders or wants to cancel/open a support ticket while unauthenticated, inform them clearly to sign in. For order cancellation, always ask explicit confirmation before executing.',
      tools: ['search_products', 'get_product_details', 'compare_products', 'check_stock', 'check_serviceability', 'add_to_cart', 'get_my_orders', 'get_order_status', 'request_cancellation', 'search_help_articles', 'create_support_ticket', 'get_ticket_status'],
    },
    {
      id: 'agt_product',
      key: 'product_agent',
      name: 'Product Agent',
      role: 'Catalog & Comparison Specialist',
      desc: 'Finds matching products from the authoritative catalog, compares technical specs side-by-side, and summarizes verified customer reviews.',
      prompt: 'You are the Product Agent. Query the live catalog via search_products, get_product_details, compare_products, and get_reviews_summary. Report exact specifications and ratings without exaggeration.',
      tools: ['search_products', 'get_product_details', 'compare_products', 'get_reviews_summary'],
    },
    {
      id: 'agt_inventory',
      key: 'inventory_agent',
      name: 'Inventory Agent',
      role: 'Real-Time Stock & Delivery Checker',
      desc: 'Checks live available_to_sell (on_hand - reserved) counts and postal-code delivery serviceability.',
      prompt: 'You are the Inventory Agent. Verify real-time stock levels using check_stock and pincode delivery estimates using check_serviceability.',
      tools: ['check_stock', 'check_serviceability'],
    },
    {
      id: 'agt_order',
      key: 'order_agent',
      name: 'Order Agent',
      role: 'Order Tracking & Cancellation Specialist',
      desc: 'Retrieves owner-scoped orders, live shipment timelines, and handles eligibility-checked cancellation requests with confirmation.',
      prompt: 'You are the Order Agent. Only access orders belonging to the authenticated user via get_my_orders and get_order_status. Never execute request_cancellation without explicit user confirmation.',
      tools: ['get_my_orders', 'get_order_status', 'request_cancellation'],
    },
    {
      id: 'agt_support',
      key: 'support_agent',
      name: 'Support Agent',
      role: 'Policy FAQ & Ticket Specialist',
      desc: 'Answers return, warranty, and payment FAQs using grounded help articles and manages support ticket creation and status checks.',
      prompt: 'You are the Support Agent. Search grounded help articles with search_help_articles, or create/track support tickets when an issue needs human review. Never ask for raw card numbers or CVVs.',
      tools: ['search_help_articles', 'create_support_ticket', 'get_ticket_status'],
    },
  ];
  for (const a of agents) {
    insertAgent.run(a.id, a.key, a.name, a.role, a.desc, 'gemini-4-hydrogen', a.prompt, JSON.stringify(a.tools), 5, 15000, 'PUBLISHED', now);
  }

  db.prepare(
    'INSERT INTO agent_workflows (id, name, nodes_json, edges_json, status, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run(
    'wf_default',
    'Multi-Agent Commerce Orchestration v1',
    JSON.stringify([
      { id: 'n_start', type: 'START', label: 'Customer Intent', x: 60, y: 180, config: { channel: 'AI Workspace' } },
      { id: 'n_shop', type: 'AGENT', label: 'Shopping Coordinator', x: 260, y: 180, config: { agentKey: 'shopping_agent' } },
      { id: 'n_cond', type: 'CONDITION', label: 'Intent Router', x: 470, y: 180, config: { routes: ['catalog', 'stock', 'order', 'support'] } },
      { id: 'n_prod', type: 'AGENT', label: 'Product Agent', x: 700, y: 50, config: { agentKey: 'product_agent', tool: 'search_products' } },
      { id: 'n_inv', type: 'AGENT', label: 'Inventory Agent', x: 700, y: 140, config: { agentKey: 'inventory_agent', tool: 'check_stock' } },
      { id: 'n_ord', type: 'AGENT', label: 'Order Agent', x: 700, y: 230, config: { agentKey: 'order_agent', tool: 'get_my_orders' } },
      { id: 'n_sup', type: 'AGENT', label: 'Support Agent', x: 700, y: 320, config: { agentKey: 'support_agent', tool: 'search_help_articles' } },
      { id: 'n_end', type: 'END', label: 'Grounded Response', x: 930, y: 180, config: { persistMemory: true } },
    ]),
    JSON.stringify([
      { id: 'e1', from: 'n_start', to: 'n_shop' },
      { id: 'e2', from: 'n_shop', to: 'n_cond' },
      { id: 'e3', from: 'n_cond', to: 'n_prod', label: 'Discovery' },
      { id: 'e4', from: 'n_cond', to: 'n_inv', label: 'Stock' },
      { id: 'e5', from: 'n_cond', to: 'n_ord', label: 'Orders' },
      { id: 'e6', from: 'n_cond', to: 'n_sup', label: 'Help' },
      { id: 'e7', from: 'n_prod', to: 'n_end' },
      { id: 'e8', from: 'n_inv', to: 'n_end' },
      { id: 'e9', from: 'n_ord', to: 'n_end' },
      { id: 'e10', from: 'n_sup', to: 'n_end' },
    ]),
    'PUBLISHED',
    now
  );

  // 9. Seed Sample AI Conversation & Agent Run History
  db.prepare(
    'INSERT INTO conversations (id, user_id, guest_token, title, summary, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)'
  ).run('conv_demo_1', 'usr_sathya', 'Laptop for full stack dev under ₹60,000', 'User searched for full-stack development laptops under ₹60,000 and received 3 stock-verified options.', h2, h2);

  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, cards_json, run_id, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)'
  ).run('msg_1', 'conv_demo_1', 'user', 'I need a laptop for full stack development under ₹60,000', h2);

  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, cards_json, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'msg_2',
    'conv_demo_1',
    'assistant',
    'I collaborated with our **Product Agent** and **Inventory Agent** and verified live stock for 3 strong full-stack development laptops under ₹60,000:\n\n1. **HP Victus 15 Developer Edition** (₹54,499 · 12 in stock) — Best raw H-series CPU power for Docker & emulators.\n2. **Lenovo IdeaPad Slim 5** (₹56,990 · 23 available) — Best balance of portability, 16GB RAM, and battery life.\n3. **ASUS Vivobook 16** (₹59,990 · 9 in stock) — Largest 16:10 display with Ryzen 7.',
    JSON.stringify([
      { productId: 'prod_ideapad_slim5', variantId: 'var_lenovo_16_512', slug: 'lenovo-ideapad-slim-5', name: 'Lenovo IdeaPad Slim 5', pricePaise: 5699000, rating: 4.7, availableToSell: 23, imageUrl: '/src/assets/images/prod_slim_laptop_1794850599703.jpg' },
      { productId: 'prod_hp_victus15', variantId: 'var_hp_victus_16', slug: 'hp-victus-15', name: 'HP Victus 15 Developer Edition', pricePaise: 5449900, rating: 4.6, availableToSell: 12, imageUrl: '/src/assets/images/prod_slim_laptop_1794850599703.jpg' },
      { productId: 'prod_asus_vivobook16', variantId: 'var_asus_vivo16', slug: 'asus-vivobook-16', name: 'ASUS Vivobook 16', pricePaise: 5999000, rating: 4.8, availableToSell: 9, imageUrl: '/src/assets/images/prod_macbook_pro_1794850599772.jpg' },
    ]),
    'run_demo_1',
    h2
  );

  db.prepare(
    'INSERT INTO agent_runs (id, conversation_id, user_id, agent_key, status, prompt_summary, final_summary, model_name, tokens_estimated, cost_microusd, duration_ms, correlation_id, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('run_demo_1', 'conv_demo_1', 'usr_sathya', 'shopping_agent', 'COMPLETED', 'Find laptop for full stack development under ₹60,000', 'Returned 3 stock-verified laptops under ₹60,000', 'gemini-4-hydrogen', 1120, 420, 840, 'corr_demo_1', h2, h2);

  const insEv = db.prepare(
    'INSERT INTO agent_events (id, run_id, agent_key, event_type, tool_name, input_summary, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insEv.run('ev_1', 'run_demo_1', 'shopping_agent', 'AGENT_ROUTED', null, 'Intent: laptop discovery <= ₹60,000', 'Delegated catalog search & stock check', 'COMPLETED', 85, h2);
  insEv.run('ev_2', 'run_demo_1', 'product_agent', 'TOOL_COMPLETED', 'search_products', '{"category":"laptops","maxPricePaise":6000000}', 'Matched 3 active laptops', 'COMPLETED', 142, h2);
  insEv.run('ev_3', 'run_demo_1', 'inventory_agent', 'TOOL_COMPLETED', 'check_stock', '{"variantIds":["var_lenovo_16_512","var_hp_victus_16","var_asus_vivo16"]}', 'Verified live stock: 23, 12, 9 units', 'COMPLETED', 94, h2);
  insEv.run('ev_4', 'run_demo_1', 'shopping_agent', 'FINAL_RESPONSE', null, 'Compiled comparison & recommendation cards', 'Delivered grounded response', 'COMPLETED', 519, h2);

  // 10. Seed Help Articles & Support Ticket & Notifications & Settings
  const insertHelp = db.prepare('INSERT INTO help_articles (id, category, question, answer, sort_order) VALUES (?, ?, ?, ?, ?)');
  insertHelp.run('hlp_1', 'Orders', 'How do I cancel or modify my order?', 'Orders in Pending Payment, Confirmed, or Processing state can be cancelled directly from My Orders or via the AI Order Agent after confirming. Once packed or shipped, please use the Return & Refund workflow after delivery.', 1);
  insertHelp.run('hlp_2', 'Returns', 'What is your return and refund policy?', 'Most electronics and accessories are eligible for a 7-day replacement or full refund from the delivery date if unused and in original packaging. Refunds are processed to your original payment method after inspection.', 2);
  insertHelp.run('hlp_3', 'Payments', 'Which payment methods are supported?', 'We support UPI (GPay, PhonePe, BHIM), Credit & Debit Cards, Net Banking, Wallets, and Cash on Delivery for eligible pincodes. We never store raw card numbers or CVV.', 3);
  insertHelp.run('hlp_4', 'AI Shopping', 'How do the 5 AI shopping agents verify prices and stock?', 'Our Shopping Coordinator delegates catalog queries to the Product Agent and real-time availability checks to the Inventory Agent, both reading live authoritative backend data before any cart or checkout action.', 4);
  insertHelp.run('hlp_5', 'Shipping', 'How fast is Express vs Standard delivery?', 'Standard delivery is free on orders ₹999 and above (2–5 business days). Express delivery is ₹199 and delivers within 1–2 business days in metro pincodes such as Chennai, Bengaluru, Mumbai, and Delhi.', 5);

  db.prepare(
    'INSERT INTO support_tickets (id, ticket_number, user_id, order_id, subject, category, priority, status, assignee_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('tkt_1', 'TKT-2041', 'usr_sathya', 'ord_ac784512', 'Need GST tax invoice copy for MacBook Pro order', 'Orders', 'MEDIUM', 'OPEN', 'usr_support', h3, h3);

  db.prepare(
    'INSERT INTO ticket_messages (id, ticket_id, sender_user_id, sender_role, is_internal_note, body, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run('tmsg_1', 'tkt_1', 'usr_sathya', 'CUSTOMER', 'Hi team, could you please share the GST invoice PDF details for order #AC784512?', h3);

  db.prepare(
    'INSERT INTO notifications (id, user_id, category, title, body, link_path, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
  ).run('ntf_1', 'usr_sathya', 'ORDERS', 'Order #AC784512 is Out for Delivery', 'Your MacBook Pro M3 is arriving today by 6:00 PM via Blue Dart Express.', '/orders/ord_ac784512/track', now);
  db.prepare(
    'INSERT INTO notifications (id, user_id, category, title, body, link_path, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
  ).run('ntf_2', 'usr_sathya', 'PROMOTIONS', 'Coupon WELCOME10 active on your account', 'Save 10% up to ₹5,000 on your next electronics checkout.', '/shop', h2);

  const insertSet = db.prepare('INSERT INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
  insertSet.run('general', JSON.stringify({ storeName: 'Agentic Commerce', supportEmail: 'support@agenticcommerce.in', currency: 'INR', currencySymbol: '₹', freeShippingThresholdPaise: 99900, expressShippingPaise: 19900, standardShippingPaise: 9900, gstRateBps: 1800, taxInclusive: true }), now);
  insertSet.run('ai_budget', JSON.stringify({ dailyTokenLimit: 500000, dailyBudgetUsd: 25, maxToolSteps: 5, allowGuestDiscovery: true }), now);

  db.prepare(
    'INSERT INTO audit_logs (id, occurred_at, actor_user_id, actor_type, action, entity_type, entity_id, correlation_id, before_summary, after_summary, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
  ).run('aud_seed_1', now, 'usr_admin', 'ADMIN', 'SYSTEM_SEED', 'PLATFORM', 'agentic_commerce', 'corr_seed', 'Initialized relational catalog, inventory, RBAC, and 5 AI agents', 'Initial database bootstrap');
}
