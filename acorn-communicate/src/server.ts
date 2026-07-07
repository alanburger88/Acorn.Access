import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createBaseContext, type PlatformConfig, type PlatformContext } from './kernel/context.js';
import { problemJsonHandler } from './kernel/http.js';
import { registerAllRoutes, wireServices } from './wiring.js';

export interface Platform {
  app: FastifyInstance;
  ctx: PlatformContext;
}

export function buildPlatform(config: PlatformConfig): Platform {
  const ctx = createBaseContext(config);
  wireServices(ctx);

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 16 * 1024 * 1024, // batch ingestion payloads
  });

  app.setErrorHandler(problemJsonHandler);

  app.get('/healthz', async () => ({ status: 'ok', service: 'acorn-communicate' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  // Operator console (static single-page app).
  const consoleHtml = readFileSync(new URL('./console/index.html', import.meta.url), 'utf8');
  app.get('/console', async (_req, reply) => reply.type('text/html; charset=utf-8').send(consoleHtml));
  app.get('/', async (_req, reply) => reply.redirect('/console'));

  registerAllRoutes(app, ctx);

  return { app, ctx };
}
