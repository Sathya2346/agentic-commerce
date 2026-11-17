import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, hashPassword, newId, verifyPassword } from './db';
import { hasPermission, type Permission } from '../src/domain/commercePolicy';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
  createdAt: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
      sessionId?: string | null;
      correlationId: string;
    }
  }
}

const COOKIE_NAME = 'ac_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'local';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const list = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (list.length >= maxRequests) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment before trying again.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    list.push(now);
    rateBuckets.set(key, list);
    next();
  };
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

export function loadUserById(userId: string): AuthUser | null {
  const row = db
    .prepare('SELECT id, name, email, phone, status, email_verified, created_at FROM users WHERE id = ?')
    .get(userId) as
    | {
        id: string;
        name: string;
        email: string;
        phone: string | null;
        status: string;
        email_verified: number;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  const roles = (
    db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(userId) as { role: string }[]
  ).map((r) => r.role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    roles,
    createdAt: row.created_at,
  };
}

export function createSessionForUser(userId: string, res: Response): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const sessId = newId('sess');

  db.prepare(
    'INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(sessId, userId, tokenHash, expires, now.toISOString());

  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  return rawToken;
}

export function resolveAuth(req: Request, _res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const rawToken = bearer || cookies[COOKIE_NAME] || null;

  req.authUser = null;
  req.sessionId = null;

  if (!rawToken) {
    next();
    return;
  }

  const tokenHash = hashToken(rawToken);
  const sess = db
    .prepare('SELECT id, user_id, expires_at, revoked FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as { id: string; user_id: string; expires_at: string; revoked: number } | undefined;

  if (!sess || sess.revoked || Date.parse(sess.expires_at) < Date.now()) {
    next();
    return;
  }

  const user = loadUserById(sess.user_id);
  if (user && user.status === 'ACTIVE') {
    req.authUser = user;
    req.sessionId = sess.id;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Please sign in to continue.',
      fieldErrors: [],
      correlationId: req.correlationId,
    });
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    if (!hasPermission(req.authUser.roles, permission)) {
      res.status(403).json({
        code: 'PERMISSION_DENIED',
        message: `Missing required permission: ${permission}`,
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    next();
  };
}

export function registerAuthRoutes(app: import('express').Express): void {
  app.post('/api/v1/auth/register', rateLimit('register', 10, 60_000), (req, res) => {
    const { name, email, phone, password } = req.body ?? {};
    const fieldErrors: { field: string; message: string }[] = [];

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : null;
    const cleanPass = typeof password === 'string' ? password : '';

    if (cleanName.length < 2) fieldErrors.push({ field: 'name', message: 'Full name must be at least 2 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      fieldErrors.push({ field: 'email', message: 'Please enter a valid email address.' });
    }
    if (cleanPass.length < 8) {
      fieldErrors.push({ field: 'password', message: 'Password must be at least 8 characters.' });
    }

    if (fieldErrors.length > 0) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted registration fields.',
        fieldErrors,
        correlationId: req.correlationId,
      });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({
        code: 'STATE_CONFLICT',
        message: 'An account with this email already exists.',
        fieldErrors: [{ field: 'email', message: 'Email is already registered.' }],
        correlationId: req.correlationId,
      });
      return;
    }

    const userId = newId('usr');
    const now = new Date().toISOString();
    const verifyCode = String(Math.floor(100000 + Math.random() * 900000));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'INSERT INTO users (id, name, email, phone, password_hash, status, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
      ).run(userId, cleanName, cleanEmail, cleanPhone, hashPassword(cleanPass), 'ACTIVE', now, now);
      db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(userId, 'CUSTOMER');
      db.prepare(
        'INSERT INTO verification_tokens (id, user_id, purpose, token_hash, code_hint, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId('vtok'),
        userId,
        'EMAIL_VERIFY',
        hashToken(verifyCode),
        verifyCode,
        new Date(Date.now() + 15 * 60_000).toISOString(),
        now
      );
      db.prepare(
        'INSERT INTO notifications (id, user_id, category, title, body, link_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId('ntf'),
        userId,
        'PROMOTIONS',
        'Welcome to Agentic Commerce!',
        'Use coupon WELCOME10 at checkout for 10% off (up to ₹5,000).',
        '/shop',
        now
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const token = createSessionForUser(userId, res);
    const user = loadUserById(userId);
    res.status(201).json({ user, sessionToken: token, verificationRequired: false });
  });

  app.post('/api/v1/auth/login', rateLimit('login', 20, 60_000), (req, res) => {
    const { email, password } = req.body ?? {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!cleanEmail || !cleanPass) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required.',
        fieldErrors: [
          ...(!cleanEmail ? [{ field: 'email', message: 'Email is required.' }] : []),
          ...(!cleanPass ? [{ field: 'password', message: 'Password is required.' }] : []),
        ],
        correlationId: req.correlationId,
      });
      return;
    }

    const row = db
      .prepare('SELECT id, password_hash, status FROM users WHERE email = ?')
      .get(cleanEmail) as { id: string; password_hash: string; status: string } | undefined;

    if (!row || !verifyPassword(cleanPass, row.password_hash)) {
      res.status(401).json({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Invalid email or password.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    if (row.status === 'SUSPENDED') {
      res.status(403).json({
        code: 'PERMISSION_DENIED',
        message: 'This account is currently suspended. Contact support for assistance.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const token = createSessionForUser(row.id, res);
    const user = loadUserById(row.id);
    res.json({ user, sessionToken: token });
  });

  app.post('/api/v1/auth/logout', (req, res) => {
    if (req.sessionId) {
      db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?').run(req.sessionId);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/v1/auth/session', (req, res) => {
    res.json({ user: req.authUser ?? null });
  });

  app.get('/api/v1/me', (req, res) => {
    if (!req.authUser) {
      res.status(401).json({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Not signed in.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    res.json({ user: req.authUser });
  });

  app.patch('/api/v1/me', requireAuth, (req, res) => {
    const userId = req.authUser!.id;
    const { name, phone } = req.body ?? {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : null;
    if (cleanName.length < 2) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Name must be at least 2 characters.',
        fieldErrors: [{ field: 'name', message: 'Name is too short.' }],
        correlationId: req.correlationId,
      });
      return;
    }
    db.prepare('UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?').run(
      cleanName,
      cleanPhone,
      new Date().toISOString(),
      userId
    );
    res.json({ user: loadUserById(userId) });
  });

  app.post('/api/v1/auth/forgot-password', rateLimit('forgot', 5, 60_000), (req, res) => {
    const { email } = req.body ?? {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Please provide a valid email address.',
        fieldErrors: [{ field: 'email', message: 'Invalid email format.' }],
        correlationId: req.correlationId,
      });
      return;
    }

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as { id: string } | undefined;
    let devResetToken: string | undefined;
    if (user) {
      const raw = crypto.randomBytes(16).toString('hex');
      devResetToken = raw;
      db.prepare(
        'INSERT INTO verification_tokens (id, user_id, purpose, token_hash, code_hint, expires_at, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)'
      ).run(newId('vtok'), user.id, 'PASSWORD_RESET', hashToken(raw), new Date(Date.now() + 30 * 60_000).toISOString(), new Date().toISOString());
    }
    // Always return generic non-enumerating message
    res.json({
      message: 'If an account matches that email, password recovery instructions have been issued.',
      previewResetToken: process.env.NODE_ENV !== 'production' ? devResetToken : undefined,
    });
  });

  app.post('/api/v1/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body ?? {};
    if (typeof token !== 'string' || !token || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Valid reset token and password (min 8 chars) are required.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }
    const row = db
      .prepare('SELECT id, user_id, expires_at, used_at FROM verification_tokens WHERE token_hash = ? AND purpose = ?')
      .get(hashToken(token), 'PASSWORD_RESET') as
      | { id: string; user_id: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Reset token is invalid or expired.',
        fieldErrors: [],
        correlationId: req.correlationId,
      });
      return;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hashPassword(newPassword),
        now,
        row.user_id
      );
      db.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
      db.prepare('UPDATE auth_sessions SET revoked = 1 WHERE user_id = ?').run(row.user_id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, message: 'Password updated successfully. Please sign in.' });
  });
}
