/**
 * TEMPLATES bounded context — communication templates composed of a block AST,
 * with versioning, a data contract, a rule-based accessibility gate, and a
 * publication workflow that pins content-refs to approved content versions.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AccessibilityIssue,
  AccessibilityReport,
  DataContractField,
  Template,
  TemplateBlock,
  TemplateService,
  TemplateVersion,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { PlatformError, conflict, forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { getPath } from '../../kernel/values.js';

const SOURCE = '/domains/templates';

// ---------------------------------------------------------------------------
// Accessibility gate (rule-based; see platform accessibility controls)
// ---------------------------------------------------------------------------

interface HeadingState {
  lastLevel: number | null;
}

function checkBlocks(
  blocks: TemplateBlock[],
  path: string,
  state: HeadingState,
  issues: AccessibilityIssue[],
): void {
  blocks.forEach((block, i) => {
    const blockPath = `${path}[${i}]`;
    switch (block.kind) {
      case 'heading': {
        if (state.lastLevel === null) {
          if (block.level !== 1) {
            issues.push({
              ruleId: 'heading-order',
              severity: 'error',
              message: `first heading must be level 1 (found level ${block.level})`,
              blockPath,
            });
          }
        } else if (block.level > state.lastLevel + 1) {
          issues.push({
            ruleId: 'heading-order',
            severity: 'error',
            message: `heading level skips from ${state.lastLevel} to ${block.level}`,
            blockPath,
          });
        }
        state.lastLevel = block.level;
        break;
      }
      case 'section': {
        if (!block.title || block.title.trim().length === 0) {
          issues.push({
            ruleId: 'section-title-required',
            severity: 'error',
            message: `section '${block.id}' is missing a title`,
            blockPath,
          });
        }
        if (!block.explanation || block.explanation.trim().length === 0) {
          issues.push({
            ruleId: 'explanation-recommended',
            severity: 'warning',
            message: `section '${block.id}' has no plain-language explanation`,
            blockPath,
          });
        }
        checkBlocks(block.blocks, `${blockPath}.blocks`, state, issues);
        break;
      }
      case 'table': {
        block.columns.forEach((col, c) => {
          if (!col.header || col.header.trim().length === 0) {
            issues.push({
              ruleId: 'table-headers-required',
              severity: 'error',
              message: `table column ${c} is missing a header`,
              blockPath,
            });
          }
        });
        break;
      }
      case 'action': {
        if (!block.label || block.label.trim().length < 2) {
          issues.push({
            ruleId: 'action-label-required',
            severity: 'error',
            message: `action '${block.action}' needs a descriptive label (>= 2 chars)`,
            blockPath,
          });
        }
        break;
      }
      default:
        break;
    }
  });
}

function runAccessibilityChecks(blocks: TemplateBlock[]): AccessibilityReport {
  const issues: AccessibilityIssue[] = [];
  checkBlocks(blocks, 'blocks', { lastLevel: null }, issues);
  return {
    checkedAt: new Date().toISOString(),
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function collectContentRefs(blocks: TemplateBlock[], out: string[] = []): string[] {
  for (const block of blocks) {
    if (block.kind === 'content-ref') out.push(block.contentKey);
    else if (block.kind === 'section') collectContentRefs(block.blocks, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data contract validation
// ---------------------------------------------------------------------------

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fieldTypeError(field: DataContractField, value: unknown): string | undefined {
  const bad = () =>
    `field ${field.path} expected ${field.type}, got ${describeValue(value)}`;
  switch (field.type) {
    case 'string':
      return typeof value === 'string' ? undefined : bad();
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value) ? undefined : bad();
    case 'boolean':
      return typeof value === 'boolean' ? undefined : bad();
    case 'array':
      return Array.isArray(value) ? undefined : bad();
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? undefined
        : bad();
    case 'date': {
      if (value instanceof Date && !Number.isNaN(value.getTime())) return undefined;
      if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return undefined;
      return `field ${field.path} expected date-parseable value, got ${describeValue(value)}`;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const PUBLISH_ROLES = ['compliance-approver', 'designer', 'tenant-admin'] as const;

export function createTemplateService(ctx: PlatformContext): TemplateService {
  const templates = ctx.store.collection<Template>('templates');
  const versions = ctx.store.collection<TemplateVersion>('templateVersions');

  function mustGetTemplate(tenantId: string, templateId: string): Template {
    const template = templates.getFor(tenantId, templateId);
    if (!template) throw notFound('template', templateId);
    return template;
  }

  function mustGetVersion(tenantId: string, versionId: string): TemplateVersion {
    const version = versions.getFor(tenantId, versionId);
    if (!version) throw notFound('template version', versionId);
    return version;
  }

  function latestVersionOf(template: Template): TemplateVersion | undefined {
    if (template.latestVersionId) {
      const latest = versions.get(template.latestVersionId);
      if (latest) return latest;
    }
    const all = versions.list(template.tenantId, (v) => v.templateId === template.id);
    return all.sort((a, b) => b.version - a.version)[0];
  }

  const service: TemplateService = {
    createTemplate(rctx, args) {
      // Optional consent purpose (marketing requires explicit opt-in at
      // delivery time; undefined is treated as 'transactional'). Not part of
      // the kernel contract's args yet — read permissively.
      const purpose = (args as { purpose?: TemplateVersion['purpose'] }).purpose;
      const duplicate = templates.list(rctx.tenantId, (t) => t.key === args.key).at(0);
      if (duplicate) throw conflict(`template with key '${args.key}' already exists`);

      const now = new Date().toISOString();
      const template: Template = {
        id: newId('tpl'),
        tenantId: rctx.tenantId,
        key: args.key,
        name: args.name,
        communicationType: args.communicationType,
        brandId: args.brandId,
        ownerId: rctx.actorId,
        createdAt: now,
      };
      const version: TemplateVersion = {
        id: newId('tpv'),
        tenantId: rctx.tenantId,
        templateId: template.id,
        version: 1,
        status: 'draft',
        dataContract: args.dataContract,
        intendedOutcome: args.intendedOutcome,
        ...(purpose ? { purpose } : {}),
        blocks: args.blocks,
        channels: args.channels ?? {},
        authorId: rctx.actorId,
        createdAt: now,
        aiAssisted: false,
      };
      template.latestVersionId = version.id;
      templates.put(template);
      versions.put(version);
      void ctx.publish({
        type: 'com.acorn.template.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: template.id,
        data: { key: template.key, name: template.name, versionId: version.id },
      });
      return { template, version };
    },

    newVersion(rctx, templateId, args) {
      const template = mustGetTemplate(rctx.tenantId, templateId);
      const latest = latestVersionOf(template);
      if (!latest) throw notFound('template version for template', templateId);
      // Purpose copies forward from the latest version; an explicit value in
      // args overrides it (see createTemplate note on the permissive read).
      const purpose =
        (args as { purpose?: TemplateVersion['purpose'] }).purpose ?? latest.purpose;
      const all = versions.list(rctx.tenantId, (v) => v.templateId === templateId);
      const next = all.reduce((max, v) => Math.max(max, v.version), 0) + 1;
      const version: TemplateVersion = {
        id: newId('tpv'),
        tenantId: rctx.tenantId,
        templateId,
        version: next,
        status: 'draft',
        dataContract: args.dataContract ?? latest.dataContract,
        intendedOutcome: args.intendedOutcome ?? latest.intendedOutcome,
        ...(purpose ? { purpose } : {}),
        blocks: args.blocks ?? latest.blocks,
        channels: args.channels ?? latest.channels,
        authorId: rctx.actorId,
        createdAt: new Date().toISOString(),
        aiAssisted: args.aiAssisted ?? false,
      };
      versions.put(version);
      templates.put({ ...template, latestVersionId: version.id });
      void ctx.publish({
        type: 'com.acorn.template.version-created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: version.id,
        data: { templateId, version: version.version },
      });
      return version;
    },

    checkAccessibility(tenantId, versionId) {
      const version = mustGetVersion(tenantId, versionId);
      const report = runAccessibilityChecks(version.blocks);
      versions.put({ ...version, accessibility: report });
      return report;
    },

    publish(rctx, versionId) {
      if (!PUBLISH_ROLES.some((r) => rctx.roles.includes(r))) {
        throw forbidden(`requires one of roles: ${PUBLISH_ROLES.join(', ')}`);
      }
      const version = mustGetVersion(rctx.tenantId, versionId);
      if (version.status === 'published') {
        throw conflict(`template version ${versionId} is already published`);
      }
      if (version.status === 'retired') {
        throw conflict(`template version ${versionId} is retired`);
      }
      const template = mustGetTemplate(rctx.tenantId, version.templateId);

      // Gate 1: accessibility (persists the report onto the version row).
      const report = service.checkAccessibility(rctx.tenantId, versionId);
      if (!report.passed) {
        throw new PlatformError(
          'accessibility-gate-failed',
          422,
          'accessibility gate failed',
          report.issues,
        );
      }

      // Gate 2: every content-ref must resolve to content with an approved version.
      for (const contentKey of collectContentRefs(version.blocks)) {
        const resolved = ctx.services.content.getByKey(rctx.tenantId, contentKey);
        if (!resolved) {
          throw invalid(`content-ref '${contentKey}' does not resolve to any content`);
        }
        if (!resolved.approved) {
          // getByKey is dating-aware: an expired or not-yet-effective approved
          // version is reported as absent here, so publishing a template that
          // references it is correctly blocked.
          throw invalid(`content '${contentKey}' has no currently-effective approved version`);
        }
      }

      // Gate 3: the data contract's own sample must validate against it.
      const errors = service.validateData(version, version.dataContract.sample);
      if (errors.length > 0) {
        throw invalid('data contract sample fails contract validation', errors);
      }

      const now = new Date().toISOString();
      // Retire the previously published version, if any.
      if (template.publishedVersionId && template.publishedVersionId !== versionId) {
        const previous = versions.get(template.publishedVersionId);
        if (previous) versions.put({ ...previous, status: 'retired' });
      }
      const stored = mustGetVersion(rctx.tenantId, versionId); // re-read: carries the report
      const published: TemplateVersion = {
        ...stored,
        status: 'published',
        publishedAt: now,
        publishedBy: rctx.actorId,
      };
      versions.put(published);
      templates.put({ ...template, publishedVersionId: versionId });
      void ctx.publish({
        type: 'com.acorn.template.published',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: version.templateId,
        data: { templateId: version.templateId, versionId, version: version.version },
      });
      return published;
    },

    validateData(version, data) {
      const errors: string[] = [];
      for (const field of version.dataContract.fields) {
        const value = getPath(data, field.path);
        if (value === undefined) {
          if (field.required) errors.push(`missing required field ${field.path}`);
          continue;
        }
        const err = fieldTypeError(field, value);
        if (err) errors.push(err);
      }
      return errors;
    },

    getTemplate(rctx, templateId) {
      return mustGetTemplate(rctx.tenantId, templateId);
    },

    getByKey(tenantId, key) {
      return templates.list(tenantId, (t) => t.key === key).at(0);
    },

    listTemplates(rctx) {
      return templates.list(rctx.tenantId);
    },

    getVersion(tenantId, versionId) {
      return versions.getFor(tenantId, versionId);
    },

    listVersions(rctx, templateId) {
      mustGetTemplate(rctx.tenantId, templateId);
      return versions
        .list(rctx.tenantId, (v) => v.templateId === templateId)
        .sort((a, b) => a.version - b.version);
    },

    publishedVersion(tenantId, templateId) {
      const template = templates.getFor(tenantId, templateId);
      if (!template?.publishedVersionId) return undefined;
      return versions.getFor(tenantId, template.publishedVersionId);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const EDIT_ROLES = ['business-author', 'designer'] as const; // tenant-admin passes implicitly
const PUBLISH_ROUTE_ROLES = ['compliance-approver', 'designer'] as const;

// blocks and dataContract are accepted permissively here: structural
// validation happens in the accessibility gate and validateData, which give
// far better, rule-scoped error messages than a deep zod schema would.
const dataContractSchema = z.object({
  fields: z.array(z.any()),
  sample: z.record(z.any()),
});

const createTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  communicationType: z.string().min(1),
  brandId: z.string().min(1),
  dataContract: dataContractSchema,
  intendedOutcome: z.enum([
    'payment_completed',
    'renewal_completed',
    'dispute_resolved',
    'details_updated',
    'understood',
    'self_served',
  ]),
  /** consent purpose; omitted = treated as 'transactional' */
  purpose: z.enum(['transactional', 'marketing']).optional(),
  blocks: z.array(z.any()),
  channels: z.record(z.any()).optional(),
});

