import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type {
  DataContract,
  RequestCtx,
  TemplateBlock,
} from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';

const TENANT = 'ten_templates_test';

const author: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_author',
  roles: ['business-author', 'designer'],
  keyId: 'key_author',
};

const approver: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_approver',
  roles: ['compliance-approver'],
  keyId: 'key_approver',
};

const contract: DataContract = {
  fields: [
    { path: 'account.balanceDue', type: 'number', required: true },
    { path: 'account.dueDate', type: 'date', required: true },
    { path: 'customer.nickname', type: 'string', required: false },
    { path: 'lines', type: 'array', required: true },
  ],
  sample: {
    account: { balanceDue: 125.5, dueDate: '2026-08-01' },
    lines: [{ description: 'Coffee', amount: 4.5 }],
  },
};

const goodBlocks: TemplateBlock[] = [
  { kind: 'heading', level: 1, text: 'Your Statement' },
  {
    kind: 'section',
    id: 'summary',
    title: 'Summary',
    explanation: 'What you owe and when it is due.',
    blocks: [
      { kind: 'field-row', label: 'Balance due', value: '{{account.balanceDue|currency}}' },
      {
        kind: 'table',
        title: 'Charges',
        itemsPath: 'lines',
        columns: [
          { header: 'Description', valuePath: 'description' },
          { header: 'Amount', valuePath: 'amount', align: 'right', format: 'currency' },
        ],
      },
      { kind: 'content-ref', contentKey: 'disclosure.efunds' },
      { kind: 'action', action: 'pay', label: 'Pay now' },
    ],
  },
];

