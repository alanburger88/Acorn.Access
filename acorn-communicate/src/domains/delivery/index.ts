/**
 * DELIVERY bounded context — channel orchestration: plan resolution, consent
 * enforcement, secure-link issuance, per-channel retry and cross-channel
 * failover, simulated provider callbacks.
 *
 * Exposes `createDeliveryService` (implements DeliveryService from
 * kernel/contracts.ts) and `registerDeliveryRoutes` (/v1 HTTP surface).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Channel,
  Communication,
  Customer,
  DeliveryAttempt,
  DeliveryService,
  SecureLink,
  Tenant,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId, newSecret } from '../../kernel/ids.js';
import { createProviders } from './providers.js';
import { inQuietHours, nextUtcMidnight, quietHoursEnd, sameUtcDay } from './scheduling.js';

const SOURCE = '/domains/delivery';
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TRIES = 3;

/** Channel capability: can this customer be reached on this channel at all? */
function capable(channel: Channel, customer: Customer): boolean {
  switch (channel) {
    case 'email':
      return Boolean(customer.email);
    case 'sms':
      return Boolean(customer.phone);
    case 'secure-link':
      return true;
    case 'print':
      return Boolean(customer.address);
    default:
      return false;
  }
}

const byCreation = (a: DeliveryAttempt, b: DeliveryAttempt): number =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt);

/** channels that push an outbound message to the customer (quiet-hours scope) */
const OUTBOUND_MESSAGE_CHANNELS: readonly Channel[] = ['email', 'sms'];

/**
 * Domain-local extension of the scheduled attempt row: the originally
 * requested channels are stashed on the row so tick() can promote the
 * delivery with the exact plan the caller asked for. The stored object may
 * carry fields beyond the kernel DeliveryAttempt contract.
 */
