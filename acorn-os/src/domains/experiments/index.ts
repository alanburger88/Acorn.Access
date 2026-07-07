/**
 * EXPERIMENTS bounded context — A/B testing of template versions. An
 * experiment splits a template's audience across weighted version variants
 * with deterministic per-customer assignment; results compare delivery,
 * viewing, and outcome rates per variant.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AccessEvent,
  Communication,
  Experiment,
  ExperimentService,
  RequestCtx,
  Role,
  Template,
  TemplateVersion,
  VariantResult,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { conflict, forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/experiments';

const MANAGE_ROLES: readonly Role[] = ['business-author', 'designer', 'operator', 'tenant-admin'];

function requireManageRole(rctx: RequestCtx): void {
  if (!MANAGE_ROLES.some((role) => rctx.roles.includes(role))) {
    throw forbidden(`requires one of roles: ${MANAGE_ROLES.join(', ')}`);
  }
}

/**
 * Deterministic bucket for a customer within an experiment: the first 8 hex
 * chars of sha256(`${experimentId}:${customerId}`) as an integer, reduced over
 * the total weight space. Stable for the experiment's whole lifetime, so the
 * same customer always sees the same variant.
 */
function bucketOf(experimentId: string, customerId: string, totalWeight: number): number {
  const hex = createHash('sha256').update(`${experimentId}:${customerId}`).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % totalWeight;
}

