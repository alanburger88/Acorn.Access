import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBaseContext, type PlatformConfig, type PlatformContext } from './kernel/context.js';
import type { ObjectStorePort, StorePort } from './kernel/storage.js';
import { problemJsonHandler } from './kernel/http.js';
import { registerAllRoutes, wireServices } from './wiring.js';

/** Paths exempt from API rate limiting (public, health, docs, bootstrap). */
const RATE_LIMIT_EXEMPT = [
  '/healthz',
  '/readyz',
  '/console',
  '/designer',
  '/agent',
  '/view/',
  '/api/view/',
  '/viewer-assets/',
  '/v1/openapi.json',
  '/v1/tenants',
  '/',
];

function isRateLimitExempt(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return RATE_LIMIT_EXEMPT.some((p) =>
    // '/' is the console redirect — exact match only, never a prefix
    // (a '/' prefix rule would exempt every request).
    p !== '/' && p.endsWith('/') ? path.startsWith(p) : path === p,
  );
}

export interface Platform {
  app: FastifyInstance;
  ctx: PlatformContext;
}

export function buildPlatform(
  config: PlatformConfig,
  adapters: { store?: StorePort; objects?: ObjectStorePort } = {},
): Platform {
  const ctx = createBaseContext(config, adapters);
  wireServices(ctx);

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 16 * 1024 * 1024, // batch ingestion payloads
  });

  app.setErrorHandler(problemJsonHandler);

  // API rate limiting: token bucket per API-key hash (the key itself is never
  // stored). Public viewer/health/docs paths are exempt; unauthenticated API
  // calls fall through to per-route auth which rejects them anyway.
  app.addHook('onRequest', async (req, reply) => {
    if (isRateLimitExempt(req.url)) return;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const bucketKey = createHash('sha256').update(header.slice(7)).digest('hex');
    const verdict = ctx.services.usage.checkRateLimit(bucketKey);
    reply.header('ratelimit-limit', verdict.limit);
    reply.header('ratelimit-remaining', Math.max(0, verdict.remaining));
    reply.header('ratelimit-reset', verdict.resetSeconds);
    if (!verdict.allowed) {
      await reply
        .status(429)
        .type('application/problem+json')
        .send({
          type: 'https://docs.acorn-os.dev/problems/rate-limited',
          title: 'rate-limited',
          status: 429,
          detail: `rate limit of ${verdict.limit} requests/minute exceeded; retry in ${verdict.resetSeconds}s`,
          instance: req.url,
        });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'acorn-os' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  // Operator console + template designer (static single-page apps).
  const consoleHtml = readFileSync(new URL('./console/index.html', import.meta.url), 'utf8');
  app.get('/console', async (_req, reply) => reply.type('text/html; charset=utf-8').send(consoleHtml));
  const designerHtml = readFileSync(new URL('./console/designer.html', import.meta.url), 'utf8');
  app.get('/designer', async (_req, reply) => reply.type('text/html; charset=utf-8').send(designerHtml));
  const agentDeskHtml = readFileSync(new URL('./console/agent.html', import.meta.url), 'utf8');
  app.get('/agent', async (_req, reply) => reply.type('text/html; charset=utf-8').send(agentDeskHtml));
  app.get('/', async (_req, reply) => reply.redirect('/console'));

  registerAllRoutes(app, ctx);

  return { app, ctx };
}
