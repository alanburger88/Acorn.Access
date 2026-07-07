/**
 * MCP stdio server — newline-delimited JSON-RPC 2.0 (MCP protocol layer).
 *
 * This in-process variant runs directly against the platform data directory
 * (the same store the API server uses) for local development and demos. In
 * production the MCP server runs as its own deployment and talks to the
 * platform through the REST API (platform/07 §5.1), so it never shares the
 * API server's process or filesystem.
 *
 * The handler NEVER throws and NEVER crashes on malformed input: parse
 * failures return JSON-RPC -32700, unknown methods -32601, and tool handler
 * failures are in-band `isError` tool results (see tools.ts).
 */
import { createInterface } from 'node:readline';
import type { PlatformContext } from '../kernel/context.js';
import type { RequestCtx } from '../kernel/contracts.js';
import { callTool, listToolDefinitions } from './tools.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'acorn-communicate', version: '0.2.0' };

type JsonRpcId = string | number | null;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

const respond = (id: JsonRpcId, result: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, result } satisfies JsonRpcResponse);

const respondError = (id: JsonRpcId, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } } satisfies JsonRpcResponse);

/**
 * Create the line handler: one JSON-RPC message in, one response line out
 * (or `undefined` for notifications and blank lines).
 */
export function createMcpHandler(
  ctx: PlatformContext,
  rctx: RequestCtx,
): (line: string) => Promise<string | undefined> {
  return async (line: string): Promise<string | undefined> => {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return respondError(null, -32600, 'invalid request: expected a JSON-RPC object');
      }
      message = parsed as Record<string, unknown>;
    } catch {
      return respondError(null, -32700, 'parse error: invalid JSON');
    }

    const id = (message.id ?? null) as JsonRpcId;
    const isNotification = message.id === undefined;
    const method = message.method;
    const params =
      message.params && typeof message.params === 'object'
        ? (message.params as Record<string, unknown>)
        : {};

    if (typeof method !== 'string') {
      return isNotification
        ? undefined
        : respondError(id, -32600, 'invalid request: method must be a string');
    }

    // Notifications (no id) never get a response — including
    // 'notifications/initialized' after the handshake.
    if (isNotification) return undefined;

    try {
      switch (method) {
        case 'initialize':
          return respond(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        case 'ping':
          return respond(id, {});
        case 'tools/list':
          return respond(id, { tools: listToolDefinitions() });
        case 'tools/call': {
          const name = params.name;
          if (typeof name !== 'string' || name.length === 0) {
            return respondError(id, -32602, 'invalid params: tools/call requires a string params.name');
          }
          const result = await callTool(ctx, rctx, name, params.arguments);
          return respond(id, result);
        }
        default:
          return respondError(id, -32601, `method not found: ${method}`);
      }
    } catch (err) {
      // Last-resort guard: a protocol-layer bug must not kill the transport.
      return respondError(id, -32603, `internal error: ${String((err as Error)?.message ?? err)}`);
    }
  };
}

/**
 * Wire stdin → handler → stdout. Lines are processed sequentially so
 * responses are written in request order. stdout carries ONLY protocol
 * frames; all logging goes to stderr (see src/mcp-server.ts).
 */
export function runStdioServer(ctx: PlatformContext, rctx: RequestCtx): void {
  const handler = createMcpHandler(ctx, rctx);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  let chain: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain.then(async () => {
      const response = await handler(line);
      if (response !== undefined) process.stdout.write(response + '\n');
    });
  });
}
