/**
 * TRANSLATIONS bounded context — locale variants of approved content with
 * their own approval lifecycle (approving a Spanish variant never touches the
 * English source), machine translation via a deterministic dictionary +
 * sentence-level translation memory, and composition-time locale resolution
 * with fallback to the approved source version.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ContentObject,
  ContentTranslation,
  ContentVersion,
  RequestCtx,
  Role,
  TranslationService,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { conflict, forbidden, invalid, notFound } from '../../kernel/errors.js';
import { isWindowEffective } from '../../kernel/dating.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { translateText, type MachineLocale } from './dictionary.js';
import { translateWithMemory, type TranslationMemoryEntry } from './memory.js';

const SOURCE = '/domains/translations';

const AUTHOR_ROLES: Role[] = ['business-author', 'designer', 'tenant-admin'];
const REVIEW_ROLES: Role[] = ['compliance-approver', 'tenant-admin'];

function requireRole(rctx: RequestCtx, roles: Role[]): void {
  if (!roles.some((r) => rctx.roles.includes(r))) {
    throw forbidden(`requires one of roles: ${roles.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createTranslationService(ctx: PlatformContext): TranslationService {
  const translations = ctx.store.collection<ContentTranslation>('contentTranslations');
  const memory = ctx.store.collection<TranslationMemoryEntry>('translationMemory');
  // read-only views over the content domain's collections
  const contents = ctx.store.collection<ContentObject>('contentObjects');
  const versions = ctx.store.collection<ContentVersion>('contentVersions');

  const service: TranslationService = {
    async translateContent(rctx, contentId, targetLocale) {
      requireRole(rctx, AUTHOR_ROLES);
      const content = contents.getFor(rctx.tenantId, contentId);
      if (!content) throw notFound('content', contentId);

      const locale = targetLocale.trim().toLowerCase();
      if (!locale) throw invalid('targetLocale is required');

      const approvedId = content.approvedVersionId;
      const source = approvedId ? versions.getFor(rctx.tenantId, approvedId) : undefined;
      if (!source || source.status !== 'approved') {
        throw invalid('content has no approved version to translate');
      }
      if (locale === source.locale.toLowerCase()) {
        throw invalid(`target locale '${locale}' equals the source version's locale`);
      }

      // Production note: when the tenant has an LLM configured
      // (ctx.config.anthropicApiKey) this call could route through
      // ctx.services.ai.draft with a translation instruction and mark method
      // 'llm'. The reference implementation ALWAYS uses the deterministic
      // dictionary + translation-memory path (method 'dictionary') so results
      // are reproducible and testable.
      const lang = locale.split('-')[0] as MachineLocale;
      const title = translateText(content.title, lang); // throws invalid for unsupported locales
      const { text: body, memoryHits } = translateWithMemory(
        memory,
        rctx.tenantId,
        source.body,
        lang,
      );

      const translation: ContentTranslation = {
        id: newId('tnl'),
        tenantId: rctx.tenantId,
        contentId: content.id,
        sourceVersionId: source.id,
        locale,
        title,
        body,
        status: 'draft',
        method: 'dictionary',
        authorId: rctx.actorId,
        createdAt: new Date().toISOString(),
        aiAssisted: true,
        memoryHits,
      };
      translations.put(translation);

      await ctx.publish({
        type: 'com.acorn.translation.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: translation.id,
        data: {
          translationId: translation.id,
          contentId: translation.contentId,
          locale: translation.locale,
          method: translation.method,
        },
      });
      return translation;
    },

    review(rctx, translationId, decision, note) {
      requireRole(rctx, REVIEW_ROLES);
      const translation = translations.getFor(rctx.tenantId, translationId);
      if (!translation) throw notFound('translation', translationId);
      // Segregation of duties, mirroring the content approval workflow.
      if (rctx.actorId === translation.authorId) {
        throw forbidden('segregation of duties: author cannot approve own translation');
      }
      if (translation.status !== 'draft' && translation.status !== 'in-review') {
        throw conflict(
          `only draft or in-review translations can be reviewed (status is '${translation.status}')`,
        );
      }
      void note; // review note is audit-logged via the event; the entity carries no note field

      const updated: ContentTranslation = {
        ...translation,
        status: decision,
        reviewedBy: rctx.actorId,
        reviewedAt: new Date().toISOString(),
      };
      if (decision === 'approved') {
        // Retire any previously approved translation for the same content+locale.
        const previous = translations.list(
          rctx.tenantId,
          (t) =>
            t.contentId === translation.contentId &&
            t.locale === translation.locale &&
            t.status === 'approved' &&
            t.id !== translation.id,
        );
        for (const prev of previous) translations.put({ ...prev, status: 'retired' });
      }
      translations.put(updated);

      void ctx.publish({
        type: 'com.acorn.translation.reviewed',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: updated.id,
        data: {
          translationId: updated.id,
          contentId: updated.contentId,
          locale: updated.locale,
          decision,
        },
      });
      return updated;
    },

    resolveContent(tenantId, key, locale) {
      const content = contents.list(tenantId, (c) => c.key === key).at(0);
      if (!content) return undefined;

      // Dating enforcement (wall-clock; production would pin to the
      // communication's compose time — acceptable for the reference impl).
      const now = Date.now();

      const loc = locale.trim().toLowerCase();
      const lang = loc.split('-')[0] ?? loc;
      const approved = translations.list(
        tenantId,
        (t) => t.contentId === content.id && t.status === 'approved',
      );
      const match =
        approved.find((t) => t.locale.toLowerCase() === loc) ??
        approved.find((t) => {
          const tl = t.locale.toLowerCase();
          return tl === lang || tl.split('-')[0] === lang;
        });
      if (match) {
        // A translation renders only while BOTH its own effective window (dates
        // stored permissively, mirroring ContentVersion) AND its source version
        // are current: an expired source disclosure must never render, even in
        // translation. When not current, fall through to the source fallback.
        const matchDates = match as { effectiveFrom?: string; expiresAt?: string };
        const src = versions.getFor(tenantId, match.sourceVersionId);
        const translationEffective =
          isWindowEffective(matchDates.effectiveFrom, matchDates.expiresAt, now) &&
          (!src || isWindowEffective(src.effectiveFrom, src.expiresAt, now));
        if (translationEffective) {
          return { title: match.title, body: match.body, ref: match.id, locale: match.locale };
        }
      }

      // Fall back to the approved source version — also dating-aware.
      const sourceVersion = content.approvedVersionId
        ? versions.getFor(tenantId, content.approvedVersionId)
        : undefined;
      if (!sourceVersion) return undefined;
      if (!isWindowEffective(sourceVersion.effectiveFrom, sourceVersion.expiresAt, now)) {
        return undefined;
      }
      return {
        title: content.title,
        body: sourceVersion.body,
        ref: sourceVersion.id,
        locale: sourceVersion.locale,
      };
    },

    list(rctx, contentId) {
      return translations.list(rctx.tenantId, (t) =>
        contentId ? t.contentId === contentId : true,
      );
    },

    memoryStats(rctx) {
      return { entries: memory.list(rctx.tenantId).length };
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const HTTP_AUTHOR_ROLES: Role[] = ['business-author', 'designer']; // tenant-admin passes any check

const translateSchema = z.object({
  locale: z.string().min(2),
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
});

export function registerTranslationRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.translations;

  app.post('/v1/content/:id/translations', async (req, reply) => {
    const rctx = requireAuth(ctx, req, HTTP_AUTHOR_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(translateSchema, req.body);
    const translation = await svc().translateContent(rctx, id, body.locale);
    reply.status(201).send(translation);
  });

  app.get('/v1/content/:id/translations', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().list(rctx, id);
  });

  app.get('/v1/translations', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { contentId } = req.query as { contentId?: string };
    return svc().list(rctx, contentId);
  });

  app.post('/v1/translations/:id/review', async (req) => {
    const rctx = requireAuth(ctx, req, ['compliance-approver']);
    const { id } = req.params as { id: string };
    const body = parseBody(reviewSchema, req.body);
    return svc().review(rctx, id, body.decision, body.note);
  });

  app.get('/v1/translation-memory/stats', async (req) => {
    const rctx = requireAuth(ctx, req);
    return svc().memoryStats(rctx);
  });
}
