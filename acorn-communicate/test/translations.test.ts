import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type { ContentObject, RequestCtx } from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTranslationService } from '../src/domains/translations/index.js';

const TENANT = 'ten_translations_test';

// author also holds compliance-approver so the SoD test fails on SoD, not on roles
const author: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_author',
  roles: ['business-author', 'compliance-approver'],
  keyId: 'key_author',
};

const approver: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_approver',
  roles: ['compliance-approver'],
  keyId: 'key_approver',
};

const admin: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_admin',
  roles: ['tenant-admin'],
  keyId: 'key_admin',
};

const PLACEHOLDER = '{{account.balanceDue|currency}}';

describe('translations domain', () => {
  let ctx: PlatformContext;
  let disclosure: ContentObject;
  let firstEsId: string;

  /** create + approve an English content object (approver reviews, never the author) */
  function approvedContent(key: string, title: string, body: string): ContentObject {
    const { content, version } = ctx.services.content.createContent(author, {
      key,
      type: 'disclosure',
      title,
      body,
    });
    ctx.services.content.submitForReview(author, version.id);
    ctx.services.content.review(approver, version.id, 'approved');
    return ctx.services.content.getContent(author, content.id);
  }

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.translations = createTranslationService(ctx);

    disclosure = approvedContent(
      'disclosure.billing',
      'Billing Rights Notice',
      `Your account balance is ${PLACEHOLDER}. ` +
        'Please make your minimum payment before the due date. ' +
        'You may dispute a charge within 60 days.',
    );
  });

  it('translates an approved English disclosure into a Spanish draft, preserving placeholders', async () => {
    const t = await ctx.services.translations.translateContent(author, disclosure.id, 'es');
    firstEsId = t.id;
    expect(t.id).toMatch(/^tnl_/);
    expect(t.status).toBe('draft');
    expect(t.method).toBe('dictionary');
    expect(t.aiAssisted).toBe(true);
    expect(t.locale).toBe('es');
    expect(t.sourceVersionId).toBe(disclosure.approvedVersionId);
    // known dictionary mappings appear
    expect(t.body).toContain('saldo');
    expect(t.body).toContain('pago mínimo');
    expect(t.body).toContain('dentro de 60 días');
    expect(t.title.toLowerCase()).toContain('aviso'); // Notice → Aviso
    // interpolation placeholders survive verbatim
    expect(t.body).toContain(PLACEHOLDER);
    expect(t.body).not.toContain('\u0000');
  });

  it('enforces segregation of duties on review; a different approver can approve', () => {
    try {
      ctx.services.translations.review(author, firstEsId, 'approved');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(403);
      expect((err as PlatformError).message).toContain('segregation of duties');
    }
    const approved = ctx.services.translations.review(approver, firstEsId, 'approved', 'ok');
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe(approver.actorId);
    expect(approved.reviewedAt).toBeTruthy();
  });

  it('resolveContent matches es-MX to the approved es translation and falls back for de', () => {
    const es = ctx.services.translations.resolveContent(TENANT, 'disclosure.billing', 'es-MX');
    expect(es).toBeDefined();
    expect(es!.ref).toBe(firstEsId);
    expect(es!.ref).toMatch(/^tnl_/);
    expect(es!.locale).toBe('es');
    expect(es!.body).toContain('saldo');

    const de = ctx.services.translations.resolveContent(TENANT, 'disclosure.billing', 'de');
    expect(de).toBeDefined();
    expect(de!.ref).toBe(disclosure.approvedVersionId);
    expect(de!.ref).toMatch(/^cnv_/);
    expect(de!.locale).toBe('en-US');
    expect(de!.title).toBe('Billing Rights Notice');

    expect(
      ctx.services.translations.resolveContent(TENANT, 'no.such.key', 'es'),
    ).toBeUndefined();
  });

  it('approving a second es translation retires the first', async () => {
    const second = await ctx.services.translations.translateContent(admin, disclosure.id, 'es');
    expect(second.status).toBe('draft');
    // every sentence was already stored in translation memory by the first run
    expect(second.memoryHits).toBeGreaterThanOrEqual(1);

    const approved = ctx.services.translations.review(approver, second.id, 'approved');
    expect(approved.status).toBe('approved');
    const all = ctx.services.translations.list(author, disclosure.id);
    const first = all.find((t) => t.id === firstEsId);
    expect(first?.status).toBe('retired');
    // resolution now points at the newest approved variant
    const es = ctx.services.translations.resolveContent(TENANT, 'disclosure.billing', 'es');
    expect(es!.ref).toBe(second.id);
  });

  it('reuses translation memory across content objects sharing a sentence', async () => {
    const late = approvedContent(
      'notice.late',
      'Late Payment Notice',
      'A late fee may apply. Please make your minimum payment before the due date.',
    );
    const t = await ctx.services.translations.translateContent(author, late.id, 'es');
    // the shared sentence is served from memory
    expect(t.memoryHits).toBeGreaterThanOrEqual(1);
    expect(t.body).toContain('pago mínimo');
    expect(ctx.services.translations.memoryStats(author).entries).toBeGreaterThan(0);
  });

  it('rejects unsupported machine-translation locales and same-locale requests', async () => {
    await expect(
      ctx.services.translations.translateContent(author, disclosure.id, 'ja'),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('unsupported machine-translation locale'),
    });
    // target locale equal to the source version's locale is refused
    await expect(
      ctx.services.translations.translateContent(author, disclosure.id, 'en-US'),
    ).rejects.toMatchObject({ status: 400 });
  });
});
