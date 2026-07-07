import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import type { MigrationJob, RequestCtx, TemplateBlock } from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';
import { createRenderingService } from '../src/domains/rendering/index.js';
import { createMigrationService } from '../src/domains/migration/index.js';

const TENANT = 'ten_migration_test';

const author: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_author',
  roles: ['business-author', 'designer'],
  keyId: 'key_author',
};

// second actor for SoD on content approvals
const approver: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_approver',
  roles: ['compliance-approver'],
  keyId: 'key_approver',
};

// >= 25 words, no variable-shaped tokens — becomes a reusable-content candidate.
const DISCLOSURE_BODY =
  'Electronic funds transfers from your account are governed by the terms of your account ' +
  'agreement and by applicable federal regulations that protect consumers when errors or ' +
  'unauthorized transfers occur on covered accounts.';

const LEGACY_HTML = `<!doctype html>
<html><head><title>legacy</title>
<style>body { color: #333; }</style>
<script>console.log("stripped $9,999.99");</script>
</head><body>
<h1>Acorn Bank Monthly Statement</h1>
<h2>Account Summary</h2>
<p>Balance Due: $1,234.56</p>
<p>Due date: 2026-07-25</p>
<p>Account number: 1234-56789</p>
<h2>Recent Transactions</h2>
<table>
  <tr><th>Date</th><th>Description</th><th>Amount</th></tr>
  <tr><td>2026-06-30</td><td>Grocery Store</td><td>$45.10</td></tr>
</table>
<p>${DISCLOSURE_BODY}</p>
</body></html>`;

function flatten(blocks: TemplateBlock[], out: TemplateBlock[] = []): TemplateBlock[] {
  for (const b of blocks) {
    out.push(b);
    if (b.kind === 'section') flatten(b.blocks, out);
  }
  return out;
}

