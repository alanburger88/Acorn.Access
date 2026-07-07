import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeAny, z } from 'zod';
import { PlatformError, forbidden, invalid, unauthorized } from './errors.js';
import type { PlatformContext } from './context.js';
import type { RequestCtx, Role } from './contracts.js';

/**
 * Authenticate the request via `Authorization: Bearer <api-key-secret>` and
 * optionally require one of the given roles. `tenant-admin` passes every
 * role check.
 */
export function requireAuth(
  ctx: PlatformContext,
  req: FastifyRequest,
  roles?: Role[],
): RequestCtx {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('missing bearer token');
  const rctx = ctx.services.tenants.authenticate(header.slice(7));
  if (!rctx) throw unauthorized('invalid api key');
  if (roles && roles.length > 0) {
    const ok = rctx.roles.includes('tenant-admin') || roles.some((r) => rctx.roles.includes(r));
    if (!ok) throw forbidden(`requires one of roles: ${roles.join(', ')}`);
  }
  return rctx;
}

/** Parse and validate a request body with zod, mapping failures to problem+json 400s. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw invalid(
      'request body validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Fastify error handler emitting RFC 9457 problem+json. */
export function problemJsonHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof PlatformError) {
    reply.status(err.status).type('application/problem+json').send(err.toProblem(req.url));
    return;
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  req.log.error(err);
  reply
    .status(status)
    .type('application/problem+json')
    .send({
      type: 'https://docs.acorn-os.dev/problems/internal',
      title: 'internal-error',
      status,
      detail: status === 500 ? 'unexpected error' : String((err as Error).message ?? err),
      instance: req.url,
    });
}
