/**
 * DATA MAPPING bounded context — reusable mapping profiles that project messy
 * source records onto a template's data contract (platform/05 ingestion
 * mapping). Suggestion is the reference implementation's deterministic
 * name-similarity heuristic standing in for AI-assisted mapping.
 *
 * Exposes `createMappingService` (implements MappingService from
 * kernel/contracts.ts) and `registerMappingRoutes` (/v1 HTTP surface).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  MappingProfile,
  MappingRule,
  MappingService,
  MappingSuggestion,
  MappingTransform,
  RequestCtx,
  Role,
  Template,
  TemplateVersion,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { applyTransform, setPath } from './transforms.js';

const SOURCE = '/domains/mapping';

const WRITE_ROLES: Role[] = ['business-author', 'developer', 'operator', 'tenant-admin'];

// ---------------------------------------------------------------------------
// Name-similarity heuristic (deterministic reference for AI-assisted mapping)
// ---------------------------------------------------------------------------

/** 'Balance_Due' → 'balancedue' — lowercase, strip non-alphanumerics. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split camelCase / snake_case / space / dot boundaries into lowercase tokens. */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

function lastSegment(path: string): string {
  return path.split('.').at(-1)!;
}

/** Similarity of a source leaf path to a contract field path, 0..1. */
function scoreNames(sourcePath: string, targetPath: string): number {
  const sLast = normalize(lastSegment(sourcePath));
  const tLast = normalize(lastSegment(targetPath));
  const sFull = normalize(sourcePath);
  const tFull = normalize(targetPath);
  // 1.0: exact normalized match of the last path segment or the full path.
  if (sLast === tLast || sFull === tFull || sFull === tLast || sLast === tFull) return 1;
  // 0.8: one name contains the other.
  for (const [a, b] of [
    [sLast, tLast],
    [sFull, tFull],
  ] as const) {
    if (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))) return 0.8;
  }
  // Fallback: token-overlap ratio (Jaccard over name tokens).
  const sTokens = new Set(tokenize(sourcePath));
  const tTokens = new Set(tokenize(targetPath));
  if (sTokens.size === 0 || tTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of sTokens) if (tTokens.has(token)) overlap++;
  const union = new Set([...sTokens, ...tTokens]).size;
  return union === 0 ? 0 : overlap / union;
}

/** Flatten a record to its dot-path leaves (arrays and scalars are leaves). */
function flattenLeaves(
  record: Record<string, unknown>,
  prefix = '',
  out: { path: string; value: unknown }[] = [],
): { path: string; value: unknown }[] {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenLeaves(value as Record<string, unknown>, path, out);
    } else {
      out.push({ path, value });
    }
  }
  return out;
}

