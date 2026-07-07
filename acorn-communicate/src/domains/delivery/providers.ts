/**
 * DELIVERY bounded context — simulated channel providers.
 *
 * Each provider "sends" by writing the outbound message to
 * `ctx.config.outboxDir` and derives a deterministic outcome from the
 * recipient address, so end-to-end flows (bounce, transient failure,
 * failover, provider receipts) can be exercised without real ESP/SMS/print
 * integrations. Production swaps these for real provider adapters behind the
 * same interface.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Channel, Communication, Customer, RenderFormat } from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { invalid } from '../../kernel/errors.js';

export interface ProviderSendArgs {
  tenantId: string;
  attemptId: string;
  to: string;
  communication: Communication;
  customer: Customer;
  /** fully-qualified secure viewer URL substituted for the {{link}} placeholder */
  viewerUrl: string;
}

export interface ProviderResult {
  /**
   * 'delivered' — synchronous receipt; 'sent' — accepted, receipt arrives
   * later via providerCallback; 'bounced' — hard failure, do not retry this
   * channel. Transient failures are signalled by THROWING (the orchestrator
   * retries those).
   */
  status: 'sent' | 'delivered' | 'bounced';
  providerMessageId?: string;
  failureReason?: string;
}

export interface ChannelProvider {
  readonly name: string;
  /** Resolve the destination address; undefined = channel not capable for this customer. */
  resolveTo(customer: Customer, viewerUrl: string): string | undefined;
  send(args: ProviderSendArgs): Promise<ProviderResult>;
}

export function createProviders(ctx: PlatformContext): Partial<Record<Channel, ChannelProvider>> {
  function outbox(fileName: string, contents: string): void {
    mkdirSync(ctx.config.outboxDir, { recursive: true });
    writeFileSync(join(ctx.config.outboxDir, fileName), contents);
  }

  function loadArtifactText(tenantId: string, communicationId: string, format: RenderFormat): string {
    const artifact = ctx.services.composition.getArtifact(tenantId, communicationId, format);
    if (!artifact) {
      throw invalid(`${format} artifact not rendered for communication ${communicationId}`);
    }
    const obj = ctx.objects.get(artifact.objectKey);
    if (!obj) throw invalid(`artifact object ${artifact.objectKey} missing from object store`);
    return obj.buf.toString('utf8');
  }

  const email: ChannelProvider = {
    name: 'sim-email',
    resolveTo: (customer) => customer.email,
    async send({ tenantId, attemptId, to, communication, viewerUrl }) {
      // Simulated SMTP connect failure (transient — orchestrator retries).
      if (to.includes('fail')) throw new Error('simulated transient smtp failure');
      const html = loadArtifactText(tenantId, communication.id, 'email-html')
        .split('{{link}}')
        .join(viewerUrl);
      // Subject convention with the renderer: first line is <!--subject:...-->.
      const subjectMatch = /^<!--subject:(.*?)-->/.exec(html.trimStart());
      const subject = subjectMatch?.[1]?.trim() || communication.composed.title;
      // Production resolves the sender from the template's Brand.fromEmail;
      // the simulated provider derives a tenant-scoped noreply address.
      const from = `noreply@${communication.tenantId.replace(/^ten_/, '').toLowerCase()}.acorn`;
      const eml = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        `X-Acorn-Attempt: ${attemptId}`,
        '',
        html,
      ].join('\r\n');
      outbox(`${attemptId}.eml`, eml);
      const providerMessageId = `sim-email-${attemptId}`;
      if (to.includes('bounce')) {
        return { status: 'bounced', failureReason: 'hard-bounce', providerMessageId };
      }
      return { status: 'delivered', providerMessageId }; // synchronous receipt
    },
  };

  const sms: ChannelProvider = {
    name: 'sim-sms',
    resolveTo: (customer) => customer.phone,
    async send({ tenantId, attemptId, to, communication, viewerUrl }) {
      const text = loadArtifactText(tenantId, communication.id, 'sms-text')
        .split('{{link}}')
        .join(viewerUrl);
      outbox(`${attemptId}.sms.json`, JSON.stringify({ to, text }, null, 2));
      const providerMessageId = `sim-sms-${attemptId}`;
      if (to.endsWith('0000')) {
        return { status: 'bounced', failureReason: 'invalid-number', providerMessageId };
      }
      return { status: 'delivered', providerMessageId };
    },
  };

  const secureLink: ChannelProvider = {
    name: 'secure-link',
    // The link itself is the destination.
    resolveTo: (_customer, viewerUrl) => viewerUrl,
    // 'secure-link' means link-only delivery: no push message is produced;
    // the link IS the channel, so the attempt is immediately delivered.
    async send() {
      return { status: 'delivered' };
    },
  };

  const print: ChannelProvider = {
    name: 'sim-print',
    resolveTo: (customer) =>
      customer.address
        ? `${customer.address.line1}, ${customer.address.city}, ${customer.address.region} ${customer.address.postalCode}, ${customer.address.country}`
        : `postal:${customer.id}`,
    async send({ tenantId, attemptId, to, communication, customer }) {
      // Print spool entry; the pdf artifact is referenced by object key when
      // rendered. Delivery receipt comes later via providerCallback.
      const pdf = ctx.services.composition.getArtifact(tenantId, communication.id, 'pdf');
      outbox(
        `${attemptId}.print.json`,
        JSON.stringify(
          { customerId: customer.id, address: to, artifact: 'pdf', objectKey: pdf?.objectKey ?? null },
          null,
          2,
        ),
      );
      return { status: 'sent', providerMessageId: `sim-print-${attemptId}` };
    },
  };

  return { email, sms, 'secure-link': secureLink, print };
}
