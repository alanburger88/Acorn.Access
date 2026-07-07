/**
 * Visual template designer — static app serving, AI draft roundtrip, and the
 * preview endpoint the designer's Preview button relies on.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';

let platform: Platform;
let adminSecret = '';
let authorSecret = '';
let approverSecret = '';

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acorn-designer-'));
  platform = buildPlatform(
    configFromEnv({
      dataDir: tmp,
      outboxDir: join(tmp, 'outbox'),
      baseUrl: 'http://designer.local',
      port: 0,
      anthropicApiKey: undefined,
    }),
  );
  await platform.app.ready();

  const tenant = await platform.app.inject({
    method: 'POST',
    url: '/v1/tenants',
    payload: { name: 'Designer Test Co', industry: 'utilities' },
  });
  adminSecret = tenant.json().adminKey.secret;

  const author = await platform.app.inject({
    method: 'POST',
    url: '/v1/api-keys',
    headers: auth(adminSecret),
    payload: { name: 'author', roles: ['business-author', 'designer'] },
  });
  authorSecret = author.json().secret;

  const approver = await platform.app.inject({
    method: 'POST',
    url: '/v1/api-keys',
    headers: auth(adminSecret),
    payload: { name: 'approver', roles: ['compliance-approver'] },
  });
  approverSecret = approver.json().secret;
});

afterAll(async () => {
  await platform.app.close();
});

describe('GET /designer', () => {
  it('serves the self-contained designer app', async () => {
    const res = await platform.app.inject({ method: 'GET', url: '/designer' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('ACORN DESIGNER');
  });

  it('lists every palette block kind', async () => {
    const res = await platform.app.inject({ method: 'GET', url: '/designer' });
    for (const label of [
      'Heading',
      'Text',
      'Summary',
      'Field row',
      'Table',
      'Section',
      'Approved content',
      'Action',
      'Divider',
    ]) {
      expect(res.body).toContain(label);
    }
  });

  it('has zero external script/link/asset URLs (CSP-friendly)', async () => {
    const res = await platform.app.inject({ method: 'GET', url: '/designer' });
    // No src=/href= attribute may point at an external host.
    expect(res.body.match(/(?:src|href)\s*=\s*"https?:\/\//gi)).toBeNull();
    expect(res.body.match(/(?:src|href)\s*=\s*'https?:\/\//gi)).toBeNull();
    expect(res.body).not.toContain('src="http');
    expect(res.body).not.toContain('href="http');
  });
});

describe('POST /v1/ai/draft (designer AI assist)', () => {
  it('returns a draft that requires human approval', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/v1/ai/draft',
      headers: auth(authorSecret),
      payload: {
        instruction: 'improve readability',
        baseText:
          'Pursuant to the aforementioned terms and conditions, remittance of the outstanding balance is required forthwith.',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.requiresHumanApproval).toBe(true);
    expect(body.invocationId).toBeTruthy();
  });
});

describe('POST /v1/renders/preview (designer preview)', () => {
  let templateVersionId = '';

  it('creates and publishes a minimal template', async () => {
    const brand = await platform.app.inject({
      method: 'POST',
      url: '/v1/brands',
      headers: auth(adminSecret),
      payload: {
        name: 'Designer Brand',
        primaryColor: '#1b3a2f',
        accentColor: '#2f6b4f',
        logoText: 'DSGN',
        fromEmail: 'no-reply@designer.example',
        fromSms: 'DSGN',
      },
    });
    const brandId = brand.json().id;

    const created = await platform.app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: auth(authorSecret),
      payload: {
        key: 'designer-preview-statement',
        name: 'Designer Preview Statement',
        communicationType: 'statement',
        brandId,
        intendedOutcome: 'payment_completed',
        dataContract: {
          fields: [
            { path: 'period', type: 'string', required: true },
            { path: 'account.balanceDue', type: 'number', required: true },
          ],
          sample: { period: 'June 2026', account: { balanceDue: 245.1 } },
        },
        blocks: [
          {
            kind: 'summary',
            title: 'Your {{period}} statement',
            text: 'Your balance of {{account.balanceDue|currency}} is ready to review.',
          },
          {
            kind: 'section',
            id: 'account-summary',
            title: 'Account Summary',
            explanation: 'What you owe this period.',
            blocks: [
              { kind: 'field-row', label: 'Balance Due', value: '{{account.balanceDue|currency}}' },
            ],
          },
          {
            kind: 'section',
            id: 'actions',
            title: 'Take action',
            explanation: 'Pay without calling us.',
            blocks: [{ kind: 'action', action: 'pay', label: 'Pay now' }],
          },
        ],
        channels: { email: { subject: 'Your {{period}} statement' } },
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    templateVersionId = created.json().version.id;

    const publish = await platform.app.inject({
      method: 'POST',
      url: `/v1/template-versions/${templateVersionId}/publish`,
      headers: auth(approverSecret),
    });
    expect([200, 201]).toContain(publish.statusCode);
    expect(publish.json().status).toBe('published');
  });

  it('renders an HTML preview from the contract sample', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/v1/renders/preview',
      headers: auth(authorSecret),
      payload: { templateVersionId, format: 'html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Account Summary');
    expect(res.body).toContain('Balance Due');
  });

  it('renders a text preview too (designer format toggle)', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/v1/renders/preview',
      headers: auth(authorSecret),
      payload: { templateVersionId, format: 'text' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.toLowerCase()).toContain('account summary');
    expect(res.body).toContain('Balance Due');
  });
});
