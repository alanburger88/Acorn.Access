/**
 * AGENT DESK bounded context — contact-center assist: customer lookup,
 * 360° overview, on-behalf resend, secure-link reissue, and service notes.
 * Every agent action is audited to the tamper-evident event log.
 *
 * Exposes `createAgentDeskService` (implements AgentDeskService from
 * kernel/contracts.ts) and `registerAgentDeskRoutes` (/v1/agent HTTP surface).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AgentDeskService,
  Channel,
  Communication,
  ConsentRecord,
  Customer,
  CustomerOverview,
  PreferenceRecord,
  RequestCtx,
  Role,
  SecureLink,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';

const SOURCE = '/domains/agent-desk';
const SEARCH_CAP = 25;
const COMMUNICATIONS_CAP = 50;
const TIMELINE_CAP = 30;
const NOTE_MAX = 500;

/** Roles allowed to use the agent desk. */
const AGENT_ROLES: Role[] = ['service-agent', 'operator', 'tenant-admin'];

function requireAgentRole(rctx: RequestCtx): void {
  if (!rctx.roles.some((r) => AGENT_ROLES.includes(r))) {
    throw forbidden(`requires one of roles: ${AGENT_ROLES.join(', ')}`);
  }
}

/** Newest first: createdAt desc, id desc tie-break (ULIDs sort by time). */
const newestFirst = (a: Communication, b: Communication): number =>
  a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAgentDeskService(ctx: PlatformContext): AgentDeskService {
  // read-only views of peer domains' collections (+ secureLinks for revocation)
  const customers = ctx.store.collection<Customer>('customers');
  const communications = ctx.store.collection<Communication>('communications');
  const preferences = ctx.store.collection<PreferenceRecord>('preferences');
  const consents = ctx.store.collection<ConsentRecord>('consents');
  const secureLinks = ctx.store.collection<SecureLink>('secureLinks');

  const service: AgentDeskService = {
    searchCustomers(rctx, query) {
      requireAgentRole(rctx);
      const q = (query ?? '').trim().toLowerCase();
      if (!q) throw invalid('search query must not be empty');
      const hits: Customer[] = [];
      for (const customer of customers.list(rctx.tenantId)) {
        const haystack = [customer.name, customer.email, customer.phone, customer.externalRef];
        if (haystack.some((field) => field?.toLowerCase().includes(q))) {
          hits.push(customer);
          if (hits.length >= SEARCH_CAP) break;
        }
      }
      return hits;
    },

    customerOverview(rctx, customerId): CustomerOverview {
      requireAgentRole(rctx);
      const customer = customers.getFor(rctx.tenantId, customerId);
      if (!customer) throw notFound('customer', customerId);

      const prefs = preferences
        .list(rctx.tenantId, (p) => p.customerId === customerId)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .at(-1);
      const consentRows = consents.list(rctx.tenantId, (c) => c.customerId === customerId);
      const comms = communications
        .list(rctx.tenantId, (c) => c.customerId === customerId)
        .sort(newestFirst)
        .slice(0, COMMUNICATIONS_CAP);
      const recentTimeline = ctx.services.analytics
        .customerTimeline(rctx.tenantId, customerId)
        .slice(-TIMELINE_CAP);

      // Audit the view (fire-and-forget: the log append is synchronous, the
      // bus fan-out is isolated, and the contract method is synchronous).
      ctx.publish({
        type: 'com.acorn.agent.customer-viewed',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: customerId,
        data: { customerId, agentActorId: rctx.actorId },
      }).catch(() => undefined);

      return {
        customer,
        preferences: prefs,
        consents: consentRows,
        communications: comms,
        recentTimeline,
      };
    },

    async resend(rctx, communicationId, channels) {
      requireAgentRole(rctx);
      const communication = communications.getFor(rctx.tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);

      // Audit-first: the on-behalf action is recorded before delivery runs.
      await ctx.publish({
        type: 'com.acorn.agent.resend',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: communicationId,
        data: {
          communicationId,
          customerId: communication.customerId,
          agentActorId: rctx.actorId,
          channels: channels ?? 'preference-based',
        },
      });

      return ctx.services.delivery.deliver({
        tenantId: rctx.tenantId,
        communicationId,
        channels,
      });
    },

    async reissueLink(rctx, communicationId) {
      requireAgentRole(rctx);
      const communication = communications.getFor(rctx.tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);

      // Revoke every live link; delivery only reuses non-revoked links, so the
      // subsequent secure-link delivery is forced to mint a fresh one.
      const live = secureLinks.list(
        rctx.tenantId,
        (l) => l.communicationId === communicationId && !l.revokedAt,
      );
      const revokedAt = new Date().toISOString();
      for (const link of live) secureLinks.put({ ...link, revokedAt });

      await ctx.publish({
        type: 'com.acorn.agent.link-reissued',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: communicationId,
        data: {
          communicationId,
          customerId: communication.customerId,
          agentActorId: rctx.actorId,
          revokedCount: live.length,
        },
      });

      await ctx.services.delivery.deliver({
        tenantId: rctx.tenantId,
        communicationId,
        channels: ['secure-link'],
      });

      const fresh = ctx.services.delivery.getSecureLink(rctx.tenantId, communicationId);
      if (!fresh) throw notFound('secure link for communication', communicationId);
      return { url: `${ctx.config.baseUrl}/view/${fresh.token}`, expiresAt: fresh.expiresAt };
    },

    async addNote(rctx, customerId, note) {
      requireAgentRole(rctx);
      const text = (note ?? '').trim();
      if (text.length < 1 || text.length > NOTE_MAX) {
        throw invalid(`note must be 1..${NOTE_MAX} characters`);
      }
      const customer = customers.getFor(rctx.tenantId, customerId);
      if (!customer) throw notFound('customer', customerId);

      // The note lives in the audit log only; analytics customerTimeline picks
      // it up via data.customerId and surfaces the type as a readable summary.
      await ctx.publish({
        type: 'com.acorn.agent.note-added',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: customerId,
        data: { customerId, agentActorId: rctx.actorId, note: text },
      });
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const channelSchema = z.enum(['email', 'sms', 'secure-link', 'webhook', 'print']);

const resendSchema = z.object({
  channels: z.array(channelSchema).min(1).optional(),
});

const noteSchema = z.object({
  note: z.string(),
});

/** Route-level gate: service-agent | operator (+ tenant-admin implicitly). */
const ROUTE_ROLES: Role[] = ['service-agent', 'operator'];

export function registerAgentDeskRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const desk = () => ctx.services.agentDesk;

  app.get('/v1/agent/customers', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_ROLES);
    const { q } = req.query as { q?: string };
    return desk().searchCustomers(rctx, q ?? '');
  });

  app.get('/v1/agent/customers/:id/overview', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_ROLES);
    const { id } = req.params as { id: string };
    return desk().customerOverview(rctx, id);
  });

  app.post('/v1/agent/communications/:id/resend', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(resendSchema, req.body);
    return desk().resend(rctx, id, body.channels as Channel[] | undefined);
  });

  app.post('/v1/agent/communications/:id/reissue-link', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_ROLES);
    const { id } = req.params as { id: string };
    return desk().reissueLink(rctx, id);
  });

  app.post('/v1/agent/customers/:id/notes', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(noteSchema, req.body);
    await desk().addNote(rctx, id, body.note);
    return { ok: true };
  });
}