describe('migration studio domain', () => {
  let ctx: PlatformContext;
  let htmlJob: MigrationJob;

  beforeAll(async () => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.templates = createTemplateService(ctx);
    ctx.services.rendering = createRenderingService(ctx);
    ctx.services.migration = createMigrationService(ctx);

    // Approved disclosure that largely overlaps a paragraph of the fixture
    // (created by the author, approved by a second actor for SoD).
    const { version } = ctx.services.content.createContent(author, {
      key: 'disclosure.efunds',
      type: 'disclosure',
      title: 'Electronic Funds Disclosure',
      body: DISCLOSURE_BODY,
    });
    ctx.services.content.submitForReview(author, version.id);
    ctx.services.content.review(approver, version.id, 'approved');

    htmlJob = await ctx.services.migration.ingestLegacy(author, {
      name: 'Monthly Statement',
      sourceFormat: 'html',
      payload: LEGACY_HTML,
    });
  });

  it('(a) drafts a template from an HTML legacy statement', () => {
    expect(htmlJob.error).toBeUndefined();
    expect(htmlJob.status).toBe('drafted');
    expect(htmlJob.id).toMatch(/^mig_/);

    const all = flatten(htmlJob.extracted.blocks);
    const sections = all.filter((b) => b.kind === 'section');
    expect(sections.map((s) => (s.kind === 'section' ? s.id : ''))).toEqual(
      expect.arrayContaining(['account-summary', 'recent-transactions']),
    );
    const table = all.find((b) => b.kind === 'table');
    expect(table).toBeDefined();
    if (table?.kind === 'table') {
      expect(table.itemsPath).toBe('table1');
      expect(table.columns.map((c) => c.header)).toEqual(['Date', 'Description', 'Amount']);
      expect(table.columns.map((c) => c.valuePath)).toEqual(['col1', 'col2', 'col3']);
    }

    // variable detection: currency + date + account-like, substituted into block text
    const currency = htmlJob.extracted.variables.find((v) => v.kind === 'currency');
    expect(currency).toMatchObject({ path: 'balanceDue', sample: '$1,234.56' });
    const date = htmlJob.extracted.variables.find((v) => v.kind === 'date');
    expect(date).toMatchObject({ path: 'dueDate', sample: '2026-07-25' });
    const account = htmlJob.extracted.variables.find((v) => v.path === 'accountNumber');
    expect(account?.kind).toBe('text');

    const texts = all.filter((b) => b.kind === 'text').map((b) => (b.kind === 'text' ? b.text : ''));
    expect(texts.some((t) => t.includes('{{balanceDue|currency}}'))).toBe(true);
    expect(texts.some((t) => t.includes('{{dueDate|date}}'))).toBe(true);
    expect(texts.some((t) => t.includes('{{accountNumber}}'))).toBe(true);

    // complexity rubric applied and effort derived from it
    expect(htmlJob.complexityScore).toBeGreaterThan(0);
    expect(htmlJob.effortHours).toBe(Math.round(htmlJob.complexityScore * 0.4 * 10) / 10);

    // the draft template exists in 'templates', stays DRAFT, and its data
    // contract sample validates cleanly against its own contract
    const template = ctx.services.templates.getTemplate(author, htmlJob.draftTemplateId!);
    expect(template.key).toMatch(/^migrated-monthly-statement-\d+$/);
    expect(template.communicationType).toBe('migrated');
    expect(template.name).toBe('Acorn Bank Monthly Statement'); // h1 → title
    expect(template.publishedVersionId).toBeUndefined();
    const version = ctx.services.templates.getVersion(TENANT, htmlJob.draftVersionId!)!;
    expect(version.status).toBe('draft');
    expect(ctx.services.templates.validateData(version, version.dataContract.sample)).toEqual([]);
  });

  it('(b) matches a content candidate against an approved disclosure at >= 0.5 similarity', () => {
    const candidates = htmlJob.extracted.contentCandidates;
    expect(candidates.length).toBeGreaterThan(0);
    const hit = candidates.find((c) => c.similarTo?.contentKey === 'disclosure.efunds');
    expect(hit).toBeDefined();
    expect(hit!.similarTo!.similarity).toBeGreaterThanOrEqual(0.5);
    expect(hit!.title.endsWith('…')).toBe(true);
    expect(hit!.title).toBe('Electronic funds transfers from your account…');
  });

  it('(c) duplicateReport flags near-identical approved contents and skips dissimilar ones', () => {
    const bodyA =
      'If your payment arrives after the due date printed on the statement a late fee of up to ' +
      'thirty five dollars may be charged to your account balance immediately.';
    const bodyB = bodyA.replace('thirty five', 'twenty five');
    for (const [key, body] of [
      ['clause.late-fee-a', bodyA],
      ['clause.late-fee-b', bodyB],
    ] as const) {
      const { version } = ctx.services.content.createContent(author, {
        key,
        type: 'clause',
        title: key,
        body,
      });
      ctx.services.content.submitForReview(author, version.id);
      ctx.services.content.review(approver, version.id, 'approved');
    }

    const report = ctx.services.migration.duplicateReport(author);
    const pair = report.find(
      (p) =>
        [p.aKey, p.bKey].includes('clause.late-fee-a') && [p.aKey, p.bKey].includes('clause.late-fee-b'),
    );
    expect(pair).toBeDefined();
    expect(pair!.similarity).toBeGreaterThanOrEqual(0.7);
    expect(pair!.aContentId).not.toBe(pair!.bContentId); // no self-pairs
    // the unrelated disclosure never pairs with the late-fee clauses
    expect(report.some((p) => p.aKey === 'disclosure.efunds' || p.bKey === 'disclosure.efunds')).toBe(
      false,
    );
    // stricter threshold excludes the pair
    expect(ctx.services.migration.duplicateReport(author, 0.95)).toEqual([]);
  });

  it('(d) parallelRun matches a version against itself and diffs a modified copy', async () => {
    const blocks: TemplateBlock[] = [
      { kind: 'heading', level: 1, text: 'Payment Notice' },
      {
        kind: 'section',
        id: 'main',
        title: 'Main',
        explanation: 'What you owe.',
        blocks: [
          { kind: 'text', text: 'Your current amount owed is {{amount|currency}}.' },
          { kind: 'field-row', label: 'Amount', value: '{{amount|currency}}' },
        ],
      },
    ];
    const { template, version } = ctx.services.templates.createTemplate(author, {
      key: 'parallel-run-base',
      name: 'Parallel Run Base',
      communicationType: 'notice',
      brandId: 'brd_test',
      dataContract: {
        fields: [{ path: 'amount', type: 'number', required: true }],
        sample: { amount: 42.5 },
      },
      intendedOutcome: 'understood',
      blocks,
    });

    const same = await ctx.services.migration.parallelRun(author, {
      versionAId: version.id,
      versionBId: version.id,
    });
    expect(same.similarity).toBe(1);
    expect(same.matches).toBe(true);
    expect(same.addedLines).toEqual([]);
    expect(same.removedLines).toEqual([]);

    const modified: TemplateBlock[] = [
      blocks[0]!,
      {
        ...(blocks[1] as Extract<TemplateBlock, { kind: 'section' }>),
        blocks: [
          ...(blocks[1] as Extract<TemplateBlock, { kind: 'section' }>).blocks,
          { kind: 'text', text: 'An additional migration note appears only in version two.' },
        ],
      },
    ];
    const v2 = ctx.services.templates.newVersion(author, template.id, { blocks: modified });
    const diff = await ctx.services.migration.parallelRun(author, {
      versionAId: version.id,
      versionBId: v2.id,
    });
    expect(diff.matches).toBe(false);
    expect(diff.similarity).toBeLessThan(0.98);
    expect(diff.addedLines.length).toBeGreaterThan(0);
    expect(diff.addedLines.join(' ')).toContain('additional migration note');
  });

  it('(e) text-mode extraction produces field-rows from Label: value lines', async () => {
    const payload = [
      'WELCOME LETTER',
      '',
      'ACCOUNT DETAILS',
      'Balance Due: $50.00',
      'Due Date: 2026-08-01',
      '',
      'Thank you for choosing Acorn Bank for your everyday banking needs.',
    ].join('\n');

    const job = await ctx.services.migration.ingestLegacy(author, {
      name: 'Welcome Letter',
      sourceFormat: 'text',
      payload,
    });
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('drafted');

    const all = flatten(job.extracted.blocks);
    const section = all.find((b) => b.kind === 'section' && b.id === 'account-details');
    expect(section).toBeDefined();
    const rows = all.filter((b) => b.kind === 'field-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: 'Balance Due', value: '{{balanceDue|currency}}' });
    expect(rows[1]).toMatchObject({ label: 'Due Date', value: '{{dueDate|date}}' });
    // label-derived variables land in the suggested data contract
    const version = ctx.services.templates.getVersion(TENANT, job.draftVersionId!)!;
    expect(version.dataContract.fields.map((f) => f.path)).toEqual(
      expect.arrayContaining(['balanceDue', 'dueDate']),
    );
    expect(version.dataContract.sample['balanceDue']).toBe(50);
  });
});
