import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  ArchiveRecord,
  ReplicationRecord,
  ReplicationService,
  RequestCtx,
} from '../src/kernel/contracts.js';
import { createReplicationService } from '../src/domains/replication/index.js';
import { deriveSigningKey } from '../src/domains/replication/sigv4.js';

describe('replication domain', () => {
  const tenantId = 'ten_REPLTEST';
  const rctx: RequestCtx = {
    tenantId,
    actorId: 'usr_test',
    roles: ['tenant-admin'],
    keyId: 'key_test',
  };

  let ctx: PlatformContext;
  let service: ReplicationService;
  let server: Server;
  let fakeUrl: string;
  let failMode = false;
  const stored = new Map<string, Buffer>();
  const requests: {
    method?: string;
    path: string;
    headers: IncomingHttpHeaders;
    bodySha256: string;
  }[] = [];

  function seedArchive(c: PlatformContext, communicationId: string): ArchiveRecord {
    const html = c.objects.put(
      tenantId,
      Buffer.from(`<html><body>statement ${communicationId}</body></html>`),
      'text/html',
    );
    const text = c.objects.put(tenantId, Buffer.from(`statement ${communicationId}`), 'text/plain');
    const snap = c.objects.put(
      tenantId,
      Buffer.from(JSON.stringify({ account: { balanceDue: 42.5 }, com: communicationId })),
      'application/json',
    );
    const record: ArchiveRecord = {
      id: `arc_${communicationId}`,
      tenantId,
      communicationId,
      customerId: 'cus_1',
      templateVersionId: 'tpv_1',
      storedAt: new Date().toISOString(),
      retentionClass: 'standard-7y',
      legalHold: false,
      manifest: {
        dataSnapshotKey: snap.key,
        dataSnapshotHash: snap.sha256,
        templateVersionId: 'tpv_1',
        contentVersionIds: ['cnv_1'],
        artifacts: [
          { format: 'html', objectKey: html.key, sha256: html.sha256 },
          { format: 'text', objectKey: text.key, sha256: text.sha256 },
        ],
        rendererVersion: 'test-renderer-1',
      },
    };
    c.store.collection<ArchiveRecord>('archiveRecords').put(record);
    return record;
  }

  beforeAll(async () => {
    delete process.env.ACORN_S3_ENDPOINT;
    delete process.env.ACORN_S3_BUCKET;
    delete process.env.ACORN_S3_ACCESS_KEY;
    delete process.env.ACORN_S3_SECRET_KEY;
    delete process.env.ACORN_S3_REGION;

    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        requests.push({
          method: req.method,
          path: req.url ?? '',
          headers: req.headers,
          bodySha256: createHash('sha256').update(body).digest('hex'),
        });
        if (failMode) {
          res.statusCode = 500;
          res.end('simulated outage');
          return;
        }
        if (req.method === 'PUT') stored.set(req.url ?? '', body);
        res.statusCode = 200;
        res.end('');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no server port');
    fakeUrl = `http://127.0.0.1:${address.port}`;

    service = createReplicationService(ctx, {
      endpoint: fakeUrl,
      bucket: 'test-bucket',
      accessKey: 'AKIATEST',
      secretKey: 'secret',
      region: 'us-east-1',
    });
    ctx.services.replication = service;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('replicates manifest + artifacts + snapshot to the S3 target', async () => {
    const arc = seedArchive(ctx, 'com_A');
    const record = await service.replicate(tenantId, 'com_A');

    expect(record.status).toBe('replicated');
    expect(record.attempts).toBe(1);
    expect(record.objectsReplicated).toBe(4); // 2 artifacts + snapshot + manifest
    expect(record.bucketKeyPrefix).toBe(`acorn/${tenantId}/com_A/`);

    const prefix = `/test-bucket/acorn/${tenantId}/com_A/`;
    expect(stored.has(`${prefix}manifest.json`)).toBe(true);
    expect(stored.has(`${prefix}artifacts/html`)).toBe(true);
    expect(stored.has(`${prefix}artifacts/text`)).toBe(true);
    expect(stored.has(`${prefix}data-snapshot.json`)).toBe(true);

    const manifest = JSON.parse(stored.get(`${prefix}manifest.json`)!.toString('utf8'));
    expect(manifest).toEqual(arc.manifest);

    const status = service.status(rctx);
    expect(status.enabled).toBe(true);
    expect(status.replicated).toBe(1);
    expect(status.records.some((r) => r.communicationId === 'com_A')).toBe(true);
  });

  it('signs every request with SigV4 headers matching the actual payload', () => {
    expect(requests.length).toBeGreaterThan(0);
    for (const req of requests) {
      expect(req.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/,
      );
      expect(req.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      // the declared content hash must equal the sha256 of the received body
      expect(req.headers['x-amz-content-sha256']).toBe(req.bodySha256);
    }
  });

  it('derives the signing key per the official AWS known-answer vector', () => {
    const key = deriveSigningKey(
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      '20120215',
      'us-east-1',
      'iam',
    );
    expect(key.toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });

  it('records failure on 500s, then succeeds on retry with attempts incremented', async () => {
    seedArchive(ctx, 'com_B');

    failMode = true;
    const failed = await service.replicate(tenantId, 'com_B');
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toContain('500');

    failMode = false;
    const recovered = await service.replicate(tenantId, 'com_B');
    expect(recovered.id).toBe(failed.id); // one record per communication, upserted
    expect(recovered.status).toBe('replicated');
    expect(recovered.attempts).toBe(2);
    expect(recovered.lastError).toBeUndefined();
    expect(recovered.objectsReplicated).toBe(4);
  });

  it('without config: disabled, silent on bus events, manual replicate → skipped', async () => {
    const ctx2 = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    const disabled = createReplicationService(ctx2); // no override, no ACORN_S3_* env
    expect(disabled.enabled()).toBe(false);

    seedArchive(ctx2, 'com_D');
    await ctx2.publish({
      type: 'com.acorn.archive.stored',
      tenantId,
      source: '/domains/archive',
      subject: 'com_D',
      data: { communicationId: 'com_D', customerId: 'cus_1', recordId: 'arc_com_D' },
    });
    // handler records nothing when replication is not configured
    expect(ctx2.store.collection<ReplicationRecord>('replicationRecords').list(tenantId)).toHaveLength(0);

    const record = await disabled.replicate(tenantId, 'com_D');
    expect(record.status).toBe('skipped');
    expect(record.objectsReplicated).toBe(0);
  });

  it('end-to-end: archive.stored on the bus triggers replication', async () => {
    seedArchive(ctx, 'com_C');
    await ctx.publish({
      type: 'com.acorn.archive.stored',
      tenantId,
      source: '/domains/archive',
      subject: 'com_C',
      data: { communicationId: 'com_C', customerId: 'cus_1', recordId: 'arc_com_C' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const record = ctx.store
      .collection<ReplicationRecord>('replicationRecords')
      .list(tenantId, (r) => r.communicationId === 'com_C')
      .at(0);
    expect(record).toBeDefined();
    expect(record!.status).toBe('replicated');
    expect(stored.has(`/test-bucket/acorn/${tenantId}/com_C/manifest.json`)).toBe(true);

    const completed = ctx.log.query(tenantId, { type: 'com.acorn.replication.completed' });
    expect(completed.some((e) => e.subject === 'com_C')).toBe(true);
  });
});
