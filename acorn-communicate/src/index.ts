import { buildPlatform } from './server.js';
import { configFromEnv } from './kernel/context.js';

const config = configFromEnv();
const { app } = buildPlatform(config);

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
