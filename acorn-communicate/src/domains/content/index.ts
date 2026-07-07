/**
 * CONTENT bounded context — reusable content objects (clauses, disclosures,
 * FAQs...) with versioning, a review workflow enforcing segregation of duties,
 * advisory readability/sentiment scoring, and a simple search index.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ContentObject,
  ContentService,
  ContentType,
  ContentVersion,
  RequestCtx,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { conflict, forbidden, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/content';

// ---------------------------------------------------------------------------
// Advisory scoring
// ---------------------------------------------------------------------------

const NEGATIVE_WORDS = [
  'overdue',
  'penalty',
  'failure',
  'failed',
  'denied',
  'declined',
  'late',
  'delinquent',
  'unfortunately',
  'regret',
  'error',
  'problem',
  'urgent',
  'warning',
  'cancel',
  'cancelled',
  'suspended',
  'collections',
];

const POSITIVE_WORDS = [
  'thank',
  'thanks',
  'welcome',
  'congratulations',
  'great',
  'pleased',
  'happy',
  'glad',
  'appreciate',
  'reward',
  'bonus',
  'enjoy',
  'good',
  'free',
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

/** Syllable estimate: count of vowel groups, minimum 1 per word. */
function syllables(word: string): number {
  const groups = word.match(/[aeiouy]+/g);
  return groups ? groups.length : 1;
}

