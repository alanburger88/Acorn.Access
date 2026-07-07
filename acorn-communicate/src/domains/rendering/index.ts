/**
 * RENDERING bounded context — turns a ComposedDocument into concrete channel
 * artifacts (html, pdf, text, email-html, sms-text), stores them in the
 * content-addressed object store, and records RenderArtifact rows.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Brand,
  Communication,
  RenderArtifact,
  RenderFormat,
  RenderingService,
  Template,
  TemplateVersion,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { composeDocument } from '../composition/document.js';
import { renderEmail } from './email.js';
import { renderHtml } from './html.js';
import { renderPdf } from './pdf.js';
import { renderSms, renderText } from './text.js';

const SOURCE = '/domains/rendering';
void SOURCE; // rendering emits no events of its own today; composition owns lifecycle events

export const RENDERER_VERSION = 'acorn-renderer/1.0.0';

/** Render a single format to bytes. Pure over its inputs. */
async function renderFormat(args: {
  format: RenderFormat;
  doc: Communication['composed'];
  templateVersion: TemplateVersion;
  rawData: Record<string, unknown>;
}): Promise<{ buf: Buffer; contentType: string }> {
  const { format, doc, templateVersion, rawData } = args;
  switch (format) {
    case 'html':
      return renderHtml(doc);
    case 'pdf':
      return renderPdf(doc);
    case 'text':
      return renderText(doc);
    case 'email-html': {
      const channel = templateVersion.channels.email;
      if (!channel) throw invalid('template version has no email channel configuration');
      // The artifact keeps the LITERAL '{{link}}' placeholder — the delivery
      // domain substitutes the per-recipient secure link at send time.
      return renderEmail(doc, channel, rawData);
    }
    case 'sms-text': {
      const channel = templateVersion.channels.sms;
      if (!channel) throw invalid('template version has no sms channel configuration');
      // Same contract as email-html: '{{link}}' stays literal for delivery.
      return renderSms(channel.text, rawData, doc.locale);
    }
    default:
      throw invalid(`unknown render format '${String(format)}'`);
  }
}

export function createRenderingService(ctx: PlatformContext): RenderingService {
  const artifacts = ctx.store.collection<RenderArtifact>('artifacts');

  const service: RenderingService = {
    rendererVersion: RENDERER_VERSION,

    async renderAll({ tenantId, communication, templateVersion }) {
      // The data snapshot taken at composition time is the single source of
      // raw values for channel overrides (email subject, sms text).
      const snapshot = ctx.objects.get(communication.dataSnapshotKey);
      if (!snapshot) throw notFound('data snapshot', communication.dataSnapshotKey);
      const rawData = JSON.parse(snapshot.buf.toString('utf8')) as Record<string, unknown>;

      const formats: RenderFormat[] = ['html', 'pdf', 'text'];
      if (templateVersion.channels.email) formats.push('email-html');
      if (templateVersion.channels.sms) formats.push('sms-text');

      const out: RenderArtifact[] = [];
      for (const format of formats) {
        const { buf, contentType } = await renderFormat({
          format,
          doc: communication.composed,
          templateVersion,
          rawData,
        });
        const stored = ctx.objects.put(tenantId, buf, contentType);
        const artifact: RenderArtifact = {
          id: newId('art'),
          tenantId,
          communicationId: communication.id,
          format,
          objectKey: stored.key,
          sha256: stored.sha256,
          size: stored.size,
          contentType: stored.contentType,
          renderedAt: new Date().toISOString(),
          rendererVersion: RENDERER_VERSION,
        };
        artifacts.put(artifact);
        out.push(artifact);
      }
      return out;
    },

    async renderPreview({ doc, format, templateVersion }) {
      // Previews have no data snapshot; the contract's sample stands in for
      // the raw record used by channel overrides.
      return renderFormat({ format, doc, templateVersion, rawData: templateVersion.dataContract.sample });
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const previewSchema = z.object({
  templateVersionId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  format: z.enum(['html', 'pdf', 'email-html', 'sms-text', 'text']),
});

const NEUTRAL_BRAND = { name: 'Default', primaryColor: '#1a365d', accentColor: '#2b6cb0' };

export function registerRenderingRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  app.post('/v1/renders/preview', async (req, reply) => {
    const rctx = requireAuth(ctx, req);
    const body = parseBody(previewSchema, req.body);

    const version = ctx.store
      .collection<TemplateVersion>('templateVersions')
      .getFor(rctx.tenantId, body.templateVersionId);
    if (!version) throw notFound('template version', body.templateVersionId);
    const template = ctx.store.collection<Template>('templates').getFor(rctx.tenantId, version.templateId);

    // Throwaway composition over the contract sample merged with caller data.
    const data = { ...version.dataContract.sample, ...(body.data ?? {}) };
    const brandRow = template
      ? ctx.store.collection<Brand>('brands').getFor(rctx.tenantId, template.brandId)
      : undefined;
    const brand = brandRow ?? { ...NEUTRAL_BRAND, logoText: template?.name ?? 'Preview' };

    const doc = composeDocument({
      version,
      ...(template ? { template } : {}),
      brand,
      customerName: 'Preview Customer',
      locale: 'en-US',
      data,
      resolveContent: (key) => {
        const resolved = ctx.services.content.getByKey(rctx.tenantId, key);
        return resolved?.approved
          ? { versionId: resolved.approved.id, title: resolved.content.title, body: resolved.approved.body }
          : undefined;
      },
    });

    const { buf, contentType } = await ctx.services.rendering.renderPreview({
      doc,
      format: body.format,
      templateVersion: version,
    });
    reply.type(contentType).send(buf);
  });
}
