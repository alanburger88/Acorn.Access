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
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId, newSecret } from '../../kernel/ids.js';
import { createProviders } from './providers.js';

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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createDeliveryService(ctx: PlatformContext): DeliveryService {
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
  const secureLinks = ctx.store.collection<SecureLink>('secureLinks');
  // read-only view of the tenants domain's customer collection
  const customers = ctx.store.collection<Customer>('customers');
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

  const service: DeliveryService = {
    async deliver({ tenantId, communicationId, channels }) {
      const communication = ctx.services.composition.getCommunication(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);
      const customer = customers.getFor(tenantId, communication.customerId);
      if (!customer) throw notFound('customer', communication.customerId);
      const customerId = customer.id;

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
        if (!ctx.services.tenants.hasConsent(tenantId, customerId, channel)) {
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
    });
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
