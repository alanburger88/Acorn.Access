/**
 * WEBHOOKS bounded context — outbound event fan-out to tenant endpoints with
 * HMAC signing, bounded retries, delivery history and replay.
 *
 * Exposes `createWebhookService` (implements WebhookService from
 * kernel/contracts.ts) and `registerWebhookRoutes` (/v1 HTTP surface). The
 * factory subscribes to the platform bus ('*') and fans matching events out
 * to active subscriptions.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  WebhookDelivery,
  WebhookService,
  WebhookSubscription,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import type { PlatformEvent } from '../../kernel/events.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId, newSecret } from '../../kernel/ids.js';

const SOURCE = '/domains/webhooks';
const MAX_TRIES = 3;
const DISPATCH_TIMEOUT_MS = 5000;

/**
 * Domain-local persistence shape: the delivery row plus the serialized event
 * it carried, so a delivery can be replayed byte-for-byte later.
 */
type StoredWebhookDelivery = WebhookDelivery & { event: PlatformEvent };

/** Subscription patterns: exact type, 'prefix.*', or '*'. */
function matches(patterns: string[], type: string): boolean {
  return patterns.some(
    (p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))),
  );
}

export function createWebhookService(ctx: PlatformContext): WebhookService {
  const subscriptions = ctx.store.collection<WebhookSubscription>('webhookSubscriptions');
  const deliveryRows = ctx.store.collection<StoredWebhookDelivery>('webhookDeliveries');

  /**
   * POST one event to one subscription, retrying up to MAX_TRIES in a
   * synchronous loop (production uses backoff queues, platform/11 RB-02).
   * ONE delivery row per dispatch, updated across tries; on replay the
   * existing row is reset and reused.
   */
  async function dispatch(
    sub: WebhookSubscription,
    event: PlatformEvent,
    existing?: StoredWebhookDelivery,
  ): Promise<StoredWebhookDelivery> {
    const body = JSON.stringify(event);
    const signature = 'sha256=' + createHmac('sha256', sub.secret).update(body).digest('hex');
    const now = new Date().toISOString();
    const row: StoredWebhookDelivery = existing
      ? { ...existing, status: 'retrying', attempts: 0, updatedAt: now }
      : {
          id: newId('whd'),
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          eventId: event.id,
          eventType: event.type,
          status: 'retrying',
          attempts: 0,
          createdAt: now,
          updatedAt: now,
          event,
        };
    deliveryRows.put(row);

    let ok = false;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      row.attempts = attempt;
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          body,
          headers: {
            'content-type': 'application/json',
            'x-acorn-event-type': event.type,
            'x-acorn-signature': signature,
          },
          signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
        });
        row.lastStatusCode = res.status;
        if (res.ok) {
          ok = true;
          delete row.lastError;
        } else {
          row.lastError = `endpoint returned HTTP ${res.status}`;
        }
      } catch (err) {
        row.lastError = err instanceof Error ? err.message : String(err);
      }
      row.updatedAt = new Date().toISOString();
      deliveryRows.put(row);
      if (ok) break;
    }

    row.status = ok ? 'delivered' : 'failed';
    row.updatedAt = new Date().toISOString();
    deliveryRows.put(row);

    await ctx.publish({
      type: ok ? 'com.acorn.webhook.delivered' : 'com.acorn.webhook.failed',
      tenantId: sub.tenantId,
      source: SOURCE,
      subject: row.id,
      data: {
        deliveryId: row.id,
        subscriptionId: sub.id,
        url: sub.url,
        eventId: event.id,
        eventType: event.type,
        attempts: row.attempts,
        lastStatusCode: row.lastStatusCode,
        lastError: row.lastError,
      },
    });
    return row;
  }

  // Fan every platform event out to matching active subscriptions of the
  // event's tenant. MUST never throw: the bus isolates handler failures, but
  // we still contain everything so one bad endpoint can't spam the error log
  // for unrelated subscriptions.
  ctx.bus.on('*', async (event) => {
    // never fan out our own delivery-outcome events (feedback loop)
    if (event.type.startsWith('com.acorn.webhook.')) return;
    try {
      const subs = subscriptions.list(
        event.tenantid,
        (s) => s.active && matches(s.events, event.type),
      );
      for (const sub of subs) {
        await dispatch(sub, event);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[webhooks] fan-out failed:', err);
    }
  });

  /**
   * SSRF guard (platform/06 SEC-APP): webhook targets are attacker-influenced
   * URLs the platform will POST to. In production (or when
   * ACORN_BLOCK_PRIVATE_WEBHOOKS=1) reject loopback/link-local/private
   * literal hosts. DNS-resolution pinning is the production follow-up — a
   * hostname can still resolve privately; the egress proxy is the real
   * boundary there (comment, not implemented here).
   */
  function assertWebhookUrlAllowed(rawUrl: string): void {
    const enforce =
      process.env.NODE_ENV === 'production' || process.env.ACORN_BLOCK_PRIVATE_WEBHOOKS === '1';
    if (!enforce) return;
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw invalid('webhook URL must be http(s)');
    }
    const host = url.hostname.toLowerCase();
    const privatePatterns = [
      /^localhost$/,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\.0\.0\.0$/,
      /^\[?::1\]?$/,
      /^\[?f[cd][0-9a-f]{2}:/, // fc00::/7 unique-local
      /^\[?fe80:/, // link-local
    ];
    if (privatePatterns.some((p) => p.test(host))) {
      throw invalid('webhook URL must not target loopback/private networks');
    }
  }

  const service: WebhookService = {
    subscribe(rctx, args) {
      assertWebhookUrlAllowed(args.url);
      const sub: WebhookSubscription = {
        id: newId('whk'),
        tenantId: rctx.tenantId,
        url: args.url,
        events: args.events,
        secret: newSecret(16),
        active: true,
        createdAt: new Date().toISOString(),
      };
      return subscriptions.put(sub);
    },

    unsubscribe(rctx, subscriptionId) {
      const sub = subscriptions.getFor(rctx.tenantId, subscriptionId);
      if (!sub) throw notFound('webhook subscription', subscriptionId);
      // keep the row (delivery history references it) — just deactivate
      subscriptions.put({ ...sub, active: false });
    },

    list(rctx) {
      return subscriptions.list(rctx.tenantId);
    },

    deliveries(rctx, subscriptionId) {
      return deliveryRows
        .list(rctx.tenantId, (r) => !subscriptionId || r.subscriptionId === subscriptionId)
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async replay(rctx, deliveryId) {
      const row = deliveryRows.getFor(rctx.tenantId, deliveryId);
      if (!row) throw notFound('webhook delivery', deliveryId);
      const sub = subscriptions.getFor(rctx.tenantId, row.subscriptionId);
      if (!sub) throw notFound('webhook subscription', row.subscriptionId);
      return dispatch(sub, row.event, row);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const subscribeSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
});

export function registerWebhookRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const webhooks = () => ctx.services.webhooks;
  const ROLES = ['developer' as const]; // + tenant-admin passes implicitly

  app.post('/v1/webhooks', async (req) => {
    const rctx = requireAuth(ctx, req, ROLES);
    const body = parseBody(subscribeSchema, req.body);
    return webhooks().subscribe(rctx, body);
  });

  app.get('/v1/webhooks', async (req) => {
    const rctx = requireAuth(ctx, req, ROLES);
    // The HMAC secret is returned exactly once, by the subscribe response —
    // list reads must not re-expose it.
    return webhooks()
      .list(rctx)
      .map(({ secret: _secret, ...rest }) => rest);
  });

  app.delete('/v1/webhooks/:id', async (req, reply) => {
    const rctx = requireAuth(ctx, req, ROLES);
    const { id } = req.params as { id: string };
    webhooks().unsubscribe(rctx, id);
    await reply.status(204).send();
  });

  app.get('/v1/webhook-deliveries', async (req) => {
    const rctx = requireAuth(ctx, req, ROLES);
    const { subscriptionId } = req.query as { subscriptionId?: string };
    return webhooks().deliveries(rctx, subscriptionId);
  });

  app.post('/v1/webhook-deliveries/:id/replay', async (req) => {
    const rctx = requireAuth(ctx, req, ROLES);
    const { id } = req.params as { id: string };
    return webhooks().replay(rctx, id);
  });
}