/** Simple Flesch-Kincaid grade estimate. */
function readingLevel(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const ws = words(text);
  if (sentences.length === 0 || ws.length === 0) return 0;
  const syllableCount = ws.reduce((sum, w) => sum + syllables(w), 0);
  const grade =
    0.39 * (ws.length / sentences.length) + 11.8 * (syllableCount / ws.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

/** Keyword-heuristic sentiment over the body text. */
function sentiment(text: string): 'negative' | 'neutral' | 'positive' {
  const ws = words(text);
  let score = 0;
  for (const w of ws) {
    if (NEGATIVE_WORDS.some((kw) => w === kw || w.startsWith(kw))) score -= 1;
    else if (POSITIVE_WORDS.some((kw) => w === kw || w.startsWith(kw))) score += 1;
  }
  if (score < 0) return 'negative';
  if (score > 0) return 'positive';
  return 'neutral';
}

function computeScores(body: string): NonNullable<ContentVersion['scores']> {
  return { readingLevel: readingLevel(body), sentiment: sentiment(body) };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const REVIEW_ROLES = ['compliance-approver', 'tenant-admin'] as const;

export function createContentService(ctx: PlatformContext): ContentService {
  const contents = ctx.store.collection<ContentObject>('contentObjects');
  const versions = ctx.store.collection<ContentVersion>('contentVersions');

  function mustGetContent(tenantId: string, contentId: string): ContentObject {
    const content = contents.getFor(tenantId, contentId);
    if (!content) throw notFound('content', contentId);
    return content;
  }

  function mustGetVersion(tenantId: string, versionId: string): ContentVersion {
    const version = versions.getFor(tenantId, versionId);
    if (!version) throw notFound('content version', versionId);
    return version;
  }

  function latestVersionOf(content: ContentObject): ContentVersion | undefined {
    if (content.latestVersionId) {
      const latest = versions.get(content.latestVersionId);
      if (latest) return latest;
    }
    const all = versions.list(content.tenantId, (v) => v.contentId === content.id);
    return all.sort((a, b) => b.version - a.version)[0];
  }

  const service: ContentService = {
    createContent(rctx, args) {
      const duplicate = contents
        .list(rctx.tenantId, (c) => c.key === args.key)
        .at(0);
      if (duplicate) throw conflict(`content with key '${args.key}' already exists`);

      const now = new Date().toISOString();
      const content: ContentObject = {
        id: newId('cnt'),
        tenantId: rctx.tenantId,
        key: args.key,
        type: args.type,
        title: args.title,
        ownerId: rctx.actorId,
        createdAt: now,
      };
      const version: ContentVersion = {
        id: newId('cnv'),
        tenantId: rctx.tenantId,
        contentId: content.id,
        version: 1,
        body: args.body,
        locale: args.locale ?? 'en-US',
        status: 'draft',
        authorId: rctx.actorId,
        createdAt: now,
        scores: computeScores(args.body),
        aiAssisted: false,
      };
      content.latestVersionId = version.id;
      contents.put(content);
      versions.put(version);
      void ctx.publish({
        type: 'com.acorn.content.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: content.id,
        data: { key: content.key, type: content.type, versionId: version.id },
      });
      return { content, version };
    },

    newVersion(rctx, contentId, args) {
      const content = mustGetContent(rctx.tenantId, contentId);
      const all = versions.list(rctx.tenantId, (v) => v.contentId === contentId);
      const next = all.reduce((max, v) => Math.max(max, v.version), 0) + 1;
      const latest = latestVersionOf(content);
      const version: ContentVersion = {
        id: newId('cnv'),
        tenantId: rctx.tenantId,
        contentId,
        version: next,
        body: args.body,
        locale: latest?.locale ?? 'en-US',
        status: 'draft',
        authorId: rctx.actorId,
        createdAt: new Date().toISOString(),
        scores: computeScores(args.body),
        aiAssisted: args.aiAssisted ?? false,
      };
      versions.put(version);
      contents.put({ ...content, latestVersionId: version.id });
      return version;
    },

    submitForReview(rctx, versionId) {
      const version = mustGetVersion(rctx.tenantId, versionId);
      if (version.status !== 'draft') {
        throw conflict(`only draft versions can be submitted (status is '${version.status}')`);
      }
      const updated: ContentVersion = {
        ...version,
        status: 'in-review',
        submittedAt: new Date().toISOString(),
      };
      versions.put(updated);
      void ctx.publish({
        type: 'com.acorn.content.submitted',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: updated.id,
        data: { contentId: updated.contentId, version: updated.version },
      });
      return updated;
    },

    review(rctx, versionId, decision, note) {
      const version = mustGetVersion(rctx.tenantId, versionId);
      if (!REVIEW_ROLES.some((r) => rctx.roles.includes(r))) {
        throw forbidden(`requires one of roles: ${REVIEW_ROLES.join(', ')}`);
      }
      // Segregation of duties: the author of a version may never approve it.
      if (rctx.actorId === version.authorId) {
        throw forbidden('segregation of duties: author cannot approve own content');
      }
      if (version.status !== 'in-review') {
        throw conflict(`only in-review versions can be reviewed (status is '${version.status}')`);
      }
      const now = new Date().toISOString();
      const updated: ContentVersion = {
        ...version,
        status: decision,
        reviewedBy: rctx.actorId,
        reviewedAt: now,
        ...(note !== undefined ? { reviewNote: note } : {}),
      };
      versions.put(updated);
      if (decision === 'approved') {
        const content = mustGetContent(rctx.tenantId, version.contentId);
        // Retire the previously approved version, if any.
        if (content.approvedVersionId && content.approvedVersionId !== updated.id) {
          const previous = versions.get(content.approvedVersionId);
          if (previous) versions.put({ ...previous, status: 'retired' });
        }
        contents.put({ ...content, approvedVersionId: updated.id });
      }
      void ctx.publish({
        type: 'com.acorn.content.reviewed',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: updated.id,
        data: { contentId: updated.contentId, decision, reviewedBy: rctx.actorId },
      });
      return updated;
    },

    getContent(rctx, contentId) {
      return mustGetContent(rctx.tenantId, contentId);
    },

    getByKey(tenantId, key) {
      const content = contents.list(tenantId, (c) => c.key === key).at(0);
      if (!content) return undefined;
      const approved = content.approvedVersionId
        ? versions.getFor(tenantId, content.approvedVersionId)
        : undefined;
      return approved ? { content, approved } : { content };
    },

    listContent(rctx, type) {
      return contents.list(rctx.tenantId, (c) => (type ? c.type === type : true));
    },

    listVersions(rctx, contentId) {
      mustGetContent(rctx.tenantId, contentId);
      return versions
        .list(rctx.tenantId, (v) => v.contentId === contentId)
        .sort((a, b) => a.version - b.version);
    },

    getVersion(tenantId, versionId) {
      return versions.getFor(tenantId, versionId);
    },

    search(tenantId, query) {
      const terms = words(query);
      if (terms.length === 0) return [];
      const results: { content: ContentObject; version: ContentVersion; score: number }[] = [];
      for (const content of contents.list(tenantId)) {
        const latest = latestVersionOf(content);
        if (!latest) continue;
        const tokens = words(`${content.title} ${latest.body}`);
        let score = 0;
        for (const term of terms) {
          for (const token of tokens) if (token === term) score += 1;
        }
        if (score > 0) results.push({ content, version: latest, score });
      }
      return results.sort((a, b) => b.score - a.score).slice(0, 20);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const AUTHOR_ROLES = ['business-author', 'designer'] as const;

const createContentSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['block', 'clause', 'disclosure', 'faq', 'tooltip']),
  title: z.string().min(1),
  body: z.string().min(1),
  locale: z.string().optional(),
});

const newVersionSchema = z.object({
  body: z.string().min(1),
  aiAssisted: z.boolean().optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
});

export function registerContentRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.content;

  app.post('/v1/content', async (req, reply) => {
    const rctx: RequestCtx = requireAuth(ctx, req, [...AUTHOR_ROLES]);
    const body = parseBody(createContentSchema, req.body);
    const result = svc().createContent(rctx, body);
    reply.status(201).send(result);
  });

  app.get('/v1/content', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { type } = req.query as { type?: ContentType };
    return svc().listContent(rctx, type);
  });

  app.get('/v1/content/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().getContent(rctx, id);
  });

  app.get('/v1/content/:id/versions', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().listVersions(rctx, id);
  });

  app.post('/v1/content/:id/versions', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...AUTHOR_ROLES]);
    const { id } = req.params as { id: string };
    const body = parseBody(newVersionSchema, req.body);
    reply.status(201).send(svc().newVersion(rctx, id, body));
  });

  app.post('/v1/content-versions/:id/submit', async (req) => {
    const rctx = requireAuth(ctx, req, [...AUTHOR_ROLES]);
    const { id } = req.params as { id: string };
    return svc().submitForReview(rctx, id);
  });

  app.post('/v1/content-versions/:id/review', async (req) => {
    const rctx = requireAuth(ctx, req, ['compliance-approver']);
    const { id } = req.params as { id: string };
    const body = parseBody(reviewSchema, req.body);
    return svc().review(rctx, id, body.decision, body.note);
  });

  app.get('/v1/content-search', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { q } = req.query as { q?: string };
    return svc().search(rctx.tenantId, q ?? '');
  });
}
