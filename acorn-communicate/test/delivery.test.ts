import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { newId } from '../src/kernel/ids.js';
import type {
  Channel,
  Communication,
  CommunicationStatus,
  CompositionService,
  Customer,
  RenderArtifact,
  RenderFormat,
  TenantService,
} from '../src/kernel/contracts.js';
import { createDeliveryService } from '../src/domains/delivery/index.js';

describe('delivery domain', () => {
  const tenantId = 'ten_DELIVERYTEST';
  let ctx: PlatformContext;
  let outboxDir: string;

  // ---- stubbed peers -------------------------------------------------------
  const communications = new Map<string, Communication>();
  const artifacts: Partial<Record<RenderFormat, RenderArtifact>> = {};
  const setStatusCalls: { id: string; status: CommunicationStatus }[] = [];
  const deniedChannels = new Set<Channel>();

  function makeCustomer(args: Partial<Customer>): Customer {
    const customer: Customer = {
      id: newId('cus'),
      tenantId,
      name: 'Test Customer',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
      ...args,
    };
    ctx.store.collection<Customer>('customers').put(customer);
    return customer;
  }

  function makeCommunication(customerId: string): Communication {
    const com = {
      id: newId('com'),
      tenantId,
      customerId,
      status: 'rendered',
      composed: { title: 'Fixture Statement' },
    } as unknown as Communication;
    communications.set(com.id, com);
    return com;
  }

  function makeArtifact(format: RenderFormat, body: string, contentType: string): void {
    const obj = ctx.objects.put(tenantId, Buffer.from(body), contentType);
    artifacts[format] = {
      id: newId('art'),
      tenantId,
      communicationId: 'com_fixture',
      format,
      objectKey: obj.key,
      sha256: obj.sha256,
      size: obj.size,
      contentType,
      renderedAt: new Date().toISOString(),
      rendererVersion: 'test-1',
    };
  }

  function outboxFilesFor(attemptId: string): string[] {
    if (!existsSync(outboxDir)) return [];
    return readdirSync(outboxDir).filter((f) => f.includes(attemptId));
  }

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-'));
    outboxDir = join(tmp, 'outbox');
    ctx = createBaseContext(
      configFromEnv({ dataDir: tmp, outboxDir, baseUrl: 'http://test.local' }),
    );

    ctx.services.composition = {
      getCommunication: (_tenantId: string, id: string) => communications.get(id),
      getArtifact: (_tenantId: string, _communicationId: string, format: RenderFormat) =>
        artifacts[format],
      setStatus: (_tenantId: string, id: string, status: CommunicationStatus) => {
        setStatusCalls.push({ id, status });
        return communications.get(id)!;
      },
    } as unknown as CompositionService;

    ctx.services.tenants = {
      hasConsent: (_tenantId: string, _customerId: string, channel: Channel) =>
        !deniedChannels.has(channel),
      preferredChannels: (): Channel[] => ['email', 'sms', 'secure-link'],
    } as unknown as TenantService;

    makeArtifact('email-html', '<!--subject:Test-->\n<p>View your document: {{link}}</p>', 'text/html');
    makeArtifact('sms-text', 'Your document is ready: {{link}}', 'text/plain');
    makeArtifact('pdf', '%PDF-1.7 fixture', 'application/pdf');

    ctx.services.delivery = createDeliveryService(ctx);
  });

  it('delivers a happy-path email: .eml with substituted link + subject, status delivered', async () => {
    const customer = makeCustomer({ email: 'good@example.com' });
    const com = makeCommunication(customer.id);
    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email'],
    });

    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt.channel).toBe('email');
    expect(attempt.status).toBe('delivered');
    expect(attempt.to).toBe('good@example.com');

    const emlPath = join(outboxDir, `${attempt.id}.eml`);
    expect(existsSync(emlPath)).toBe(true);
    const eml = readFileSync(emlPath, 'utf8');
    expect(eml).toContain('http://test.local/view/');
    expect(eml).not.toContain('{{link}}');
    expect(eml).toContain('Subject: Test');
    expect(eml).toContain('To: good@example.com');

    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });

    // one secure link exists for the communication
    const link = ctx.services.delivery.getSecureLink(tenantId, com.id);
    expect(link).toBeDefined();
    expect(eml).toContain(link!.token);
  });

  it('fails over to sms after an email hard bounce (failoverFrom set)', async () => {
    const customer = makeCustomer({ email: 'bounce@example.com', phone: '+15550001234' });
    const com = makeCommunication(customer.id);
    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email', 'sms'],
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.channel).toBe('email');
    expect(attempts[0]!.status).toBe('bounced');
    expect(attempts[1]!.channel).toBe('sms');
    expect(attempts[1]!.status).toBe('delivered');
    expect(attempts[1]!.failoverFrom).toBe('email');
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });
  });

  it('records no-consent as a failed attempt and moves on WITHOUT failover', async () => {
    deniedChannels.add('email');
    try {
      const customer = makeCustomer({ email: 'good2@example.com', phone: '+15550005678' });
      const com = makeCommunication(customer.id);
      const attempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: com.id,
        channels: ['email', 'sms'],
      });

      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.channel).toBe('email');
      expect(attempts[0]!.status).toBe('failed');
      expect(attempts[0]!.failureReason).toBe('no-consent');
      expect(attempts[1]!.channel).toBe('sms');
      expect(attempts[1]!.status).toBe('delivered');
      expect(attempts[1]!.failoverFrom).toBeUndefined();
    } finally {
      deniedChannels.delete('email');
    }
  });

  it('retries a transient email failure 3 times, then fails over to sms', async () => {
    const customer = makeCustomer({ email: 'fail@example.com', phone: '+15550009999' });
    const com = makeCommunication(customer.id);
    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email', 'sms'],
    });

    expect(attempts).toHaveLength(4);
    const emailAttempts = attempts.filter((a) => a.channel === 'email');
    expect(emailAttempts).toHaveLength(3);
    expect(emailAttempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    for (const a of emailAttempts) {
      expect(a.status).toBe('failed');
      expect(a.failureReason).toBe('smtp transient error');
    }
    const sms = attempts[3]!;
    expect(sms.channel).toBe('sms');
    expect(sms.status).toBe('delivered');
    expect(sms.failoverFrom).toBe('email');
  });

  it('delivers via secure-link only, producing no outbox file', async () => {
    const customer = makeCustomer({});
    const com = makeCommunication(customer.id);
    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['secure-link'],
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.channel).toBe('secure-link');
    expect(attempts[0]!.status).toBe('delivered');
    expect(outboxFilesFor(attempts[0]!.id)).toEqual([]);
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });
  });

  it('providerCallback flips a print attempt from sent to delivered', async () => {
    const customer = makeCustomer({
      address: {
        line1: '1 Oak Lane',
        city: 'Acornville',
        region: 'CA',
        postalCode: '94000',
        country: 'US',
      },
    });
    const com = makeCommunication(customer.id);
    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['print'],
    });

    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(attempt.channel).toBe('print');
    expect(attempt.status).toBe('sent');

    const spool = JSON.parse(
      readFileSync(join(outboxDir, `${attempt.id}.print.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(spool.customerId).toBe(customer.id);
    expect(spool.artifactObjectKey).toBe(artifacts.pdf!.objectKey);

    const updated = await ctx.services.delivery.providerCallback({
      tenantId,
      attemptId: attempt.id,
      status: 'delivered',
    });
    expect(updated.status).toBe('delivered');
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });

    const listed = ctx.services.delivery.listAttempts(tenantId, com.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('delivered');
  });

  it('throws notFound for an unknown communication and unknown attempt', async () => {
    await expect(
      ctx.services.delivery.deliver({ tenantId, communicationId: 'com_missing' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      ctx.services.delivery.providerCallback({
        tenantId,
        attemptId: 'dlv_missing',
        status: 'delivered',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
