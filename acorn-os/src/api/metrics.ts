import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PlatformContext } from '../kernel/context.js';
import { requireAuth } from '../kernel/http.js';
import { newId } from '../kernel/ids.js';

/**
 * Observability: request ids + Prometheus metrics.
 *
 * The registry is in-memory and process-local — in production Prometheus
 * scrapes each pod individually and aggregates across replicas, so no shared
 * state is needed here.
 *
 * Rate limiting: '/metrics' is NOT in the server's RATE_LIMIT_EXEMPT list, but
 * that hook only buckets requests that carry an `Authorization: Bearer` header
 * (it returns early otherwise — see src/server.ts). An unauthenticated
 * loopback scrape therefore passes through untouched, and no server change is
 * needed. Bearer-authenticated scrapes are rate-limited like any API call.
 */

// ---------------------------------------------------------------------------
// Minimal metric registry (node builtins only, no deps)
// ---------------------------------------------------------------------------

type Labels = Record<string, string>;

interface Sample {
  labels: Labels;
  value: number;
}

/** Escape a label value per the Prometheus text exposition format 0.0.4. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Deterministic key for a label set (label names sorted). */
function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`)
    .join(',');
}

class MetricFamily {
  private samples = new Map<string, Sample>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge',
  ) {}

  inc(labels: Labels, delta = 1): void {
    const key = labelKey(labels);
    const existing = this.samples.get(key);
    if (existing) existing.value += delta;
    else this.samples.set(key, { labels, value: delta });
  }

  set(labels: Labels, value: number): void {
    this.samples.set(labelKey(labels), { labels, value });
  }

  /** Reset all samples — used for gauges recomputed at scrape time. */
  clear(): void {
    this.samples.clear();
  }

  /** Render `# HELP` + `# TYPE` + one line per sample, deterministically sorted. */
  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
    const keys = [...this.samples.keys()].sort();
    for (const key of keys) {
      const sample = this.samples.get(key)!;
      lines.push(key === '' ? `${this.name} ${sample.value}` : `${this.name}{${key}} ${sample.value}`);
    }
    return lines;
  }
}

// ---------------------------------------------------------------------------
// installMetrics
// ---------------------------------------------------------------------------

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const GAUGED_COLLECTIONS = [
  'communications',
  'deliveries',
  'customers',
  'templates',
  'archiveRecords',
] as const;

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function installMetrics(app: FastifyInstance, ctx: PlatformContext): void {
  const httpRequests = new MetricFamily(
    'acorn_http_requests_total',
    'Total HTTP requests handled, by method, route pattern and status.',
    'counter',
  );
  const httpDurationSum = new MetricFamily(
    'acorn_http_request_duration_seconds_sum',
    'Cumulative HTTP request duration in seconds, by method and route pattern.',
    'counter',
  );
  const httpDurationCount = new MetricFamily(
    'acorn_http_request_duration_seconds_count',
    'Number of HTTP requests observed for duration, by method and route pattern.',
    'counter',
  );
  const eventsTotal = new MetricFamily(
    'acorn_events_total',
    'Platform events published on the bus, by truncated event type.',
    'counter',
  );
  const collectionDocs = new MetricFamily(
    'acorn_collection_documents',
    'Number of documents per store collection (all tenants).',
    'gauge',
  );
  const uptime = new MetricFamily(
    'acorn_process_uptime_seconds',
    'Process uptime in seconds.',
    'gauge',
  );
  const rss = new MetricFamily(
    'acorn_process_resident_memory_bytes',
    'Resident set size of the process in bytes.',
    'gauge',
  );
  const heapUsed = new MetricFamily(
    'acorn_process_heap_used_bytes',
    'V8 heap used by the process in bytes.',
    'gauge',
  );

  // -------------------------------------------------------------------------
  // 1. Request ids: honor a sane inbound x-request-id, otherwise fall back to
  //    fastify's own req.id (or a fresh newId('req') if that is unusable), and
  //    echo the chosen id back on every response. Stored in a WeakMap rather
  //    than decorateRequest since routes are already registered by now.
  // -------------------------------------------------------------------------
  const requestIds = new WeakMap<FastifyRequest, string>();

  app.addHook('onRequest', async (req) => {
    const inbound = req.headers['x-request-id'];
    let id: string | undefined;
    if (typeof inbound === 'string' && REQUEST_ID_RE.test(inbound)) id = inbound;
    else if (typeof req.id === 'string' && REQUEST_ID_RE.test(req.id)) id = req.id;
    requestIds.set(req, id ?? newId('req'));
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', requestIds.get(req) ?? newId('req'));
  });

  // -------------------------------------------------------------------------
  // 2. HTTP metrics. Route label uses the registered route PATTERN (e.g.
  //    '/v1/communications/:id'), never the raw URL, to bound cardinality;
  //    unmatched requests (404s) collapse into a single 'unmatched' label.
  //    The '/metrics' scrape itself is excluded so scraping never inflates
  //    traffic counters.
  // -------------------------------------------------------------------------
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    if (route === '/metrics') return;
    const method = req.method;
    httpRequests.inc({ method, route, status: String(reply.statusCode) });
    httpDurationSum.inc({ method, route }, reply.elapsedTime / 1000); // ms → s
    httpDurationCount.inc({ method, route });
  });

  // -------------------------------------------------------------------------
  // 3. Event metrics. Type label strips the 'com.acorn.' prefix and keeps the
  //    first two segments (e.g. 'delivery.delivered') to bound cardinality.
  // -------------------------------------------------------------------------
  ctx.bus.on('*', (event) => {
    const stripped = event.type.startsWith('com.acorn.')
      ? event.type.slice('com.acorn.'.length)
      : event.type;
    const type = stripped.split('.').slice(0, 2).join('.');
    eventsTotal.inc({ type });
  });

  // -------------------------------------------------------------------------
  // 4. Platform gauges, computed at scrape time. Per-tenant event-log lengths
  //    are deliberately NOT exported: tenant ids are an unbounded label set.
  // -------------------------------------------------------------------------
  function computeGauges(): void {
    collectionDocs.clear();
    for (const name of GAUGED_COLLECTIONS) {
      collectionDocs.set({ collection: name }, ctx.store.collection(name).listAll().length);
    }
    const mem = process.memoryUsage();
    uptime.set({}, process.uptime());
    rss.set({}, mem.rss);
    heapUsed.set({}, mem.heapUsed);
  }

  // -------------------------------------------------------------------------
  // 5. GET /metrics — unauthenticated only from loopback (scrape endpoints sit
  //    on the pod network in production, where the scraper hits localhost /
  //    the pod IP directly); any other caller must present a valid bearer key
  //    (any role).
  // -------------------------------------------------------------------------
  app.get('/metrics', async (req, reply) => {
    if (!isLoopback(req.ip)) requireAuth(ctx, req);
    computeGauges();
    const families = [
      collectionDocs,
      eventsTotal,
      httpDurationCount,
      httpDurationSum,
      httpRequests,
      heapUsed,
      rss,
      uptime,
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const body = families.flatMap((f) => f.render()).join('\n') + '\n';
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return body;
  });
}
