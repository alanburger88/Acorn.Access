import { buildPlatform } from './server.js';
import { configFromEnv } from './kernel/context.js';
import { adaptersFromEnv } from './adapters/select.js';

const config = configFromEnv();
const { app, ctx } = buildPlatform(config, adaptersFromEnv(config));

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

// Scheduled-delivery promotion (explicit schedules, quiet hours, caps).
setInterval(() => {
  ctx.services.delivery.tick().catch((err) => app.log.error(err, 'delivery tick failed'));
}, 10_000).unref();

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Acorn OS listening on :${config.port}`);
    app.log.info(`Console: ${config.baseUrl}/console`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
