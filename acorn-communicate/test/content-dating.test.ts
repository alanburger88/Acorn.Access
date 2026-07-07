/**
 * Content effective/expiry DATE ENFORCEMENT.
 *
 * Exercises the compliance rule that an expired (or not-yet-effective) approved
 * content version must not be surfaced by getByKey / resolveContent, and must
 * block composition. All dates are injected relative to Date.now() so the suite
 * is deterministic.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type {
  Brand,
  ContentTranslation,
  ContentVersion,
  Customer,
  RequestCtx,
  TemplateBlock,
} from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTranslationService } from '../src/domains/translations/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';
import { createRenderingService } from '../src/domains/rendering/index.js';
import { createCompositionService } from '../src/domains/composition/index.js';

const TENANT = 'ten_dating_test';

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

const HOUR = 3_600_000;
const past = () => new Date(Date.now() - HOUR).toISOString();
const future = () => new Date(Date.now() + HOUR).toISOString();

/**
 * Dates are accepted permissively (the ContentService contract signature is
 * fixed), so createContent/newVersion take them via an extended args object.
 */
type DatedCreate = Parameters<ReturnType<typeof createContentService>['createContent']>[1] & {
  effectiveFrom?: string;
  expiresAt?: string;
};

describe('content effective/expiry dating', () => {
  let ctx: PlatformContext;

  /** create + approve a version (second actor approves — segregation of duties) */
  function createApproved(args: DatedCreate): { contentId: string; versionId: string } {
    const { content, version } = ctx.services.content.createContent(author, args);
    ctx.services.content.submitForReview(author, version.id);
    ctx.services.content.review(approver, version.id, 'approved');
    return { contentId: content.id, versionId: version.id };
  }

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.translations = createTranslationService(ctx);
    ctx.services.templates = createTemplateService(ctx);
    ctx.services.rendering = createRenderingService(ctx);
    ctx.services.composition = createCompositionService(ctx);
  });

  // (a) expiresAt in the past hides the approved version; future keeps it.
  it('getByKey hides an approved version whose expiresAt is in the past', () => {
    const { versionId } = createApproved({
      key: 'disclosure.expired',
      type: 'disclosure',
      title: 'Expired Disclosure',
      body: 'This disclosure is no longer effective.',
      expiresAt: past(),
    });
    const byKey = ctx.services.content.getByKey(TENANT, 'disclosure.expired');
    expect(byKey).toBeDefined();
    expect(byKey!.approved).toBeUndefined();
    // The content still tracks the approved version (admin/debug path).
    expect(byKey!.content.approvedVersionId).toBe(versionId);
    expect(ctx.services.content.getVersion(TENANT, versionId)?.status).toBe('approved');
  });

  it('getByKey surfaces an approved version whose expiresAt is in the future', () => {
    const { versionId } = createApproved({
      key: 'disclosure.future-expiry',
      type: 'disclosure',
      title: 'Currently Effective Disclosure',
      body: 'This disclosure is effective now and expires later.',
      expiresAt: future(),
    });
    const byKey = ctx.services.content.getByKey(TENANT, 'disclosure.future-expiry');
    expect(byKey!.approved?.id).toBe(versionId);
  });

  // (b) effectiveFrom in the future hides it until effective; no dates = always active.
  it('getByKey hides an approved version whose effectiveFrom is in the future', () => {
    createApproved({
      key: 'disclosure.not-yet',
      type: 'disclosure',
      title: 'Not Yet Effective',
      body: 'This disclosure becomes effective later.',
      effectiveFrom: future(),
    });
    expect(ctx.services.content.getByKey(TENANT, 'disclosure.not-yet')!.approved).toBeUndefined();
  });

  it('getByKey always surfaces an approved version with no dates', () => {
    const { versionId } = createApproved({
      key: 'disclosure.undated',
      type: 'disclosure',
      title: 'Undated Disclosure',
      body: 'This disclosure has no effective window and is always active.',
    });
    expect(ctx.services.content.getByKey(TENANT, 'disclosure.undated')!.approved?.id).toBe(versionId);
  });

  // (c) validation: effectiveFrom must be on or before expiresAt.
  it('rejects effectiveFrom later than expiresAt on create', () => {
    try {
      ctx.services.content.createContent(author, {
        key: 'disclosure.badwindow',
        type: 'disclosure',
        title: 'Bad Window',
        body: 'The dates are inverted.',
        effectiveFrom: future(),
        expiresAt: past(),
      } as DatedCreate);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(400);
      expect((err as PlatformError).message).toContain('effectiveFrom');
    }
  });

  it('rejects effectiveFrom later than expiresAt on newVersion', () => {
    const { content } = ctx.services.content.createContent(author, {
      key: 'disclosure.version-window',
      type: 'disclosure',
      title: 'Version Window',
      body: 'Original body.',
    });
    expect(() =>
      ctx.services.content.newVersion(author, content.id, {
        body: 'Updated body with an inverted window.',
        effectiveFrom: future(),
        expiresAt: past(),
      } as { body: string }),
    ).toThrowError(PlatformError);
  });

  // (d) resolveContent respects expiry on both the translation and the source fallback.
  it('resolveContent falls back to source when the translation is expired, then undefined when source is also expired', async () => {
    const { contentId, versionId } = createApproved({
      key: 'disclosure.multilang',
      type: 'disclosure',
      title: 'Billing Rights Notice',
      body: 'Please make your minimum payment before the due date.',
    });

    // Translate to Spanish and approve it (second actor).
    const es = await ctx.services.translations.translateContent(author, contentId, 'es');
    const approvedEs = ctx.services.translations.review(approver, es.id, 'approved');
    expect(approvedEs.status).toBe('approved');

    // Sanity: the approved translation resolves for an es customer.
    const resolvedEs = ctx.services.translations.resolveContent(TENANT, 'disclosure.multilang', 'es');
    expect(resolvedEs?.ref).toBe(approvedEs.id);

    // Expire the translation (dates stored permissively on the entity) — it must
    // fall back to the still-effective approved source version.
    const trStore = ctx.store.collection<ContentTranslation>('contentTranslations');
    trStore.put({ ...approvedEs, expiresAt: past() } as ContentTranslation);
    const fellBack = ctx.services.translations.resolveContent(TENANT, 'disclosure.multilang', 'es');
    expect(fellBack?.ref).toBe(versionId);
    expect(fellBack?.body).toContain('minimum payment');

    // Now expire the source version too — nothing effective remains.
    const versionStore = ctx.store.collection<ContentVersion>('contentVersions');
    const src = ctx.services.content.getVersion(TENANT, versionId)!;
    versionStore.put({ ...src, expiresAt: past() });
    expect(
      ctx.services.translations.resolveContent(TENANT, 'disclosure.multilang', 'es'),
    ).toBeUndefined();
  });

  // (e) composition: a content-ref whose approved version has expired blocks compose.
  it('compose throws invalid mentioning the content key when the referenced disclosure has expired', async () => {
    // Seed a customer + brand for composition.
    ctx.store.collection<Customer>('customers').put({
      id: 'cus_DATING',
      tenantId: TENANT,
      name: 'Dana Dating',
      email: 'dana@example.com',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
    });
    ctx.store.collection<Brand>('brands').put({
      id: 'brd_DATING',
      tenantId: TENANT,
      name: 'Acorn Bank',
      primaryColor: '#1a365d',
      accentColor: '#2b6cb0',
      logoText: 'ACORN BANK',
      fromEmail: 'no-reply@acornbank.test',
      fromSms: 'ACORN',
    });

    // Approve the disclosure with a far-future expiry so publish passes while it
    // is effective.
    const { versionId } = createApproved({
      key: 'disclosure.compose-legal',
      type: 'disclosure',
      title: 'Legal Disclosure',
      body: 'Standard legal disclosure text.',
      expiresAt: future(),
    });

    const blocks: TemplateBlock[] = [
      {
        kind: 'section',
        id: 'legal',
        title: 'Important information',
        explanation: 'Required disclosures for this communication.',
        blocks: [{ kind: 'content-ref', contentKey: 'disclosure.compose-legal' }],
      },
    ];
    const { template, version } = ctx.services.templates.createTemplate(author, {
      key: 'dating-template',
      name: 'Dating Template',
      communicationType: 'notice',
      brandId: 'brd_DATING',
      dataContract: { fields: [], sample: {} },
      intendedOutcome: 'understood',
      blocks,
    });
    // Publish succeeds because the disclosure is currently effective.
    ctx.services.templates.publish(approver, version.id);

    // Simulate the disclosure expiring after publication.
    const versionStore = ctx.store.collection<ContentVersion>('contentVersions');
    const src = ctx.services.content.getVersion(TENANT, versionId)!;
    versionStore.put({ ...src, expiresAt: past() });

    // Compose must now fail, and the error must name the content key.
    await expect(
      ctx.services.composition.compose({
        tenantId: TENANT,
        templateId: template.id,
        customerId: 'cus_DATING',
        data: {},
      }),
    ).rejects.toThrowError(/disclosure\.compose-legal/);
  });
});
