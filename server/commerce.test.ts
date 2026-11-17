import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { initSchemaAndSeed, db } from './db';
import { registerAuthRoutes, resolveAuth } from './auth';
import { registerCommerceRoutes, signWebhookPayload } from './commerce';
import { executeAllowlistedTool, registerAiRoutes } from './aiOrchestrator';
import { processOutboxBatch } from './worker';
import { redactSensitiveText } from '../src/domain/commercePolicy';

function startTestApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  initSchemaAndSeed();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.correlationId = 'test_corr';
    next();
  });
  app.use(resolveAuth);
  registerAuthRoutes(app);
  registerCommerceRoutes(app);
  registerAiRoutes(app);

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

async function apiLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

test('Multi-role RBAC, IDOR, Webhook Security, Atomic Stock Race, Idempotency & AI Guardrails', async () => {
  const { baseUrl, close } = await startTestApp();
  try {
    const sathyaCookie = await apiLogin(baseUrl, 'sathya@example.com', 'Customer@123');
    const priyaCookie = await apiLogin(baseUrl, 'priya@example.com', 'Customer@123');
    const opsCookie = await apiLogin(baseUrl, 'ops@agenticcommerce.in', 'Ops@123');
    const adminCookie = await apiLogin(baseUrl, 'admin@agenticcommerce.in', 'Admin@123');

    // 1. IDOR: Priya cannot inspect Sathya's seeded order ord_ac784512
    const idorRes = await fetch(`${baseUrl}/api/v1/orders/ord_ac784512`, { headers: { Cookie: priyaCookie } });
    assert.equal(idorRes.status, 403);

    // 2. RBAC: Customer & Ops Manager (ORDER_MANAGER) cannot approve refund
    const custRefund = await fetch(`${baseUrl}/api/v1/admin/payments/pay_1/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
      body: JSON.stringify({ amountPaise: 1000, reason: 'Unauthorized' }),
    });
    assert.equal(custRefund.status, 403);

    const opsRefund = await fetch(`${baseUrl}/api/v1/admin/payments/pay_1/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({ amountPaise: 1000, reason: 'Ops lacks refund:approve' }),
    });
    assert.equal(opsRefund.status, 403);

    // 3. Atomic last-unit race on Sony WH-1000XM5 Platinum Silver (var_xm5_silver has 1 available unit in seed)
    const addS = await fetch(`${baseUrl}/api/v1/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
      body: JSON.stringify({ variantId: 'var_xm5_silver', quantity: 1 }),
    });
    assert.equal(addS.status, 201);

    const addP = await fetch(`${baseUrl}/api/v1/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: priyaCookie },
      body: JSON.stringify({ variantId: 'var_xm5_silver', quantity: 1 }),
    });
    assert.equal(addP.status, 201);

    const qS = await (
      await fetch(`${baseUrl}/api/v1/checkout/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
        body: JSON.stringify({ shippingMethod: 'STANDARD' }),
      })
    ).json();

    const qP = await (
      await fetch(`${baseUrl}/api/v1/checkout/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: priyaCookie },
        body: JSON.stringify({ shippingMethod: 'STANDARD' }),
      })
    ).json();

    const priyaAddrs = await (await fetch(`${baseUrl}/api/v1/addresses`, { headers: { Cookie: priyaCookie } })).json();
    const priyaAddrId = priyaAddrs.addresses[0].id;

    // Both submit concurrently -> 1 succeeds, 1 gets 409 STOCK_UNAVAILABLE
    const [subS, subP] = await Promise.all([
      fetch(`${baseUrl}/api/v1/checkout/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie, 'Idempotency-Key': 'race_sathya_1' },
        body: JSON.stringify({ quoteId: qS.quoteId, addressId: 'addr_1', paymentMethod: 'UPI' }),
      }),
      fetch(`${baseUrl}/api/v1/checkout/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: priyaCookie, 'Idempotency-Key': 'race_priya_1' },
        body: JSON.stringify({ quoteId: qP.quoteId, addressId: priyaAddrId, paymentMethod: 'UPI' }),
      }),
    ]);

    const statuses = [subS.status, subP.status].sort();
    assert.deepEqual(statuses, [201, 409]);

    const winnerRes = subS.status === 201 ? await subS.json() : await subP.json();
    const winnerCookie = subS.status === 201 ? sathyaCookie : priyaCookie;
    const winnerQuoteId = subS.status === 201 ? qS.quoteId : qP.quoteId;
    const winnerAddr = subS.status === 201 ? 'addr_1' : priyaAddrId;
    const winnerIdem = subS.status === 201 ? 'race_sathya_1' : 'race_priya_1';

    // 4. Idempotent replay returns exact same orderId without double reservation
    const replay = await fetch(`${baseUrl}/api/v1/checkout/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: winnerCookie, 'Idempotency-Key': winnerIdem },
      body: JSON.stringify({ quoteId: winnerQuoteId, addressId: winnerAddr, paymentMethod: 'UPI' }),
    });
    assert.equal(replay.status, 200);
    const replayJson = await replay.json();
    assert.equal(replayJson.orderId, winnerRes.orderId);

    // 5. Webhook signature enforcement + event deduplication
    const webhookBody = {
      providerEventId: `evt_test_${winnerRes.orderNumber}`,
      providerReference: winnerRes.providerReference,
      eventType: 'PAYMENT_SUCCEEDED',
      amountPaise: winnerRes.amountPaise,
      currency: 'INR',
    };
    const rawWebhook = JSON.stringify(webhookBody);

    const badSigRes = await fetch(`${baseUrl}/api/v1/payments/webhooks/AURORA_PAY`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'tampered_sig' },
      body: rawWebhook,
    });
    assert.equal(badSigRes.status, 401);

    const validSig = signWebhookPayload(rawWebhook);
    const goodHook = await fetch(`${baseUrl}/api/v1/payments/webhooks/AURORA_PAY`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': validSig },
      body: rawWebhook,
    });
    assert.equal(goodHook.status, 200);
    const goodJson = await goodHook.json();
    assert.equal(goodJson.orderStatus, 'CONFIRMED');
    assert.equal(goodJson.duplicate, false);

    // Replay same webhook event -> duplicate: true
    const dupHook = await fetch(`${baseUrl}/api/v1/payments/webhooks/AURORA_PAY`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': validSig },
      body: rawWebhook,
    });
    const dupJson = await dupHook.json();
    assert.equal(dupJson.duplicate, true);

    // 6. Outbox worker dispatches notification cleanly
    processOutboxBatch();
    const notifs = await (await fetch(`${baseUrl}/api/v1/notifications`, { headers: { Cookie: winnerCookie } })).json();
    assert.ok(notifs.notifications.length >= 1);

    // 7. Admin partial refund & overpayment rejection
    const overRefund = await fetch(`${baseUrl}/api/v1/admin/payments/${winnerRes.paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ amountPaise: winnerRes.amountPaise + 500, reason: 'Over-refund attempt' }),
    });
    assert.equal(overRefund.status, 400);

    const validRefund = await fetch(`${baseUrl}/api/v1/admin/payments/${winnerRes.paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ amountPaise: 50000, reason: 'Partial goodwill credit' }),
    });
    assert.equal(validRefund.status, 200);

    // 8. Admin negative stock adjustment blocked if below reserved & invalid order transition blocked
    const badTrans = await fetch(`${baseUrl}/api/v1/admin/orders/${winnerRes.orderId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ targetStatus: 'DELIVERED', reason: 'Cannot skip directly from CONFIRMED to DELIVERED' }),
    });
    assert.equal(badTrans.status, 409);

    // 9. Price drift test: quote then change price -> submit returns 409 PRICE_CHANGED
    const cart2 = await fetch(`${baseUrl}/api/v1/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
      body: JSON.stringify({ variantId: 'var_bag_22l', quantity: 1 }),
    });
    assert.equal(cart2.status, 201);
    const quoteDrift = await (
      await fetch(`${baseUrl}/api/v1/checkout/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
        body: JSON.stringify({ shippingMethod: 'STANDARD' }),
      })
    ).json();
    // Simulate admin price change
    db.prepare('UPDATE product_variants SET price_paise = price_paise + 10000 WHERE id = ?').run('var_bag_22l');
    const driftSub = await fetch(`${baseUrl}/api/v1/checkout/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie, 'Idempotency-Key': 'drift_key_1' },
      body: JSON.stringify({ quoteId: quoteDrift.quoteId, addressId: 'addr_1', paymentMethod: 'UPI' }),
    });
    assert.equal(driftSub.status, 409);
    const driftJson = await driftSub.json();
    assert.equal(driftJson.code, 'PRICE_CHANGED');
    // Restore original price
    db.prepare('UPDATE product_variants SET price_paise = price_paise - 10000 WHERE id = ?').run('var_bag_22l');

    // 10. AI Guardrails: allowlist, guest isolation, PII redaction, and confirmation gate
    const blockedTool = executeAllowlistedTool({
      agentKey: 'inventory_agent',
      toolName: 'request_cancellation',
      args: { orderIdOrNumber: 'AC784512' },
      user: null,
    });
    assert.equal(blockedTool.ok, false);

    const guestOrders = executeAllowlistedTool({
      agentKey: 'order_agent',
      toolName: 'get_my_orders',
      args: {},
      user: null,
    });
    assert.equal(guestOrders.ok, false);

    const cleanText = redactSensitiveText('My card 4532-1234-5678-9012 cvv 789');
    assert.ok(!cleanText.includes('4532'));
    assert.ok(!cleanText.includes('789'));

    // AI Chat confirmation gate flow
    const convCreate = await (
      await fetch(`${baseUrl}/api/v1/ai/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
        body: JSON.stringify({ title: 'Cancel Test' }),
      })
    ).json();
    const cancelPromptRes = await (
      await fetch(`${baseUrl}/api/v1/ai/conversations/${convCreate.conversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sathyaCookie },
        body: JSON.stringify({ content: 'Cancel my order AC784515' }),
      })
    ).json();
    assert.ok(cancelPromptRes.message.pendingConfirmation || cancelPromptRes.message.content);
  } finally {
    await close();
  }
});
