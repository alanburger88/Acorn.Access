import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type {
  AccessEvent,
  ActionTransaction,
  AiInvocation,
  ArchiveRecord,
  Communication,
  ComposedDocument,
  DeliveryAttempt,
  RenderArtifact,
  RenderFormat,
  RenderingService,
  RequestCtx,
  TemplateVersion,
} from '../src/kernel/contracts.js';
import { createArchiveService } from '../src/domains/archive/index.js';

const TENANT = 'ten_archive';
const COM = 'com_A';

const sameBytesFor: Partial<Record<RenderFormat, Buffer>> = {
  html: Buffer.from('<h1>Statement of record</h1>'),
  text: Buffer.from('Statement of record'),
};

function doc(): ComposedDocument {
  return {
    title: 'Statement',
    brand: { name: 'Acorn', primaryColor: '#004400', accentColor: '#88cc66', logoText: 'Acorn' },
    customerName: 'Jane',
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [],
    contentVersionIds: ['cnv_1'],
  };
}

describe('archive domain', () => {
  let ctx: PlatformContext;
  let recordId: string;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.rendering = {
      rendererVersion: 'acorn-renderer/1.0.0',
      renderPreview: async ({ format }: { format: RenderFormat }) => ({
        buf: sameBytesFor[format]!,
        contentType: 'x',
      }),
    } as unknown as RenderingService;
    ctx.services.archive = createArchiveService(ctx);

    const now = new Date().toISOString();
    ctx.store.collection<Communication>('communications').put({
      id: COM,
      tenantId: TENANT,
      templateId: 'tpl_1',
      templateVersionId: 'tpv_1',
      customerId: 'cus_1',
      status: 'rendered',
      dataSnapshotKey: `${TENANT}/snap`,
      dataSnapshotHash: 'snap-hash',
      composed: doc(),
      createdAt: now,
    });

    // artifacts + matching blobs in the object store
    const artifacts = ctx.store.collection<RenderArtifact>('artifacts');
    for (const format of ['html', 'text'] as const) {
      const stored = ctx.objects.put(TENANT, sameBytesFor[format]!, 'text/plain');
      artifacts.put({
        id: `art_${format}`,
        tenantId: TENANT,
        communicationId: COM,
        format,
        objectKey: stored.key,
        sha256: stored.sha256,
        size: stored.size,
        contentType: stored.contentType,
        renderedAt: now,
        rendererVersion: 'acorn-renderer/1.0.0',
      });
    }

    ctx.store.collection<TemplateVersion>('templateVersions').put({
      id: 'tpv_1',
      tenantId: TENANT,
      templateId: 'tpl_1',
      version: 1,
      status: 'published',
      dataContract: { fields: [], sample: {} },
      intendedOutcome: 'payment_completed',
      blocks: [],
      channels: {},
      authorId: 'usr_1',
      createdAt: now,
      aiAssisted: false,
    });

    // proofs for the evidence pack
    ctx.store.collection<DeliveryAttempt>('deliveries').put({
      id: 'dlv_1', tenantId: TENANT, communicationId: COM, customerId: 'cus_1',
      channel: 'email', provider: 'sim-email', to: 'jane@example.com', status: 'delivered',
      attempt: 1, createdAt: now, updatedAt: now,
    });
    ctx.store.collection<AccessEvent>('accessEvents').put({
      id: 'acc_1', tenantId: TENANT, communicationId: COM, customerId: 'cus_1',
      linkId: 'lnk_1', at: now, authMethod: 'link',
    });
    ctx.store.collection<ActionTransaction>('actions').put({
      id: 'act_1', tenantId: TENANT, communicationId: COM, customerId: 'cus_1',
      action: 'pay', status: 'completed', payload: {}, at: now,
    });
    ctx.store.collection<AiInvocation>('aiInvocations').put({
      id: 'aii_1', tenantId: TENANT, task: 'assistant-answer', model: 'sim', grounded: true,
      confidence: 0.92, citations: ['sec-summary'], inputHash: 'in', outputPreview: 'out',
      latencyMs: 12, at: now, subject: COM, escalated: false,
    });
  });

  it('archive() stores a full manifest and is idempotent', async () => {
    const record = await ctx.services.archive.archive(TENANT, COM);
    recordId = record.id;
    expect(record.id).toMatch(/^arc_/);
    expect(record.customerId).toBe('cus_1');
    expect(record.retentionClass).toBe('standard-7y');
    expect(record.legalHold).toBe(false);
    expect(record.manifest.dataSnapshotHash).toBe('snap-hash');
    expect(record.manifest.templateVersionId).toBe('tpv_1');
    expect(record.manifest.contentVersionIds).toEqual(['cnv_1']);
    expect(record.manifest.rendererVersion).toBe('acorn-renderer/1.0.0');
    expect(record.manifest.artifacts).toHaveLength(2);

    const again = await ctx.services.archive.archive(TENANT, COM);
    expect(again.id).toBe(record.id);
    expect(ctx.store.collection<ArchiveRecord>('archiveRecords').list(TENANT)).toHaveLength(1);

    // archive.stored emitted to the tamper-evident log
    const stored = ctx.log.query(TENANT, { type: 'com.acorn.archive.stored' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.subject).toBe(COM);
  });

  it('get and search find the record', () => {
    expect(ctx.services.archive.get(TENANT, COM)?.id).toBe(recordId);
    expect(ctx.services.archive.search(TENANT, { customerId: 'cus_1' })).toHaveLength(1);
    expect(ctx.services.archive.search(TENANT, { templateId: 'tpl_1' })).toHaveLength(1);
    expect(ctx.services.archive.search(TENANT, { templateId: 'tpl_other' })).toHaveLength(0);
  });

  it('evidence pack collects every proof and verifies the event chain', () => {
    const pack = ctx.services.archive.evidencePack(TENANT, COM);
    expect(pack.record.id).toBe(recordId);
    expect(pack.proofs.proofOfDelivery).toHaveLength(1);
    expect(pack.proofs.proofOfAccess).toHaveLength(1);
    expect(pack.proofs.proofOfCustomerAction).toHaveLength(1);
    expect(pack.proofs.proofOfAiChanges).toHaveLength(1);
    expect(pack.proofs.proofOfContent.dataSnapshotHash).toBe('snap-hash');
    expect(Object.keys(pack.proofs.proofOfContent.artifactHashes).sort()).toEqual(['html', 'text']);
    expect(pack.proofs.proofOfVersion).toEqual({
      templateVersionId: 'tpv_1',
      contentVersionIds: ['cnv_1'],
    });
    expect(pack.eventChain.intact).toBe(true);
    expect(pack.eventChain.length).toBeGreaterThan(0);
  });

  it('verifyReproducibility matches, then fails after manifest tampering', async () => {
    const ok = await ctx.services.archive.verifyReproducibility(TENANT, COM);
    expect(ok).toEqual({ reproducible: true, detail: 'html: match, text: match' });

    // tamper with the stored manifest hash for the html artifact
    const records = ctx.store.collection<ArchiveRecord>('archiveRecords');
    const record = records.getFor(TENANT, recordId)!;
    records.put({
      ...record,
      manifest: {
        ...record.manifest,
        artifacts: record.manifest.artifacts.map((a) =>
          a.format === 'html' ? { ...a, sha256: '0'.repeat(64) } : a,
        ),
      },
    });

    const bad = await ctx.services.archive.verifyReproducibility(TENANT, COM);
    expect(bad.reproducible).toBe(false);
    expect(bad.detail).toContain('html: mismatch');
    expect(bad.detail).toContain('text: match');
  });

  it('setLegalHold is forbidden for non-compliance roles and works for compliance', () => {
    const operator: RequestCtx = {
      tenantId: TENANT, actorId: 'usr_ops', roles: ['operator'], keyId: 'key_ops',
    };
    expect(() => ctx.services.archive.setLegalHold(operator, recordId, true)).toThrowError(
      PlatformError,
    );
    try {
      ctx.services.archive.setLegalHold(operator, recordId, true);
    } catch (err) {
      expect((err as PlatformError).status).toBe(403);
    }

    const compliance: RequestCtx = { ...operator, roles: ['compliance-approver'] };
    expect(ctx.services.archive.setLegalHold(compliance, recordId, true).legalHold).toBe(true);
    expect(ctx.services.archive.get(TENANT, COM)?.legalHold).toBe(true);
  });
});
