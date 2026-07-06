import { randomBytes } from 'node:crypto';
import { createApiServer } from './api/server.js';
import { SignalService } from './service.js';

/**
 * Minimal operational CLI:
 *   node dist/cli.js serve [port]
 *
 * ACORN_SIGNAL_ADMIN_KEY  — admin key for agent registration (generated if unset)
 * ACORN_SIGNAL_TOKEN_SECRET — HMAC secret for access tokens (generated if unset)
 */
const [, , command, portArg] = process.argv;

if (command === 'serve') {
  const port = portArg ? Number.parseInt(portArg, 10) : 8787;
  const adminKey = process.env.ACORN_SIGNAL_ADMIN_KEY ?? randomBytes(24).toString('base64url');
  if (!process.env.ACORN_SIGNAL_ADMIN_KEY) {
    console.log(`[acorn.signal] generated admin key: ${adminKey}`);
  }
  const service = new SignalService({ tokenSecret: process.env.ACORN_SIGNAL_TOKEN_SECRET });
  const server = createApiServer(service, { adminKey });
  server.listen(port, () => {
    console.log(`[acorn.signal] API listening on http://localhost:${port}`);
    console.log(`[acorn.signal] demo console:  http://localhost:${port}/`);
    console.log(`[acorn.signal] signing key id: ${service.signer.keyId}`);
  });
} else {
  console.error('Usage: cli.js serve [port]');
  process.exit(1);
}
