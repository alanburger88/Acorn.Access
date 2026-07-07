import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  Communication,
  CompositionService,
  Customer,
  DeliveryService,
  RequestCtx,
  TemplateService,
  TemplateVersion,
} from '../src/kernel/contracts.js';
import { createIngestionService } from '../src/domains/ingestion/index.js';
import { luhn } from '../src/domains/ingestion/pii.js';

const TENANT = 'ten_ingest';

describe('ingestion domain', () => {
  let ctx: PlatformContext;
  let rctx: RequestCtx;
  let composeCount = 0;
  let lastComposeData: Record<string, unknown> | undefined;
  const deliveredIds: string[] = [];

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    rctx = { tenantId: TENANT, actorId: 'usr_1', roles: ['operator'], keyId: 'key_1' };

    const fixtureVersion: TemplateVersion = {
      id: 'tpv_1',
      tenantId: TENANT,
      templateId: 'tpl_1',
      version: 1,
      status: 'published',
      dataContract: {
        fields: [{ path: 'amount', type: 'number', required: false }],
        sample: { amount: 1 },
      },
      intendedOutcome: 'payment_completed',
      blocks: [],
      channels: {},
      authorId: 'usr_1',
      createdAt: new Date().toISOString(),
      aiAssisted: false,
    };
    ctx.services.templates = {
      publishedVersion: () => fixtureVersion,
    } as unknown as TemplateService;

    // Validation happens inside compose (data contract enforcement); simulate
    // a contract failure whenever data.bad === true.
    let n = 0;
    ctx.services.composition = {
      compose: async (args: {
        tenantId: string;
        templateId: string;
        customerId: string;
        data: Record<string, unknown>;
      }) => {
        composeCount++;
        lastComposeData = args.data;
        if (args.data.bad === true) throw new Error('data contract validation failed');
        n++;
        return {
          id: `com_${n}`,
          tenantId: args.tenantId,
          templateId: args.templateId,
          customerId: args.customerId,
          status: 'rendered',
        } as unknown as Communication;
      },
    } as unknown as CompositionService;

    ctx.services.delivery = {
      deliver: async (args: { communicationId: string }) => {
        deliveredIds.push(args.communicationId);
        return [];
      },
    } as unknown as DeliveryService;

    const customers = ctx.store.collection<Customer>('customers');
    customers.put({
      id: 'cus_ext', tenantId: TENANT, externalRef: 'CUST-9', name: 'Ref Customer',
      locale: 'en-US', createdAt: new Date().toISOString(),
    });
    customers.put({
      id: 'cus_plain', tenantId: TENANT, name: 'Plain Customer',
      locale: 'en-US', createdAt: new Date().toISOString(),
    });

    ctx.services.ingestion = createIngestionService(ctx);
  });

  it('ingests a JSON batch, tracking per-record errors and delivering valid records', async () => {
    const payload = JSON.stringify([
      { customerRef: 'NOPE-1', amount: 10 }, // unknown customer
      { customerRef: 'CUST-9', bad: true, amount: 20 }, // compose throws
      { customerId: 'cus_plain', amount: 30 }, // good (resolved by id)
    ]);
    const job = await ctx.services.ingestion.ingestBatch({
      ctx: rctx, templateId: 'tpl_1', sourceFormat: 'json', payload,
    });

    expect(job.recordCount).toBe(3);
    expect(job.validCount).toBe(1);
    expect(job.errorCount).toBe(2);
    expect(job.status).toBe('completed');
    expect(job.communicationIds).toHaveLength(1);
    expect(job.errors[0]).toEqual({ record: 1, message: 'record 1: unknown customer' });
    expect(job.errors[1]?.record).toBe(2);
    expect(job.errors[1]?.message).toContain('data contract validation failed');
    expect(composeCount).toBe(2); // unknown-customer record never reaches compose

    expect(deliveredIds).toHaveLength(1);
    expect(deliveredIds[0]).toBe(job.communicationIds[0]);

    // persisted + queryable, and completion event emitted
    expect(ctx.services.ingestion.getJob(rctx, job.id).status).toBe('completed');
    expect(ctx.services.ingestion.listJobs(rctx).map((j) => j.id)).toContain(job.id);
    const events = ctx.log.query(TENANT, { type: 'com.acorn.ingestion.completed' });
    expect(events.at(-1)?.subject).toBe(job.id);
    expect(events.at(-1)?.data).toEqual({
      jobId: job.id, templateId: 'tpl_1', recordCount: 3, validCount: 1, errorCount: 2,
    });
  });

  it('deliver:false composes without delivering', async () => {
    const before = deliveredIds.length;
    const job = await ctx.services.ingestion.ingestBatch({
      ctx: rctx,
      templateId: 'tpl_1',
      sourceFormat: 'json',
      payload: JSON.stringify([{ customerRef: 'CUST-9', amount: 5 }]),
      deliver: false,
    });
    expect(job.validCount).toBe(1);
    expect(deliveredIds).toHaveLength(before);
  });

  it('parses CSV with quoted commas, coercion, and dot-path headers', async () => {
    const payload =
      'customerRef,name,account.balanceDue,paperless\n' +
      'CUST-9,"Smith, Jane",1250.5,true\n';
    const job = await ctx.services.ingestion.ingestBatch({
      ctx: rctx, templateId: 'tpl_1', sourceFormat: 'csv', payload, deliver: false,
    });
    expect(job.recordCount).toBe(1);
    expect(job.validCount).toBe(1);
    expect(lastComposeData).toEqual({
      name: 'Smith, Jane',
      account: { balanceDue: 1250.5 },
      paperless: true,
    });
  });

  it('scanPii finds email + ssn (not phone) and Luhn-validates PANs', () => {
    const findings = ctx.services.ingestion.scanPii(
      'contact jane@example.com, ssn 123-45-6789',
    );
    expect(findings).toContainEqual({ path: '$', kind: 'email', count: 1 });
    expect(findings).toContainEqual({ path: '$', kind: 'ssn', count: 1 });
    expect(findings.find((f) => f.kind === 'phone')).toBeUndefined();

    const pan = ctx.services.ingestion.scanPii('card 4242 4242 4242 4242');
    expect(pan).toContainEqual({ path: '$', kind: 'pan', count: 1 });

    const notPan = ctx.services.ingestion.scanPii('card 1234 5678 9012 3456');
    expect(notPan.find((f) => f.kind === 'pan')).toBeUndefined();

    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('1234567890123456')).toBe(false);
  });
});
