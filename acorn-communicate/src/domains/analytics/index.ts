/**
 * ANALYTICS bounded context — outcome metrics overview, template funnels,
 * communication/customer timelines (from the tamper-evident event log),
 * section hotspots, and audit chain verification.
 *
 * Exposes `createAnalyticsService` (implements AnalyticsService from
 * kernel/contracts.ts) and `registerAnalyticsRoutes` (/v1 HTTP surface).
 */
import type { FastifyInstance } from 'fastify';
import type {
  AccessEvent,
  ActionTransaction,
  AnalyticsService,
  Communication,
  DeliveryAttempt,
  FunnelStep,
  InteractionEvent,
  MetricsOverview,
  TimelineEntry,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import type { StoredEvent } from '../../kernel/events.js';
import { invalid } from '../../kernel/errors.js';
import { requireAuth } from '../../kernel/http.js';

/** Humanized one-liner for a stored event: strip the reverse-DNS prefix and
 * append the salient bits of the payload when present. */
function summarize(e: StoredEvent): string {
  const base = e.type.replace(/^com\.acorn\./, '');
  const data = (e.data ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof data.channel === 'string') parts.push(`via ${data.channel}`);
  if (typeof data.status === 'string' && !base.endsWith(`.${data.status}`)) {
    parts.push(data.status);
  }
  if (typeof data.action === 'string') parts.push(`action ${data.action}`);
  if (typeof data.kind === 'string') parts.push(`kind ${data.kind}`);
  return [base, ...parts].join(' ');
}

function toTimeline(events: StoredEvent[]): TimelineEntry[] {
  return events
    .map((e) => ({ at: e.time, type: e.type, subject: e.subject, summary: summarize(e) }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAnalyticsService(ctx: PlatformContext): AnalyticsService {
  const communications = ctx.store.collection<Communication>('communications');
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
  const accessEvents = ctx.store.collection<AccessEvent>('accessEvents');
  const interactions = ctx.store.collection<InteractionEvent>('interactions');
  const actions = ctx.store.collection<ActionTransaction>('actions');

  const viewedIds = (tenantId: string): Set<string> =>
    new Set(accessEvents.list(tenantId).map((a) => a.communicationId));

  const isDelivered = (c: Communication): boolean =>
    c.status === 'delivered' || c.status === 'archived';

  return {
    overview(tenantId): MetricsOverview {
      const comms = communications.list(tenantId);
      const viewed = viewedIds(tenantId);
      const acts = actions.list(tenantId);
      const contacts = acts.filter((a) => a.action === 'contact').length;
      const selfServed = acts.length - contacts;
      const outcomesAchieved = comms.filter((c) => c.outcome?.achieved).length;

      const byChannel: Record<string, { sent: number; delivered: number; failed: number }> = {};
      for (const d of deliveries.list(tenantId)) {
        const bucket = (byChannel[d.channel] ??= { sent: 0, delivered: 0, failed: 0 });
        if (d.status === 'sent' || d.status === 'delivered') bucket.sent++;
        if (d.status === 'delivered') bucket.delivered++;
        if (d.status === 'failed' || d.status === 'bounced') bucket.failed++;
      }

      return {
        communications: comms.length,
        delivered: comms.filter(isDelivered).length,
        failed: comms.filter((c) => c.status === 'failed').length,
        viewed: comms.filter((c) => viewed.has(c.id)).length,
        actionsCompleted: acts.length,
        outcomesAchieved,
        outcomeRate: comms.length === 0 ? 0 : outcomesAchieved / comms.length,
        callDeflectionProxy:
          selfServed + contacts === 0 ? 0 : selfServed / (selfServed + contacts),
        byChannel,
      };
    },

    funnel(tenantId, templateId): FunnelStep[] {
      const comms = communications.list(tenantId, (c) => c.templateId === templateId);
      const viewed = viewedIds(tenantId);
      const interacted = new Set(interactions.list(tenantId).map((i) => i.communicationId));
      const acted = new Set(actions.list(tenantId).map((a) => a.communicationId));
      return [
        { step: 'composed', count: comms.length },
        { step: 'delivered', count: comms.filter(isDelivered).length },
        { step: 'viewed', count: comms.filter((c) => viewed.has(c.id)).length },
        { step: 'interacted', count: comms.filter((c) => interacted.has(c.id)).length },
        { step: 'action-completed', count: comms.filter((c) => acted.has(c.id)).length },
        { step: 'outcome', count: comms.filter((c) => c.outcome?.achieved).length },
      ];
    },

    communicationTimeline(tenantId, communicationId) {
      const events = ctx.log
        .readAll(tenantId)
        .filter(
          (e) =>
            e.subject === communicationId ||
            (e.data as { communicationId?: unknown } | null | undefined)?.communicationId ===
              communicationId,
        );
      return toTimeline(events);
    },

    customerTimeline(tenantId, customerId) {
      const events = ctx.log
        .readAll(tenantId)
        .filter(
          (e) =>
            (e.data as { customerId?: unknown } | null | undefined)?.customerId === customerId,
        );
      return toTimeline(events);
    },

    hotspots(tenantId, templateId) {
      const commIds = new Set(
        communications.list(tenantId, (c) => c.templateId === templateId).map((c) => c.id),
      );
      const rows = interactions.list(tenantId, (i) => commIds.has(i.communicationId));
      const bySection = new Map<string, { sectionId: string; views: number; expands: number }>();
      for (const row of rows) {
        if (!row.detail) continue;
        if (row.kind !== 'section-viewed' && row.kind !== 'section-expanded') continue;
        let entry = bySection.get(row.detail);
        if (!entry) {
          entry = { sectionId: row.detail, views: 0, expands: 0 };
          bySection.set(row.detail, entry);
        }
        if (row.kind === 'section-viewed') entry.views++;
        else entry.expands++;
      }
      return [...bySection.values()].sort((a, b) => b.views - a.views);
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const analytics = () => ctx.services.analytics;

  app.get('/v1/analytics/overview', async (req) => {
    const rctx = requireAuth(ctx, req);
    return analytics().overview(rctx.tenantId);
  });

  app.get('/v1/analytics/funnel', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { templateId } = req.query as { templateId?: string };
    if (!templateId) throw invalid('templateId query parameter is required');
    return analytics().funnel(rctx.tenantId, templateId);
  });

  app.get('/v1/analytics/hotspots', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { templateId } = req.query as { templateId?: string };
    if (!templateId) throw invalid('templateId query parameter is required');
    return analytics().hotspots(rctx.tenantId, templateId);
  });

  app.get('/v1/communications/:id/timeline', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return analytics().communicationTimeline(rctx.tenantId, id);
  });

  app.get('/v1/customers/:id/timeline', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return analytics().customerTimeline(rctx.tenantId, id);
  });

  app.get('/v1/audit/verify-chain', async (req) => {
    const rctx = requireAuth(ctx, req, ['auditor', 'compliance-approver']); // + tenant-admin implicitly
    return ctx.log.verifyChain(rctx.tenantId);
  });
}
