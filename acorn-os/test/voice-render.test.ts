/**
 * Regression tests for the SSML voice-script renderer:
 *  (a) unit — output is well-formed SSML, escapes hostile field values, and
 *      speaks the customer name / section explanation / action options;
 *  (b) determinism — the same document renders byte-identical buffers (archive
 *      reproducibility);
 *  (c) integration — a composed communication exposes a downloadable
 *      'voice-script' artifact with the ssml content type.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';
import type { ComposedDocument } from '../src/kernel/contracts.js';
import { renderVoiceScript } from '../src/domains/rendering/voice.js';

const SSML_CONTENT_TYPE = 'application/ssml+xml; charset=utf-8';

function makeDoc(): ComposedDocument {
  return {
    title: 'Your June Statement',
    brand: { name: 'Acorn & Co', primaryColor: '#004225', accentColor: '#e07a00', logoText: 'ACORN' },
    customerName: 'Casey Customer',
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [
      {
        id: 'summary',
        title: 'Account Summary',
        collapsible: false,
        explanation: 'What you owe and when it is due.',
        lines: [
          { kind: 'summary', title: 'Balance', text: 'Your balance is due soon.' },
          // Hostile value: must be XML-escaped, never emitted raw.
          { kind: 'field-row', label: 'Balance Due', value: '<script>alert(1)</script> & more' },
          { kind: 'action', action: 'pay', label: 'Pay now' },
        ],
      },
    ],
    contentVersionIds: [],
  };
}

// ---------------------------------------------------------------------------
// (a) unit
// ---------------------------------------------------------------------------

describe('renderVoiceScript (unit)', () => {
  it('emits well-formed, escaped SSML with the expected spoken content', () => {
    const { buf, contentType } = renderVoiceScript(makeDoc());
    const ssml = buf.toString('utf8');

    expect(ssml.startsWith('<?xml')).toBe(true);
    expect(ssml).toContain('<speak');
    expect(ssml).toContain('</speak>');
    expect(ssml).toContain('Casey Customer');
    expect(ssml).toContain('What you owe and when it is due.');
    // 'pay' action is spoken as its human phrase.
    expect(ssml).toContain('to make a payment');

    // Hostile field value is XML-escaped: no raw markup, escaped entities present.
    expect(ssml).not.toContain('<script>');
    expect(ssml).toContain('&lt;script&gt;');
    expect(ssml).toContain('&amp;');

    expect(contentType).toBe(SSML_CONTENT_TYPE);
  });
});

// ---------------------------------------------------------------------------
// (b) determinism
// ---------------------------------------------------------------------------

describe('renderVoiceScript (determinism)', () => {
  it('renders byte-identical buffers for the same document', () => {
    const first = renderVoiceScript(makeDoc()).buf;
    const second = renderVoiceScript(makeDoc()).buf;
    expect(first.equals(second)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) integration — voice-script artifact over the HTTP API
// ---------------------------------------------------------------------------

describe('voice-script artifact (integration)', () => {
  let platform: Platform;
  let adminSecret: string;
  let communicationId = '';
  const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

  beforeAll(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-voice-'));
    platform = buildPlatform(
      configFromEnv({
        dataDir: tmp,
        outboxDir: join(tmp, 'outbox'),
        baseUrl: 'http://voice.local',
        port: 0,
        anthropicApiKey: undefined,
      }),
    );
    await platform.app.ready();

    // tenant-admin key passes every role gate implicitly.
    const tenant = await platform.app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Voice CU', industry: 'credit-union' },
    });
    adminSecret = tenant.json().adminKey.secret;

    const customer = await platform.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: auth(adminSecret),
      payload: { name: 'Casey Customer', email: 'casey@example.com', locale: 'en-US' },
    });
    const customerId = customer.json().id;

    const brand = await platform.app.inject({
      method: 'POST',
      url: '/v1/brands',
      headers: auth(adminSecret),
      payload: {
        name: 'Voice CU',
        primaryColor: '#004225',
        accentColor: '#e07a00',
        logoText: 'Voice CU',
        fromEmail: 'no-reply@voice.example',
        fromSms: 'VOICECU',
      },
    });
    const brandId = brand.json().id;

    const template = await platform.app.inject({
      method: 'POST',
      url: '/v1/templates',
      headers: auth(adminSecret),
      payload: {
        key: 'voice-statement',
        name: 'Voice Statement',
        communicationType: 'statement',
        brandId,
        intendedOutcome: 'payment_completed',
        dataContract: {
          fields: [
            { path: 'period', type: 'string', required: true },
            { path: 'account.balanceDue', type: 'number', required: true },
          ],
          sample: { period: 'June 2026', account: { balanceDue: 120.5 } },
        },
        blocks: [
          {
            kind: 'summary',
            title: 'Your {{period}} statement',
            text: 'Your balance of {{account.balanceDue|currency}} is due soon.',
          },
          {
            kind: 'section',
            id: 'summary',
            title: 'Account Summary',
            explanation: 'What you owe and when it is due.',
            blocks: [{ kind: 'field-row', label: 'Balance Due', value: '{{account.balanceDue|currency}}' }],
          },
          {
            kind: 'section',
            id: 'actions',
            title: 'Take action',
            explanation: 'Complete your payment without calling us.',
            blocks: [{ kind: 'action', action: 'pay', label: 'Pay now' }],
          },
        ],
      },
    });
    expect([200, 201]).toContain(template.statusCode);
    const versionId = template.json().version.id;

    const publish = await platform.app.inject({
      method: 'POST',
      url: `/v1/template-versions/${versionId}/publish`,
      headers: auth(adminSecret),
    });
    expect([200, 201]).toContain(publish.statusCode);

    const communication = await platform.app.inject({
      method: 'POST',
      url: '/v1/communications',
      headers: auth(adminSecret),
      payload: {
        templateId: template.json().template.id,
        customerId,
        data: { period: 'June 2026', account: { balanceDue: 245.1 } },
      },
    });
    expect([200, 201]).toContain(communication.statusCode);
    communicationId = communication.json().id;
  });

  afterAll(async () => {
    await platform.app.close();
  });

  it('lists a voice-script artifact and downloads it as SSML', async () => {
    const artifacts = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}/artifacts`,
      headers: auth(adminSecret),
    });
    const voice = (artifacts.json() as { format: string; contentType: string }[]).find(
      (a) => a.format === 'voice-script',
    );
    expect(voice).toBeDefined();
    expect(voice!.contentType).toBe(SSML_CONTENT_TYPE);

    const download = await platform.app.inject({
      method: 'GET',
      url: `/v1/communications/${communicationId}/artifacts/voice-script/download`,
      headers: auth(adminSecret),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe(SSML_CONTENT_TYPE);
    expect(download.body.startsWith('<?xml')).toBe(true);
    expect(download.body).toContain('<speak');
    expect(download.body).toContain('to make a payment');
  });
});
