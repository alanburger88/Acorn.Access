import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type { ComposedDocument, RenderArtifact, TemplateVersion } from '../src/kernel/contracts.js';
import { createRenderingService, RENDERER_VERSION } from '../src/domains/rendering/index.js';
import { renderHtml } from '../src/domains/rendering/html.js';
import { renderPdf } from '../src/domains/rendering/pdf.js';
import { renderEmail } from '../src/domains/rendering/email.js';
import { renderSms, renderText } from '../src/domains/rendering/text.js';

const fixtureDoc: ComposedDocument = {
  title: 'Monthly Statement',
  brand: { name: 'Acorn Bank', primaryColor: '#1a365d', accentColor: '#2b6cb0', logoText: 'ACORN' },
  customerName: 'Casey Customer',
  locale: 'en-US',
  intendedOutcome: 'payment_completed',
  sections: [
    {
      id: 'overview',
      title: 'Overview',
      collapsible: false,
      lines: [
        { kind: 'summary', title: 'Your statement', text: 'Balance due is $1,250.00.' },
        { kind: 'field-row', label: 'Amount due', value: '$1,250.00' },
        // hostile value: must be escaped in every HTML surface
        { kind: 'field-row', label: 'Memo', value: '<script>alert("xss")</script>' },
        { kind: 'action', action: 'pay', label: 'Pay now' },
      ],
    },
    {
      id: 'charges',
      title: 'Charges this period',
      collapsible: true,
      explanation: 'Every transaction posted to your account this cycle.',
      lines: [
        {
          kind: 'table',
          title: 'Transactions',
          headers: ['Date', 'Description', 'Amount'],
          aligns: ['left', 'left', 'right'],
          rows: [
            ['2026-06-01', 'Coffee shop', '$4.50'],
            ['2026-06-14', 'Grocery store', '$82.10'],
          ],
        },
        { kind: 'content', contentKey: 'disclosure.efunds', contentVersionId: 'cnv_TEST', title: 'Disclosure', text: 'Standard disclosure text.' },
        { kind: 'divider' },
        { kind: 'text', text: 'Thank you for banking with us.' },
      ],
    },
  ],
  contentVersionIds: ['cnv_TEST'],
};

const emailChannel = { subject: 'Your statement for {{period}}' };
const rawData = { period: 'June 2026', customer: { firstName: 'Casey' } };

describe('rendering domain', () => {
  let ctx: PlatformContext;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.rendering = createRenderingService(ctx);
  });

  it('html renderer emits the viewer contract structure', () => {
    const { buf, contentType } = renderHtml(fixtureDoc);
    const html = buf.toString('utf8');
    expect(contentType).toBe('text/html; charset=utf-8');
    expect(html).toContain('data-section-id="overview"');
    expect(html).toContain('data-section-id="charges"');
    // collapsible section renders as an open <details>
    expect(html).toContain('<details class="doc-section" data-section-id="charges" open>');
    expect(html).toContain('<summary>Charges this period</summary>');
    expect(html).toContain('data-content-version="cnv_TEST"');
    expect(html).toContain('data-action="pay"');
    // no scripts of our own, and hostile values are escaped
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('pdf renderer produces a real PDF of nontrivial size', async () => {
    const { buf, contentType } = await renderPdf(fixtureDoc);
    expect(contentType).toBe('application/pdf');
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('email renderer puts the interpolated subject on the first line and keeps {{link}}', () => {
    const { buf } = renderEmail(fixtureDoc, emailChannel, rawData);
    const html = buf.toString('utf8');
    const firstLine = html.split('\n')[0]!;
    expect(firstLine).toContain('<!--subject:');
    expect(firstLine).toContain('Your statement for June 2026');
    expect(html).toContain('href="{{link}}"');
    expect(html).toContain('This is a service communication regarding your account.');
  });

  it('text renderer includes fields, ruled headings and padded table columns', () => {
    const { buf, contentType } = renderText(fixtureDoc);
    const text = buf.toString('utf8');
    expect(contentType).toBe('text/plain; charset=utf-8');
    expect(text).toContain('Monthly Statement');
    expect(text).toContain('Amount due: $1,250.00');
    expect(text).toContain('CHARGES THIS PERIOD');
    expect(text).toMatch(/Date\s+Description\s+Amount/);
  });

  it('sms interpolation substitutes data paths but preserves the literal {{link}}', () => {
    const { buf } = renderSms('Hi {{customer.firstName}}, your {{period}} statement: {{link}}', rawData);
    expect(buf.toString('utf8')).toBe('Hi Casey, your June 2026 statement: {{link}}');
  });

  it('renderPreview renders a format without persisting artifacts', async () => {
    const templateVersion = {
      channels: { email: emailChannel },
      dataContract: { fields: [], sample: rawData },
    } as unknown as TemplateVersion;
    const preview = await ctx.services.rendering.renderPreview({
      doc: fixtureDoc,
      format: 'email-html',
      templateVersion,
    });
    expect(preview.buf.toString('utf8')).toContain('{{link}}');
    expect(ctx.store.collection<RenderArtifact>('artifacts').listAll()).toEqual([]);
    expect(ctx.services.rendering.rendererVersion).toBe(RENDERER_VERSION);
  });
});
