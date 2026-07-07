import { buildPlatform } from './server.js';
import { configFromEnv } from './kernel/context.js';

const config = configFromEnv();
const { app, ctx } = buildPlatform(config);

// Journey scheduler: advance wait-step deadlines (production uses a durable
// timer queue; see platform/04 saga patterns).
setInterval(() => {
  ctx.services.journeys.tick().catch((err) => app.log.error(err, 'journey tick failed'));
}, 5000).unref();

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
