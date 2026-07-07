/**
 * INGESTION bounded context — batch intake (JSON array or CSV), per-record
 * customer resolution, compose+deliver fan-out, PII scanning, and job
 * tracking.
 *
 * Exposes `createIngestionService` (implements IngestionService from
 * kernel/contracts.ts) and `registerIngestionRoutes` (/v1 HTTP surface).
 * Record validation itself happens inside CompositionService.compose (data
 * contract enforcement) — a compose failure becomes a per-record error row.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Customer, IngestionJob, IngestionService } from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { parseCsv } from './csv.js';
import { scanPii } from './pii.js';

const SOURCE = '/domains/ingestion';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createIngestionService(ctx: PlatformContext): IngestionService {
  const jobs = ctx.store.collection<IngestionJob>('ingestionJobs');
  const customers = ctx.store.collection<Customer>('customers');

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

  function parseRecords(sourceFormat: 'json' | 'csv', payload: string): Record<string, unknown>[] {
    if (sourceFormat === 'csv') return parseCsv(payload);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      throw invalid(`payload is not valid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw invalid('json payload must be an array of records');
    return parsed as Record<string, unknown>[];
  }

  const service: IngestionService = {
    async ingestBatch({ ctx: rctx, templateId, sourceFormat, payload, deliver }) {
      const version = ctx.services.templates.publishedVersion(rctx.tenantId, templateId);
      if (!version) throw invalid(`template ${templateId} has no published version`);

      const records = parseRecords(sourceFormat, payload);

      let job: IngestionJob = {
        id: newId('ing'),
        tenantId: rctx.tenantId,
        templateId,
        sourceFormat,
        status: 'received',
        receivedAt: new Date().toISOString(),
        recordCount: records.length,
        validCount: 0,
        errorCount: 0,
        errors: [],
        piiFindings: [],
        communicationIds: [],
      };
      jobs.put(job);

      const errors: { record: number; message: string }[] = [];
      const communicationIds: string[] = [];
      for (let i = 0; i < records.length; i++) {
        const n = i + 1;
        try {
          const record = records[i]!;
          const customer = resolveCustomer(rctx.tenantId, record);
          const { customerRef: _ref, customerId: _cid, ...data } = record;
          const communication = await ctx.services.composition.compose({
            tenantId: rctx.tenantId,
            templateId,
            customerId: customer.id,
            data,
          });
          communicationIds.push(communication.id);
          if (deliver !== false) {
            await ctx.services.delivery.deliver({
              tenantId: rctx.tenantId,
              communicationId: communication.id,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ record: n, message: `record ${n}: ${message}` });
        }
      }

      const validCount = communicationIds.length;
      job = {
        ...job,
        status: validCount > 0 ? 'completed' : errors.length > 0 ? 'failed' : 'completed',
        completedAt: new Date().toISOString(),
        recordCount: records.length,
        validCount,
        errorCount: errors.length,
        errors,
        piiFindings: scanPii(payload),
        communicationIds,
      };
      jobs.put(job);

      await ctx.publish({
        type: 'com.acorn.ingestion.completed',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: job.id,
        data: {
          jobId: job.id,
          templateId,
          recordCount: job.recordCount,
          validCount: job.validCount,
          errorCount: job.errorCount,
        },
      });
      return job;
    },

    getJob(rctx, jobId) {
      const job = jobs.getFor(rctx.tenantId, jobId);
      if (!job) throw notFound('ingestion job', jobId);
      return job;
    },

    listJobs(rctx) {
      return jobs.list(rctx.tenantId);
    },

    scanPii(payload) {
      return scanPii(payload);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const ingestBatchSchema = z.object({
  templateId: z.string().min(1),
  sourceFormat: z.enum(['json', 'csv']),
  payload: z.string(),
  deliver: z.boolean().optional(),
});

const piiScanSchema = z.object({ payload: z.string() });

export function registerIngestionRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const ingestion = () => ctx.services.ingestion;

  app.post('/v1/ingestion/batches', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']); // + tenant-admin implicitly
    const body = parseBody(ingestBatchSchema, req.body);
    return ingestion().ingestBatch({ ctx: rctx, ...body });
  });

  app.get('/v1/ingestion/jobs', async (req) => {
    const rctx = requireAuth(ctx, req);
    return ingestion().listJobs(rctx);
  });

  app.get('/v1/ingestion/jobs/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return ingestion().getJob(rctx, id);
  });

  app.post('/v1/ingestion/pii-scan', async (req) => {
    requireAuth(ctx, req);
    const body = parseBody(piiScanSchema, req.body);
    return { findings: ingestion().scanPii(body.payload) };
  });
}
