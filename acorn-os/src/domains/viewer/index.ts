/**
 * VIEWER bounded context — the interactive document experience.
 *
 * Public, token-authenticated surface (NO bearer auth): secure-link
 * resolution with expiry/revocation/OTP enforcement, access + interaction
 * telemetry, in-document actions (pay/dispute/update-details/contact) and
 * grounded assistant Q&A over the composed document + approved FAQs.
 */
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type {
  AccessEvent,
  ActionTransaction,
  Communication,
  ComposedDocument,
  ComposedSection,
  ContentObject,
  ContentVersion,
  Customer,
  InteractionEvent,
  SecureLink,
  ViewerService,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { notFound } from '../../kernel/errors.js';
import { parseBody } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';
import { escapeHtml } from '../../kernel/values.js';
import { errorPage, otpPage, shellPage } from './shell.js';

const SOURCE = '/domains/viewer';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Flatten a composed section into plain text for assistant grounding. */
function sectionPassageText(section: ComposedSection): string {
  const parts: string[] = [];
  for (const line of section.lines) {
    switch (line.kind) {
      case 'field-row':
        parts.push(`${line.label}: ${line.value}`);
        break;
      case 'table':
        for (const row of line.rows) parts.push(row.join(' | '));
        break;
      case 'text':
      case 'summary':
      case 'content':
        parts.push(line.text);
        break;
      default:
        break;
    }
  }
  if (section.explanation) parts.push(section.explanation);
  return parts.join('\n');
}

export function createViewerService(ctx: PlatformContext): ViewerService {
  const secureLinks = ctx.store.collection<SecureLink>('secureLinks');
  const communications = ctx.store.collection<Communication>('communications');
  const customers = ctx.store.collection<Customer>('customers');
  const accessEvents = ctx.store.collection<AccessEvent>('accessEvents');
  const interactions = ctx.store.collection<InteractionEvent>('interactions');
  const actions = ctx.store.collection<ActionTransaction>('actions');
  const contentObjects = ctx.store.collection<ContentObject>('contentObjects');
  const contentVersions = ctx.store.collection<ContentVersion>('contentVersions');

  const service: ViewerService = {
    resolveLink(token, otp) {
      // Timing-safe credential comparison (platform/06 SEC-DOC): compare
      // sha256 digests with timingSafeEqual so lookup cost never leaks how
      // much of a guessed token matched. Digesting first also normalizes
      // lengths, which timingSafeEqual requires.
      const digest = (value: string) => createHash('sha256').update(value).digest();
      const tokenDigest = digest(token);
      const link = secureLinks
        .listAll((l) => timingSafeEqual(digest(l.token), tokenDigest))
        .at(0);
      if (!link) return { ok: false, reason: 'not-found' };
      if (link.revokedAt) return { ok: false, reason: 'revoked' };
      if (new Date(link.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };
      if (link.otpCode) {
        if (!otp) return { ok: false, reason: 'otp-required' };
        if (!timingSafeEqual(digest(otp), digest(link.otpCode))) {
          // OTP brute-force guard: persist a failure counter on the link and
          // revoke it after 5 wrong codes (the customer service desk can
          // reissue a fresh link). Counter lives on the row so it survives
          // restarts and applies across processes.
          type LinkWithFailures = typeof link & { otpFailures?: number };
          const withFailures = link as LinkWithFailures;
          const failures = (withFailures.otpFailures ?? 0) + 1;
          const updated: LinkWithFailures = { ...withFailures, otpFailures: failures };
          if (failures >= 5) updated.revokedAt = new Date().toISOString();
          secureLinks.put(updated);
          return { ok: false, reason: failures >= 5 ? 'revoked' : 'otp-invalid' };
        }
      }
      const communication = communications.getFor(link.tenantId, link.communicationId);
      if (!communication) return { ok: false, reason: 'not-found' };
      return { ok: true, link, communication };
    },

    async recordAccess({ link, authMethod, userAgent }) {
      const event: AccessEvent = {
        id: newId('acc'),
        tenantId: link.tenantId,
        communicationId: link.communicationId,
        customerId: link.customerId,
        linkId: link.id,
        at: new Date().toISOString(),
        authMethod,
        userAgent,
      };
      accessEvents.put(event);
      await ctx.publish({
        type: 'com.acorn.access.viewed',
        tenantId: link.tenantId,
        source: SOURCE,
        subject: link.communicationId,
        data: {
          communicationId: link.communicationId,
          customerId: link.customerId,
          linkId: link.id,
          authMethod,
        },
      });
      return event;
    },

    async recordInteraction({ tenantId, communicationId, customerId, kind, detail }) {
      const event: InteractionEvent = {
        id: newId('ixn'),
        tenantId,
        communicationId,
        customerId,
        at: new Date().toISOString(),
        kind,
        detail,
      };
      interactions.put(event);
      await ctx.publish({
        type: 'com.acorn.interaction.recorded',
        tenantId,
        source: SOURCE,
        subject: communicationId,
        data: { communicationId, customerId, kind, detail },
      });
      return event;
    },

    async performAction({ tenantId, communicationId, customerId, action, payload }) {
      const txn: ActionTransaction = {
        id: newId('act'),
        tenantId,
        communicationId,
        customerId,
        action,
        status: 'completed',
        payload,
        at: new Date().toISOString(),
      };
      actions.put(txn);

      if (action === 'update-details') {
        const customer = customers.getFor(tenantId, customerId);
        if (customer) {
          const patched: Customer = { ...customer };
          if (typeof payload.email === 'string' && payload.email) patched.email = payload.email;
          if (typeof payload.phone === 'string' && payload.phone) patched.phone = payload.phone;
          if (payload.address && typeof payload.address === 'object') {
            patched.address = payload.address as Customer['address'];
          }
          customers.put(patched);
        }
      }

      // Outcome mapping: did this action achieve the communication's intent?
      const communication = communications.getFor(tenantId, communicationId);
      const intended = communication?.composed.intendedOutcome;
      const achieved =
        (intended === 'payment_completed' && action === 'pay') ||
        (intended === 'dispute_resolved' && action === 'dispute') ||
        (intended === 'details_updated' && action === 'update-details') ||
        (intended === 'self_served' && action !== 'contact');
      if (achieved) {
        try {
          ctx.services.composition.markOutcome(tenantId, communicationId, `action:${action}`);
        } catch {
          // outcome bookkeeping must never fail the customer's action
        }
      }
      try {
        ctx.services.nba.recommend(tenantId, communicationId);
      } catch {
        // recommendations are best-effort
      }

      await ctx.publish({
        type: 'com.acorn.action.completed',
        tenantId,
        source: SOURCE,
        subject: communicationId,
        data: { communicationId, customerId, action },
      });
      return txn;
    },

    async ask({ tenantId, communicationId, question }) {
      const communication = communications.getFor(tenantId, communicationId);
      if (!communication) throw notFound('communication', communicationId);

      const passages = communication.composed.sections.map((section) => ({
        id: section.id,
        title: section.title,
        text: sectionPassageText(section),
      }));

      // Approved FAQ content joins the grounding corpus.
      const faqs = contentObjects.list(
        tenantId,
        (c) => c.type === 'faq' && Boolean(c.approvedVersionId),
      );
      for (const faq of faqs) {
        const version = contentVersions.getFor(tenantId, faq.approvedVersionId!);
        if (version) passages.push({ id: faq.id, title: faq.title, text: version.body });
      }

      const answer = await ctx.services.ai.answer({
        tenantId,
        question,
        passages,
        subject: communicationId,
      });
      await service.recordInteraction({
        tenantId,
        communicationId,
        customerId: communication.customerId,
        kind: 'assistant-asked',
        detail: question.slice(0, 200),
      });
      return answer;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// Fallback document renderer (used when no HTML artifact exists)
// ---------------------------------------------------------------------------

function renderFallbackDoc(doc: ComposedDocument): string {
  const out: string[] = ['<article>'];
  out.push(`<h1>${escapeHtml(doc.title)}</h1>`);
  out.push(`<p>Prepared for ${escapeHtml(doc.customerName)}</p>`);
  for (const section of doc.sections) {
    const open = section.collapsible
      ? `<details data-section-id="${escapeHtml(section.id)}"><summary>${escapeHtml(section.title)}</summary>`
      : `<section data-section-id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2>`;
    out.push(open);
    if (section.explanation) out.push(`<p class="explanation">${escapeHtml(section.explanation)}</p>`);
    for (const line of section.lines) {
      switch (line.kind) {
        case 'heading':
          out.push(`<h${line.level + 1}>${escapeHtml(line.text)}</h${line.level + 1}>`);
          break;
        case 'text':
          out.push(`<p>${escapeHtml(line.text)}</p>`);
          break;
        case 'summary':
          out.push(`<p><strong>${escapeHtml(line.title)}:</strong> ${escapeHtml(line.text)}</p>`);
          break;
        case 'field-row':
          out.push(
            `<div class="field-row"><span>${escapeHtml(line.label)}</span><span>${escapeHtml(line.value)}</span></div>`,
          );
          break;
        case 'table': {
          const headers = line.headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
          const rows = line.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
            .join('');
          out.push(
            `<table>${line.title ? `<caption>${escapeHtml(line.title)}</caption>` : ''}<thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`,
          );
          break;
        }
        case 'content':
          out.push(`<h3>${escapeHtml(line.title)}</h3><p>${escapeHtml(line.text)}</p>`);
          break;
        case 'action':
          out.push(
            `<button type="button" class="doc-action" data-action="${escapeHtml(line.action)}">${escapeHtml(line.label)}</button>`,
          );
          break;
        case 'divider':
          out.push('<hr>');
          break;
      }
    }
    out.push(section.collapsible ? '</details>' : '</section>');
  }
  out.push('</article>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// HTTP routes — PUBLIC (secure-link token is the credential; no bearer auth)
// ---------------------------------------------------------------------------

const interactionSchema = z.object({
  kind: z.enum(['section-viewed', 'section-expanded', 'faq-searched', 'assistant-asked', 'download']),
  detail: z.string().max(500).optional(),
});

const actionSchema = z.object({
  action: z.enum(['pay', 'dispute', 'update-details', 'contact']),
  payload: z.record(z.unknown()).default({}),
});

const askSchema = z.object({
  question: z.string().min(1).max(500),
});

function sendUnauthorized(reply: FastifyReply): void {
  reply.status(401).type('application/problem+json').send({
    type: 'https://docs.acorn-os.dev/problems/unauthorized',
    title: 'unauthorized',
    status: 401,
    detail: 'invalid or expired viewer token',
  });
}

export function registerViewerRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const viewer = () => ctx.services.viewer;

  // Loaded once at register time; served as the accessibility widget layer.
  const accessWidget = readFileSync(new URL('../../../assets/acorn-access.min.js', import.meta.url));

  // Tiny urlencoded parser for the OTP form (no extra deps).
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      },
    );
  }

  function docHtmlFor(link: SecureLink, communication: Communication): string {
    try {
      const artifact = ctx.services.composition.getArtifact(
        link.tenantId,
        link.communicationId,
        'html',
      );
      if (artifact) {
        const stored = ctx.objects.get(artifact.objectKey);
        if (stored) {
          const html = stored.buf.toString('utf8');
          const article = html.match(/<article[\s\S]*<\/article>/)?.[0];
          const style = html.match(/<style[\s\S]*?<\/style>/)?.[0] ?? '';
          if (article) return `${style}\n${article}`;
        }
      }
    } catch {
      // fall through to the fallback renderer
    }
    return renderFallbackDoc(communication.composed);
  }

  function hasPdf(link: SecureLink): boolean {
    try {
      return (
        ctx.services.composition.getArtifact(link.tenantId, link.communicationId, 'pdf') !==
        undefined
      );
    } catch {
      return false;
    }
  }

  async function serveDocument(
    reply: FastifyReply,
    link: SecureLink,
    communication: Communication,
    authMethod: AccessEvent['authMethod'],
    userAgent?: string,
  ): Promise<void> {
    await viewer().recordAccess({ link, authMethod, userAgent });
    const html = shellPage({
      docHtml: docHtmlFor(link, communication),
      title: communication.composed.title,
      token: link.token,
      hasPdf: hasPdf(link),
    });
    reply.type('text/html').send(html);
  }

  function sendResolveFailure(
    reply: FastifyReply,
    token: string,
    reason: 'not-found' | 'expired' | 'revoked' | 'otp-required' | 'otp-invalid',
  ): void {
    if (reason === 'otp-required') {
      reply.type('text/html').send(otpPage({ token }));
      return;
    }
    if (reason === 'otp-invalid') {
      reply
        .status(401)
        .type('text/html')
        .send(otpPage({ token, error: 'That code is not correct. Please try again.' }));
      return;
    }
    if (reason === 'not-found') {
      reply
        .status(404)
        .type('text/html')
        .send(errorPage({ title: 'Document not found', message: 'This secure link is not valid.' }));
      return;
    }
    const message =
      reason === 'expired'
        ? 'This secure link has expired.'
        : 'This secure link has been revoked.';
    reply.status(410).type('text/html').send(errorPage({ title: 'Link no longer available', message }));
  }

  app.get('/view/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const resolved = viewer().resolveLink(token);
    if (!resolved.ok) {
      sendResolveFailure(reply, token, resolved.reason);
      return;
    }
    await serveDocument(reply, resolved.link, resolved.communication, 'link', req.headers['user-agent']);
  });

  app.post('/view/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const otp = typeof (req.body as Record<string, unknown>)?.otp === 'string'
      ? String((req.body as Record<string, unknown>).otp)
      : undefined;
    const resolved = viewer().resolveLink(token, otp);
    if (!resolved.ok) {
      sendResolveFailure(reply, token, resolved.reason);
      return;
    }
    await serveDocument(reply, resolved.link, resolved.communication, 'link+otp', req.headers['user-agent']);
  });

  app.get('/view/:token/pdf', async (req, reply) => {
    const { token } = req.params as { token: string };
    const otp = (req.query as Record<string, string | undefined>)?.otp;
    const resolved = viewer().resolveLink(token, otp);
    if (!resolved.ok) {
      if (resolved.reason === 'otp-required' || resolved.reason === 'otp-invalid') {
        sendUnauthorized(reply);
        return;
      }
      sendResolveFailure(reply, token, resolved.reason);
      return;
    }
    const { link } = resolved;
    await viewer().recordInteraction({
      tenantId: link.tenantId,
      communicationId: link.communicationId,
      customerId: link.customerId,
      kind: 'download',
      detail: 'pdf',
    });
    const artifact = ctx.services.composition.getArtifact(link.tenantId, link.communicationId, 'pdf');
    const stored = artifact ? ctx.objects.get(artifact.objectKey) : undefined;
    if (!artifact || !stored) {
      reply.status(404).type('application/problem+json').send({
        type: 'https://docs.acorn-os.dev/problems/not-found',
        title: 'not-found',
        status: 404,
        detail: 'no pdf artifact for this communication',
      });
      return;
    }
    reply
      .type(stored.contentType || 'application/pdf')
      .header('content-disposition', 'inline; filename="document.pdf"')
      .send(stored.buf);
  });

  app.post('/api/view/:token/interactions', async (req, reply) => {
    const { token } = req.params as { token: string };
    const resolved = viewer().resolveLink(token);
    if (!resolved.ok) {
      sendUnauthorized(reply);
      return;
    }
    const body = parseBody(interactionSchema, req.body);
    const { link } = resolved;
    return viewer().recordInteraction({
      tenantId: link.tenantId,
      communicationId: link.communicationId,
      customerId: link.customerId,
      kind: body.kind,
      detail: body.detail,
    });
  });

  app.post('/api/view/:token/actions', async (req, reply) => {
    const { token } = req.params as { token: string };
    const resolved = viewer().resolveLink(token);
    if (!resolved.ok) {
      sendUnauthorized(reply);
      return;
    }
    const body = parseBody(actionSchema, req.body);
    const { link } = resolved;
    return viewer().performAction({
      tenantId: link.tenantId,
      communicationId: link.communicationId,
      customerId: link.customerId,
      action: body.action,
      payload: body.payload,
    });
  });

  app.post('/api/view/:token/ask', async (req, reply) => {
    const { token } = req.params as { token: string };
    const resolved = viewer().resolveLink(token);
    if (!resolved.ok) {
      sendUnauthorized(reply);
      return;
    }
    const body = parseBody(askSchema, req.body);
    const { link } = resolved;
    return viewer().ask({
      tenantId: link.tenantId,
      communicationId: link.communicationId,
      question: body.question,
    });
  });

  app.get('/viewer-assets/acorn-access.min.js', async (_req, reply) => {
    reply
      .type('application/javascript')
      .header('cache-control', 'public, max-age=3600')
      .send(accessWidget);
  });
}
