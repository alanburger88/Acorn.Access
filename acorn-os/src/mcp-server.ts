/**
 * Acorn OS — MCP stdio server entry point.
 *
 * Runs the MCP server IN-PROCESS against the platform data directory (the
 * same store the API server uses) — ideal for local development and demos.
 * In production the MCP server is deployed separately and talks to the
 * platform through the REST API (platform/07 §5.1).
 *
 * Register with an MCP client (e.g. Claude Desktop / Claude Code):
 *
 *   {
 *     "mcpServers": {
 *       "acorn-os": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp-server.ts"],
 *         "env": {
 *           "ACORN_DATA_DIR": "./data",
 *           "ACORN_MCP_API_KEY": "<api key secret from POST /v1/tenants or /v1/tenant/api-keys>"
 *         }
 *       }
 *     }
 *   }
 *
 * Environment:
 *   ACORN_DATA_DIR     platform data directory (default ./data)
 *   ACORN_MCP_API_KEY  REQUIRED — tenant API key secret; scopes every tool
 *                      call to that key's tenant, actor, and roles.
 *
 * stdout is reserved for the MCP protocol; all logs go to stderr.
 */
import { configFromEnv, createBaseContext } from './kernel/context.js';
import { wireServices } from './wiring.js';
import { runStdioServer } from './mcp/server.js';

const secret = process.env.ACORN_MCP_API_KEY;
if (!secret) {
  console.error(
    'ACORN_MCP_API_KEY is required (a tenant API key secret). ' +
      'Create one via POST /v1/tenants (bootstrap admin key) or POST /v1/tenant/api-keys.',
  );
  process.exit(1);
}

const ctx = createBaseContext(configFromEnv());
wireServices(ctx);

const rctx = ctx.services.tenants.authenticate(secret);
if (!rctx) {
  console.error('invalid API key: ACORN_MCP_API_KEY did not match an active key');
  process.exit(1);
}

console.error(
  `Acorn OS MCP server ready (tenant ${rctx.tenantId}, roles ${rctx.roles.join(', ')})`,
);
runStdioServer(ctx, rctx);
