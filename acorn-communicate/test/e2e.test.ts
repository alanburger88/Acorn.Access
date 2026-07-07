/**
 * End-to-end lifecycle test through the HTTP API:
 * tenant bootstrap → content approval → template publish (accessibility gate)
 * → compose → deliver (secure link) → view → assistant → pay action → outcome
 * → NBA → analytics → archive evidence pack → tamper-evident chain.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';

let platform: Platform;
let adminSecret: string;
let authorSecret: string;
let approverSecret: string;

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acorn-e2e-'));
  platform = buildPlatform(
    configFromEnv({
      dataDir: tmp,
      outboxDir: join(tmp, 'outbox'),
      baseUrl: 'http://e2e.local',
      port: 0,
      anthropicApiKey: undefined,
    }),
  );
  await platform.app.ready();
});

afterAll(async () => {
  await platform.app.close();
});

describe('full communication lifecycle', () => {
  let templateId = '';
  let customerId = '';
  let communicationId = '';
  let viewToken = '';

  it('bootstraps a tenant and role-scoped API keys', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'E2E Credit Union', industry: 'credit-union' },
    });
    expect([200, 201]).toContain(res.statusCode);
    adminSecret = res.json().adminKey.secret;

    const authorRes = await platform.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: auth(adminSecret),
      payload: { name: 'author', roles: ['business-author', 'designer', 'operator'] },
    });
    expect(authorRes.statusCode).toBe(200);
    authorSecret = authorRes.json().secret;

    const approverRes = await platform.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: auth(adminSecret),
      payload: { name: 'approver', roles: ['compliance-approver'] },
    });
    approverSecret = approverRes.json().secret;
    expect(approverSecret).toBeTruthy();
  });

  it('creates customer, approves content with segregation of duties', async () => {
    const cust = await platform.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: auth(adminSecret),
      payload: { name: 'Eve Martin', email: 'eve@example.com', phone: '+1-555-777-1234', locale: 'en-US' },
    });
    expect([200, 201]).toContain(cust.statusCode);
    customerId = cust.json().id;

    const created = await platform.app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(authorSecret),
      payload: {
        key: 'disclosure.e2e',
        type: 'disclosure',
        title: 'E2E Disclosure',
        body: 'You may dispute any charge within 60 days of the statement date.',
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    const versionId = created.json().version.id;

    await platform.app.inject({
      method: 'POST',
      url: `/v1/content-versions/${versionId}/submit`,
      headers: auth(authorSecret),
    });
    const review = await platform.app.inject({
      method: 'POST',
      url: `/v1/content-versions/${versionId}/review`,
      headers: auth(approverSecret),
      payload: { decision: 'approved' },
    });
    expect([200, 201]).toContain(review.statusCode);
  });

  it('blocks publish on accessibility gate, then publishes a fixed version', async () => {
    const brand = await platform.app.inject({
      method: 'POST',
      url: '/v1/brands',
      headers: auth(adminSecret),
      payload: {
        name: 'E2E CU',
        primaryColor: '#123456',
        accentColor: '#234567',
        logoText: 'E2E CU',
        fromEmail: 'no-reply@e2e.example',
        fromSms: 'E2ECU',
      },
    });
    const brandId = brand.json().id;

    const dataContract = {
      fields: [
        { path: 'period', type: 'string', required: true },
        { path: 'account.balanceDue', type: 'number', required: true },
        { path: 'account.dueDate', type: 'date', required: true },
      ],
      sample: { period: 'June 2026', account: { balanceDue: 120.5, dueDate: '2026-07-20' } },
    };

    // Version with an accessibility violation: table column without a header.
    const badTemplate = await platform.app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: auth(authorSecret),
      payload: {
        key: 'e2e-statement',
        name: 'E2E Statement',
        communicationType: 'statement',
        brandId,
        intendedOutcome: 'payment_completed',
        dataContract,
        blocks: [
          {
            kind: 'section',
            id: 'summary',
            title: '', // violates section-title-required
            blocks: [{ kind: 'field-row', label: 'Balance Due', value: '{{account.balanceDue|currency}}' }],
          },
        ],
      },
    });
    expect([200, 201]).toContain(badTemplate.statusCode);
    templateId = badTemplate.json().template.id;
    const badVersionId = badTemplate.json().version.id;

    const blockedPublish = await platform.app.inject({
      method: 'POST',
      url: `/v1/template-versions/${badVersionId}/publish`,
      headers: auth(approverSecret),
    });
    expect(blockedPublish.statusCode).toBe(422);
    expect(blockedPublish.json().title).toBe('accessibility-gate-failed');

    const fixed = await platform.app.inject({
      method: 'POST',
      url: `/v1/templates/${templateId}/versions`,
      headers: auth(authorSecret),
      payload: {
        blocks: [
          {
            kind: 'summary',
            title: 'Your {{period}} statement',
            text: 'Your balance of {{account.balanceDue|currency}} is due {{account.dueDate|date}}.',
          },
          {
            kind: 'section',
            id: 'summary',
            title: 'Account Summary',
            explanation: 'What you owe and when it is due.',
            blocks: [
              { kind: 'field-row', label: 'Balance Due', value: '{{account.balanceDue|currency}}' },
              { kind: 'field-row', label: 'Due Date', value: '{{account.dueDate|date}}' },
            ],
          },
          {
            kind: 'section',
            id: 'rights',
            title: 'Your Rights',
            explanation: 'Dispute rules that protect you.',
            blocks: [{ kind: 'content-ref', contentKey: 'disclosure.e2e' }],
          },
          {
            kind: 'section',
            id: 'actions',
            title: 'Take action',
            explanation: 'Complete your payment without calling us.',
            blocks: [{ kind: 'action', action: 'pay', label: 'Pay now' }],
          },
        ],
        channels: { email: { subject: 'Your {{period}} statement' } },
      },
    });
    expect([200, 201]).toContain(fixed.statusCode);

    const publish = await platform.app.inject({
      method: 'POST',
      url: `/v1/template-versions/${fixed.json().id}/publish`,
      headers: auth(approverSecret),
    });
    expect([200, 201]).toContain(publish.statusCode);
  });

  it('composes and renders a communication with pinned content', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/v1/communications',
      headers: auth(authorSecret),
      payload: {
        templateId,
        customerId,
        data: { period: 'June 2026', account: { balanceDue: 245.1, dueDate: '2026-07-20' } },
      },
    });
    expect([200, 201]).toContain(res.statusCode);
    const com = res.json();
    communicationId = com.id;
    expect(com.status).toBe('rendered');
    expect(com.composed.contentVersionIds.length).toBeGreaterThan(0);

    const artifacts = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}/artifacts`,
      headers: auth(authorSecret),
    });
    const formats = artifacts.json().map((a: { format: string }) => a.format);
    expect(formats).toContain('html');
    expect(formats).toContain('pdf');
  });

  it('delivers via email and issues a secure link', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: `/v1/communications/${communicationId}/deliver`,
      headers: auth(authorSecret),
      payload: {},
    });
    expect([200, 201]).toContain(res.statusCode);

    const link = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}/secure-link`,
      headers: auth(authorSecret),
    });
    expect([200, 201]).toContain(link.statusCode);
    viewToken = link.json().url.split('/view/')[1];
    expect(viewToken).toBeTruthy();

    const com = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}`,
      headers: auth(authorSecret),
    });
    expect(com.json().status).toBe('delivered');
  });

  it('serves the interactive viewer and records access', async () => {
    const res = await platform.app.inject({ method: 'GET', url: `/view/${viewToken}` });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toContain('data-section-id');
    expect(res.body).toContain('acorn-access.min.js');

    const bad = await platform.app.inject({ method: 'GET', url: '/view/not-a-real-token' });
    expect([404, 410]).toContain(bad.statusCode);
  });

  it('answers a grounded question and escalates when unsure', async () => {
    const good = await platform.app.inject({
      method: 'POST',
      url: `/api/view/${viewToken}/ask`,
      payload: { question: 'When is my balance due?' },
    });
    expect([200, 201]).toContain(good.statusCode);
    expect(good.json().escalated).toBe(false);
    expect(good.json().citations.length).toBeGreaterThan(0);

    const vague = await platform.app.inject({
      method: 'POST',
      url: `/api/view/${viewToken}/ask`,
      payload: { question: 'zebra quantum harvest velocity?' },
    });
    expect(vague.json().escalated).toBe(true);
  });

  it('completes a payment action and achieves the intended outcome', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: `/api/view/${viewToken}/actions`,
      payload: { action: 'pay', payload: { amount: 245.1 } },
    });
    expect([200, 201]).toContain(res.statusCode);

    const com = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}`,
      headers: auth(authorSecret),
    });
    expect(com.json().outcome?.achieved).toBe(true);
  });

  it('reports analytics reflecting the journey', async () => {
    const overview = await platform.app.inject({
      method: 'GET',
      url: '/v1/analytics/overview',
      headers: auth(authorSecret),
    });
    const metrics = overview.json();
    expect(metrics.communications).toBeGreaterThanOrEqual(1);
    expect(metrics.outcomesAchieved).toBeGreaterThanOrEqual(1);

    const funnel = await platform.app.inject({
      method: 'GET',
      url: `/v1/analytics/funnel?templateId=${templateId}`,
      headers: auth(authorSecret),
    });
    const steps = funnel.json();
    expect(steps.find((s: { step: string }) => s.step === 'outcome')?.count).toBeGreaterThanOrEqual(1);

    const timeline = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}/timeline`,
      headers: auth(authorSecret),
    });
    expect(timeline.json().length).toBeGreaterThanOrEqual(4);
  });

  it('produces an archive evidence pack with an intact event chain', async () => {
    const pack = await platform.app.inject({
      method: 'GET',
      url: `/v1/archive/${communicationId}/evidence-pack`,
      headers: auth(adminSecret),
    });
    expect([200, 201]).toContain(pack.statusCode);
    const evidence = pack.json();
    expect(evidence.record.manifest.artifacts.length).toBeGreaterThan(0);
    expect(evidence.proofs.proofOfDelivery.length).toBeGreaterThan(0);
    expect(evidence.proofs.proofOfAccess.length).toBeGreaterThan(0);
    expect(evidence.proofs.proofOfCustomerAction.length).toBeGreaterThan(0);
    expect(evidence.eventChain.intact).toBe(true);

    const verify = await platform.app.inject({
      method: 'GET',
      url: '/v1/audit/verify-chain',
      headers: auth(adminSecret),
    });
    expect(verify.json().intact).toBe(true);
  });

  it('enforces tenant isolation between API keys', async () => {
    const other = await platform.app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Other Corp' },
    });
    const otherSecret = other.json().adminKey.secret;
    const res = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}`,
      headers: auth(otherSecret),
    });
    expect(res.statusCode).toBe(404);
  });
});