describe('templates domain', () => {
  let ctx: PlatformContext;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.templates = createTemplateService(ctx);

    // Referenced content must be approved by a second actor (SoD) before publish.
    const { version } = ctx.services.content.createContent(author, {
      key: 'disclosure.efunds',
      type: 'disclosure',
      title: 'Electronic Funds Disclosure',
      body: 'Electronic funds transfers are governed by these terms.',
    });
    ctx.services.content.submitForReview(author, version.id);
    ctx.services.content.review(approver, version.id, 'approved');
  });

  it('creates a template with v1 draft, then publishes it (happy path)', () => {
    const { template, version } = ctx.services.templates.createTemplate(author, {
      key: 'credit-card-statement',
      name: 'Credit Card Statement',
      communicationType: 'statement',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'payment_completed',
      blocks: goodBlocks,
      channels: { email: { subject: 'Your statement is ready' } },
    });
    expect(template.id).toMatch(/^tpl_/);
    expect(template.latestVersionId).toBe(version.id);
    expect(version.version).toBe(1);
    expect(version.status).toBe('draft');

    const published = ctx.services.templates.publish(approver, version.id);
    expect(published.status).toBe('published');
    expect(published.publishedBy).toBe(approver.actorId);
    expect(published.publishedAt).toBeTruthy();
    expect(published.accessibility?.passed).toBe(true);

    const refreshed = ctx.services.templates.getTemplate(author, template.id);
    expect(refreshed.publishedVersionId).toBe(version.id);
    expect(ctx.services.templates.publishedVersion(TENANT, template.id)?.id).toBe(version.id);
    expect(ctx.services.templates.getByKey(TENANT, 'credit-card-statement')?.id).toBe(template.id);
  });

  it('rejects a duplicate template key per tenant', () => {
    expect(() =>
      ctx.services.templates.createTemplate(author, {
        key: 'credit-card-statement',
        name: 'Duplicate',
        communicationType: 'statement',
        brandId: 'brd_test',
        dataContract: contract,
        intendedOutcome: 'payment_completed',
        blocks: goodBlocks,
      }),
    ).toThrowError(PlatformError);
  });

  it('accessibility gate blocks publish when the first heading is level 2', () => {
    const badBlocks: TemplateBlock[] = [
      { kind: 'heading', level: 2, text: 'Not a top-level heading' },
      ...goodBlocks.slice(1),
    ];
    const { version } = ctx.services.templates.createTemplate(author, {
      key: 'bad-heading-notice',
      name: 'Bad Heading Notice',
      communicationType: 'notice',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'understood',
      blocks: badBlocks,
    });
    try {
      ctx.services.templates.publish(approver, version.id);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).code).toBe('accessibility-gate-failed');
      expect((err as PlatformError).status).toBe(422);
    }
    // report persisted onto the version row
    const stored = ctx.services.templates.getVersion(TENANT, version.id);
    expect(stored?.accessibility?.passed).toBe(false);
    expect(
      stored?.accessibility?.issues.some(
        (i) => i.ruleId === 'heading-order' && i.severity === 'error',
      ),
    ).toBe(true);
    expect(stored?.status).toBe('draft');
  });

  it('checkAccessibility flags missing section titles, table headers, and action labels', () => {
    const { version } = ctx.services.templates.createTemplate(author, {
      key: 'messy-template',
      name: 'Messy Template',
      communicationType: 'letter',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'understood',
      blocks: [
        { kind: 'heading', level: 1, text: 'Ok heading' },
        {
          kind: 'section',
          id: 'untitled',
          title: '',
          blocks: [
            {
              kind: 'table',
              itemsPath: 'lines',
              columns: [{ header: '', valuePath: 'description' }],
            },
            { kind: 'action', action: 'pay', label: 'P' },
          ],
        },
      ],
    });
    const report = ctx.services.templates.checkAccessibility(TENANT, version.id);
    const ruleIds = report.issues.map((i) => i.ruleId);
    expect(report.passed).toBe(false);
    expect(ruleIds).toContain('section-title-required');
    expect(ruleIds).toContain('table-headers-required');
    expect(ruleIds).toContain('action-label-required');
    expect(ruleIds).toContain('explanation-recommended');
    expect(
      report.issues.find((i) => i.ruleId === 'explanation-recommended')?.severity,
    ).toBe('warning');
  });

  it('validateData catches missing required fields and wrong types', () => {
    const version = ctx.services.templates.getVersion(
      TENANT,
      ctx.services.templates.getByKey(TENANT, 'credit-card-statement')!.publishedVersionId!,
    )!;
    const errors = ctx.services.templates.validateData(version, {
      account: { balanceDue: 'not-a-number', dueDate: '2026-08-01' },
      lines: [],
    });
    expect(errors).toContain('field account.balanceDue expected number, got string');
    expect(errors.some((e) => e.includes('missing required field'))).toBe(false);

    const missing = ctx.services.templates.validateData(version, { lines: [] });
    expect(missing).toContain('missing required field account.balanceDue');
    expect(missing).toContain('missing required field account.dueDate');

    // valid data yields no errors; optional fields may be absent
    expect(ctx.services.templates.validateData(version, contract.sample)).toEqual([]);
  });

  it('publish rejects a content-ref whose content has no approved version', () => {
    // content exists but is only a draft — never approved
    ctx.services.content.createContent(author, {
      key: 'clause.unapproved',
      type: 'clause',
      title: 'Unapproved Clause',
      body: 'Draft only.',
    });
    const { version } = ctx.services.templates.createTemplate(author, {
      key: 'unapproved-ref-notice',
      name: 'Unapproved Ref Notice',
      communicationType: 'notice',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'understood',
      blocks: [
        { kind: 'heading', level: 1, text: 'Notice' },
        {
          kind: 'section',
          id: 'body',
          title: 'Details',
          explanation: 'Why you are receiving this.',
          blocks: [{ kind: 'content-ref', contentKey: 'clause.unapproved' }],
        },
      ],
    });
    try {
      ctx.services.templates.publish(approver, version.id);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(400);
      expect((err as PlatformError).message).toContain('clause.unapproved');
    }
    expect(ctx.services.templates.getVersion(TENANT, version.id)?.status).toBe('draft');
  });

  it('newVersion copies fields from the latest version and applies overrides', () => {
    const template = ctx.services.templates.getByKey(TENANT, 'credit-card-statement')!;
    const v2 = ctx.services.templates.newVersion(author, template.id, {
      intendedOutcome: 'self_served',
      aiAssisted: true,
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('draft');
    expect(v2.intendedOutcome).toBe('self_served');
    expect(v2.aiAssisted).toBe(true);
    expect(v2.blocks).toEqual(goodBlocks); // copied
    expect(v2.dataContract).toEqual(contract); // copied
    const refreshed = ctx.services.templates.getTemplate(author, template.id);
    expect(refreshed.latestVersionId).toBe(v2.id);

    // publishing v2 retires the previously published v1
    const published = ctx.services.templates.publish(approver, v2.id);
    expect(published.status).toBe('published');
    const v1 = ctx.services.templates.getVersion(TENANT, template.publishedVersionId!);
    expect(v1?.status).toBe('retired');
    expect(ctx.services.templates.publishedVersion(TENANT, template.id)?.id).toBe(v2.id);
  });

  it('publish requires an authorized role', () => {
    const operator: RequestCtx = { ...author, actorId: 'usr_op', roles: ['operator'] };
    const template = ctx.services.templates.getByKey(TENANT, 'credit-card-statement')!;
    const v3 = ctx.services.templates.newVersion(author, template.id, {});
    try {
      ctx.services.templates.publish(operator, v3.id);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(403);
    }
  });
});
