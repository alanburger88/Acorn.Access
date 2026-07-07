import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type { RequestCtx } from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';

const TENANT = 'ten_content_test';

const author: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_author',
  roles: ['business-author', 'compliance-approver'],
  keyId: 'key_author',
};

const reviewer: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_reviewer',
  roles: ['compliance-approver'],
  keyId: 'key_reviewer',
};

describe('content domain', () => {
  let ctx: PlatformContext;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
  });

  it('creates content with a v1 draft and advisory scores', () => {
    const { content, version } = ctx.services.content.createContent(author, {
      key: 'disclosure.efunds',
      type: 'disclosure',
      title: 'Electronic Funds Disclosure',
      body: 'A late payment may incur a penalty fee. Contact us with questions.',
    });
    expect(content.id).toMatch(/^cnt_/);
    expect(content.latestVersionId).toBe(version.id);
    expect(version.version).toBe(1);
    expect(version.status).toBe('draft');
    expect(version.scores?.readingLevel).toBeGreaterThanOrEqual(0);
    expect(version.scores?.sentiment).toBe('negative');
  });

  it('rejects a duplicate key in the same tenant with 409 conflict', () => {
    try {
      ctx.services.content.createContent(author, {
        key: 'disclosure.efunds',
        type: 'disclosure',
        title: 'Duplicate',
        body: 'Duplicate body.',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(409);
      expect((err as PlatformError).code).toBe('conflict');
    }
  });

  it('newVersion bumps the version number and updates latestVersionId', () => {
    const { content } = ctx.services.content.createContent(author, {
      key: 'faq.billing',
      type: 'faq',
      title: 'Billing FAQ',
      body: 'How do I read my statement?',
    });
    const v2 = ctx.services.content.newVersion(author, content.id, {
      body: 'How do I read my statement? See the summary section.',
      aiAssisted: true,
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('draft');
    expect(v2.aiAssisted).toBe(true);
    const refreshed = ctx.services.content.getContent(author, content.id);
    expect(refreshed.latestVersionId).toBe(v2.id);
  });

  it('segregation of duties: the author cannot approve their own version', () => {
    const { content, version } = ctx.services.content.createContent(author, {
      key: 'clause.sod',
      type: 'clause',
      title: 'SoD Clause',
      body: 'This clause tests segregation of duties.',
    });
    ctx.services.content.submitForReview(author, version.id);
    // author holds compliance-approver too, so this fails on SoD, not on roles
    try {
      ctx.services.content.review(author, version.id, 'approved');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(403);
      expect((err as PlatformError).message).toContain('segregation of duties');
    }
    // a different approver succeeds
    const approved = ctx.services.content.review(reviewer, version.id, 'approved', 'looks good');
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe(reviewer.actorId);
    const byKey = ctx.services.content.getByKey(TENANT, 'clause.sod');
    expect(byKey?.content.approvedVersionId).toBe(version.id);
    expect(byKey?.approved?.id).toBe(version.id);
    expect(content.id).toBe(byKey?.content.id);
  });

  it('approving a new version retires the previously approved one', () => {
    const { content, version: v1 } = ctx.services.content.createContent(author, {
      key: 'disclosure.retire',
      type: 'disclosure',
      title: 'Retirement Disclosure',
      body: 'Original body of the disclosure.',
    });
    ctx.services.content.submitForReview(author, v1.id);
    ctx.services.content.review(reviewer, v1.id, 'approved');

    const v2 = ctx.services.content.newVersion(author, content.id, {
      body: 'Updated body of the disclosure.',
    });
    ctx.services.content.submitForReview(author, v2.id);
    ctx.services.content.review(reviewer, v2.id, 'approved');

    const oldV1 = ctx.services.content.getVersion(TENANT, v1.id);
    expect(oldV1?.status).toBe('retired');
    const refreshed = ctx.services.content.getContent(author, content.id);
    expect(refreshed.approvedVersionId).toBe(v2.id);
  });

  it('only draft versions can be submitted for review', () => {
    const byKey = ctx.services.content.getByKey(TENANT, 'disclosure.retire');
    expect(() =>
      ctx.services.content.submitForReview(author, byKey!.approved!.id),
    ).toThrowError(PlatformError);
  });

  it('search finds content by a term in the latest version body', () => {
    ctx.services.content.createContent(author, {
      key: 'faq.overdraft',
      type: 'faq',
      title: 'Overdraft FAQ',
      body: 'An overdraft happens when your zebrafish account balance goes below zero.',
    });
    const hits = ctx.services.content.search(TENANT, 'zebrafish');
    expect(hits.length).toBe(1);
    expect(hits[0]!.content.key).toBe('faq.overdraft');
    expect(hits[0]!.score).toBeGreaterThan(0);
    // zero-score results are excluded
    expect(ctx.services.content.search(TENANT, 'xylophonequark')).toEqual([]);
  });
});
