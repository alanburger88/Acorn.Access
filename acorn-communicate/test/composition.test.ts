import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type {
  Brand,
  Communication,
  Customer,
  RequestCtx,
  TemplateBlock,
} from '../src/kernel/contracts.js';
// Real peer services from the content and templates bounded contexts.
import { createContentService } from '../src/domains/content/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';
import { createRenderingService } from '../src/domains/rendering/index.js';
import { createCompositionService } from '../src/domains/composition/index.js';

const TENANT = 'ten_TESTTENANT';

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

const blocks: TemplateBlock[] = [
  {
    kind: 'summary',
    title: 'Statement summary',
    text: 'Your balance for {{period}} is {{account.balanceDue|currency}}.',
  },
  { kind: 'field-row', label: 'Amount due', value: '{{account.balanceDue|currency}}' },
  {
    kind: 'text',
    text: 'Your account is past due. Please pay promptly to avoid additional fees.',
    condition: { path: 'account.balancePastDue', op: 'gt', value: 0 },
  },
  {
    kind: 'section',
    id: 'charges',
    title: 'Charges',
    collapsible: true,
    explanation: 'Every transaction posted this cycle.',
    blocks: [
      {
        kind: 'table',
        title: 'Transactions',
        itemsPath: 'transactions',
        columns: [
          { header: 'Date', valuePath: 'date' },
          { header: 'Description', valuePath: 'description' },
          { header: 'Amount', valuePath: 'amount', align: 'right', format: 'currency' },
        ],
      },
    ],
  },
  {
    kind: 'section',
    id: 'legal',
    title: 'Important information',
    explanation: 'Disclosures required for this communication type.',
    blocks: [{ kind: 'content-ref', contentKey: 'disclosure.efunds' }],
  },
  { kind: 'action', action: 'pay', label: 'Pay now' },
];

const baseData = {
  period: 'June 2026',
  account: { balanceDue: 1250, balancePastDue: 0 },
  transactions: [
    { date: '2026-06-01', description: 'Coffee shop', amount: 4.5 },
    { date: '2026-06-14', description: 'Grocery store', amount: 82.1 },
  ],
};

