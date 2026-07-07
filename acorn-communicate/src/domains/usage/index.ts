/**
 * USAGE METERING & FINOPS bounded context — metered consumption counters
 * per tenant/period/metric, reference-rate cost estimation (platform/10
 * Part B cost model), and API rate limiting.
 *
 * Metering is driven entirely by bus subscription: the factory listens on
 * '*' and maps lifecycle events to metrics. This context deliberately emits
 * NO events of its own — metering must never feed itself (or anyone else)
 * more events to meter.
 *
 * Exposes `createUsageService` (implements UsageService from
 * kernel/contracts.ts) and `registerUsageRoutes` (/v1 HTTP surface).
 */
import type { FastifyInstance } from 'fastify';
import type { UsageService, UsageSummary } from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import type { PlatformEvent } from '../../kernel/events.js';
import { invalid } from '../../kernel/errors.js';
import { requireAuth } from '../../kernel/http.js';

/** One usage counter — id is the composite `${tenantId}:${period}:${metric}`. */
interface UsageCounter {
  id: string;
  tenantId: string;
  period: string; // YYYY-MM
  metric: string;
  qty: number;
}

/**
 * Reference unit rates in USD (per platform/10-roadmap-cost-model.md Part B).
 * These are directional list-price analogues (e.g. SES-like email, SNS-like
 * SMS, first-class presort print) used for cost *estimation* only — actual
 * billing would come from provider invoices.
 */
const REFERENCE_RATES: Record<string, number> = {
  'renders': 0.002,
  'communications.composed': 0.001,
  'deliveries.email': 0.0004,
  'deliveries.sms': 0.0079,
  'deliveries.print': 0.61,
  'deliveries.secure-link': 0.0001,
  'ai.invocations': 0.01,
  'views': 0.0001,
  'archive.records': 0.0005,
  'mcp.calls': 0.001,
  'print.pieces': 0.61,
};

/** Current metering period, YYYY-MM. */
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Map a lifecycle event to a (metric, qty) pair; undefined for event types
 * that are not metered (skipped silently — new event types must not break
 * metering).
 *
 * Deliveries: a successful send produces BOTH `delivery.sent` and (on the
 * provider receipt) `delivery.delivered` for the same attempt — counting
 * either of those would double-charge a sent+delivered pair. We therefore
 * count only `com.acorn.delivery.attempted`, which fires exactly once per
 * provider attempt: that is also the honest cost driver, since providers
 * bill per attempted send, not per confirmed receipt.
 */
function metricForEvent(e: PlatformEvent): { metric: string; qty: number } | undefined {
  const data = (e.data ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'com.acorn.communication.composed':
      return { metric: 'communications.composed', qty: 1 };
    case 'com.acorn.communication.rendered':
      return {
        metric: 'renders',
        qty: Array.isArray(data.formats) ? data.formats.length : 1,
      };
    case 'com.acorn.delivery.attempted':
      return { metric: `deliveries.${String(data.channel ?? 'unknown')}`, qty: 1 };
    case 'com.acorn.ai.invoked':
      return { metric: 'ai.invocations', qty: 1 };
    case 'com.acorn.access.viewed':
      return { metric: 'views', qty: 1 };
    case 'com.acorn.archive.stored':
      return { metric: 'archive.records', qty: 1 };
    case 'com.acorn.mcp.tool-invoked':
      return { metric: 'mcp.calls', qty: 1 };
    case 'com.acorn.print.batch-spooled':
      return { metric: 'print.pieces', qty: typeof data.pieces === 'number' ? data.pieces : 1 };
    default:
      return undefined;
  }
}

const WINDOW_MS = 60_000;
/** Memory-DoS guard: bucket keys are attacker-influenced (any random bearer token). */
const MAX_BUCKETS = 10_000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createUsageService(ctx: PlatformContext): UsageService {
  const counters = ctx.store.collection<UsageCounter>('usageCounters');

  // Rate-limit buckets are process-local and in-memory by design: in the
  // reference deployment there is exactly one node. Production would enforce
  // this at the API gateway (or a shared Redis) so limits hold across
  // replicas and survive restarts.
  const buckets = new Map<string, { windowStart: number; count: number }>();

  const service: UsageService = {
    record(tenantId, metric, qty = 1) {
      const period = currentPeriod();
      const id = `${tenantId}:${period}:${metric}`;
      const existing = counters.get(id);
      counters.put({
        id,
        tenantId,
        period,
        metric,
        qty: (existing?.qty ?? 0) + qty,
      });
    },

    summary(tenantId, period): UsageSummary {
      const p = period ?? currentPeriod();
      const metrics: Record<string, number> = {};
      const rates: Record<string, number> = {};
      let cost = 0;
      for (const row of counters.list(tenantId, (c) => c.period === p)) {
        metrics[row.metric] = row.qty;
        const rate = REFERENCE_RATES[row.metric] ?? 0; // unmetered/unknown metrics cost nothing
        rates[row.metric] = rate;
        cost += row.qty * rate;
      }
      return {
        period: p,
        metrics,
        rates,
        estimatedCostUsd: Math.round(cost * 1e4) / 1e4,
      };
    },

    listPeriods(tenantId) {
      const periods = new Set(counters.list(tenantId).map((c) => c.period));
      return [...periods].sort((a, b) => b.localeCompare(a));
    },

    checkRateLimit(bucketKey) {
      // Fixed-window counter (simpler than a true refilling token bucket; the
      // worst-case burst of 2x limit across a window boundary is acceptable
      // for the reference deployment).
      const limit = Number(process.env.ACORN_RATE_LIMIT ?? 300);
      const now = Date.now();
      // Bounded memory: sweep expired windows once the map grows, then
      // hard-cap by evicting oldest insertion order.
      if (buckets.size > MAX_BUCKETS) {
        for (const [key, entry] of buckets) {
          if (now - entry.windowStart >= WINDOW_MS) buckets.delete(key);
        }
        while (buckets.size > MAX_BUCKETS) {
          const oldest = buckets.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          buckets.delete(oldest);
        }
      }
      let bucket = buckets.get(bucketKey);
      if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
        bucket = { windowStart: now, count: 0 };
        buckets.set(bucketKey, bucket);
      }
      bucket.count++;
      return {
        allowed: bucket.count <= limit,
        limit,
        remaining: limit - bucket.count,
        resetSeconds: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
      };
    },
  };

  // Meter every lifecycle event; unknown types are skipped silently.
  ctx.bus.on('*', (event) => {
    const hit = metricForEvent(event);
    if (hit) service.record(event.tenantid, hit.metric, hit.qty);
  });

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

export function registerUsageRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const usage = () => ctx.services.usage;

  app.get('/v1/usage', async (req) => {
    const rctx = requireAuth(ctx, req); // any authenticated role may read usage
    const { period } = req.query as { period?: string };
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw invalid('period must be formatted YYYY-MM');
    }
    return usage().summary(rctx.tenantId, period);
  });

  app.get('/v1/usage/periods', async (req) => {
    const rctx = requireAuth(ctx, req);
    return usage().listPeriods(rctx.tenantId);
  });
}