export function createExperimentService(ctx: PlatformContext): ExperimentService {
  const experiments = ctx.store.collection<Experiment>('experiments');
  const templates = ctx.store.collection<Template>('templates');
  const versions = ctx.store.collection<TemplateVersion>('templateVersions');
  const communications = ctx.store.collection<Communication>('communications');
  const accessEvents = ctx.store.collection<AccessEvent>('accessEvents');

  function mustGet(tenantId: string, experimentId: string): Experiment {
    const experiment = experiments.getFor(tenantId, experimentId);
    if (!experiment) throw notFound('experiment', experimentId);
    return experiment;
  }

  function runningFor(tenantId: string, templateId: string): Experiment | undefined {
    return experiments
      .list(tenantId, (e) => e.templateId === templateId && e.status === 'running')
      .at(0);
  }

  const service: ExperimentService = {
    create(rctx, args) {
      requireManageRole(rctx);
      const template = templates.getFor(rctx.tenantId, args.templateId);
      if (!template) throw invalid(`template ${args.templateId} does not exist`);
      if (args.variants.length < 2) {
        throw invalid('an experiment needs at least 2 variants');
      }
      for (const variant of args.variants) {
        const version = versions.getFor(rctx.tenantId, variant.versionId);
        if (!version || version.templateId !== args.templateId) {
          throw invalid(
            `variant version ${variant.versionId} is not a version of template ${args.templateId}`,
          );
        }
        // Accessibility gate: experiments must not smuggle inaccessible
        // versions past the publication gate — a variant reaches customers
        // without ever being published, so every variant must pass the same
        // accessibility checks publication enforces. Use the stored report
        // when present; otherwise run the gate now.
        const report =
          version.accessibility ??
          ctx.services.templates.checkAccessibility(rctx.tenantId, version.id);
        if (!report.passed) {
          throw invalid(
            `variant version ${variant.versionId} fails the accessibility gate and cannot be experimented on`,
            report.issues,
          );
        }
        if (!(variant.weight > 0)) {
          throw invalid(`variant ${variant.versionId} weight must be > 0 (got ${variant.weight})`);
        }
      }
      // A template can host at most one running experiment: overlapping
      // experiments would make assignment ambiguous.
      const running = runningFor(rctx.tenantId, args.templateId);
      if (running) {
        throw conflict(
          `template ${args.templateId} already has a running experiment (${running.id})`,
        );
      }

      const experiment: Experiment = {
        id: newId('exp'),
        tenantId: rctx.tenantId,
        templateId: args.templateId,
        name: args.name,
        status: 'running',
        variants: args.variants.map((v) => ({ versionId: v.versionId, weight: v.weight })),
        createdAt: new Date().toISOString(),
      };
      experiments.put(experiment);
      void ctx.publish({
        type: 'com.acorn.experiment.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: experiment.id,
        data: {
          experimentId: experiment.id,
          templateId: experiment.templateId,
          variants: experiment.variants.length,
        },
      });
      return experiment;
    },

    selectVersion(tenantId, templateId, customerId) {
      const experiment = runningFor(tenantId, templateId);
      if (!experiment) return undefined;
      const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
      if (totalWeight <= 0) return undefined;
      let bucket = bucketOf(experiment.id, customerId, totalWeight);
      // Walk the variants accumulating weights until the bucket falls inside
      // one — a weighted, deterministic split of the hash space.
      let chosen = experiment.variants[experiment.variants.length - 1];
      for (const variant of experiment.variants) {
        if (bucket < variant.weight) {
          chosen = variant;
          break;
        }
        bucket -= variant.weight;
      }
      if (!chosen) return undefined;
      return versions.getFor(tenantId, chosen.versionId);
    },

    results(rctx, experimentId) {
      const experiment = mustGet(rctx.tenantId, experimentId);
      // Only communications composed during the experiment window count as
      // assignments (ISO-8601 strings compare chronologically).
      const inWindow = communications.list(rctx.tenantId, (c) => {
        if (c.templateId !== experiment.templateId) return false;
        if (c.createdAt <= experiment.createdAt) return false;
        if (experiment.concludedAt && c.createdAt > experiment.concludedAt) return false;
        return true;
      });
      return experiment.variants.map((variant): VariantResult => {
        const assigned = inWindow.filter((c) => c.templateVersionId === variant.versionId);
        const delivered = assigned.filter(
          (c) => c.status === 'delivered' || c.status === 'archived',
        );
        const viewed = assigned.filter(
          (c) =>
            accessEvents.list(rctx.tenantId, (a) => a.communicationId === c.id).length > 0,
        );
        const outcomes = assigned.filter((c) => c.outcome?.achieved);
        return {
          versionId: variant.versionId,
          assigned: assigned.length,
          delivered: delivered.length,
          viewed: viewed.length,
          outcomes: outcomes.length,
          outcomeRate: assigned.length > 0 ? outcomes.length / assigned.length : 0,
        };
      });
    },

    conclude(rctx, experimentId, winnerVersionId) {
      requireManageRole(rctx);
      const experiment = mustGet(rctx.tenantId, experimentId);
      if (experiment.status !== 'running') {
        throw conflict(`experiment ${experimentId} is not running`);
      }
      let winner = winnerVersionId;
      if (winner !== undefined) {
        if (!experiment.variants.some((v) => v.versionId === winner)) {
          throw invalid(`winnerVersionId ${winner} is not a variant of experiment ${experimentId}`);
        }
      } else {
        // Pick the variant with the highest outcome rate; ties go to the
        // first variant in declaration order.
        const results = service.results(rctx, experimentId);
        let best = results[0];
        for (const result of results) {
          if (best === undefined || result.outcomeRate > best.outcomeRate) best = result;
        }
        winner = best?.versionId ?? experiment.variants[0]?.versionId;
      }
      if (winner === undefined) throw invalid('experiment has no variants to pick a winner from');

      // NOTE: concluding does NOT auto-publish the winning version. Publication
      // stays behind the template publish gate (roles + accessibility +
      // content approval) — we return the concluded experiment and let the
      // operator publish the winner explicitly through the templates domain.
      const concluded: Experiment = {
        ...experiment,
        status: 'concluded',
        concludedAt: new Date().toISOString(),
        winnerVersionId: winner,
      };
      experiments.put(concluded);
      void ctx.publish({
        type: 'com.acorn.experiment.concluded',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: experiment.id,
        data: { experimentId: experiment.id, winnerVersionId: winner },
      });
      return concluded;
    },

    list(rctx) {
      return experiments.list(rctx.tenantId);
    },

    get(rctx, experimentId) {
      return mustGet(rctx.tenantId, experimentId);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const createSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  variants: z.array(z.object({ versionId: z.string().min(1), weight: z.number() })),
});

const concludeSchema = z.object({
  winnerVersionId: z.string().min(1).optional(),
});

export function registerExperimentRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.experiments;

  app.post('/v1/experiments', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...MANAGE_ROLES]);
    const body = parseBody(createSchema, req.body);
    reply.status(201).send(svc().create(rctx, body));
  });

  app.get('/v1/experiments', async (req) => {
    const rctx = requireAuth(ctx, req);
    return svc().list(rctx);
  });

  app.get('/v1/experiments/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().get(rctx, id);
  });

  app.get('/v1/experiments/:id/results', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().results(rctx, id);
  });

  app.post('/v1/experiments/:id/conclude', async (req) => {
    const rctx = requireAuth(ctx, req, [...MANAGE_ROLES]);
    const { id } = req.params as { id: string };
    const body = parseBody(concludeSchema, req.body);
    return svc().conclude(rctx, id, body.winnerVersionId);
  });
}
