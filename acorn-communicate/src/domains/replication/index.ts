/**
 * ARCHIVE REPLICATION bounded context — async offsite WORM copy of archived
 * communications to S3-compatible object storage (platform/06 retention,
 * platform/04 storage tiering).
 *
 * Exposes `createReplicationService` (implements ReplicationService from
 * kernel/contracts.ts) and `registerReplicationRoutes` (/v1 HTTP surface).
 * The factory subscribes to `com.acorn.archive.stored` so every archived
 * communication is replicated automatically when a target is configured.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  ArchiveRecord,
  ReplicationRecord,
  ReplicationService,
  Role,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { signRequest } from './sigv4.js';

const SOURCE = '/domains/replication';

/** Tries per object before giving up (transient-failure tolerance). */
const TRIES_PER_OBJECT = 2;

export interface S3Config {
  endpoint: string; // e.g. http://127.0.0.1:9000
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

const sha256Hex = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createReplicationService(
  ctx: PlatformContext,
  cfgOverride?: Partial<S3Config>,
): ReplicationService {
  const cfg: S3Config = {
    endpoint: cfgOverride?.endpoint ?? process.env.ACORN_S3_ENDPOINT ?? '',
    bucket: cfgOverride?.bucket ?? process.env.ACORN_S3_BUCKET ?? '',
    accessKey: cfgOverride?.accessKey ?? process.env.ACORN_S3_ACCESS_KEY ?? '',
    secretKey: cfgOverride?.secretKey ?? process.env.ACORN_S3_SECRET_KEY ?? '',
    region: cfgOverride?.region ?? process.env.ACORN_S3_REGION ?? 'us-east-1',
  };

  const records = ctx.store.collection<ReplicationRecord>('replicationRecords');
  const archiveRecords = ctx.store.collection<ArchiveRecord>('archiveRecords');

  /** PUT one object to the S3 target with SigV4-signed headers; 200 = success. */
  async function putObject(key: string, buf: Buffer, contentType: string): Promise<void> {
    const url = new URL(`${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}/${key}`);
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= TRIES_PER_OBJECT; attempt++) {
      try {
        const headers = signRequest({
          method: 'PUT',
          url,
          headers: { 'content-type': contentType },
          payloadSha256: sha256Hex(buf),
          accessKey: cfg.accessKey,
          secretKey: cfg.secretKey,
          region: cfg.region,
          service: 's3',
        });
        const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(buf) });
        await res.arrayBuffer().catch(() => undefined); // drain the body
        if (res.status === 200) return;
        lastError = `PUT ${key}: HTTP ${res.status}`;
      } catch (err) {
        lastError = `PUT ${key}: ${(err as Error).message}`;
      }
    }
    throw new Error(lastError);
  }

  const service: ReplicationService = {
    enabled() {
      return Boolean(cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey);
    },

    async replicate(tenantId, communicationId) {
      const bucketKeyPrefix = `acorn/${tenantId}/${communicationId}/`;
      // One replication record per communication, upserted across retries.
      const base: ReplicationRecord = records
        .list(tenantId, (r) => r.communicationId === communicationId)
        .at(0) ?? {
        id: newId('rpl'),
        tenantId,
        communicationId,
        status: 'skipped',
        attempts: 0,
        objectsReplicated: 0,
        bucketKeyPrefix,
        updatedAt: new Date().toISOString(),
      };

      if (!service.enabled()) {
        return records.put({ ...base, status: 'skipped', updatedAt: new Date().toISOString() });
      }

      const archive = archiveRecords
        .list(tenantId, (r) => r.communicationId === communicationId)
        .at(0);
      if (!archive) throw notFound('archive record for communication', communicationId);

      let objectsReplicated = 0;
      let lastError: string | undefined;
      const copy = async (key: string, buf: Buffer, contentType: string) => {
        try {
          await putObject(key, buf, contentType);
          objectsReplicated++;
        } catch (err) {
          lastError = (err as Error).message;
        }
      };

      // 1) rendered artifacts (skip objects that were erased from the store)
      for (const artifact of archive.manifest.artifacts) {
        const obj = ctx.objects.get(artifact.objectKey);
        if (!obj) continue;
        await copy(`${bucketKeyPrefix}artifacts/${artifact.format}`, obj.buf, obj.contentType);
      }
      // 2) the data snapshot (skip when erased)
      if (archive.manifest.dataSnapshotKey !== '[erased]') {
        const snapshot = ctx.objects.get(archive.manifest.dataSnapshotKey);
        if (snapshot) {
          await copy(`${bucketKeyPrefix}data-snapshot.json`, snapshot.buf, snapshot.contentType);
        }
      }
      // 3) the manifest itself — everything needed to locate/verify the copies
      await copy(
        `${bucketKeyPrefix}manifest.json`,
        Buffer.from(JSON.stringify(archive.manifest, null, 2)),
        'application/json',
      );

      const ok = lastError === undefined;
      const record = records.put({
        ...base,
        status: ok ? 'replicated' : 'failed',
        attempts: base.attempts + 1,
        objectsReplicated,
        bucketKeyPrefix,
        lastError: ok ? undefined : lastError,
        updatedAt: new Date().toISOString(),
      });

      if (ok) {
        await ctx.publish({
          type: 'com.acorn.replication.completed',
          tenantId,
          source: SOURCE,
          subject: communicationId,
          data: { communicationId, objectsReplicated },
        });
      } else {
        await ctx.publish({
          type: 'com.acorn.replication.failed',
          tenantId,
          source: SOURCE,
          subject: communicationId,
          data: { communicationId, error: lastError },
        });
      }
      return record;
    },

    status(rctx) {
      const all = records.list(rctx.tenantId);
      const newest = [...all].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 50);
      return {
        enabled: service.enabled(),
        replicated: all.filter((r) => r.status === 'replicated').length,
        failed: all.filter((r) => r.status === 'failed').length,
        records: newest,
      };
    },
  };

  // Auto-replicate every archived communication. When no target is configured
  // the handler records nothing (no noise rows). The promise is returned so
  // publishers awaiting the bus also await replication (errors are isolated).
  ctx.bus.on('com.acorn.archive.stored', async (e) => {
    if (!service.enabled() || !e.subject) return;
    await service.replicate(e.tenantid, e.subject).catch(() => {});
  });

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

export function registerReplicationRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const replication = () => ctx.services.replication;
  const statusRoles: Role[] = ['operator', 'auditor', 'tenant-admin'];
  const replicateRoles: Role[] = ['operator', 'tenant-admin'];

  app.get('/v1/replication/status', async (req) => {
    const rctx = requireAuth(ctx, req, statusRoles);
    return replication().status(rctx);
  });

  app.post('/v1/replication/:communicationId/replicate', async (req) => {
    const rctx = requireAuth(ctx, req, replicateRoles);
    if (!replication().enabled()) throw invalid('replication disabled — set ACORN_S3_* env');
    const { communicationId } = req.params as { communicationId: string };
    return replication().replicate(rctx.tenantId, communicationId);
  });
}
