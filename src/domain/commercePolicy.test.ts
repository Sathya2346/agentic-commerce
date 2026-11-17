import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePricingBreakdown,
  canRefundAmount,
  canReserveStock,
  canTransitionOrder,
  canTransitionPayment,
  computeAvailableToSell,
  hasPermission,
  isCustomerCancellable,
  isToolAllowedForAgent,
  redactSensitiveText,
  validateStockAdjustment,
} from './commercePolicy';

test('inventory invariant calculations and stock adjustment bounds', () => {
  assert.equal(computeAvailableToSell(10, 3), 7);
  assert.equal(computeAvailableToSell(2, 5), 0);
  assert.equal(canReserveStock(5, 4, 1), true);
  assert.equal(canReserveStock(5, 4, 2), false);
  assert.equal(canReserveStock(5, 4, 0), false);

  const okAdj = validateStockAdjustment(10, 3, -5);
  assert.equal(okAdj.ok, true);
  assert.equal(okAdj.nextOnHand, 5);

  const badAdj = validateStockAdjustment(10, 8, -3);
  assert.equal(badAdj.ok, false);
});

test('authoritative pricing breakdown validates coupons, limits, and shipping', () => {
  const valid = calculatePricingBreakdown({
    lines: [{ variantId: 'v1', unitPricePaise: 5699000, quantity: 1 }],
    shippingMethod: 'STANDARD',
    coupon: {
      code: 'WELCOME10',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountPaise: 500000, // cap ₹5,000
      minOrderPaise: 100000,
      startsAt: '2025-01-01T00:00:00Z',
      expiresAt: '2030-01-01T00:00:00Z',
      active: true,
      usageLimit: 100,
      usedCount: 5,
      userUsedCount: 0,
      perUserLimit: 1,
    },
    nowIso: '2026-11-16T10:00:00Z',
  });

  assert.equal(valid.subtotalPaise, 5699000);
  assert.equal(valid.discountPaise, 500000); // capped at ₹5,000
  assert.equal(valid.shippingPaise, 0); // above threshold
  assert.equal(valid.grandTotalPaise, 5199000);
  assert.equal(valid.appliedCouponCode, 'WELCOME10');
  assert.equal(valid.couponError, null);

  const expired = calculatePricingBreakdown({
    lines: [{ variantId: 'v1', unitPricePaise: 100000, quantity: 1 }],
    shippingMethod: 'EXPRESS',
    coupon: {
      code: 'EXPIRED50',
      discountType: 'PERCENT',
      discountValue: 50,
      maxDiscountPaise: null,
      minOrderPaise: 0,
      startsAt: '2024-01-01T00:00:00Z',
      expiresAt: '2025-01-01T00:00:00Z',
      active: true,
      usageLimit: null,
      usedCount: 0,
      userUsedCount: 0,
      perUserLimit: 1,
    },
    nowIso: '2026-11-16T10:00:00Z',
  });
  assert.equal(expired.discountPaise, 0);
  assert.equal(expired.appliedCouponCode, null);
  assert.match(expired.couponError ?? '', /expired/i);
  assert.equal(expired.shippingPaise, 19900);
});

test('order and payment state transitions and refund caps', () => {
  assert.equal(canTransitionOrder('PENDING_PAYMENT', 'CONFIRMED'), true);
  assert.equal(canTransitionOrder('SHIPPED', 'CANCELLED'), false);
  assert.equal(isCustomerCancellable('CONFIRMED'), true);
  assert.equal(isCustomerCancellable('SHIPPED'), false);

  assert.equal(canTransitionPayment('PENDING', 'PAID'), true);
  assert.equal(canTransitionPayment('REFUNDED', 'PAID'), false);

  assert.equal(canRefundAmount(50000, 20000, 30000).ok, true);
  assert.equal(canRefundAmount(50000, 20000, 30001).ok, false);
});

test('RBAC permissions and AI tool safety allowlists + PII redaction', () => {
  assert.equal(hasPermission(['CUSTOMER'], 'refund:approve'), false);
  assert.equal(hasPermission(['ORDER_MANAGER'], 'refund:approve'), false);
  assert.equal(hasPermission(['ORDER_MANAGER'], 'order:transition'), true);
  assert.equal(hasPermission(['ADMIN'], 'refund:approve'), true);
  assert.equal(hasPermission(['AI_ADMIN'], 'agent:publish'), true);
  assert.equal(hasPermission(['AI_ADMIN'], 'product:write'), false);

  assert.equal(isToolAllowedForAgent('inventory_agent', 'check_stock'), true);
  assert.equal(isToolAllowedForAgent('inventory_agent', 'request_cancellation'), false);

  const redacted = redactSensitiveText(
    'Card 4111 2222 3333 4444 cvv: 123 bearer abcdef123456 "password":"secret"'
  );
  assert.equal(redacted.includes('4111'), false);
  assert.equal(redacted.includes('123'), false);
  assert.equal(redacted.includes('abcdef123456'), false);
  assert.equal(redacted.includes('"secret"'), false);
});
