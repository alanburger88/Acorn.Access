import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AccessDenied, requireScope, requireTenant, type Principal } from '../agents/access.js';
import { GrantError, type AgentRegistration, type Scope } from '../agents/grants.js';
import { IngestError, type RawCommunication } from '../ingest/normalize.js';
import type { SignalService } from '../service.js';

export interface ApiOptions {
  /** Shared secret for bootstrap admin operations (agent registration, token issue). */
  adminKey: string;
  /** Max accepted request body, bytes. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 2 * 1024 * 1024;

interface JsonError {
  error: string;
}

/**
 * Minimal dependency-free HTTP API over the SignalService.
 *
 * Routes:
 *   GET  /v1/health
 *   POST /v1/agents                                            (admin)
 *   POST /v1/agents/{agentId}/tokens                           (admin)
 *   POST /v1/communications                                    (communications:ingest)
 *   GET  /v1/tenants/{t}/packets/{id}                          (packets:read)
 *   GET  /v1/tenants/{t}/packets/{id}/verify                   (packets:verify)
 *   GET  /v1/tenants/{t}/audit                                 (packets:verify)
 *   POST /v1/tenants/{t}/packets/{id}/actions/{i}/complete     (outcomes:act)
 */
export function createApiServer(service: SignalService, options: ApiOptions): Server {
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      // Last-resort handler: never leak stack traces to clients.
      sendJson(res, 500, { error: 'Internal error' });
      console.error('[acorn.signal] unhandled API error:', err);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/v1/health') {
        return sendJson(res, 200, { status: 'ok', pipeline: service.pipelineVersion });
      }

      if (method === 'POST' && url.pathname === '/v1/agents') {
        requireAdmin(req);
        const body = await readJson<Omit<AgentRegistration, 'createdAt' | 'revokedAt'>>(req, maxBody);
        const agent = service.registry.register(body, new Date().toISOString());
        return sendJson(res, 201, { agent });
      }

      if (method === 'POST' && parts[0] === 'v1' && parts[1] === 'agents' && parts[3] === 'tokens' && parts.length === 4) {
        requireAdmin(req);
        const body = await readJson<{ scopes: Scope[]; ttlSeconds?: number }>(req, maxBody);
        const token = service.registry.issueToken(parts[2]!, body.scopes, body.ttlSeconds ?? 3600);
        return sendJson(res, 201, { token });
      }

      if (method === 'POST' && url.pathname === '/v1/communications') {
        const principal = authenticate(req);
        requireScope(principal, 'communications:ingest');
        const raw = await readJson<RawCommunication>(req, maxBody);
        requireTenant(principal, raw.tenantId);
        const packet = await service.ingest(raw);
        return sendJson(res, 201, { packet });
      }

      if (parts[0] === 'v1' && parts[1] === 'tenants' && parts.length >= 3) {
        const tenantId = parts[2]!;

        if (method === 'GET' && parts[3] === 'audit' && parts.length === 4) {
          const principal = authenticate(req);
          const audit = await service.auditChain(principal, tenantId);
          return sendJson(res, 200, { audit });
        }

        if (parts[3] === 'packets' && parts[4]) {
          const packetId = parts[4];

          if (method === 'GET' && parts.length === 5) {
            const principal = authenticate(req);
            const result = await service.getPacket(principal, tenantId, packetId);
            if (!result) return sendJson(res, 404, { error: 'Packet not found' });
            return sendJson(res, 200, result);
          }

          if (method === 'GET' && parts[5] === 'verify' && parts.length === 6) {
            const principal = authenticate(req);
            const verification = await service.verifyPacket(principal, tenantId, packetId);
            return sendJson(res, 200, { verification });
          }

          if (
            method === 'POST' &&
            parts[5] === 'actions' &&
            parts[7] === 'complete' &&
            parts.length === 8
          ) {
            const principal = authenticate(req);
            const index = Number.parseInt(parts[6]!, 10);
            if (!Number.isInteger(index) || index < 0) {
              return sendJson(res, 400, { error: 'Invalid action index' });
            }
            const packet = await service.completeAction(principal, tenantId, packetId, index);
            return sendJson(res, 200, { packet });
          }
        }
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, statusFor(err), { error: err instanceof Error ? err.message : 'Bad request' });
    }
  }

  function requireAdmin(req: IncomingMessage): void {
    const given = firstHeader(req.headers['x-admin-key']);
    const expected = Buffer.from(options.adminKey, 'utf8');
    const provided = Buffer.from(given ?? '', 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new AccessDenied('Invalid admin key');
    }
  }

  function authenticate(req: IncomingMessage): Principal {
    const auth = firstHeader(req.headers.authorization);
    if (!auth?.startsWith('Bearer ')) {
      throw new AccessDenied('Missing bearer token');
    }
    return service.registry.verifyToken(auth.slice('Bearer '.length).trim());
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusFor(err: unknown): number {
  if (err instanceof AccessDenied) return err.message.includes('Missing bearer') ? 401 : 403;
  if (err instanceof GrantError) return 401;
  if (err instanceof IngestError) return 400;
  if (err instanceof RangeError) return 400;
  if (err instanceof SyntaxError) return 400;
  return 500;
}

function sendJson(res: ServerResponse, status: number, body: object | JsonError): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson<T>(req: IncomingMessage, maxBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new RangeError('Request body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new SyntaxError('Empty request body');
  return JSON.parse(text) as T;
}
