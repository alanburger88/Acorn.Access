import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { createUsageService } from '../src/domains/usage/index.js';

const TENANT = 'ten_usage';
const PERIOD = new Date().toISOString().slice(0, 7);

describe('usage domain', () => {
  let ctx: PlatformContext;
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-'));
    ctx = createBaseContext(configFromEnv({ dataDir }));
    ctx.services.usage = createUsageService(ctx);
  });

  it('meters lifecycle events published on the bus', async () => {
    await ctx.publish({
      type: 'com.acorn.communication.rendered',
      tenantId: TENANT,
      source: '/domains/composition',
      subject: 'com_1',
      data: { communicationId: 'com_1', customerId: 'cus_1', formats: ['html', 'pdf', 'email-html'] },
    });
    await ctx.publish({
      type: 'com.acorn.delivery.attempted',
      tenantId: TENANT,
      source: '/domains/delivery',
      subject: 'com_1',
      data: { communicationId: 'com_1', customerId: 'cus_1', channel: 'email', attemptId: 'dlv_1' },
    });
    await ctx.publish({
      type: 'com.acorn.ai.invoked',
      tenantId: TENANT,
      source: '/domains/ai',
      subject: 'com_1',
      data: { invocationId: 'aii_1', task: 'assistant-answer', model: 'sim', confidence: 0.9 },
    });
    // sent/delivered pairs must NOT double count (only 'attempted' is metered)
    await ctx.publish({
      type: 'com.acorn.delivery.sent',
      tenantId: TENANT,
      source: '/domains/delivery',
      subject: 'com_1',
      data: { communicationId: 'com_1', customerId: 'cus_1', channel: 'email', attemptId: 'dlv_1' },
    });
    await ctx.publish({
      type: 'com.acorn.delivery.delivered',
      tenantId: TENANT,
      source: '/domains/delivery',
      subject: 'com_1',
      data: { communicationId: 'com_1', customerId: 'cus_1', channel: 'email', attemptId: 'dlv_1' },
    });
    // unknown event types are skipped silently
    await ctx.publish({
      type: 'com.acorn.something.unmapped',
      tenantId: TENANT,
      source: '/test',
      data: {},
    });

    const s = ctx.services.usage.summary(TENANT);
    expect(s.period).toBe(PERIOD);
    expect(s.metrics['renders']).toBe(3); // one per rendered format
    expect(s.metrics['deliveries.email']).toBe(1);
    expect(s.metrics['ai.invocations']).toBe(1);
  });

  it('summary computes estimatedCostUsd from reference rates; unknown metrics cost 0', () => {
    const tenant = 'ten_usage_cost';
    ctx.services.usage.record(tenant, 'renders', 100); // 100 * 0.002  = 0.2
    ctx.services.usage.record(tenant, 'deliveries.sms', 10); // 10 * 0.0079 = 0.079
    ctx.services.usage.record(tenant, 'ai.invocations', 3); // 3 * 0.01   = 0.03
    ctx.services.usage.record(tenant, 'custom.metric', 999); // unknown     = 0

    const s = ctx.services.usage.summary(tenant);
    expect(s.metrics).toEqual({
      'renders': 100,
      'deliveries.sms': 10,
      'ai.invocations': 3,
      'custom.metric': 999,
    });
    expect(s.rates['renders']).toBe(0.002);
    expect(s.rates['deliveries.sms']).toBe(0.0079);
    expect(s.rates['custom.metric']).toBe(0);
    expect(s.estimatedCostUsd).toBe(0.309);
    expect(ctx.services.usage.listPeriods(tenant)).toEqual([PERIOD]);
  });

  it('record() persists counters durably across service instances', () => {
    const tenant = 'ten_usage_durable';
    ctx.services.usage.record(tenant, 'archive.records', 7);

    // A second context + service over the SAME dataDir must see the counter.
    const ctx2 = createBaseContext(configFromEnv({ dataDir }));
    const usage2 = createUsageService(ctx2);
    expect(usage2.summary(tenant).metrics['archive.records']).toBe(7);
  });

  describe('checkRateLimit', () => {
    const saved = process.env.ACORN_RATE_LIMIT;

    afterEach(() => {
      if (saved === undefined) delete process.env.ACORN_RATE_LIMIT;
      else process.env.ACORN_RATE_LIMIT = saved;
    });

    it('allows N requests per window, blocks the N+1th, buckets independently', () => {
      process.env.ACORN_RATE_LIMIT = '5';
      const usage = createUsageService(createBaseContext(configFromEnv({
        dataDir: mkdtempSync(join(tmpdir(), 'acorn-')),
      })));

      for (let i = 1; i <= 5; i++) {
        const v = usage.checkRateLimit('key-a');
        expect(v.allowed).toBe(true);
        expect(v.limit).toBe(5);
        expect(v.remaining).toBe(5 - i);
      }
      const blocked = usage.checkRateLimit('key-a');
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBeLessThanOrEqual(0);
      expect(blocked.resetSeconds).toBeGreaterThan(0);
      expect(blocked.resetSeconds).toBeLessThanOrEqual(60);

      // separate bucket keys are independent
      const other = usage.checkRateLimit('key-b');
      expect(other.allowed).toBe(true);
      expect(other.remaining).toBe(4);
    });
  });
});
