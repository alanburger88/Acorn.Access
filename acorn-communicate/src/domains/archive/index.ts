/**
 * ARCHIVE bounded context — immutable statement-of-record storage, legal hold,
 * evidence packs, and reproducibility verification.
 *
 * Exposes `createArchiveService` (implements ArchiveService from
 * kernel/contracts.ts) and `registerArchiveRoutes` (/v1 HTTP surface). The
 * factory subscribes to `com.acorn.communication.rendered` so every rendered
 * communication is archived automatically.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AccessEvent,
  ActionTransaction,
  AiInvocation,
  ArchiveRecord,
  ArchiveService,
  Communication,
  DeliveryAttempt,
  EvidencePack,
  RenderArtifact,
  RenderFormat,
  Role,
  TemplateVersion,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/archive';

const COMPLIANCE_ROLES: Role[] = ['compliance-approver', 'auditor', 'tenant-admin'];

/**
 * Formats whose renders are byte-deterministic and therefore hash-comparable.
 * PDF is deliberately excluded: pdfkit embeds creation timestamps in the
 * bytes, so a re-render never hashes identically even when content matches.
 */
const COMPARABLE_FORMATS: RenderFormat[] = ['html', 'text'];

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createArchiveService(ctx: PlatformContext): ArchiveService {
  const communications = ctx.store.collection<Communication>('communications');
  const artifacts = ctx.store.collection<RenderArtifact>('artifacts');
  const archiveRecords = ctx.store.collection<ArchiveRecord>('archiveRecords');
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
  const accessEvents = ctx.store.collection<AccessEvent>('accessEvents');
  const actions = ctx.store.collection<ActionTransaction>('actions');
  const aiInvocations = ctx.store.collection<AiInvocation>('aiInvocations');
  const templateVersions = ctx.store.collection<TemplateVersion>('templateVersions');

  const service: ArchiveService = {
    async archive(tenantId, communicationId) {
      // Idempotent: a communication has exactly one statement-of-record.
      const existing = service.get(tenantId, communicationId);
      if (existing) return existing;

      const communication = communications.getFor(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);
      const arts = artifacts.list(tenantId, (a) => a.communicationId === communicationId);

      const record: ArchiveRecord = {
        id: newId('arc'),
        tenantId,
        communicationId,
        customerId: communication.customerId,
        templateVersionId: communication.templateVersionId,
        storedAt: new Date().toISOString(),
        retentionClass: 'standard-7y',
        legalHold: false,
        manifest: {
          dataSnapshotKey: communication.dataSnapshotKey,
          dataSnapshotHash: communication.dataSnapshotHash,
          templateVersionId: communication.templateVersionId,
          contentVersionIds: communication.composed.contentVersionIds,
          artifacts: arts.map((a) => ({
            format: a.format,
            objectKey: a.objectKey,
            sha256: a.sha256,
          })),
          rendererVersion: ctx.services.rendering.rendererVersion,
        },
      };
      archiveRecords.put(record);

      await ctx.publish({
        type: 'com.acorn.archive.stored',
        tenantId,
        source: SOURCE,
        subject: communicationId,
        data: { communicationId, customerId: communication.customerId, recordId: record.id },
      });
      return record;
    },

    get(tenantId, communicationId) {
      return archiveRecords
        .list(tenantId, (r) => r.communicationId === communicationId)
        .at(0);
    },

    search(tenantId, filter) {
      return archiveRecords.list(tenantId, (r) => {
        if (filter.customerId && r.customerId !== filter.customerId) return false;
        if (filter.templateId) {
          const communication = communications.getFor(tenantId, r.communicationId);
          if (communication?.templateId !== filter.templateId) return false;
        }
        return true;
      });
    },

    setLegalHold(rctx, recordId, hold) {
      if (!rctx.roles.some((r) => COMPLIANCE_ROLES.includes(r))) {
        throw forbidden(`requires one of roles: ${COMPLIANCE_ROLES.join(', ')}`);
      }
      const record = archiveRecords.getFor(rctx.tenantId, recordId);
      if (!record) throw notFound('archive record', recordId);
      return archiveRecords.put({ ...record, legalHold: hold });
    },

    evidencePack(tenantId, communicationId): EvidencePack {
      const record = service.get(tenantId, communicationId);
      if (!record) throw notFound('archive record for communication', communicationId);
      return {
        generatedAt: new Date().toISOString(),
        communicationId,
        record,
        proofs: {
          proofOfContent: {
            dataSnapshotHash: record.manifest.dataSnapshotHash,
            artifactHashes: Object.fromEntries(
              record.manifest.artifacts.map((a) => [a.format, a.sha256]),
            ),
          },
          proofOfDelivery: deliveries.list(tenantId, (d) => d.communicationId === communicationId),
          proofOfAccess: accessEvents.list(tenantId, (a) => a.communicationId === communicationId),
          proofOfCustomerAction: actions.list(
            tenantId,
            (a) => a.communicationId === communicationId,
          ),
          proofOfVersion: {
            templateVersionId: record.templateVersionId,
            contentVersionIds: record.manifest.contentVersionIds,
          },
          proofOfAiChanges: aiInvocations.list(tenantId, (i) => i.subject === communicationId),
        },
        eventChain: (({ intact, length }) => ({ intact, length }))(
          ctx.log.verifyChain(tenantId),
        ),
      };
    },

    async verifyReproducibility(tenantId, communicationId) {
      const record = service.get(tenantId, communicationId);
      if (!record) throw notFound('archive record for communication', communicationId);
      const communication = communications.getFor(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);
      const templateVersion = templateVersions.getFor(tenantId, record.manifest.templateVersionId);
      if (!templateVersion) throw notFound('template version', record.manifest.templateVersionId);

      const comparable = record.manifest.artifacts.filter((a) =>
        COMPARABLE_FORMATS.includes(a.format),
      );
      if (comparable.length === 0) {
        return { reproducible: false, detail: 'no comparable formats in manifest' };
      }

      let reproducible = true;
      const results: string[] = [];
      for (const artifact of comparable) {
        const { buf } = await ctx.services.rendering.renderPreview({
          doc: communication.composed,
          format: artifact.format,
          templateVersion,
        });
        const match = sha256(buf) === artifact.sha256;
        if (!match) reproducible = false;
        results.push(`${artifact.format}: ${match ? 'match' : 'mismatch'}`);
      }
      return { reproducible, detail: results.join(', ') };
    },
  };

  // Auto-archive every rendered communication (statement of record).
  ctx.bus.on('com.acorn.communication.rendered', (e) => {
    void service.archive(e.tenantid, e.subject!).catch(() => {});
  });

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const legalHoldSchema = z.object({ hold: z.boolean() });

export function registerArchiveRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const archive = () => ctx.services.archive;
  const auditRoles: Role[] = ['auditor', 'compliance-approver']; // + tenant-admin implicitly

  app.get('/v1/archive', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { customerId, templateId } = req.query as { customerId?: string; templateId?: string };
    return archive().search(rctx.tenantId, { customerId, templateId });
  });

  app.get('/v1/archive/:communicationId', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { communicationId } = req.params as { communicationId: string };
    const record = archive().get(rctx.tenantId, communicationId);
    if (!record) throw notFound('archive record for communication', communicationId);
    return record;
  });

  app.post('/v1/archive/records/:recordId/legal-hold', async (req) => {
    const rctx = requireAuth(ctx, req, ['compliance-approver', 'auditor']);
    const { recordId } = req.params as { recordId: string };
    const body = parseBody(legalHoldSchema, req.body);
    return archive().setLegalHold(rctx, recordId, body.hold);
  });

  app.get('/v1/archive/:communicationId/evidence-pack', async (req) => {
    const rctx = requireAuth(ctx, req, auditRoles);
    const { communicationId } = req.params as { communicationId: string };
    return archive().evidencePack(rctx.tenantId, communicationId);
  });

  app.post('/v1/archive/:communicationId/verify', async (req) => {
    const rctx = requireAuth(ctx, req, auditRoles);
    const { communicationId } = req.params as { communicationId: string };
    return archive().verifyReproducibility(rctx.tenantId, communicationId);
  });
}
