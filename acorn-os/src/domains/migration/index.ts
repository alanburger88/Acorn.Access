/**
 * MIGRATION STUDIO bounded context (tier 4) — platform/09-migration-strategy.md.
 *
 * Reference implementation of the migration pipeline: legacy ingestion →
 * extraction → variable/data-contract suggestion → reusable-content candidate
 * matching → complexity/effort scoring → AI-less first-draft template, plus
 * the duplicate report (rationalization input, §3 stage 4) and the
 * parallel-run comparison harness (§5).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Brand,
  ContentObject,
  ContentVersion,
  DataContractField,
  DuplicatePair,
  MigrationJob,
  MigrationService,
  ParallelRunResult,
  RequestCtx,
  Role,
  Template,
  TemplateBlock,
  TemplateVersion,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { composeDocument } from '../composition/document.js';
import { extractLegacy, slugify, type ExtractedVariable } from './extract.js';
import { jaccard, shingles } from './similarity.js';

const SOURCE = '/domains/migration';

/** Roles allowed to ingest legacy documents / run parallel-run verification. */
const MUTATE_ROLES: Role[] = ['business-author', 'designer', 'developer', 'tenant-admin'];
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
const CANDIDATE_MIN_WORDS = 25;
const SIMILAR_TO_THRESHOLD = 0.5;
const PARALLEL_MATCH_THRESHOLD = 0.98;
const DIFF_LINE_CAP = 40;