describe('composition domain', () => {
  let ctx: PlatformContext;
  let templateId: string;
  let approvedContentVersionId: string;
  let communication: Communication;

  beforeAll(async () => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.templates = createTemplateService(ctx);
    ctx.services.rendering = createRenderingService(ctx);
    ctx.services.composition = createCompositionService(ctx);

    // Seed a customer + brand row directly.
    ctx.store.collection<Customer>('customers').put({
      id: 'cus_TEST',
      tenantId: TENANT,
      name: 'Casey Customer',
      email: 'casey@example.com',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
    });
    ctx.store.collection<Brand>('brands').put({
      id: 'brd_TEST',
      tenantId: TENANT,
      name: 'Acorn Bank',
      primaryColor: '#1a365d',
      accentColor: '#2b6cb0',
      logoText: 'ACORN BANK',
      fromEmail: 'no-reply@acornbank.test',
      fromSms: 'ACORN',
    });

    // Approved disclosure content (second actor approves — segregation of duties).
    const { version: draft } = ctx.services.content.createContent(author, {
      key: 'disclosure.efunds',
      type: 'disclosure',
      title: 'Electronic Funds Disclosure',
      body: 'Electronic transfers are governed by your account agreement for {{period}}.',
    });
    ctx.services.content.submitForReview(author, draft.id);
    const approved = ctx.services.content.review(approver, draft.id, 'approved');
    approvedContentVersionId = approved.id;

    // Statement template with a published version.
    const { template, version } = ctx.services.templates.createTemplate(author, {
      key: 'credit-card-statement',
      name: 'Monthly Statement',
      communicationType: 'statement',
      brandId: 'brd_TEST',
      dataContract: {
        fields: [
          { path: 'period', type: 'string', required: true },
          { path: 'account.balanceDue', type: 'number', required: true },
          { path: 'account.balancePastDue', type: 'number', required: true },
          { path: 'transactions', type: 'array', required: true },
        ],
        sample: baseData,
      },
      intendedOutcome: 'payment_completed',
      blocks,
      channels: { email: { subject: 'Your statement for {{period}}' } },
    });
    templateId = template.id;
    ctx.services.templates.publish(approver, version.id);
  });

  it('compose validates, snapshots, composes, renders and ends up rendered', async () => {
    communication = await ctx.services.composition.compose({
      tenantId: TENANT,
      templateId,
      customerId: 'cus_TEST',
      data: baseData,
      requestedChannels: ['email', 'secure-link'],
    });
    expect(communication.id).toMatch(/^com_/);
    expect(communication.status).toBe('rendered');
    expect(communication.composed.brand.logoText).toBe('ACORN BANK');
    expect(communication.composed.customerName).toBe('Casey Customer');
  });

  it('rejects composition when the template has no published version', async () => {
    await expect(
      ctx.services.composition.compose({
        tenantId: TENANT,
        templateId: 'tpl_missing',
        customerId: 'cus_TEST',
        data: baseData,
      }),
    ).rejects.toThrowError(/template has no published version/);
  });

  it('rejects data failing the contract', async () => {
    await expect(
      ctx.services.composition.compose({
        tenantId: TENANT,
        templateId,
        customerId: 'cus_TEST',
        data: { period: 'June 2026' },
      }),
    ).rejects.toThrowError(PlatformError);
  });

  it('persists artifacts for html, pdf, text and email-html with retrievable objects', () => {
    const artifacts = ctx.services.composition.listArtifacts(TENANT, communication.id);
    const formats = artifacts.map((a) => a.format).sort();
    // no sms channel configured; voice-script always rendered
    expect(formats).toEqual(['email-html', 'html', 'pdf', 'text', 'voice-script']);
    for (const artifact of artifacts) {
      expect(artifact.size).toBeGreaterThan(0);
      expect(artifact.rendererVersion).toBe('acorn-renderer/1.0.0');
      const stored = ctx.objects.get(artifact.objectKey);
      expect(stored).toBeDefined();
      expect(stored!.buf.length).toBe(artifact.size);
      expect(createHash('sha256').update(stored!.buf).digest('hex')).toBe(artifact.sha256);
    }
  });

  it('pins the approved content version into the composition', () => {
    expect(communication.composed.contentVersionIds).toContain(approvedContentVersionId);
    const legal = communication.composed.sections.find((s) => s.id === 'legal');
    const contentLine = legal?.lines.find((l) => l.kind === 'content');
    expect(contentLine).toMatchObject({
      contentKey: 'disclosure.efunds',
      contentVersionId: approvedContentVersionId,
    });
    // content body was interpolated with the data record
    expect((contentLine as { text: string }).text).toContain('June 2026');
  });

  it('formats currency and excludes the past-due line when balancePastDue is 0', () => {
    const html = ctx.objects
      .get(ctx.services.composition.getArtifact(TENANT, communication.id, 'html')!.objectKey)!
      .buf.toString('utf8');
    expect(html).toContain('$1,250.00');
    expect(html).not.toContain('Your account is past due');
    // email subject interpolated onto the first line, {{link}} left literal
    const email = ctx.objects
      .get(ctx.services.composition.getArtifact(TENANT, communication.id, 'email-html')!.objectKey)!
      .buf.toString('utf8');
    expect(email.split('\n')[0]).toContain('Your statement for June 2026');
    expect(email).toContain('{{link}}');
  });

  it('includes the past-due line when balancePastDue > 0', async () => {
    const pastDue = await ctx.services.composition.compose({
      tenantId: TENANT,
      templateId,
      customerId: 'cus_TEST',
      data: { ...baseData, account: { balanceDue: 1250, balancePastDue: 150 } },
    });
    const html = ctx.objects
      .get(ctx.services.composition.getArtifact(TENANT, pastDue.id, 'html')!.objectKey)!
      .buf.toString('utf8');
    expect(html).toContain('Your account is past due');
  });

  it('stores the data snapshot and its hash matches sha256', () => {
    const snapshot = ctx.objects.get(communication.dataSnapshotKey);
    expect(snapshot).toBeDefined();
    expect(createHash('sha256').update(snapshot!.buf).digest('hex')).toBe(
      communication.dataSnapshotHash,
    );
    expect(JSON.parse(snapshot!.buf.toString('utf8'))).toEqual(baseData);
  });

  it('emitted composed and rendered lifecycle events', () => {
    const composedEvents = ctx.log.query(TENANT, {
      type: 'com.acorn.communication.composed',
      subject: communication.id,
    });
    expect(composedEvents).toHaveLength(1);
    expect(composedEvents[0]!.data).toMatchObject({
      communicationId: communication.id,
      templateId,
      customerId: 'cus_TEST',
      intendedOutcome: 'payment_completed',
    });
    const renderedEvents = ctx.log.query(TENANT, {
      type: 'com.acorn.communication.rendered',
      subject: communication.id,
    });
    expect(renderedEvents).toHaveLength(1);
    expect((renderedEvents[0]!.data as { formats: string[] }).formats).toContain('pdf');
  });

  it('setStatus persists and emits status-changed', () => {
    const updated = ctx.services.composition.setStatus(TENANT, communication.id, 'delivering');
    expect(updated.status).toBe('delivering');
    const events = ctx.log.query(TENANT, {
      type: 'com.acorn.communication.status-changed',
      subject: communication.id,
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)!.data).toMatchObject({ status: 'delivering' });
  });

  it('markOutcome is idempotent — the second call does not duplicate events', () => {
    const first = ctx.services.composition.markOutcome(TENANT, communication.id, 'payment');
    expect(first.outcome).toMatchObject({ achieved: true, via: 'payment' });
    const second = ctx.services.composition.markOutcome(TENANT, communication.id, 'payment-again');
    expect(second.outcome!.via).toBe('payment'); // first achievement wins
    const events = ctx.log.query(TENANT, {
      type: 'com.acorn.communication.outcome-achieved',
      subject: communication.id,
    });
    expect(events).toHaveLength(1);
  });

  it('lists communications with filters', () => {
    const all = ctx.services.composition.listCommunications(TENANT);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const byCustomer = ctx.services.composition.listCommunications(TENANT, {
      customerId: 'cus_TEST',
      templateId,
    });
    expect(byCustomer.length).toBe(all.length);
    expect(ctx.services.composition.listCommunications(TENANT, { customerId: 'cus_other' })).toEqual([]);
  });
});
