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
  MappingProfile,
  MappingRule,
  RequestCtx,
  Template,
} from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';
import { createMappingService } from '../src/domains/mapping/index.js';
import { createIngestionService } from '../src/domains/ingestion/index.js';
import { applyTransform, setPath } from '../src/domains/mapping/transforms.js';

const TENANT = 'ten_map';

const MESSY = {
  first_name: 'Ada',
  Balance_Due: '$1,234.50',
  due_date: '07/25/2026',
  noise: 'x',
};

describe('mapping domain', () => {
  let ctx: PlatformContext;
  let designer: RequestCtx;
  let operator: RequestCtx;
  let template: Template;
  let profile: MappingProfile;
  const composedData: Record<string, unknown>[] = [];

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    designer = { tenantId: TENANT, actorId: 'usr_designer', roles: ['designer'], keyId: 'key_d' };
    operator = { tenantId: TENANT, actorId: 'usr_op', roles: ['operator'], keyId: 'key_o' };

    // Real content + templates services (publication gates included).
    ctx.services.content = createContentService(ctx);
    ctx.services.templates = createTemplateService(ctx);

    const created = ctx.services.templates.createTemplate(designer, {
      key: 'monthly-bill',
      name: 'Monthly Bill',
      communicationType: 'bill',
      brandId: 'brd_1',
      dataContract: {
        fields: [
          { path: 'customer.firstName', type: 'string', required: true },
          { path: 'account.balanceDue', type: 'number', required: true },
          { path: 'account.dueDate', type: 'date', required: true },
        ],
        sample: {
          customer: { firstName: 'Ada' },
          account: { balanceDue: 100, dueDate: '2026-01-01' },
        },
      },
      intendedOutcome: 'payment_completed',
      blocks: [{ kind: 'heading', level: 1, text: 'Your monthly bill' }],
    });
    template = created.template;
    ctx.services.templates.publish(designer, created.version.id);

    ctx.services.mapping = createMappingService(ctx);

    // Profile built from the heuristic's own suggestions (deliverable c/e).
    const suggestions = ctx.services.mapping.suggest(operator, template.id, MESSY);
    const rules: MappingRule[] = suggestions
      .filter((s) => s.transform !== null)
      .map((s) => ({ target: s.target, transform: s.transform! }));
    profile = ctx.services.mapping.create(operator, {
      templateId: template.id,
      name: 'billing-feed',
      rules,
    });

    // Ingestion with stubbed composition/delivery (pattern from ingestion.test.ts).
    ctx.services.composition = {
      compose: async (args: {
        tenantId: string;
        templateId: string;
        customerId: string;
        data: Record<string, unknown>;
      }) => {
        composedData.push(args.data);
        return {
          id: `com_${composedData.length}`,
          tenantId: args.tenantId,
          templateId: args.templateId,
          customerId: args.customerId,
          status: 'rendered',
        } as unknown as Communication;
      },
    } as unknown as CompositionService;
    ctx.services.delivery = {
      deliver: async () => [],
    } as unknown as DeliveryService;
    ctx.services.ingestion = createIngestionService(ctx);

    ctx.store.collection<Customer>('customers').put({
      id: 'cus_map1',
      tenantId: TENANT,
      externalRef: 'CUST-1',
      name: 'Ada Lovelace',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
    });
  });

  it('suggest() maps messy source names onto contract fields by name similarity', () => {
    const suggestions = ctx.services.mapping.suggest(operator, template.id, MESSY);

    // Sorted by contract field order.
    expect(suggestions.map((s) => s.target)).toEqual([
      'customer.firstName',
      'account.balanceDue',
      'account.dueDate',
    ]);

    const [firstName, balance, due] = suggestions;
    // 'first_name' normalizes to 'firstname' — exact match of the target's last segment.
    expect(firstName?.transform).toEqual({ kind: 'trim', source: 'first_name' });
    expect(firstName?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(firstName?.confidence).toBe(1);
    expect(firstName?.sample).toBe('Ada');

    expect(balance?.transform).toEqual({ kind: 'number', source: 'Balance_Due' });
    expect(balance?.confidence).toBe(1);
    expect(balance?.sample).toBe('$1,234.50');

    expect(due?.transform).toEqual({ kind: 'date-iso', source: 'due_date' });
    expect(due?.confidence).toBe(1);

    // 'noise' never scores >= 0.5 against any contract field.
    for (const s of suggestions) {
      const source = (s.transform as { source?: string } | null)?.source;
      expect(source).not.toBe('noise');
    }
  });

  it('create() rejects rules whose targets are not in the data contract', () => {
    expect(() =>
      ctx.services.mapping.create(operator, {
        templateId: template.id,
        name: 'bad-profile',
        rules: [
          { target: 'account.balanceDue', transform: { kind: 'copy', source: 'Balance_Due' } },
          { target: 'account.wrongField', transform: { kind: 'copy', source: 'x' } },
        ],
      }),
    ).toThrowError(/account\.wrongField/);

    // valid create persists + emits the created event
    expect(ctx.services.mapping.get(operator, profile.id).name).toBe('billing-feed');
    expect(ctx.services.mapping.list(operator, template.id).map((p) => p.id)).toContain(profile.id);
    const events = ctx.log.query(TENANT, { type: 'com.acorn.mapping.created' });
    expect(events.at(-1)?.subject).toBe(profile.id);
    expect(events.at(-1)?.data).toEqual({
      profileId: profile.id,
      templateId: template.id,
      rules: 3,
    });
  });

  it('update() re-validates targets, bumps updatedAt, and emits the updated event', () => {
    expect(() =>
      ctx.services.mapping.update(operator, profile.id, [
        { target: 'nope.nope', transform: { kind: 'constant', value: 1 } },
      ]),
    ).toThrowError(/nope\.nope/);

    const updated = ctx.services.mapping.update(operator, profile.id, profile.rules);
    expect(updated.updatedAt >= profile.updatedAt).toBe(true);
    const events = ctx.log.query(TENANT, { type: 'com.acorn.mapping.updated' });
    expect(events.at(-1)?.subject).toBe(profile.id);
  });

  it('apply() produces a contract-shaped record that validates cleanly', () => {
    const mapped = ctx.services.mapping.apply(TENANT, profile.id, {
      ...MESSY,
      customerRef: 'CUST-1',
    });
    expect(mapped).toEqual({
      customerRef: 'CUST-1', // passthrough — rules don't set it
      customer: { firstName: 'Ada' },
      account: { balanceDue: 1234.5, dueDate: '2026-07-25' },
    });

    const published = ctx.services.templates.publishedVersion(TENANT, template.id)!;
    expect(ctx.services.templates.validateData(published, mapped)).toEqual([]);
  });

  it('transforms: number, date-iso, concat, constant, trim, setPath', () => {
    // number strips $/commas/whitespace; NaN → undefined
    expect(applyTransform({ kind: 'number', source: 'a' }, { a: '$2, 000.75' })).toBe(2000.75);
    expect(applyTransform({ kind: 'number', source: 'a' }, { a: 'n/a' })).toBeUndefined();
    expect(applyTransform({ kind: 'number', source: 'a' }, {})).toBeUndefined();

    // date-iso: MM/DD/YYYY, ISO passthrough, 'Month D, YYYY', invalid → undefined
    expect(applyTransform({ kind: 'date-iso', source: 'd' }, { d: '07/25/2026' })).toBe('2026-07-25');
    expect(applyTransform({ kind: 'date-iso', source: 'd' }, { d: '2026-07-25' })).toBe('2026-07-25');
    expect(applyTransform({ kind: 'date-iso', source: 'd' }, { d: '2026-07-25T10:30:00Z' })).toBe(
      '2026-07-25',
    );
    expect(applyTransform({ kind: 'date-iso', source: 'd' }, { d: 'July 25, 2026' })).toBe(
      '2026-07-25',
    );
    expect(applyTransform({ kind: 'date-iso', source: 'd' }, { d: 'not a date' })).toBeUndefined();

    // concat joins with custom separator and skips missing sources
    expect(
      applyTransform(
        { kind: 'concat', sources: ['first', 'last'], separator: ', ' },
        { first: 'Ada', last: 'Lovelace' },
      ),
    ).toBe('Ada, Lovelace');
    expect(
      applyTransform({ kind: 'concat', sources: ['first', 'middle', 'last'] }, { first: 'Ada', last: 'L' }),
    ).toBe('Ada L');

    // constant emits its value; trim trims
    expect(applyTransform({ kind: 'constant', value: 42 }, {})).toBe(42);
    expect(applyTransform({ kind: 'trim', source: 'a' }, { a: '  hi  ' })).toBe('hi');

    const obj: Record<string, unknown> = {};
    setPath(obj, 'a.b.c', 1);
    setPath(obj, 'a.b.d', 2);
    expect(obj).toEqual({ a: { b: { c: 1, d: 2 } } });
  });

  it('ingestBatch applies the mapping profile before composing', async () => {
    const payload = JSON.stringify([{ customerRef: 'CUST-1', ...MESSY }]);
    const before = composedData.length;
    const job = await ctx.services.ingestion.ingestBatch({
      ctx: operator,
      templateId: template.id,
      sourceFormat: 'json',
      payload,
      mappingProfileId: profile.id,
      deliver: false,
    });

    expect(job.recordCount).toBe(1);
    expect(job.validCount).toBe(1);
    expect(job.errorCount).toBe(0);
    // compose received the MAPPED, contract-shaped record (customerRef stripped by ingestion)
    expect(composedData.length).toBe(before + 1);
    expect(composedData.at(-1)).toEqual({
      customer: { firstName: 'Ada' },
      account: { balanceDue: 1234.5, dueDate: '2026-07-25' },
    });

    // a missing profile becomes a per-record 'mapping failed' error row
    const failed = await ctx.services.ingestion.ingestBatch({
      ctx: operator,
      templateId: template.id,
      sourceFormat: 'json',
      payload,
      mappingProfileId: 'map_missing',
      deliver: false,
    });
    expect(failed.validCount).toBe(0);
    expect(failed.errors[0]?.message).toBe(
      'record 1: mapping failed: mapping profile map_missing not found',
    );
  });
});