function requireMigrationRole(rctx: RequestCtx): void {
  if (!MUTATE_ROLES.some((r) => rctx.roles.includes(r))) {
    throw forbidden(`requires one of roles: ${MUTATE_ROLES.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Block/contract helpers
// ---------------------------------------------------------------------------

function collectTextBodies(blocks: TemplateBlock[], out: string[] = []): string[] {
  for (const block of blocks) {
    if (block.kind === 'text') out.push(block.text);
    else if (block.kind === 'section') collectTextBodies(block.blocks, out);
  }
  return out;
}

function countKinds(blocks: TemplateBlock[]): { nonSection: number; tables: number; sections: number } {
  let nonSection = 0;
  let tables = 0;
  let sections = 0;
  for (const block of blocks) {
    if (block.kind === 'section') {
      sections++;
      const inner = countKinds(block.blocks);
      nonSection += inner.nonSection;
      tables += inner.tables;
      sections += inner.sections;
    } else {
      nonSection++;
      if (block.kind === 'table') tables++;
    }
  }
  return { nonSection, tables, sections };
}

/**
 * Wrap extracted blocks so the top-level flow is a valid template body:
 * a leading level-1 heading may stay top-level (document title), extracted
 * sections stay where they are, and every other stray top-level block is
 * gathered into an implicit 'body' / 'Document' section (inserted at the
 * position of the first stray). At least one section is guaranteed.
 */
function wrapBlocks(extracted: TemplateBlock[]): TemplateBlock[] {
  const out: TemplateBlock[] = [];
  let body: Extract<TemplateBlock, { kind: 'section' }> | undefined;
  extracted.forEach((block, i) => {
    if (block.kind === 'section') {
      out.push(block);
      return;
    }
    if (block.kind === 'heading' && block.level === 1 && i === 0) {
      out.push(block);
      return;
    }
    if (!body) {
      body = { kind: 'section', id: 'body', title: 'Document', blocks: [] };
      out.push(body);
    }
    body.blocks.push(block);
  });
  if (!out.some((b) => b.kind === 'section')) {
    out.push({ kind: 'section', id: 'body', title: 'Document', blocks: [] });
  }
  return out;
}

/** kind → data-contract type; sample values coerced to match. */
function contractFieldType(kind: ExtractedVariable['kind']): DataContractField['type'] {
  switch (kind) {
    case 'currency':
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'string';
  }
}

function coerceSampleValue(v: ExtractedVariable): unknown {
  switch (v.kind) {
    case 'currency':
      return Number(v.sample.replace(/[^0-9.]/g, ''));
    case 'number':
      return Number(v.sample);
    default:
      return v.sample; // dates validate as date-parseable strings
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createMigrationService(ctx: PlatformContext): MigrationService {
  const jobs = ctx.store.collection<MigrationJob>('migrationJobs');
  const templateVersions = ctx.store.collection<TemplateVersion>('templateVersions');
  const templates = ctx.store.collection<Template>('templates');

  /** Latest APPROVED version per content object, joined to its ContentObject. */
  function approvedLibrary(tenantId: string): { content: ContentObject; version: ContentVersion }[] {
    const contents = ctx.store.collection<ContentObject>('contentObjects').list(tenantId);
    const versions = ctx.store.collection<ContentVersion>('contentVersions');
    const out: { content: ContentObject; version: ContentVersion }[] = [];
    for (const content of contents) {
      const approved = versions
        .list(tenantId, (v) => v.contentId === content.id && v.status === 'approved')
        .sort((a, b) => b.version - a.version)[0];
      if (approved) out.push({ content, version: approved });
    }
    return out;
  }

  /** Render the 'text' format of a template version over `data` (parallel-run harness §5). */
  async function renderTextOf(
    tenantId: string,
    version: TemplateVersion,
    data: Record<string, unknown>,
  ): Promise<string> {
    const template = templates.getFor(tenantId, version.templateId);
    // Same throwaway-composition approach as the rendering preview route:
    // neutral brand, approved content resolved via the content service.
    const brand = {
      name: 'Default',
      primaryColor: '#1a365d',
      accentColor: '#2b6cb0',
      logoText: template?.name ?? 'Parallel run',
    };
    const doc = composeDocument({
      version,
      ...(template ? { template } : {}),
      brand,
      customerName: 'Parallel Run',
      locale: 'en-US',
      data,
      resolveContent: (key) => {
        const resolved = ctx.services.content.getByKey(tenantId, key);
        return resolved?.approved
          ? { versionId: resolved.approved.id, title: resolved.content.title, body: resolved.approved.body }
          : undefined;
      },
    });
    const { buf } = await ctx.services.rendering.renderPreview({
      doc,
      format: 'text',
      templateVersion: version,
    });
    return buf.toString('utf8');
  }

  const service: MigrationService = {
    async ingestLegacy(rctx, args) {
      requireMigrationRole(rctx);
      if (Buffer.byteLength(args.payload, 'utf8') > MAX_PAYLOAD_BYTES) {
        throw invalid('payload exceeds the 1MB ingestion limit');
      }
      const job: MigrationJob = {
        id: newId('mig'),
        tenantId: rctx.tenantId,
        name: args.name,
        sourceFormat: args.sourceFormat,
        status: 'extracted',
        createdAt: new Date().toISOString(),
        extracted: { blocks: [], variables: [], contentCandidates: [] },
        complexityScore: 0,
        effortHours: 0,
      };

      try {
        const { title, blocks, variables } = extractLegacy(args.payload, args.sourceFormat);

        // Reusable-content candidates: extracted paragraphs of >= 25 words,
        // matched against the approved content library via shingle Jaccard.
        const library = approvedLibrary(rctx.tenantId).map((entry) => ({
          ...entry,
          shingleSet: shingles(entry.version.body),
        }));
        const candidates: MigrationJob['extracted']['contentCandidates'] = [];
        for (const body of collectTextBodies(blocks)) {
          const words = body.split(/\s+/).filter(Boolean);
          if (words.length < CANDIDATE_MIN_WORDS) continue;
          const candidateShingles = shingles(body);
          let best: { contentId: string; contentKey: string; similarity: number } | undefined;
          for (const entry of library) {
            const similarity = jaccard(candidateShingles, entry.shingleSet);
            if (similarity >= SIMILAR_TO_THRESHOLD && (!best || similarity > best.similarity)) {
              best = {
                contentId: entry.content.id,
                contentKey: entry.content.key,
                similarity: Math.round(similarity * 1000) / 1000,
              };
            }
          }
          candidates.push({
            title: `${words.slice(0, 6).join(' ')}…`,
            body,
            ...(best ? { similarTo: best } : {}),
          });
        }

        // Complexity rubric (simplified reference weights, platform/09 §4.2):
        //   3 pts per non-section block  (content mass to review)
        // + 10 pts per table             (structure + data binding work)
        // +  2 pts per detected variable (data-contract mapping work)
        // +  5 pts per section           (document structure)
        // capped at 100. Effort estimate: 0.4h per complexity point, 1 decimal.
        const counts = countKinds(blocks);
        const complexityScore = Math.min(
          100,
          counts.nonSection * 3 + counts.tables * 10 + variables.length * 2 + counts.sections * 5,
        );
        const effortHours = Math.round(complexityScore * 0.4 * 10) / 10;

        // Data contract suggested from the detected variables; fields are
        // optional (required: false) because a legacy sample proves presence,
        // not obligation. The sample carries the coerced observed values.
        const sample: Record<string, unknown> = {};
        for (const v of variables) sample[v.path] = coerceSampleValue(v);
        const dataContract = {
          fields: variables.map(
            (v): DataContractField => ({ path: v.path, type: contractFieldType(v.kind), required: false }),
          ),
          sample,
        };

        // Unique template key: migrated-<slug(name)>-<n>.
        const base = `migrated-${slugify(args.name)}`;
        let suffix = 1;
        let key = `${base}-${suffix}`;
        while (ctx.services.templates.getByKey(rctx.tenantId, key)) key = `${base}-${++suffix}`;

        const brandId =
          args.brandId ??
          ctx.store.collection<Brand>('brands').list(rctx.tenantId)[0]?.id ??
          'brd_none';

        // Create the first-draft template. It stays a DRAFT on purpose: the
        // normal accessibility/publish gates apply exactly as they do for
        // hand-authored templates — migration never bypasses them.
        const wrappedBlocks = wrapBlocks(blocks);
        const draft = ctx.services.templates.createTemplate(rctx, {
          key,
          name: title || args.name,
          communicationType: 'migrated',
          brandId,
          dataContract,
          intendedOutcome: 'understood',
          blocks: wrappedBlocks,
        });

        job.status = 'drafted';
        job.extracted = { blocks: wrappedBlocks, variables, contentCandidates: candidates };
        job.complexityScore = complexityScore;
        job.effortHours = effortHours;
        job.draftTemplateId = draft.template.id;
        job.draftVersionId = draft.version.id;
        jobs.put(job);

        await ctx.publish({
          type: 'com.acorn.migration.ingested',
          tenantId: rctx.tenantId,
          source: SOURCE,
          subject: job.id,
          data: {
            jobId: job.id,
            name: job.name,
            complexityScore,
            contentCandidates: candidates.length,
          },
        });
        await ctx.publish({
          type: 'com.acorn.migration.drafted',
          tenantId: rctx.tenantId,
          source: SOURCE,
          subject: job.id,
          data: { jobId: job.id, draftTemplateId: draft.template.id },
        });
        return job;
      } catch (err) {
        // Extraction/drafting failures land on the job row, never as a 500.
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        jobs.put(job);
        return job;
      }
    },

    getJob(rctx, jobId) {
      const job = jobs.getFor(rctx.tenantId, jobId);
      if (!job) throw notFound('migration job', jobId);
      return job;
    },

    listJobs(rctx) {
      return jobs.list(rctx.tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    duplicateReport(rctx, threshold = 0.7) {
      const library = approvedLibrary(rctx.tenantId).map((entry) => ({
        ...entry,
        shingleSet: shingles(entry.version.body),
      }));
      const pairs: DuplicatePair[] = [];
      // All unordered pairs (i < j) of latest-approved versions — self-pairs
      // are excluded by construction.
      for (let i = 0; i < library.length; i++) {
        for (let j = i + 1; j < library.length; j++) {
          const a = library[i]!;
          const b = library[j]!;
          const similarity = jaccard(a.shingleSet, b.shingleSet);
          if (similarity >= threshold) {
            pairs.push({
              aContentId: a.content.id,
              aKey: a.content.key,
              bContentId: b.content.id,
              bKey: b.content.key,
              similarity: Math.round(similarity * 1000) / 1000,
            });
          }
        }
      }
      return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, 100);
    },

    async parallelRun(rctx, args) {
      requireMigrationRole(rctx);
      const versionA = templateVersions.getFor(rctx.tenantId, args.versionAId);
      if (!versionA) throw notFound('template version', args.versionAId);
      const versionB = templateVersions.getFor(rctx.tenantId, args.versionBId);
      if (!versionB) throw notFound('template version', args.versionBId);

      const data = args.data ?? versionA.dataContract.sample;
      const [textA, textB] = await Promise.all([
        renderTextOf(rctx.tenantId, versionA, data),
        renderTextOf(rctx.tenantId, versionB, data),
      ]);

      // Normalize: trim every line, drop empties.
      const normalize = (s: string): string[] =>
        s.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      const linesA = normalize(textA);
      const linesB = normalize(textB);

      // Multiset line diff: each line in A consumes at most one matching line
      // in B (and vice versa), so repeated lines are counted correctly.
      const countOf = (lines: string[]): Map<string, number> => {
        const m = new Map<string, number>();
        for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
        return m;
      };
      const remainingB = countOf(linesB);
      const removedLines: string[] = [];
      for (const line of linesA) {
        const left = remainingB.get(line) ?? 0;
        if (left > 0) remainingB.set(line, left - 1);
        else removedLines.push(line);
      }
      const remainingA = countOf(linesA);
      const addedLines: string[] = [];
      for (const line of linesB) {
        const left = remainingA.get(line) ?? 0;
        if (left > 0) remainingA.set(line, left - 1);
        else addedLines.push(line);
      }

      const common = linesA.length - removedLines.length;
      const total = linesA.length + linesB.length;
      const similarity = total === 0 ? 1 : (2 * common) / total;
      const result: ParallelRunResult = {
        similarity: Math.round(similarity * 10000) / 10000,
        matches: similarity >= PARALLEL_MATCH_THRESHOLD,
        addedLines: addedLines.slice(0, DIFF_LINE_CAP),
        removedLines: removedLines.slice(0, DIFF_LINE_CAP),
      };
      return result;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTE_MUTATE_ROLES: Role[] = ['business-author', 'designer', 'developer']; // tenant-admin passes implicitly

const ingestSchema = z.object({
  name: z.string().min(1),
  sourceFormat: z.enum(['html', 'text']),
  payload: z.string().min(1),
  brandId: z.string().min(1).optional(),
});

const parallelRunSchema = z.object({
  versionAId: z.string().min(1),
  versionBId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

export function registerMigrationRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.migration;

  app.post('/v1/migration/jobs', async (req, reply) => {
    const rctx = requireAuth(ctx, req, ROUTE_MUTATE_ROLES);
    const body = parseBody(ingestSchema, req.body);
    reply.status(201).send(await svc().ingestLegacy(rctx, body));
  });

  app.get('/v1/migration/jobs', async (req) => {
    const rctx = requireAuth(ctx, req);
    return svc().listJobs(rctx);
  });

  app.get('/v1/migration/jobs/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().getJob(rctx, id);
  });

  app.get('/v1/migration/duplicate-report', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { threshold } = req.query as { threshold?: string };
    let t: number | undefined;
    if (threshold !== undefined && threshold !== '') {
      t = Number(threshold);
      if (Number.isNaN(t) || t < 0 || t > 1) {
        throw invalid('threshold must be a number between 0 and 1');
      }
    }
    return svc().duplicateReport(rctx, t);
  });

  app.post('/v1/migration/parallel-run', async (req) => {
    const rctx = requireAuth(ctx, req, ROUTE_MUTATE_ROLES);
    const body = parseBody(parallelRunSchema, req.body);
    return svc().parallelRun(rctx, {
      versionAId: body.versionAId,
      versionBId: body.versionBId,
      ...(body.data ? { data: body.data as Record<string, unknown> } : {}),
    });
  });
}
