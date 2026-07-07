/**
 * AI authoring endpoint used by the template designer's assist button.
 * Output is a DRAFT ONLY — the platform's human-review gates (platform/06
 * AIG controls) mean drafts must go through the normal content approval
 * workflow before they can appear in any communication.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlatformContext } from '../kernel/context.js';
import { parseBody, requireAuth } from '../kernel/http.js';

const draftSchema = z.object({
  instruction: z.string().min(1).max(2000),
  baseText: z.string().max(20_000).optional(),
});

export function registerAiRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  app.post('/v1/ai/draft', async (req) => {
    const rctx = requireAuth(ctx, req, ['business-author', 'designer', 'tenant-admin']);
    const body = parseBody(draftSchema, req.body);
    const draft = await ctx.services.ai.draft({
      tenantId: rctx.tenantId,
      instruction: body.instruction,
      ...(body.baseText !== undefined ? { baseText: body.baseText } : {}),
    });
    return {
      text: draft.text,
      invocationId: draft.invocationId,
      requiresHumanApproval: true,
    };
  });
}
