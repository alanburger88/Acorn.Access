/**
 * HIGH-VOLUME BATCH PRODUCTION bounded context — runs large record sets
 * through compose(+deliver) with a bounded worker pool, checkpointed
 * restartability (platform/11), pause/resume, and throughput reporting.
 *
 * Exposes `createBatchService` (implements BatchService from
 * kernel/contracts.ts) and `registerBatchRoutes` (/v1 HTTP surface).
 *
 * Restartability design: workers pull record indexes from a shared cursor, so
 * records are ASSIGNED in index order but COMPLETE out of order. The contract
 * field `processed` counts completions; to make resume deterministic the run
 * row carries a domain-local extension `done: number[]` — the set of 0-based
 * record indexes that fully finished (compose + optional deliver). resume()
 * re-runs exactly the indexes NOT in `done`, so a record is never composed
 * twice regardless of completion order at pause/crash time. `processed` is
 * always `done.length`. Bounded memory: at the 50k record cap the array is a
 * few hundred KB — fine for the reference store.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BatchRun, BatchService, Customer } from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/batch';

const MAX_RECORDS = 50_000;
const MAX_CONCURRENCY = 32;
const DEFAULT_CONCURRENCY = 8;
/**
 * Persist the run row every N completed records. The checkpoint interval
 * trades write amplification (persisting the row after every record would
 * rewrite the collection file 50k times) against the replay window on
 * crash-resume (at most N-1 records re-run) — per platform/11 restartability.
 */
const CHECKPOINT_INTERVAL = 25;
/**
 * errors[] is capped at this many entries to bound row size on pathological
 * batches; `processed` and `succeeded` stay accurate beyond the cap, so the
 * TRUE failure count is always `processed - succeeded` even when the array
 * is truncated.
 */
const ERROR_CAP = 200;

