import { buildPlatform } from './server.js';
import { configFromEnv } from './kernel/context.js';
import { createSqliteStore } from './adapters/sqlite-store.js';
import { join } from 'node:path';

const config = configFromEnv();

// Storage driver selection: ACORN_STORE=sqlite swaps the file-backed
// collections for the SQL adapter (same StorePort; domains are untouched).
const adapters =
  process.env.ACORN_STORE === 'sqlite'
    ? { store: createSqliteStore(join(config.dataDir, 'acorn.sqlite')) }
    : {};

const { app, ctx } = buildPlatform(config, adapters);

// Journey scheduler: advance wait-step deadlines (production uses a durable
// timer queue; see platform/04 saga patterns).
setInterval(() => {
  ctx.services.journeys.tick().catch((err) => app.log.error(err, 'journey tick failed'));
}, 5000).unref();

// Lifecycle housekeeping: expired-link revocation and retention checks
// (production: durable scheduled jobs per platform/11).
setInterval(() => {
  ctx.services.lifecycle.sweep().catch((err) => app.log.error(err, 'lifecycle sweep failed'));
}, 60_000).unref();

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Acorn Communicate listening on :${config.port}`);
    app.log.info(`Console: ${config.baseUrl}/console`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
