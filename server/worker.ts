import { db, newId } from './db';

let workerTimer: NodeJS.Timeout | null = null;

export function processOutboxBatch(): number {
  const now = new Date().toISOString();
  const pending = db
    .prepare("SELECT * FROM outbox_events WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT 20")
    .all(now) as {
    id: string;
    event_type: string;
    payload_json: string;
    retries: number;
  }[];

  let processed = 0;
  for (const ev of pending) {
    try {
      const payload = JSON.parse(ev.payload_json || '{}');
      if (payload.userId) {
        let title = 'Account Update';
        let body = 'Your request has been updated.';
        let category = 'ORDERS';
        let linkPath = '/orders';

        if (ev.event_type === 'ORDER_CONFIRMED') {
          title = `Order #${payload.orderNumber} Confirmed`;
          body = 'Payment verified. Your items are being prepared for dispatch.';
          linkPath = `/orders/${payload.orderId}`;
        } else if (ev.event_type === 'PAYMENT_FAILED') {
          title = `Payment Failed for #${payload.orderNumber}`;
          body = 'Your payment was declined and stock reservation was safely released. You may retry anytime.';
          linkPath = `/orders/${payload.orderId}`;
        } else if (ev.event_type === 'SHIPMENT_UPDATE') {
          title = `Order #${payload.orderNumber} · ${String(payload.status).replace(/_/g, ' ')}`;
          body = 'Your shipment tracking timeline has been updated.';
          linkPath = `/orders/${payload.orderId}/track`;
        } else if (ev.event_type === 'ORDER_CANCELLED') {
          title = `Order #${payload.orderNumber} Cancelled`;
          body = 'Your cancellation has been processed and any applicable refund was initiated.';
          linkPath = `/orders/${payload.orderId}`;
        } else if (ev.event_type === 'REFUND_PROCESSED') {
          title = `Refund Processed for #${payload.orderNumber}`;
          body = `₹${Math.round(Number(payload.amountPaise || 0) / 100)} refund initiated to your original payment method.`;
          linkPath = `/orders/${payload.orderId}`;
        } else if (ev.event_type === 'TICKET_CREATED' || ev.event_type === 'TICKET_REPLY') {
          category = 'SUPPORT';
          title = `Support Ticket ${payload.ticketNumber}`;
          body = ev.event_type === 'TICKET_CREATED' ? 'We received your support request.' : 'Support sent a new reply on your ticket.';
          linkPath = `/support/tickets/${payload.ticketId}`;
        }

        db.prepare(
          'INSERT INTO notifications (id, user_id, category, title, body, link_path, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
        ).run(newId('ntf'), payload.userId, category, title, body, linkPath, now);
      }

      db.prepare("UPDATE outbox_events SET status = 'PROCESSED', processed_at = ? WHERE id = ?").run(now, ev.id);
      processed++;
    } catch {
      const nextRetries = ev.retries + 1;
      const status = nextRetries >= 5 ? 'DEAD_LETTER' : 'PENDING';
      const backoffMs = Math.min(60_000, 2000 * Math.pow(2, nextRetries));
      db.prepare('UPDATE outbox_events SET status = ?, retries = ?, next_attempt_at = ? WHERE id = ?').run(
        status,
        nextRetries,
        new Date(Date.now() + backoffMs).toISOString(),
        ev.id
      );
    }
  }
  return processed;
}

export function startBackgroundWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    try {
      processOutboxBatch();
    } catch {
      // keep worker resilient
    }
  }, 3000);
}

export function stopBackgroundWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