/** Stored row — BatchRun plus domain-local resume bookkeeping. */
interface BatchRow extends BatchRun {
  /** 0-based record indexes fully processed (see module comment). */
  done: number[];
  /** mapping profile applied per record before compose, when requested */
  mappingProfileId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createBatchService(ctx: PlatformContext): BatchService {
  const runs = ctx.store.collection<BatchRow>('batchRuns');
  const customers = ctx.store.collection<Customer>('customers');
  /** Pause flags for pools currently executing in this process, by batch id. */
  const active = new Map<string, { paused: boolean }>();

  function mustGet(tenantId: string, batchId: string): BatchRow {
    const row = runs.getFor(tenantId, batchId);
    if (!row) throw notFound('batch run', batchId);
    return row;
  }

  /** Resolve `customerRef` (or `customerId`) by Customer.id OR externalRef. */
  function resolveCustomer(tenantId: string, record: Record<string, unknown>): Customer {
    const ref = record.customerRef ?? record.customerId;
    if (typeof ref === 'string' && ref.length > 0) {
      const byId = customers.getFor(tenantId, ref);
      if (byId) return byId;
      const byExternalRef = customers.list(tenantId, (c) => c.externalRef === ref).at(0);
      if (byExternalRef) return byExternalRef;
    }
    throw new Error('unknown customer');
  }

  /**
   * Worker-pool executor shared by run() and resume(). Maintains
   * `row.concurrency` in-flight promises pulling the next record index from a
   * shared cursor (classic pool: not serial, never more than `concurrency`
   * in flight). Indexes already in `done` are skipped (resume path).
   */
  async function execute(row: BatchRow, records: Record<string, unknown>[]): Promise<BatchRun> {
    const flag = { paused: false };
    active.set(row.id, flag);
    const done = new Set<number>(row.done);
    let cursor = 0; // shared pool cursor — workers claim indexes atomically (single-threaded JS)
    let sinceCheckpoint = 0;

    const checkpoint = () => {
      row.done = [...done];
      row.processed = done.size;
      runs.put(row);
    };

    async function processRecord(index: number): Promise<void> {
      try {
        let record = records[index]!;
        // Optional per-record mapping — a profile/transform failure becomes a
        // per-record error row, not a batch failure.
        if (row.mappingProfileId) {
          record = ctx.services.mapping.apply(row.tenantId, row.mappingProfileId, record);
        }
        const customer = resolveCustomer(row.tenantId, record);
        const { customerRef: _ref, customerId: _cid, ...data } = record;
        const communication = await ctx.services.composition.compose({
          tenantId: row.tenantId,
          templateId: row.templateId,
          customerId: customer.id,
          data,
        });
        if (row.deliver) {
          await ctx.services.delivery.deliver({
            tenantId: row.tenantId,
            communicationId: communication.id,
          });
        }
        row.communicationIds.push(communication.id);
        row.succeeded++;
      } catch (err) {
        // Cap the ARRAY only — succeeded/processed stay accurate (see ERROR_CAP).
        if (row.errors.length < ERROR_CAP) {
          row.errors.push({
            record: index + 1, // 1-based record number for operator-facing reports
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // CHECKPOINT: processed advances after EACH record finishes; the row is
      // persisted every CHECKPOINT_INTERVAL records and at the end.
      done.add(index);
      row.processed = done.size;
      if (++sinceCheckpoint >= CHECKPOINT_INTERVAL) {
        sinceCheckpoint = 0;
        checkpoint();
      }
    }

    async function worker(): Promise<void> {
      // In-flight records finish; the paused flag only stops NEW claims.
      while (!flag.paused) {
        const index = cursor++;
        if (index >= row.total) return;
        if (done.has(index)) continue; // resume: already processed in a prior phase
        await processRecord(index);
      }
    }

    const width = Math.min(row.concurrency, row.total);
    await Promise.all(Array.from({ length: width }, () => worker()));
    active.delete(row.id);

    if (flag.paused) {
      row.status = 'paused';
      checkpoint();
      await ctx.publish({
        type: 'com.acorn.batch.paused',
        tenantId: row.tenantId,
        source: SOURCE,
        subject: row.id,
        data: { batchId: row.id, processed: row.processed },
      });
      return row;
    }

    const elapsedSeconds = (Date.now() - Date.parse(row.startedAt)) / 1000;
    row.status = row.succeeded === 0 ? 'failed' : 'completed';
    row.completedAt = new Date().toISOString();
    row.perSecond = Math.round((row.processed / Math.max(0.001, elapsedSeconds)) * 10) / 10;
    checkpoint();
    await ctx.publish({
      type: 'com.acorn.batch.completed',
      tenantId: row.tenantId,
      source: SOURCE,
      subject: row.id,
      data: {
        batchId: row.id,
        processed: row.processed,
        succeeded: row.succeeded,
        errors: row.processed - row.succeeded, // true failure count (errors[] may be capped)
        perSecond: row.perSecond,
      },
    });
    return row;
  }

  const service: BatchService = {
    async run(rctx, { templateId, records, concurrency = DEFAULT_CONCURRENCY, deliver = true, mappingProfileId }) {
      if (!Array.isArray(records) || records.length === 0) {
        throw invalid('records must be a non-empty array');
      }
      if (records.length > MAX_RECORDS) {
        throw invalid(`records exceeds the batch cap of ${MAX_RECORDS}`);
      }
      const width = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(concurrency)));
      const version = ctx.services.templates.publishedVersion(rctx.tenantId, templateId);
      if (!version) throw invalid(`template ${templateId} has no published version`);

      const row: BatchRow = {
        id: newId('bat'),
        tenantId: rctx.tenantId,
        templateId,
        status: 'running',
        concurrency: width,
        total: records.length,
        processed: 0,
        succeeded: 0,
        errors: [],
        deliver,
        startedAt: new Date().toISOString(),
        communicationIds: [],
        done: [],
        ...(mappingProfileId !== undefined ? { mappingProfileId } : {}),
      };
      runs.put(row);

      await ctx.publish({
        type: 'com.acorn.batch.started',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: row.id,
        data: { batchId: row.id, templateId, total: row.total, concurrency: width },
      });

      return execute(row, records);
    },

    async resume(rctx, batchId, records) {
      const row = mustGet(rctx.tenantId, batchId);
      if (row.status === 'running') throw invalid(`batch ${batchId} is already running`);
      if (row.status === 'completed') throw invalid(`batch ${batchId} already completed`);
      if (!Array.isArray(records) || records.length !== row.total) {
        throw invalid(`resume requires the original ${row.total} records (got ${Array.isArray(records) ? records.length : 0})`);
      }
      row.status = 'running';
      runs.put(row);
      return execute(row, records);
    },

    pause(rctx, batchId) {
      const row = mustGet(rctx.tenantId, batchId);
      const flag = active.get(row.id);
      if (row.status !== 'running' || !flag) throw invalid(`batch ${batchId} is not running`);
      // Consulted by the worker cursor loop: in-flight records finish, no new
      // ones start. The pool drain persists the final checkpoint and emits
      // batch.paused with the accurate processed count.
      flag.paused = true;
      row.status = 'paused';
      runs.put(row);
      return row;
    },

    get(rctx, batchId) {
      return mustGet(rctx.tenantId, batchId);
    },

    list(rctx) {
      return runs.list(rctx.tenantId);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const runSchema = z.object({
  templateId: z.string().min(1),
  records: z.array(z.record(z.unknown())),
  concurrency: z.number().int().optional(),
  deliver: z.boolean().optional(),
  mappingProfileId: z.string().min(1).optional(),
});

const resumeSchema = z.object({
  records: z.array(z.record(z.unknown())),
});

export function registerBatchRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const batch = () => ctx.services.batch;

  // NOTE: run() awaits full completion before responding — production runs
  // detached with progress polling (GET /v1/batches/:id); the reference
  // implementation is synchronous for determinism.
  app.post('/v1/batches', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']); // + tenant-admin implicitly
    const body = parseBody(runSchema, req.body);
    return batch().run(rctx, body);
  });

  app.get('/v1/batches', async (req) => {
    const rctx = requireAuth(ctx, req);
    return batch().list(rctx);
  });

  app.get('/v1/batches/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return batch().get(rctx, id);
  });

  app.post('/v1/batches/:id/pause', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']);
    const { id } = req.params as { id: string };
    return batch().pause(rctx, id);
  });

  app.post('/v1/batches/:id/resume', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']);
    const { id } = req.params as { id: string };
    const body = parseBody(resumeSchema, req.body);
    return batch().resume(rctx, id, body.records);
  });
}
