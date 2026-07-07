import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import { EventLog } from '../src/kernel/events.js';
import type {
  ArchiveRecord,
  Communication,
  ComposedDocument,
  Customer,
  RenderArtifact,
  RequestCtx,
  SecureLink,
} from '../src/kernel/contracts.js';
import { createLifecycleService } from '../src/domains/lifecycle/index.js';
import { backup, restore, verify } from '../src/tools/backup.js';

const TENANT = 'ten_lifecycle';
const CUS = 'cus_1';

const compliance: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_compliance',
  roles: ['compliance-approver'],
  keyId: 'key_c',
};
const operator: RequestCtx = { ...compliance, actorId: 'usr_ops', roles: ['operator'], keyId: 'key_o' };

function doc(name: string): ComposedDocument {
  return {
    title: 'Statement',
    brand: { name: 'Acorn', primaryColor: '#004400', accentColor: '#88cc66', logoText: 'Acorn' },
    customerName: name,
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [
      {
        id: 'sec-summary',
        title: 'Summary',
        collapsible: false,
        lines: [
          { kind: 'text', text: `Dear ${name}, your balance is $120.00` },
          { kind: 'field-row', label: 'Account', value: '****1234' },
        ],
      },
    ],
    contentVersionIds: ['cnv_1'],
  };
}

