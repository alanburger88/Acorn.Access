/**
 * DATA LIFECYCLE bounded context — retention sweeps, GDPR/CCPA erasure, and
 * data hygiene (platform tier 4).
 *
 * Exposes `createLifecycleService` (implements LifecycleService from
 * kernel/contracts.ts) and `registerLifecycleRoutes` (/v1 HTTP surface).
 */
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ArchiveRecord,
  Communication,
  ConsentRecord,
  Customer,
  DeliveryAttempt,
  ErasureReport,
  LifecycleService,
  PreferenceRecord,
  RenderArtifact,
  Role,
  SecureLink,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';

const SOURCE = '/domains/lifecycle';

const ERASE_ROLES: Role[] = ['compliance-approver', 'tenant-admin'];

const ERASED = '[erased]';
const ERASED_LINE = '[content erased at customer request]';

/** Records stored before this instant have exceeded the standard-7y class. */
function retentionCutoffMs(now: number): number {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 7);
  return cutoff.getTime();
}

/** 'standard-7y' past its window and not frozen by legal hold ('permanent' is never due). */
function isRetentionDue(record: ArchiveRecord, cutoffMs: number): boolean {
  return (
    record.retentionClass === 'standard-7y' &&
    !record.legalHold &&
    Date.parse(record.storedAt) <= cutoffMs
  );
}

