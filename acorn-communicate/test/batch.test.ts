/**
 * HIGH-VOLUME BATCH PRODUCTION domain tests — worker-pool concurrency, error
 * rows, pause/resume restartability (no duplicate compose), mapping profile
 * path, and the platform/11 throughput benchmark. Peer services are stubbed
 * for speed and determinism.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  Communication,
  CompositionService,
  Customer,
  DeliveryService,
  MappingService,
  RequestCtx,
  TemplateService,
  TemplateVersion,
} from '../src/kernel/contracts.js';
import { createBatchService } from '../src/domains/batch/index.js';

const TENANT = 'ten_batch';

describe('batch domain', () => {
  let ctx: PlatformContext;
  let rctx: RequestCtx;
  let customerIds: string[] = [];

  // compose stub state
  let composeDelay = 2;
  let current = 0;
  let maxInFlight = 0;
  let n = 0;
  const failIds = new Set<string>();

  const compose = vi.fn(async ({ customerId, data }: { customerId: string; data: Record<string, unknown> }) => {
    current++;
    maxInFlight = Math.max(maxInFlight, current);
    await new Promise((r) => setTimeout(r, composeDelay));
    current--;
    if (failIds.has(customerId)) throw new Error('boom');
    void data;
    return { id: `com_${++n}` } as Communication;
  });
  const deliver = vi.fn(async () => []);
  const mappingApply = vi.fn((_t: string, _p: string, r: Record<string, unknown>) => ({ ...r, mapped: true }));

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    rctx = { tenantId: TENANT, actorId: 'usr_1', roles: ['operator'], keyId: 'key_1' };

    const fixtureVersion = { id: 'tpv_1', templateId: 'tpl_1' } as unknown as TemplateVersion;
    ctx.services.templates = {
      publishedVersion: () => fixtureVersion,
    } as unknown as TemplateService;
    ctx.services.composition = { compose } as unknown as CompositionService;
    ctx.services.delivery = { deliver } as unknown as DeliveryService;
    ctx.services.mapping = { apply: mappingApply } as unknown as MappingService;
    ctx.services.batch = createBatchService(ctx);

    // Seed 60 customers addressable by externalRef CUST-i.
    const customers = ctx.store.collection<Customer>('customers');
    customerIds = Array.from({ length: 60 }, (_, i) => {
      const customer: Customer = {
        id: `cus_${i}`,
        tenantId: TENANT,
        externalRef: `CUST-${i}`,
        name: `Customer ${i}`,
        email: `c${i}@example.com`,
        locale: 'en-US',
        createdAt: new Date().toISOString(),
      };
      customers.put(customer);
      return customer.id;
    });
  });

  beforeEach(() => {
    composeDelay = 2;
    current = 0;
    maxInFlight = 0;
    failIds.clear();
    compose.mockClear();
    deliver.mockClear();
    mappingApply.mockClear();
  });

  const makeRecords = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ customerRef: `CUST-${i % 60}`, amount: i }));

  it('runs 60 records through a bounded worker pool (concurrency 8)', async () => {
    const run = await ctx.services.batch.run(rctx, {
      templateId: 'tpl_1',
      records: makeRecords(60),
      concurrency: 8,
    });
    expect(run.status).toBe('completed');
    expect(run.total).toBe(60);
    expect(run.processed).toBe(60);
    expect(run.succeeded).toBe(60);
    expect(run.errors).toHaveLength(0);
    expect(run.communicationIds).toHaveLength(60);
    expect(deliver).toHaveBeenCalledTimes(60);
    // Proves pooling: parallel (not serial) but bounded by the pool width.
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it('records per-record errors with 1-based record numbers and keeps going', async () => {
    // Records 6, 21, 41 (1-based) hit failing customers.
    failIds.add(customerIds[5]!);
    failIds.add(customerIds[20]!);
    failIds.add(customerIds[40]!);
    const run = await ctx.services.batch.run(rctx, {
      templateId: 'tpl_1',
      records: makeRecords(60),
      concurrency: 8,
    });
    expect(run.status).toBe('completed'); // partial failure is still a completed run
    expect(run.processed).toBe(60);
    expect(run.succeeded).toBe(57);
    expect(run.errors).toHaveLength(3);
    expect(run.errors.map((e) => e.record).sort((a, b) => a - b)).toEqual([6, 21, 41]);
    for (const e of run.errors) expect(e.message).toContain('boom');
  });

  it('pauses mid-run and resumes from the checkpoint without duplicate composes', async () => {
    composeDelay = 4; // 60 records / concurrency 4 → ~60ms+, so a 15ms pause lands mid-run
    const records = makeRecords(60);
    const running = ctx.services.batch.run(rctx, {
      templateId: 'tpl_1',
      records,
      concurrency: 4,
    });
    await new Promise((r) => setTimeout(r, 15));
    // Find the run id via list — run() has not resolved yet.
    const batchId = ctx.services.batch.list(rctx).find((b) => b.status === 'running')!.id;
    const paused = ctx.services.batch.pause(rctx, batchId);
    expect(paused.status).toBe('paused');

    const afterPhase1 = await running; // in-flight records drain, then the pool stops
    expect(afterPhase1.status).toBe('paused');
    expect(afterPhase1.processed).toBeGreaterThan(0);
    expect(afterPhase1.processed).toBeLessThan(60);
    const phase1Composes = compose.mock.calls.length;
    expect(phase1Composes).toBeLessThan(60);

    const resumed = await ctx.services.batch.resume(rctx, batchId, records);
    expect(resumed.status).toBe('completed');
    expect(resumed.processed).toBe(60);
    expect(resumed.succeeded).toBe(60);
    expect(resumed.communicationIds).toHaveLength(60);
    // Restartability: already-done indexes are skipped — exactly 60 composes total.
    expect(compose.mock.calls.length).toBe(60);
  });

  it('applies the mapping profile per record before compose', async () => {
    const run = await ctx.services.batch.run(rctx, {
      templateId: 'tpl_1',
      records: makeRecords(5),
      concurrency: 2,
      mappingProfileId: 'map_1',
    });
    expect(run.succeeded).toBe(5);
    expect(mappingApply).toHaveBeenCalledTimes(5);
    expect(mappingApply).toHaveBeenCalledWith(TENANT, 'map_1', expect.objectContaining({ customerRef: 'CUST-0' }));
    // The mapped output reaches compose.
    expect(compose).toHaveBeenCalledTimes(5);
    for (const [args] of compose.mock.calls) {
      expect((args as { data: Record<string, unknown> }).data.mapped).toBe(true);
    }
  });

  it('validates inputs', async () => {
    await expect(ctx.services.batch.run(rctx, { templateId: 'tpl_1', records: [] })).rejects.toThrow(
      /non-empty/,
    );
    await expect(
      ctx.services.batch.resume(rctx, 'bat_missing', makeRecords(1)),
    ).rejects.toThrow(/not found/);
  });

  it('throughput benchmark: 500 records at concurrency 16 exceed 100/s', async () => {
    composeDelay = 1;
    const run = await ctx.services.batch.run(rctx, {
      templateId: 'tpl_1',
      records: makeRecords(500),
      concurrency: 16,
    });
    expect(run.status).toBe('completed');
    expect(run.processed).toBe(500);
    expect(run.perSecond).toBeGreaterThan(100);
    console.log('batch throughput', run.perSecond, '/s');
  });
});