function transformFor(fieldType: string, source: string): MappingTransform {
  switch (fieldType) {
    case 'number':
      return { kind: 'number', source };
    case 'date':
      return { kind: 'date-iso', source };
    case 'string':
      return { kind: 'trim', source };
    default:
      return { kind: 'copy', source };
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createMappingService(ctx: PlatformContext): MappingService {
  const profiles = ctx.store.collection<MappingProfile>('mappingProfiles');
  const templates = ctx.store.collection<Template>('templates');
  const versions = ctx.store.collection<TemplateVersion>('templateVersions');

  function requireWriteRole(rctx: RequestCtx): void {
    if (!WRITE_ROLES.some((r) => rctx.roles.includes(r))) {
      throw forbidden(`requires one of roles: ${WRITE_ROLES.join(', ')}`);
    }
  }

  /** The version whose data contract governs targets: published ?? latest. */
  function contractVersion(tenantId: string, templateId: string): TemplateVersion {
    const template = templates.getFor(tenantId, templateId);
    if (!template) throw notFound('template', templateId);
    if (template.publishedVersionId) {
      const published = versions.getFor(tenantId, template.publishedVersionId);
      if (published) return published;
    }
    if (template.latestVersionId) {
      const latest = versions.getFor(tenantId, template.latestVersionId);
      if (latest) return latest;
    }
    const fallback = versions
      .list(tenantId, (v) => v.templateId === templateId)
      .sort((a, b) => b.version - a.version)
      .at(0);
    if (!fallback) throw notFound('template version for template', templateId);
    return fallback;
  }

  /** Every rule target must be a data-contract field path of the template. */
  function validateTargets(version: TemplateVersion, rules: MappingRule[]): void {
    const valid = new Set(version.dataContract.fields.map((f) => f.path));
    const unknown = [...new Set(rules.map((r) => r.target).filter((t) => !valid.has(t)))];
    if (unknown.length > 0) {
      throw invalid(`unknown data contract targets: ${unknown.join(', ')}`);
    }
  }

  function mustGetProfile(tenantId: string, profileId: string): MappingProfile {
    const profile = profiles.getFor(tenantId, profileId);
    if (!profile) throw notFound('mapping profile', profileId);
    return profile;
  }

  const service: MappingService = {
    create(rctx, args) {
      requireWriteRole(rctx);
      const version = contractVersion(rctx.tenantId, args.templateId);
      validateTargets(version, args.rules);
      const now = new Date().toISOString();
      const profile: MappingProfile = {
        id: newId('map'),
        tenantId: rctx.tenantId,
        templateId: args.templateId,
        name: args.name,
        rules: args.rules,
        createdAt: now,
        updatedAt: now,
      };
      profiles.put(profile);
      void ctx.publish({
        type: 'com.acorn.mapping.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: profile.id,
        data: { profileId: profile.id, templateId: profile.templateId, rules: profile.rules.length },
      });
      return profile;
    },

    update(rctx, profileId, rules) {
      requireWriteRole(rctx);
      const existing = mustGetProfile(rctx.tenantId, profileId);
      const version = contractVersion(rctx.tenantId, existing.templateId);
      validateTargets(version, rules);
      const updated: MappingProfile = { ...existing, rules, updatedAt: new Date().toISOString() };
      profiles.put(updated);
      void ctx.publish({
        type: 'com.acorn.mapping.updated',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: updated.id,
        data: { profileId: updated.id, templateId: updated.templateId, rules: rules.length },
      });
      return updated;
    },

    get(rctx, profileId) {
      return mustGetProfile(rctx.tenantId, profileId);
    },

    list(rctx, templateId) {
      return profiles.list(rctx.tenantId, (p) => !templateId || p.templateId === templateId);
    },

    suggest(rctx, templateId, sampleRecord) {
      const version = contractVersion(rctx.tenantId, templateId);
      const leaves = flattenLeaves(sampleRecord);
      const suggestions: MappingSuggestion[] = [];
      for (const field of version.dataContract.fields) {
        let best: { path: string; value: unknown } | undefined;
        let bestScore = 0;
        for (const leaf of leaves) {
          const score = scoreNames(leaf.path, field.path);
          if (score > bestScore) {
            bestScore = score;
            best = leaf;
          }
        }
        if (best && bestScore >= 0.5) {
          suggestions.push({
            target: field.path,
            transform: transformFor(field.type, best.path),
            confidence: bestScore,
            sample: best.value,
          });
        } else {
          suggestions.push({ target: field.path, transform: null, confidence: bestScore });
        }
      }
      return suggestions; // already in contract field order
    },

    apply(tenantId, profileId, record) {
      const profile = mustGetProfile(tenantId, profileId);
      const out: Record<string, unknown> = {};
      for (const rule of profile.rules) {
        const value = applyTransform(rule.transform, record);
        if (value !== undefined) setPath(out, rule.target, value);
      }
      // Ingestion resolves the customer via customerRef/customerId on the
      // record; pass them through when the profile's rules don't set them so
      // a mapped batch still knows who each record belongs to.
      for (const key of ['customerRef', 'customerId'] as const) {
        if (out[key] === undefined && record[key] !== undefined) out[key] = record[key];
      }
      return out;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const transformSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('copy'), source: z.string().min(1) }),
  z.object({ kind: z.literal('number'), source: z.string().min(1) }),
  z.object({ kind: z.literal('trim'), source: z.string().min(1) }),
  z.object({ kind: z.literal('date-iso'), source: z.string().min(1) }),
  z.object({
    kind: z.literal('concat'),
    sources: z.array(z.string().min(1)).min(1),
    separator: z.string().optional(),
  }),
  z.object({ kind: z.literal('constant'), value: z.unknown() }),
]);

const ruleSchema = z.object({ target: z.string().min(1), transform: transformSchema });

const createProfileSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  rules: z.array(ruleSchema),
});

const updateProfileSchema = z.object({ rules: z.array(ruleSchema) });

const suggestSchema = z.object({
  templateId: z.string().min(1),
  sampleRecord: z.record(z.unknown()),
});

const applySchema = z.object({ record: z.record(z.unknown()) });

const WRITE_ROUTE_ROLES: Role[] = ['business-author', 'developer', 'operator']; // + tenant-admin implicitly

export function registerMappingRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.mapping;

  app.post('/v1/mapping-profiles', async (req, reply) => {
    const rctx = requireAuth(ctx, req, WRITE_ROUTE_ROLES);
    const body = parseBody(createProfileSchema, req.body);
    reply.status(201).send(svc().create(rctx, body as Parameters<MappingService['create']>[1]));
  });

  app.put('/v1/mapping-profiles/:id', async (req) => {
    const rctx = requireAuth(ctx, req, WRITE_ROUTE_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(updateProfileSchema, req.body);
    return svc().update(rctx, id, body.rules as MappingRule[]);
  });

  app.get('/v1/mapping-profiles', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { templateId } = req.query as { templateId?: string };
    return svc().list(rctx, templateId);
  });

  app.get('/v1/mapping-profiles/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().get(rctx, id);
  });

  app.post('/v1/mapping-profiles/suggest', async (req) => {
    const rctx = requireAuth(ctx, req);
    const body = parseBody(suggestSchema, req.body);
    return {
      suggestions: svc().suggest(rctx, body.templateId, body.sampleRecord as Record<string, unknown>),
    };
  });

  // Dry-run apply for the console/designer: shows the contract-shaped record.
  app.post('/v1/mapping-profiles/:id/apply', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(applySchema, req.body);
    return svc().apply(rctx.tenantId, id, body.record as Record<string, unknown>);
  });
}