/** Read-only count of retention-due archive records for one tenant (no side effects). */
export function countRetentionDue(
  ctx: PlatformContext,
  tenantId: string,
  now: number = Date.now(),
): number {
  const cutoff = retentionCutoffMs(now);
  return ctx.store
    .collection<ArchiveRecord>('archiveRecords')
    .list(tenantId, (r) => isRetentionDue(r, cutoff)).length;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createLifecycleService(ctx: PlatformContext): LifecycleService {
  const customers = ctx.store.collection<Customer>('customers');
  const communications = ctx.store.collection<Communication>('communications');
  const artifacts = ctx.store.collection<RenderArtifact>('artifacts');
  const archiveRecords = ctx.store.collection<ArchiveRecord>('archiveRecords');
  const secureLinks = ctx.store.collection<SecureLink>('secureLinks');
  // Read-only in this domain: consulted during erasure but deliberately left
  // intact (see eraseCustomer step 2).
  const consents = ctx.store.collection<ConsentRecord>('consents');
  const preferences = ctx.store.collection<PreferenceRecord>('preferences');
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');

  const service: LifecycleService = {
    async sweep(now = Date.now()) {
      const nowIso = new Date(now).toISOString();
      const perTenant = new Map<string, { expiredLinksRevoked: number; retentionDue: number }>();
      const tally = (tenantId: string) => {
        let t = perTenant.get(tenantId);
        if (!t) {
          t = { expiredLinksRevoked: 0, retentionDue: 0 };
          perTenant.set(tenantId, t);
        }
        return t;
      };

      // Revoke secure links past their expiry across every tenant.
      for (const link of secureLinks.listAll(
        (l) => !l.revokedAt && Date.parse(l.expiresAt) <= now,
      )) {
        secureLinks.put({ ...link, revokedAt: nowIso });
        tally(link.tenantId).expiredLinksRevoked++;
      }

      // Retention-due archive records are COUNTED, never deleted here:
      // production queues a disposition review (human sign-off + regulator
      // notice where required) before anything leaves the archive.
      const cutoff = retentionCutoffMs(now);
      for (const record of archiveRecords.listAll((r) => isRetentionDue(r, cutoff))) {
        tally(record.tenantId).retentionDue++;
      }

      let expiredLinksRevoked = 0;
      let retentionDue = 0;
      for (const [tenantId, counts] of perTenant) {
        expiredLinksRevoked += counts.expiredLinksRevoked;
        retentionDue += counts.retentionDue;
        // Emit only for tenants where the sweep actually found work — a
        // no-op sweep must not add noise to the tamper-evident log.
        if (counts.expiredLinksRevoked > 0 || counts.retentionDue > 0) {
          await ctx.publish({
            type: 'com.acorn.lifecycle.sweep',
            tenantId,
            source: SOURCE,
            data: {
              expiredLinksRevoked: counts.expiredLinksRevoked,
              retentionDue: counts.retentionDue,
            },
          });
        }
      }
      return { expiredLinksRevoked, retentionDue };
    },

    async eraseCustomer(rctx, customerId, reason): Promise<ErasureReport> {
      if (!rctx.roles.some((r) => ERASE_ROLES.includes(r))) {
        throw forbidden(`requires one of roles: ${ERASE_ROLES.join(', ')}`);
      }
      const trimmed = (reason ?? '').trim();
      if (trimmed.length < 3 || trimmed.length > 300) {
        throw invalid('reason is required (3..300 characters)');
      }
      const { tenantId } = rctx;
      const customer = customers.getFor(tenantId, customerId);
      if (!customer) throw notFound('customer', customerId);

      // LEGAL HOLD CHECK — any held archive record blocks the whole request:
      // partial erasure would destroy evidence a court has ordered preserved.
      // Nothing is mutated; only the attempt itself is audited.
      const held = archiveRecords.list(tenantId, (r) => r.customerId === customerId && r.legalHold);
      if (held.length > 0) {
        await ctx.publish({
          type: 'com.acorn.lifecycle.erasure',
          tenantId,
          source: SOURCE,
          subject: customerId,
          data: { customerId, erased: false, blockedBy: held.length, deletedObjects: 0 },
        });
        return {
          customerId,
          erased: false,
          blockedBy: held.map((r) => r.id),
          redactedCustomerFields: 0,
          revokedLinks: 0,
          deletedObjects: 0,
          tombstonedArchiveRecords: 0,
        };
      }

      // 1. Redact the customer row to tombstone values. `id` and `locale` are
      //    kept for referential integrity: communications, deliveries and
      //    archive records key off the id, and a locale alone identifies
      //    nobody.
      let redactedCustomerFields = 0;
      const redacted: Customer = { ...customer };
      if (redacted.name !== ERASED) {
        redacted.name = ERASED;
        redactedCustomerFields++;
      }
      for (const field of ['email', 'phone', 'address', 'externalRef'] as const) {
        if (redacted[field] !== undefined) {
          delete redacted[field];
          redactedCustomerFields++;
        }
      }
      customers.put(redacted);

      // 2. Consent, preference and delivery rows stay untouched: consent
      //    DECISIONS are the tenant's compliance evidence of opt-in/out and
      //    carry no PII beyond the pseudonymous customer id; preference rows
      //    hold only channel ordering; delivery attempts remain as
      //    proof-of-delivery (production additionally crypto-shreds the `to`
      //    address per platform/06).
      void consents.list(tenantId, (c) => c.customerId === customerId);
      void preferences.list(tenantId, (p) => p.customerId === customerId);
      void deliveries.list(tenantId, (d) => d.customerId === customerId);

      // 3. Revoke every live secure link so no rendered PII stays reachable.
      const nowIso = new Date().toISOString();
      let revokedLinks = 0;
      for (const link of secureLinks.list(
        tenantId,
        (l) => l.customerId === customerId && !l.revokedAt,
      )) {
        secureLinks.put({ ...link, revokedAt: nowIso });
        revokedLinks++;
      }

      // 4. Delete stored objects (data snapshots + rendered artifacts).
      //    The ObjectStore is immutable by design and exposes no delete API;
      //    erasure is the one sanctioned exception, performed directly against
      //    the store's on-disk layout: object key '<tenantId>/<sha256>' lives
      //    at `${dataDir}/objects/<key>` with a sibling '<key>.meta.json'
      //    (see kernel/storage.ts ObjectStore.put).
      const myComms = communications.list(tenantId, (c) => c.customerId === customerId);
      const allComms = communications.listAll();
      const allArtifacts = artifacts.listAll();
      let deletedObjects = 0;
      const considered = new Set<string>();
      for (const comm of myComms) {
        const keys = [
          comm.dataSnapshotKey,
          ...allArtifacts.filter((a) => a.communicationId === comm.id).map((a) => a.objectKey),
        ];
        for (const key of keys) {
          if (!key || key === ERASED || considered.has(key)) continue;
          considered.add(key);
          // Content-addressed storage dedupes identical bytes: the same hash
          // key can back another communication's artifact or snapshot — even
          // another customer's — and unlinking it would orphan their evidence.
          // Guard: only unlink when NO other communication references the key
          // (scan across all tenants' 'artifacts' + 'communications').
          // Trade-off: this is conservative — when two of the erased
          // customer's own communications share bytes, the blob survives
          // (each sees the other as a live reference); production would
          // reference-count instead. Erring toward keeping a blob beats
          // destroying someone else's statement of record.
          const referencedElsewhere =
            allArtifacts.some((a) => a.objectKey === key && a.communicationId !== comm.id) ||
            allComms.some((c) => c.dataSnapshotKey === key && c.id !== comm.id);
          if (referencedElsewhere) continue;
          const file = join(ctx.config.dataDir, 'objects', key);
          if (existsSync(file)) {
            unlinkSync(file);
            deletedObjects++;
          }
          if (existsSync(`${file}.meta.json`)) unlinkSync(`${file}.meta.json`);
        }
      }

      // 5. Tombstone archive records: empty the artifact list and erase the
      //    snapshot key (the blobs are gone). dataSnapshotHash is kept — a
      //    hash is not PII and preserves the evidence chain (proof of what
      //    the original content was, verifiable if it ever resurfaces).
      let tombstonedArchiveRecords = 0;
      for (const record of archiveRecords.list(tenantId, (r) => r.customerId === customerId)) {
        archiveRecords.put({
          ...record,
          manifest: { ...record.manifest, artifacts: [], dataSnapshotKey: ERASED },
        });
        tombstonedArchiveRecords++;
      }

      // 6. Redact the composed documents held on communication rows: the
      //    customer name and every section's resolved lines contain PII.
      //    Section ids/titles are template structure, not customer data, and
      //    are kept so analytics hotspots keep resolving. Status is left
      //    unchanged.
      for (const comm of myComms) {
        communications.put({
          ...comm,
          composed: {
            ...comm.composed,
            customerName: ERASED,
            sections: comm.composed.sections.map((s) => ({
              ...s,
              lines: [{ kind: 'text' as const, text: ERASED_LINE }],
            })),
          },
        });
      }

      // The hash-chained event log is deliberately NOT rewritten: tamper
      // evidence wins, and events carry only pseudonymous ids (cus_/com_).
      // Production adds crypto-shredding of per-customer event payload keys
      // (platform/06) so logged PII becomes unreadable without breaking the
      // chain.
      await ctx.publish({
        type: 'com.acorn.lifecycle.erasure',
        tenantId,
        source: SOURCE,
        subject: customerId,
        data: { customerId, erased: true, blockedBy: 0, deletedObjects },
      });

      return {
        customerId,
        erased: true,
        blockedBy: [],
        redactedCustomerFields,
        revokedLinks,
        deletedObjects,
        tombstonedArchiveRecords,
      };
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const eraseSchema = z.object({ reason: z.string() });

export function registerLifecycleRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  app.post('/v1/lifecycle/sweep', async (req) => {
    requireAuth(ctx, req, ['operator', 'tenant-admin']);
    return ctx.services.lifecycle.sweep();
  });

  app.post('/v1/customers/:id/erase', async (req) => {
    const rctx = requireAuth(ctx, req, ERASE_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(eraseSchema, req.body);
    return ctx.services.lifecycle.eraseCustomer(rctx, id, body.reason);
  });

  app.get('/v1/lifecycle/retention-due', async (req) => {
    const rctx = requireAuth(ctx, req); // any authenticated caller
    // Read-only: counts what the next sweep would flag, no side effects.
    return { retentionDue: countRetentionDue(ctx, rctx.tenantId) };
  });
}
