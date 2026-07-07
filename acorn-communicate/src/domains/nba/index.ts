/**
 * NBA bounded context — explainable next-best-action recommendations.
 *
 * Evaluates the deterministic rule table (rules.ts) over facts gathered from
 * access events, actions, deliveries, and preferences; persists the current
 * recommendation set per communication (replace-on-recompute) and emits
 * com.acorn.nba.recommended per recommendation.
 */
import type { FastifyInstance } from 'fastify';
import type {
  AccessEvent,
  ActionTransaction,
  Communication,
  DeliveryAttempt,
  NbaService,
  PreferenceRecord,
  Recommendation,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { notFound } from '../../kernel/errors.js';
import { requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { rules, type NbaFacts } from './rules.js';

const SOURCE = '/domains/nba';

export function createNbaService(ctx: PlatformContext): NbaService {
  const communications = ctx.store.collection<Communication>('communications');
  const accessEvents = ctx.store.collection<AccessEvent>('accessEvents');
  const actions = ctx.store.collection<ActionTransaction>('actions');
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
  const preferences = ctx.store.collection<PreferenceRecord>('preferences');
  const recommendations = ctx.store.collection<Recommendation>('recommendations');

  return {
    recommend(tenantId, communicationId) {
      const communication = communications.getFor(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);

      const facts: NbaFacts = {
        communication,
        accessEvents: accessEvents.list(tenantId, (e) => e.communicationId === communicationId),
        actions: actions.list(tenantId, (a) => a.communicationId === communicationId),
        deliveries: deliveries.list(tenantId, (d) => d.communicationId === communicationId),
        preferences: preferences
          .list(tenantId, (p) => p.customerId === communication.customerId)
          .at(0),
      };

      // Replace the existing recommendation set for this communication.
      for (const existing of recommendations.list(
        tenantId,
        (r) => r.communicationId === communicationId,
      )) {
        recommendations.delete(existing.id);
      }

      const out: Recommendation[] = [];
      for (const rule of rules) {
        const fired = rule.evaluate(facts);
        if (!fired) continue;
        const recommendation: Recommendation = {
          id: newId('rec'),
          tenantId,
          communicationId,
          customerId: communication.customerId,
          action: fired.action,
          reason: fired.reason,
          ruleId: rule.ruleId,
          createdAt: new Date().toISOString(),
          taken: facts.actions.some((a) => a.action === fired.action) ? true : undefined,
        };
        recommendations.put(recommendation);
        out.push(recommendation);
        void ctx.publish({
          type: 'com.acorn.nba.recommended',
          tenantId,
          source: SOURCE,
          subject: communicationId,
          data: {
            communicationId,
            customerId: communication.customerId,
            action: recommendation.action,
            ruleId: recommendation.ruleId,
          },
        });
      }
      return out;
    },

    listRecommendations(tenantId, communicationId) {
      return recommendations.list(
        tenantId,
        (r) => !communicationId || r.communicationId === communicationId,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

export function registerNbaRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const nba = () => ctx.services.nba;

  app.get('/v1/communications/:id/recommendations', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return nba().listRecommendations(rctx.tenantId, id);
  });

  app.post('/v1/communications/:id/recommendations/refresh', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'tenant-admin']);
    const { id } = req.params as { id: string };
    return nba().recommend(rctx.tenantId, id);
  });
}