type ScheduledRow = DeliveryAttempt & { plannedChannels?: Channel[] };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createDeliveryService(ctx: PlatformContext): DeliveryService {
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
  const secureLinks = ctx.store.collection<SecureLink>('secureLinks');
  // read-only view of the tenants domain's customer collection
  const customers = ctx.store.collection<Customer>('customers');
  // read-only view of the tenants domain's tenant collection (quiet hours, caps)
  const tenants = ctx.store.collection<Tenant>('tenants');
  const providers = createProviders(ctx);

  async function emitDelivery(
    kind: 'requested' | 'attempted' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'failover',
    tenantId: string,
    communicationId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await ctx.publish({
      type: `com.acorn.delivery.${kind}`,
      tenantId,
      source: SOURCE,
      subject: communicationId,
      data,
    });
  }

  /** One SecureLink per communication: reuse a live (non-revoked, unexpired) one. */
  async function ensureSecureLink(tenantId: string, communication: Communication): Promise<SecureLink> {
    const now = Date.now();
    const existing = secureLinks
      .list(
        tenantId,
        (l) =>
          l.communicationId === communication.id && !l.revokedAt && Date.parse(l.expiresAt) > now,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    if (existing) return existing;
    const link: SecureLink = {
      id: newId('lnk'),
      tenantId,
      communicationId: communication.id,
      customerId: communication.customerId,
      token: newSecret(24),
      expiresAt: new Date(now + LINK_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    secureLinks.put(link);
    await ctx.publish({
      type: 'com.acorn.link.created',
      tenantId,
      source: SOURCE,
      subject: link.id,
      data: {
        linkId: link.id,
        communicationId: communication.id,
        customerId: communication.customerId,
        expiresAt: link.expiresAt,
      },
    });
    return link;
  }

  /**
   * The full immediate-delivery orchestration (consent, secure link,
   * providers, failover, retries). deliver() calls this when no deferral
   * applies; tick() calls it directly when promoting a scheduled row.
   */
  async function executeNow({
    tenantId,
    communicationId,
    channels,
  }: {
    tenantId: string;
    communicationId: string;
    channels?: Channel[];
  }): Promise<DeliveryAttempt[]> {
    {
      const communication = ctx.services.composition.getCommunication(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);
      const customer = customers.getFor(tenantId, communication.customerId);
      if (!customer) throw notFound('customer', communication.customerId);
      const customerId = customer.id;

      // Consent purpose comes from the template version (marketing requires
      // explicit opt-in; transactional carries implied consent).
      const templateVersion = ctx.store
        .collection<{ id: string; tenantId: string; purpose?: 'transactional' | 'marketing' }>(
          'templateVersions',
        )
        .getFor(tenantId, communication.templateVersionId);
      const purpose = templateVersion?.purpose ?? 'transactional';

      // Channel plan: explicit request > communication request > preferences;
      // then filter to channels the customer is actually reachable on.
      const requested =
        channels ??
        communication.requestedChannels ??
        ctx.services.tenants.preferredChannels(tenantId, customerId);
      const plan = requested.filter((c) => capable(c, customer) && Boolean(providers[c]));
      await emitDelivery('requested', tenantId, communicationId, {
        communicationId,
        customerId,
        channel: plan,
      });

      const link = await ensureSecureLink(tenantId, communication);
      const viewerUrl = `${ctx.config.baseUrl}/view/${link.token}`;

      const attempts: DeliveryAttempt[] = [];
      /** channel that bounced/exhausted and is handing over to the next one */
      let pendingFailover: Channel | undefined;
      let succeeded = false;

      function createAttempt(
        channel: Channel,
        providerName: string,
        to: string,
        attempt: number,
        failoverFrom?: Channel,
      ): DeliveryAttempt {
        const now = new Date().toISOString();
        const row: DeliveryAttempt = {
          id: newId('dlv'),
          tenantId,
          communicationId,
          customerId,
          channel,
          provider: providerName,
          to,
          status: 'queued',
          attempt,
          createdAt: now,
          updatedAt: now,
          ...(failoverFrom ? { failoverFrom } : {}),
        };
        deliveries.put(row);
        attempts.push(row);
        return row;
      }

      function updateAttempt(row: DeliveryAttempt, patch: Partial<DeliveryAttempt>): DeliveryAttempt {
        const updated = { ...row, ...patch, updatedAt: new Date().toISOString() };
        deliveries.put(updated);
        attempts[attempts.indexOf(row)] = updated;
        return updated;
      }

      for (const channel of plan) {
        if (succeeded) break;
        const provider = providers[channel];
        if (!provider) continue;
        const to = provider.resolveTo(customer, viewerUrl) ?? '';

        // Consent gate: a denied channel is recorded and skipped, but it is
        // NOT a failover — the customer said no, the channel didn't break.
        if (!ctx.services.tenants.hasConsent(tenantId, customerId, channel, purpose)) {
          const row = createAttempt(channel, provider.name, to, 1);
          updateAttempt(row, { status: 'failed', failureReason: 'no-consent' });
          await emitDelivery('failed', tenantId, communicationId, {
            communicationId,
            customerId,
            channel,
            attemptId: row.id,
            to,
            reason: 'no-consent',
          });
          continue;
        }

        // Retry loop: up to MAX_TRIES synchronous tries for transient errors
        // (provider throws). Production replaces this with backoff queues
        // (platform/11 RB-02); the reference build retries inline, no timers.
        for (let tryNo = 1; tryNo <= MAX_TRIES; tryNo++) {
          const failoverFrom = tryNo === 1 ? pendingFailover : undefined;
          const row = createAttempt(channel, provider.name, to, tryNo, failoverFrom);
          if (failoverFrom) {
            pendingFailover = undefined;
            await emitDelivery('failover', tenantId, communicationId, {
              communicationId,
              customerId,
              channel,
              attemptId: row.id,
              to,
              reason: `failover from ${failoverFrom}`,
            });
          }
          await emitDelivery('attempted', tenantId, communicationId, {
            communicationId,
            customerId,
            channel,
            attemptId: row.id,
            to,
          });

          try {
            const result = await provider.send({
              tenantId,
              attemptId: row.id,
              to,
              communication,
              customer,
              viewerUrl,
            });
            const updated = updateAttempt(row, {
              status: result.status,
              providerMessageId: result.providerMessageId,
              failureReason: result.failureReason,
            });
            if (result.status === 'sent' || result.status === 'delivered') {
              await emitDelivery(result.status, tenantId, communicationId, {
                communicationId,
                customerId,
                channel,
                attemptId: updated.id,
                to,
              });
              succeeded = true;
              break; // stop everything — the communication went out
            }
            // bounced: hard failure on this channel, fail over to the next one
            await emitDelivery('bounced', tenantId, communicationId, {
              communicationId,
              customerId,
              channel,
              attemptId: updated.id,
              to,
              reason: updated.failureReason,
            });
            pendingFailover = channel;
            break;
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            updateAttempt(row, { status: 'failed', failureReason: reason });
            if (tryNo === MAX_TRIES) {
              // retries exhausted: give up on this channel, fail over
              await emitDelivery('failed', tenantId, communicationId, {
                communicationId,
                customerId,
                channel,
                attemptId: row.id,
                to,
                reason,
              });
              pendingFailover = channel;
            }
          }
        }
      }

      const anySucceeded = attempts.some((a) => a.status === 'sent' || a.status === 'delivered');
      ctx.services.composition.setStatus(
        tenantId,
        communicationId,
        anySucceeded ? 'delivered' : 'failed',
      );
      return attempts;
    }
  }

  /**
   * Record (or refresh) the single 'scheduled' row for a communication and
   * emit delivery.scheduled. Providers are never touched and the
   * communication status is left as-is.
   */
  async function scheduleDelivery(args: {
    tenantId: string;
    communicationId: string;
    customerId: string;
    /** effective channel plan (used only for the row's display channel) */
    plan: Channel[];
    /** original requested channels, replayed verbatim on promotion */
    channels?: Channel[];
    deferReason: NonNullable<DeliveryAttempt['deferReason']>;
    scheduledForMs: number;
  }): Promise<DeliveryAttempt> {
    const nowIso = new Date().toISOString();
    const scheduledFor = new Date(args.scheduledForMs).toISOString();
    // Re-delivery while a scheduled row is pending: replace its
    // scheduledFor/deferReason in place — never two scheduled rows per
    // communication.
    const pending = deliveries
      .list(
        args.tenantId,
        (r) => r.communicationId === args.communicationId && r.status === 'scheduled',
      )
      .sort(byCreation)
      .at(0) as ScheduledRow | undefined;
    let row: ScheduledRow;
    if (pending) {
      const { plannedChannels: _stale, ...rest } = pending;
      row = {
        ...rest,
        scheduledFor,
        deferReason: args.deferReason,
        updatedAt: nowIso,
        ...(args.channels ? { plannedChannels: args.channels } : {}),
      };
    } else {
      row = {
        id: newId('dlv'),
        tenantId: args.tenantId,
        communicationId: args.communicationId,
        customerId: args.customerId,
        channel: args.plan[0] ?? 'email',
        provider: 'scheduler',
        to: '(deferred)',
        status: 'scheduled',
        attempt: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        scheduledFor,
        deferReason: args.deferReason,
        ...(args.channels ? { plannedChannels: args.channels } : {}),
      };
    }
    deliveries.put(row);
    await ctx.publish({
      type: 'com.acorn.delivery.scheduled',
      tenantId: args.tenantId,
      source: SOURCE,
      subject: args.communicationId,
      data: {
        communicationId: args.communicationId,
        customerId: args.customerId,
        scheduledFor,
        reason: args.deferReason,
      },
    });
    return row;
  }

  const service: DeliveryService = {
    async deliver({ tenantId, communicationId, channels, scheduleAt }) {
      const now = Date.now();
      const communication = ctx.services.composition.getCommunication(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);
      const customer = customers.getFor(tenantId, communication.customerId);
      if (!customer) throw notFound('customer', communication.customerId);

      // Effective channel plan, mirroring executeNow's resolution — needed up
      // front because quiet hours only apply to outbound message channels.
      const requested =
        channels ??
        communication.requestedChannels ??
        ctx.services.tenants.preferredChannels(tenantId, customer.id);
      const plan = requested.filter((c) => capable(c, customer) && Boolean(providers[c]));

      // Deferral decision — computed BEFORE any provider attempt, in priority
      // order: explicit schedule > quiet hours > frequency cap.
      let deferReason: NonNullable<DeliveryAttempt['deferReason']> | undefined;
      let scheduledForMs = 0;

      // (a) explicit scheduleAt in the future
      if (scheduleAt !== undefined) {
        const at = Date.parse(scheduleAt);
        if (Number.isNaN(at)) throw invalid('scheduleAt must be an ISO datetime');
        if (at > now) {
          deferReason = 'explicit-schedule';
          scheduledForMs = at;
        }
      }

      const tenant = tenants.getFor(tenantId, tenantId);

      // (b) tenant quiet hours: only outbound message channels (email/sms)
      // wake people up; secure-link/print/webhook-only plans go out anyway.
      // Simplification: evaluated in UTC — production evaluates the window in
      // the customer's locale timezone (see scheduling.ts).
      if (!deferReason) {
        const quietHours = tenant?.settings.quietHours;
        const outbound = plan.some((c) => OUTBOUND_MESSAGE_CHANNELS.includes(c));
        if (quietHours && outbound && inQuietHours(now, quietHours)) {
          deferReason = 'quiet-hours';
          scheduledForMs = quietHoursEnd(now, quietHours);
        }
      }

      // (c) frequency cap: count today's (UTC) distinct COMMUNICATIONS with
      // non-scheduled attempts for the customer — retries/failovers of one
      // delivery must not burn extra cap slots. At/over the cap the delivery
      // waits for the next UTC day.
      if (!deferReason) {
        const cap = tenant?.settings.maxDeliveriesPerCustomerPerDay;
        if (cap !== undefined) {
          const todayCount = new Set(
            deliveries
              .list(
                tenantId,
                (r) =>
                  r.customerId === customer.id &&
                  r.status !== 'scheduled' &&
                  sameUtcDay(Date.parse(r.createdAt), now),
              )
              .map((r) => r.communicationId),
          ).size;
          if (todayCount >= cap) {
            deferReason = 'frequency-cap';
            scheduledForMs = nextUtcMidnight(now);
          }
        }
      }

      if (deferReason) {
        const row = await scheduleDelivery({
          tenantId,
          communicationId,
          customerId: customer.id,
          plan,
          channels,
          deferReason,
          scheduledForMs,
        });
        return [row];
      }

      return executeNow({ tenantId, communicationId, channels });
    },

    async tick(now = Date.now()) {
      const due = deliveries.listAll(
        (r) => r.status === 'scheduled' && !!r.scheduledFor && Date.parse(r.scheduledFor) <= now,
      ) as ScheduledRow[];
      let promoted = 0;
      for (const row of due) {
        // tick() never throws: a broken row is marked failed and the sweep
        // moves on to the next one.
        try {
          // Flip the row out of 'scheduled' and persist FIRST so a concurrent
          // or re-entrant tick can never pick it up again.
          deliveries.put({ ...row, status: 'queued', updatedAt: new Date().toISOString() });
          await ctx.publish({
            type: 'com.acorn.delivery.promoted',
            tenantId: row.tenantId,
            source: SOURCE,
            subject: row.communicationId,
            data: { communicationId: row.communicationId, scheduledAttemptId: row.id },
          });
          // Promotion skips the deferral checks (skipDeferralChecks): we call
          // the raw orchestration, not deliver(). Rationale: a 'quiet-hours'
          // row's scheduledFor IS the window end, so re-evaluating quiet
          // hours at that boundary minute (or a cap re-count against rows the
          // promotion itself creates) would re-defer forever. A promoted
          // delivery always executes.
          await executeNow({
            tenantId: row.tenantId,
            communicationId: row.communicationId,
            channels: row.plannedChannels,
          });
          promoted++;
        } catch (err) {
          const failureReason = err instanceof Error ? err.message : String(err);
          deliveries.put({
            ...row,
            status: 'failed',
            failureReason,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return promoted;
    },

    listAttempts(tenantId, communicationId) {
      return deliveries
        .list(tenantId, (a) => !communicationId || a.communicationId === communicationId)
        .sort(byCreation);
    },

    getSecureLink(tenantId, communicationId) {
      return secureLinks
        .list(tenantId, (l) => l.communicationId === communicationId && !l.revokedAt)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .at(-1);
    },

    async providerCallback({ tenantId, attemptId, status }) {
      const row = deliveries.getFor(tenantId, attemptId);
      if (!row) throw notFound('delivery attempt', attemptId);
      const updated: DeliveryAttempt = {
        ...row,
        status,
        updatedAt: new Date().toISOString(),
      };
      deliveries.put(updated);
      await emitDelivery(status === 'delivered' ? 'delivered' : 'bounced', tenantId, row.communicationId, {
        communicationId: row.communicationId,
        customerId: row.customerId,
        channel: row.channel,
        attemptId: row.id,
        to: row.to,
        ...(status === 'bounced' ? { reason: 'provider-callback-bounce' } : {}),
      });
      if (status === 'delivered') {
        ctx.services.composition.setStatus(tenantId, row.communicationId, 'delivered');
      }
      return updated;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const channelSchema = z.enum(['email', 'sms', 'secure-link', 'webhook', 'print']);

const deliverSchema = z.object({
  channels: z.array(channelSchema).min(1).optional(),
  /** ISO datetime; a future instant defers the delivery to that time */
  scheduleAt: z.string().datetime({ offset: true }).optional(),
});

const providerCallbackSchema = z.object({
  attemptId: z.string().min(1),
  status: z.enum(['delivered', 'bounced']),
});

export function registerDeliveryRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const delivery = () => ctx.services.delivery;

  app.post('/v1/communications/:id/deliver', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']); // + tenant-admin implicitly
    const { id } = req.params as { id: string };
    const body = parseBody(deliverSchema, req.body);
    return delivery().deliver({
      tenantId: rctx.tenantId,
      communicationId: id,
      channels: body.channels,
      scheduleAt: body.scheduleAt,
    });
  });

  // Promote due scheduled deliveries (also driven by the wiring's interval).
  app.post('/v1/deliveries/tick', async (req) => {
    requireAuth(ctx, req, ['operator', 'tenant-admin']);
    const promoted = await delivery().tick();
    return { promoted };
  });

  app.get('/v1/deliveries', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { communicationId } = req.query as { communicationId?: string };
    return delivery().listAttempts(rctx.tenantId, communicationId);
  });

  app.get('/v1/communications/:id/secure-link', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const link = delivery().getSecureLink(rctx.tenantId, id);
    if (!link) throw notFound('secure link for communication', id);
    return { url: `${ctx.config.baseUrl}/view/${link.token}`, expiresAt: link.expiresAt };
  });

  app.post('/v1/provider-callbacks', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']); // + tenant-admin implicitly
    const body = parseBody(providerCallbackSchema, req.body);
    return delivery().providerCallback({ tenantId: rctx.tenantId, ...body });
  });
}
