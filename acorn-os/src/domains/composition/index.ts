/**
 * COMPOSITION bounded context — composes a Communication for one customer from
 * a template's published version and a data record, snapshots the data,
 * triggers rendering, and tracks the communication lifecycle (event-sourced).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Brand,
  Communication,
  CommunicationStatus,
  CompositionService,
  Customer,
  RenderArtifact,
  RenderFormat,
  Template,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { composeDocument } from './document.js';

const SOURCE = '/domains/composition';

const NEUTRAL_BRAND = { name: 'Default', primaryColor: '#1a365d', accentColor: '#2b6cb0' };

export function createCompositionService(ctx: PlatformContext): CompositionService {
  const communications = ctx.store.collection<Communication>('communications');
  const artifacts = ctx.store.collection<RenderArtifact>('artifacts');

  function mustGet(tenantId: string, id: string): Communication {
    const communication = communications.getFor(tenantId, id);
    if (!communication) throw notFound('communication', id);
    return communication;
  }

  const service: CompositionService = {
    async compose({ tenantId, templateId, customerId, data, requestedChannels, journeyRef }) {
      // Experiment hook: a running A/B experiment on the template assigns this
      // customer a variant version deterministically; otherwise the published
      // version is used. (Optional chaining: standalone tests may wire
      // composition without the experiments service.)
      const version =
        ctx.services.experiments?.selectVersion(tenantId, templateId, customerId) ??
        ctx.services.templates.publishedVersion(tenantId, templateId);
      if (!version) throw invalid('template has no published version');
      const template = ctx.store.collection<Template>('templates').getFor(tenantId, templateId);
      if (!template) throw notFound('template', templateId);
      const customer = ctx.store.collection<Customer>('customers').getFor(tenantId, customerId);
      if (!customer) throw notFound('customer', customerId);

      const errors = ctx.services.templates.validateData(version, data);
      if (errors.length > 0) throw invalid('data contract validation failed', errors);

      // Immutable snapshot of the input record — the chain-of-custody anchor.
      const snapshot = ctx.objects.put(tenantId, Buffer.from(JSON.stringify(data)), 'application/json');

      const brand =
        ctx.store.collection<Brand>('brands').getFor(tenantId, template.brandId) ??
        { ...NEUTRAL_BRAND, logoText: template.name };

      const composed = composeDocument({
        version,
        template,
        brand,
        customerName: customer.name,
        locale: customer.locale,
        data,
        resolveContent: (key) => {
          // Locale-aware resolution: an approved translation matching the
          // customer's locale wins; the translation service falls back to the
          // approved source version internally. (Optional chaining for
          // standalone tests wired without the translations service.)
          const localized = ctx.services.translations?.resolveContent(tenantId, key, customer.locale);
          if (localized) {
            return { versionId: localized.ref, title: localized.title, body: localized.body };
          }
          const resolved = ctx.services.content.getByKey(tenantId, key);
          return resolved?.approved
            ? { versionId: resolved.approved.id, title: resolved.content.title, body: resolved.approved.body }
            : undefined;
        },
      });

      const communication: Communication = {
        id: newId('com'),
        tenantId,
        templateId,
        templateVersionId: version.id,
        customerId,
        status: 'composed',
        dataSnapshotKey: snapshot.key,
        dataSnapshotHash: snapshot.sha256,
        composed,
        createdAt: new Date().toISOString(),
        ...(requestedChannels !== undefined ? { requestedChannels } : {}),
        ...(journeyRef !== undefined ? { journeyRef } : {}),
      };
      communications.put(communication);
      await ctx.publish({
        type: 'com.acorn.communication.composed',
        tenantId,
        source: SOURCE,
        subject: communication.id,
        data: {
          communicationId: communication.id,
          templateId,
          templateVersionId: version.id,
          customerId,
          intendedOutcome: version.intendedOutcome,
        },
      });

      const rendered = await ctx.services.rendering.renderAll({
        tenantId,
        communication,
        templateVersion: version,
        viewerBaseUrl: ctx.config.baseUrl,
      });

      const updated: Communication = { ...communication, status: 'rendered' };
      communications.put(updated);
      await ctx.publish({
        type: 'com.acorn.communication.rendered',
        tenantId,
        source: SOURCE,
        subject: communication.id,
        data: {
          communicationId: communication.id,
          customerId,
          formats: rendered.map((artifact) => artifact.format),
        },
      });
      return updated;
    },

    getCommunication(tenantId, id) {
      return communications.getFor(tenantId, id);
    },

    listCommunications(tenantId, filter) {
      return communications.list(tenantId, (communication) => {
        if (filter?.customerId && communication.customerId !== filter.customerId) return false;
        if (filter?.templateId && communication.templateId !== filter.templateId) return false;
        if (filter?.status && communication.status !== filter.status) return false;
        return true;
      });
    },

    setStatus(tenantId, id, status) {
      const communication = mustGet(tenantId, id);
      const updated: Communication = { ...communication, status };
      communications.put(updated);
      void ctx.publish({
        type: 'com.acorn.communication.status-changed',
        tenantId,
        source: SOURCE,
        subject: id,
        data: { communicationId: id, customerId: communication.customerId, status },
      });
      return updated;
    },

    markOutcome(tenantId, id, via) {
      const communication = mustGet(tenantId, id);
      // Idempotent: the first achievement wins; repeats neither rewrite the
      // outcome nor emit a duplicate event.
      if (communication.outcome?.achieved) return communication;
      const updated: Communication = {
        ...communication,
        outcome: { achieved: true, at: new Date().toISOString(), via },
      };
      communications.put(updated);
      void ctx.publish({
        type: 'com.acorn.communication.outcome-achieved',
        tenantId,
        source: SOURCE,
        subject: id,
        data: { communicationId: id, customerId: communication.customerId, via },
      });
      return updated;
    },

    listArtifacts(tenantId, communicationId) {
      return artifacts.list(tenantId, (artifact) => artifact.communicationId === communicationId);
    },

    getArtifact(tenantId, communicationId, format) {
      return artifacts
        .list(tenantId, (artifact) => artifact.communicationId === communicationId && artifact.format === format)
        .at(0);
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const COMPOSE_ROLES = ['operator', 'developer', 'tenant-admin'] as const;

const composeSchema = z.object({
  templateId: z.string().min(1),
  customerId: z.string().min(1),
  data: z.record(z.unknown()),
  channels: z.array(z.enum(['email', 'sms', 'secure-link', 'webhook', 'print'])).optional(),
  journeyRef: z.string().optional(),
});

const outcomeSchema = z.object({ via: z.string().min(1) });

const RENDER_FORMATS: readonly RenderFormat[] = [
  'html',
  'pdf',
  'email-html',
  'sms-text',
  'text',
  'voice-script',
];

export function registerCompositionRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.composition;

  // Composes (and renders) only — delivery is a separate endpoint owned by the
  // delivery domain.
  app.post('/v1/communications', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...COMPOSE_ROLES]);
    const body = parseBody(composeSchema, req.body);
    const communication = await svc().compose({
      tenantId: rctx.tenantId,
      templateId: body.templateId,
      customerId: body.customerId,
      data: body.data,
      ...(body.channels !== undefined ? { requestedChannels: body.channels } : {}),
      ...(body.journeyRef !== undefined ? { journeyRef: body.journeyRef } : {}),
    });
    reply.status(201).send(communication);
  });

  app.get('/v1/communications', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { customerId, templateId, status } = req.query as {
      customerId?: string;
      templateId?: string;
      status?: CommunicationStatus;
    };
    return svc().listCommunications(rctx.tenantId, {
      ...(customerId ? { customerId } : {}),
      ...(templateId ? { templateId } : {}),
      ...(status ? { status } : {}),
    });
  });

  app.get('/v1/communications/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const communication = svc().getCommunication(rctx.tenantId, id);
    if (!communication) throw notFound('communication', id);
    return communication;
  });

  app.get('/v1/communications/:id/artifacts', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().listArtifacts(rctx.tenantId, id);
  });

  app.get('/v1/communications/:id/artifacts/:format/download', async (req, reply) => {
    const rctx = requireAuth(ctx, req);
    const { id, format } = req.params as { id: string; format: string };
    if (!RENDER_FORMATS.includes(format as RenderFormat)) {
      throw invalid(`unknown render format '${format}'`);
    }
    const artifact = svc().getArtifact(rctx.tenantId, id, format as RenderFormat);
    if (!artifact) throw notFound('artifact', `${id}/${format}`);
    const stored = ctx.objects.get(artifact.objectKey);
    if (!stored) throw notFound('artifact object', artifact.objectKey);
    reply.type(artifact.contentType).send(stored.buf);
  });

  app.post('/v1/communications/:id/outcome', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(outcomeSchema, req.body);
    return svc().markOutcome(rctx.tenantId, id, body.via);
  });
}