const newVersionSchema = z.object({
  dataContract: dataContractSchema.optional(),
  intendedOutcome: createTemplateSchema.shape.intendedOutcome.optional(),
  /** consent purpose; omitted = copied forward from the latest version */
  purpose: z.enum(['transactional', 'marketing']).optional(),
  blocks: z.array(z.any()).optional(),
  channels: z.record(z.any()).optional(),
  aiAssisted: z.boolean().optional(),
});

const validateDataSchema = z.object({
  data: z.record(z.any()),
});

export function registerTemplateRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.templates;

  app.post('/v1/templates', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...EDIT_ROLES]);
    const body = parseBody(createTemplateSchema, req.body);
    reply.status(201).send(
      svc().createTemplate(rctx, {
        ...body,
        dataContract: body.dataContract as TemplateVersion['dataContract'],
        blocks: body.blocks as TemplateVersion['blocks'],
        channels: body.channels as TemplateVersion['channels'] | undefined,
      }),
    );
  });

  app.get('/v1/templates', async (req) => {
    const rctx = requireAuth(ctx, req);
    return svc().listTemplates(rctx);
  });

  app.get('/v1/templates/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().getTemplate(rctx, id);
  });

  app.get('/v1/templates/:id/versions', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().listVersions(rctx, id);
  });

  app.post('/v1/templates/:id/versions', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...EDIT_ROLES]);
    const { id } = req.params as { id: string };
    const body = parseBody(newVersionSchema, req.body);
    reply.status(201).send(
      svc().newVersion(rctx, id, {
        ...body,
        dataContract: body.dataContract as TemplateVersion['dataContract'] | undefined,
        blocks: body.blocks as TemplateVersion['blocks'] | undefined,
        channels: body.channels as TemplateVersion['channels'] | undefined,
      }),
    );
  });

  app.post('/v1/template-versions/:id/publish', async (req) => {
    const rctx = requireAuth(ctx, req, [...PUBLISH_ROUTE_ROLES]);
    const { id } = req.params as { id: string };
    return svc().publish(rctx, id);
  });

  app.get('/v1/template-versions/:id/accessibility', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().checkAccessibility(rctx.tenantId, id);
  });

  app.post('/v1/template-versions/:id/validate-data', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(validateDataSchema, req.body);
    const version = svc().getVersion(rctx.tenantId, id);
    if (!version) throw notFound('template version', id);
    return { errors: svc().validateData(version, body.data as Record<string, unknown>) };
  });
}