describe('lifecycle domain', () => {
  let ctx: PlatformContext;
  let dataDir: string;
  let sharedKey: string;
  let uniqueKey: string;
  let snap1Key: string;
  let snap2Key: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-'));
    ctx = createBaseContext(configFromEnv({ dataDir }));
    ctx.services.lifecycle = createLifecycleService(ctx);

    const now = new Date().toISOString();
    ctx.store.collection<Customer>('customers').put({
      id: CUS,
      tenantId: TENANT,
      externalRef: 'core-778899',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15550001111',
      locale: 'en-US',
      address: { line1: '1 Oak St', city: 'Acton', region: 'MA', postalCode: '01720', country: 'US' },
      createdAt: now,
    });

    // Real object-store blobs: two data snapshots, one artifact blob SHARED
    // by both communications (same bytes -> same content-addressed key) and
    // one unique to com_1.
    const snap1 = ctx.objects.put(TENANT, Buffer.from('{"balance":120}'), 'application/json');
    const snap2 = ctx.objects.put(TENANT, Buffer.from('{"balance":98}'), 'application/json');
    const shared = ctx.objects.put(TENANT, Buffer.from('<h1>shared render</h1>'), 'text/html');
    const sharedAgain = ctx.objects.put(TENANT, Buffer.from('<h1>shared render</h1>'), 'text/html');
    const unique = ctx.objects.put(TENANT, Buffer.from('%PDF unique to com_1'), 'application/pdf');
    expect(sharedAgain.key).toBe(shared.key); // dedupe precondition
    snap1Key = snap1.key;
    snap2Key = snap2.key;
    sharedKey = shared.key;
    uniqueKey = unique.key;

    const communications = ctx.store.collection<Communication>('communications');
    const artifacts = ctx.store.collection<RenderArtifact>('artifacts');
    for (const [comId, snap] of [
      ['com_1', snap1],
      ['com_2', snap2],
    ] as const) {
      communications.put({
        id: comId,
        tenantId: TENANT,
        templateId: 'tpl_1',
        templateVersionId: 'tpv_1',
        customerId: CUS,
        status: 'archived',
        dataSnapshotKey: snap.key,
        dataSnapshotHash: snap.sha256,
        composed: doc('Jane Doe'),
        createdAt: now,
      });
      artifacts.put({
        id: `art_${comId}_html`,
        tenantId: TENANT,
        communicationId: comId,
        format: 'html',
        objectKey: shared.key,
        sha256: shared.sha256,
        size: shared.size,
        contentType: 'text/html',
        renderedAt: now,
        rendererVersion: 'r/1',
      });
    }
    artifacts.put({
      id: 'art_com_1_pdf',
      tenantId: TENANT,
      communicationId: 'com_1',
      format: 'pdf',
      objectKey: unique.key,
      sha256: unique.sha256,
      size: unique.size,
      contentType: 'application/pdf',
      renderedAt: now,
      rendererVersion: 'r/1',
    });

    const records = ctx.store.collection<ArchiveRecord>('archiveRecords');
    for (const [recId, comId, snap, hold] of [
      ['arc_1', 'com_1', snap1, true],
      ['arc_2', 'com_2', snap2, false],
    ] as const) {
      records.put({
        id: recId,
        tenantId: TENANT,
        communicationId: comId,
        customerId: CUS,
        templateVersionId: 'tpv_1',
        storedAt: now,
        retentionClass: 'standard-7y',
        legalHold: hold,
        manifest: {
          dataSnapshotKey: snap.key,
          dataSnapshotHash: snap.sha256,
          templateVersionId: 'tpv_1',
          contentVersionIds: ['cnv_1'],
          artifacts: [{ format: 'html', objectKey: shared.key, sha256: shared.sha256 }],
          rendererVersion: 'r/1',
        },
      });
    }

    const links = ctx.store.collection<SecureLink>('secureLinks');
    links.put({
      id: 'lnk_expired',
      tenantId: TENANT,
      communicationId: 'com_1',
      customerId: CUS,
      token: 'tok-expired',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      createdAt: now,
    });
    links.put({
      id: 'lnk_live',
      tenantId: TENANT,
      communicationId: 'com_2',
      customerId: CUS,
      token: 'tok-live',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: now,
    });
  });

  it('sweep revokes only expired links; a second sweep is a no-op with no duplicate event', async () => {
    const first = await ctx.services.lifecycle.sweep();
    expect(first).toEqual({ expiredLinksRevoked: 1, retentionDue: 0 });

    const links = ctx.store.collection<SecureLink>('secureLinks');
    expect(links.get('lnk_expired')?.revokedAt).toBeDefined();
    expect(links.get('lnk_live')?.revokedAt).toBeUndefined();
    expect(ctx.log.query(TENANT, { type: 'com.acorn.lifecycle.sweep' })).toHaveLength(1);

    const second = await ctx.services.lifecycle.sweep();
    expect(second).toEqual({ expiredLinksRevoked: 0, retentionDue: 0 });
    // no-op sweep must not add noise to the event log
    expect(ctx.log.query(TENANT, { type: 'com.acorn.lifecycle.sweep' })).toHaveLength(1);
  });

  it('erasure is blocked by legal hold without changing anything', async () => {
    const report = await ctx.services.lifecycle.eraseCustomer(compliance, CUS, 'GDPR art.17 request');
    expect(report.erased).toBe(false);
    expect(report.blockedBy).toEqual(['arc_1']);
    expect(report.redactedCustomerFields).toBe(0);
    expect(report.deletedObjects).toBe(0);

    const customer = ctx.store.collection<Customer>('customers').get(CUS)!;
    expect(customer.email).toBe('jane@example.com');
    expect(customer.name).toBe('Jane Doe');
    expect(existsSync(join(dataDir, 'objects', uniqueKey))).toBe(true);
  });

  it('rejects operator role and invalid reasons', async () => {
    await expect(ctx.services.lifecycle.eraseCustomer(operator, CUS, 'valid reason')).rejects.toThrowError(
      PlatformError,
    );
    await expect(
      ctx.services.lifecycle.eraseCustomer(operator, CUS, 'valid reason'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(ctx.services.lifecycle.eraseCustomer(compliance, CUS, 'no')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      ctx.services.lifecycle.eraseCustomer(compliance, 'cus_missing', 'valid reason'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('erases after the legal hold is released, sparing shared blobs and the event chain', async () => {
    const records = ctx.store.collection<ArchiveRecord>('archiveRecords');
    records.put({ ...records.get('arc_1')!, legalHold: false });

    const report = await ctx.services.lifecycle.eraseCustomer(compliance, CUS, 'GDPR art.17 request');
    expect(report.erased).toBe(true);
    expect(report.blockedBy).toEqual([]);
    expect(report.redactedCustomerFields).toBe(5); // name, email, phone, address, externalRef
    expect(report.revokedLinks).toBe(1); // lnk_live (lnk_expired already revoked by sweep)
    expect(report.deletedObjects).toBe(3); // snap1, snap2, unique pdf
    expect(report.tombstonedArchiveRecords).toBe(2);

    // customer PII gone, id + locale kept
    const customer = ctx.store.collection<Customer>('customers').get(CUS)!;
    expect(customer.name).toBe('[erased]');
    expect(customer.email).toBeUndefined();
    expect(customer.phone).toBeUndefined();
    expect(customer.address).toBeUndefined();
    expect(customer.externalRef).toBeUndefined();
    expect(customer.locale).toBe('en-US');

    // links all revoked
    const links = ctx.store.collection<SecureLink>('secureLinks');
    expect(links.get('lnk_live')?.revokedAt).toBeDefined();

    // unique + snapshot blobs deleted; SHARED blob survives (still referenced
    // by the other communication in the content-addressed store)
    expect(existsSync(join(dataDir, 'objects', uniqueKey))).toBe(false);
    expect(existsSync(join(dataDir, 'objects', `${uniqueKey}.meta.json`))).toBe(false);
    expect(existsSync(join(dataDir, 'objects', snap1Key))).toBe(false);
    expect(existsSync(join(dataDir, 'objects', snap2Key))).toBe(false);
    expect(existsSync(join(dataDir, 'objects', sharedKey))).toBe(true);

    // archive records tombstoned but hash evidence kept
    for (const recId of ['arc_1', 'arc_2']) {
      const record = records.get(recId)!;
      expect(record.manifest.artifacts).toEqual([]);
      expect(record.manifest.dataSnapshotKey).toBe('[erased]');
      expect(record.manifest.dataSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    }

    // composed documents redacted, section structure kept
    for (const comId of ['com_1', 'com_2']) {
      const comm = ctx.store.collection<Communication>('communications').get(comId)!;
      expect(comm.composed.customerName).toBe('[erased]');
      expect(comm.composed.sections[0]!.id).toBe('sec-summary');
      expect(comm.composed.sections[0]!.title).toBe('Summary');
      expect(comm.composed.sections[0]!.lines).toEqual([
        { kind: 'text', text: '[content erased at customer request]' },
      ]);
      expect(comm.status).toBe('archived');
    }

    // erasure audited; the hash-chained event log is NOT rewritten and intact
    const events = ctx.log.query(TENANT, { type: 'com.acorn.lifecycle.erasure' });
    expect(events.length).toBe(2); // blocked attempt + successful erasure
    expect(events.at(-1)!.subject).toBe(CUS);
    expect(ctx.log.verifyChain(TENANT).intact).toBe(true);
  });

  it('backup -> restore -> verify round-trips the data dir with the chain intact', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'acorn-bak-'));
    const archive = join(scratch, 'acorn.tgz');

    const manifest = backup(dataDir, archive);
    expect(manifest.fileCount).toBeGreaterThan(0);
    expect(manifest.totalBytes).toBeGreaterThan(0);
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(archive)).toBe(true);

    // refuses a non-empty target
    expect(() => restore(archive, dataDir)).toThrowError(/non-empty/);

    const restoreDir = mkdtempSync(join(tmpdir(), 'acorn-restore-'));
    const restored = restore(archive, restoreDir);
    expect(restored.fileCount).toBe(manifest.fileCount);
    expect(restored.fileCount).toBeGreaterThan(0);

    const result = verify(restoreDir);
    expect(result.ok).toBe(true);
    const tenant = result.tenants.find((t) => t.tenantId === TENANT);
    expect(tenant?.intact).toBe(true);
    expect(tenant?.length).toBeGreaterThan(0);

    // independent check through the kernel EventLog on the restored copy
    const log = new EventLog(join(restoreDir, 'events'));
    expect(log.verifyChain(TENANT)).toMatchObject({ intact: true, brokenAtSeq: null });
  });
});
