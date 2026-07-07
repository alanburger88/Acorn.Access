/**
 * Regression tests for the per-customer daily frequency cap.
 *
 * The fix: the cap counts DISTINCT communications delivered to a customer today,
 * not raw delivery-attempt rows. One communication that produces many attempt
 * rows (retries + cross-channel failover) must burn exactly ONE cap slot.
 *
 * Stub wiring mirrors test/delivery-scheduling.test.ts.
 */
import { mkdtempSync } from 'node:fs';
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
  Tenant,
  TenantService,
} from '../src/kernel/contracts.js';
import { createDeliveryService } from '../src/domains/delivery/index.js';

describe('delivery frequency cap counts distinct communications', () => {
  const tenantId = 'ten_FREQCAP';
  let ctx: PlatformContext;

  const communications = new Map<string, Communication>();
  const artifacts: Partial<Record<RenderFormat, RenderArtifact>> = {};
  const setStatusCalls: { id: string; status: CommunicationStatus }[] = [];

  function makeCustomer(args: Partial<Customer>): Customer {
    const customer: Customer = {
      id: newId('cus'),
      tenantId,
      name: 'Cap Customer',
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

  function setTenantSettings(settings: Partial<Tenant['settings']>): void {
    ctx.store.collection<Tenant>('tenants').put({
      id: tenantId,
      tenantId,
      name: 'Freq Cap Tenant',
      createdAt: new Date().toISOString(),
      settings: { defaultLocale: 'en-US', aiEnabled: false, ...settings },
    });
  }

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-freq-'));
    ctx = createBaseContext(
      configFromEnv({ dataDir: tmp, outboxDir: join(tmp, 'outbox'), baseUrl: 'http://test.local' }),
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
      hasConsent: () => true,
      preferredChannels: (): Channel[] => ['email', 'sms', 'secure-link'],
    } as unknown as TenantService;

    makeArtifact('email-html', '<!--subject:Cap-->\n<p>View: {{link}}</p>', 'text/html');
    makeArtifact('sms-text', 'Ready: {{link}}', 'text/plain');

    ctx.services.delivery = createDeliveryService(ctx);
  });

  it('cap=1: first communication delivers, a second same-day communication defers', async () => {
    setTenantSettings({ maxDeliveriesPerCustomerPerDay: 1 });
    try {
      const customer = makeCustomer({ email: 'ok@example.com' });

      const first = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: makeCommunication(customer.id).id,
        channels: ['email'],
      });
      expect(first).toHaveLength(1);
      expect(first[0]!.status).toBe('delivered');

      const second = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: makeCommunication(customer.id).id,
        channels: ['email'],
      });
      expect(second).toHaveLength(1);
      expect(second[0]!.status).toBe('scheduled');
      expect(second[0]!.deferReason).toBe('frequency-cap');
    } finally {
      setTenantSettings({});
    }
  });

  it('cap=2: one communication with many attempt rows still counts as ONE slot', async () => {
    setTenantSettings({ maxDeliveriesPerCustomerPerDay: 2 });
    try {
      // 'fail@' triggers a transient email error -> 3 email retries + a failover
      // sms success. Communication A therefore produces FOUR attempt rows.
      const customer = makeCustomer({ email: 'fail@example.com', phone: '+15550009999' });

      const comA = makeCommunication(customer.id);
      const aAttempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: comA.id,
        channels: ['email', 'sms'],
      });
      expect(aAttempts).toHaveLength(4); // 3 failed email tries + 1 delivered sms
      expect(aAttempts.filter((a) => a.channel === 'email')).toHaveLength(3);
      expect(aAttempts.some((a) => a.status === 'delivered')).toBe(true);
      // A alone left more attempt rows than the cap...
      expect(ctx.services.delivery.listAttempts(tenantId, comA.id).length).toBeGreaterThan(2);

      // ...yet a SECOND distinct communication is NOT blocked: distinct
      // communications delivered today = {A} = 1 < cap 2. (A row-counting bug
      // would see 4 >= 2 and wrongly defer this.)
      const comB = makeCommunication(customer.id);
      const bAttempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: comB.id,
        channels: ['email', 'sms'],
      });
      expect(bAttempts.some((a) => a.status === 'scheduled')).toBe(false);
      expect(bAttempts.some((a) => a.status === 'delivered')).toBe(true);

      // A THIRD distinct communication now hits the cap: distinct today = {A,B} = 2.
      const comC = makeCommunication(customer.id);
      const cAttempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: comC.id,
        channels: ['email', 'sms'],
      });
      expect(cAttempts).toHaveLength(1);
      expect(cAttempts[0]!.status).toBe('scheduled');
      expect(cAttempts[0]!.deferReason).toBe('frequency-cap');
    } finally {
      setTenantSettings({});
    }
  });
});
