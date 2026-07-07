/**
 * GraphQL API surface — POST /graphql (read-only query execution) and
 * GET /graphql/schema (SDL introspection for humans and codegen).
 *
 * Read-only per platform/07 §3: GraphQL is a query projection over the same
 * domain services the REST surface uses; every mutation stays on REST.
 */
import type { FastifyInstance } from 'fastify';
import { graphql } from 'graphql';
import { z } from 'zod';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { createRoot, schema, sdl } from './schema.js';

const requestSchema = z.object({
  query: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
  operationName: z.string().optional(),
});

const MAX_QUERY_LENGTH = 10_000;
const MAX_DEPTH = 8;

/**
 * Pragmatic depth guard: measure the maximum brace-nesting depth of the raw
 * query string instead of walking the parsed AST. Selection sets are the only
 * braces a valid query document contains at meaningful volume, so counting
 * `{`/`}` nesting is a cheap, conservative proxy for query depth.
 */
function maxBraceDepth(query: string): number {
  let depth = 0;
  let max = 0;
  for (const ch of query) {
    if (ch === '{') {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === '}') {
      depth--;
    }
  }
  return max;
}

export function registerGraphqlRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  app.post('/graphql', async (req, reply) => {
    const rctx = requireAuth(ctx, req); // any authenticated role may query
    const body = parseBody(requestSchema, req.body);

    // Guardrails (cheap string checks before any parsing/execution).
    if (body.query.length > MAX_QUERY_LENGTH) {
      throw invalid(`query exceeds ${MAX_QUERY_LENGTH} characters`);
    }
    // Read-only endpoint: reject mutation/subscription operations up front.
    // Keyword scan is pragmatic — the schema defines no Mutation/Subscription
    // types, so execution would fail anyway; this gives a clearer 400.
    if (/(?:^|[^A-Za-z0-9_])(mutation|subscription)(?:[^A-Za-z0-9_]|$)/.test(body.query)) {
      throw invalid('read-only endpoint');
    }
    if (maxBraceDepth(body.query) > MAX_DEPTH) {
      throw invalid(`query depth exceeds limit of ${MAX_DEPTH}`);
    }

    const result = await graphql({
      schema,
      source: body.query,
      rootValue: createRoot(ctx, rctx),
      variableValues: body.variables,
      operationName: body.operationName,
    });

    // GraphQL convention: transport-level 200 even when resolver errors occur.
    return reply.status(200).send({
      data: result.data ?? null,
      ...(result.errors
        ? { errors: result.errors.map((e) => ({ message: e.message, path: e.path })) }
        : {}),
    });
  });

  app.get('/graphql/schema', async (req, reply) => {
    requireAuth(ctx, req); // any authenticated role
    return reply.type('text/plain; charset=utf-8').send(sdl);
  });
}
