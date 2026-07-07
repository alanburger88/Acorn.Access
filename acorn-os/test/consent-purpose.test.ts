import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { newId } from '../src/kernel/ids.js';
import type {
  Communication,
  CommunicationStatus,
  CompositionService,
  Customer,
  RenderArtifact,
  RenderFormat,
  RequestCtx,
  TemplateVersion,
} from '../src/kernel/contracts.js';
import { createDeliveryService } from '../src/domains/delivery/index.js';
import { createTenantService } from '../src/domains/tenants/index.js';

// ---------------------------------------------------------------------------
// Purpose-aware consent — tenants unit behavior
// ---------------------------------------------------------------------------

describe('tenants purpose-aware consent', () => {
  let ctx: PlatformContext;
  let tenantId: string;
  let adminCtx: RequestCtx;
  let customerId: string;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.tenants = createTenantService(ctx);
    const { tenant, adminKey } = ctx.services.tenants.createTenant({ name: 'Consent Bank' });
    tenantId = tenant.id;
    adminCtx = ctx.services.tenants.authenticate(adminKey.secret)!;
    customerId = ctx.services.tenants.createCustomer(adminCtx, {
      name: 'Morgan Marketing',
      email: 'morgan@example.com',
      phone: '+15550001111',
      locale: 'en-US',
    }).id;
  });

  it('marketing purpose with no record on file -> false (no implied consent)', () => {
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email', 'marketing')).toBe(false);
    // transactional keeps implied consent for the same channel
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email')).toBe(true);
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email', 'transactional')).toBe(true);
  });

  it('explicit marketing grant -> true; explicit deny after grant -> false (latest wins)', () => {
    ctx.services.tenants.recordConsent(adminCtx, {
      customerId,
      channel: 'email',
      purpose: 'marketing',
      granted: true,
      source: 'signup-form',
    });
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email', 'marketing')).toBe(true);

    ctx.services.tenants.recordConsent(adminCtx, {
      customerId,
      channel: 'email',
      purpose: 'marketing',
      granted: false,
      source: 'preference-center',
    });
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email', 'marketing')).toBe(false);
  });

  it('transactional consent is unaffected by marketing records (purpose filtering)', () => {
    // marketing opt-out recorded above must not touch transactional email
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'email')).toBe(true);

    // and a marketing grant on sms must not resurrect a transactional deny
    ctx.services.tenants.recordConsent(adminCtx, {
      customerId,
      channel: 'sms',
      purpose: 'transactional',
      granted: false,
      source: 'preference-center',
    });
    ctx.services.tenants.recordConsent(adminCtx, {
      customerId,
      channel: 'sms',
      purpose: 'marketing',
      granted: true,
      source: 'signup-form',
    });
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'sms', 'transactional')).toBe(false);
    expect(ctx.services.tenants.hasConsent(tenantId, customerId, 'sms', 'marketing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Purpose-aware consent — delivery integration (marketing template versions)
// ---------------------------------------------------------------------------

describe('delivery consent purpose integration', () => {
  const tenantId = 'ten_PURPOSETEST';
  let ctx: PlatformContext;
  const opCtx: RequestCtx = { tenantId, actorId: 'usr_test', roles: ['tenant-admin'], keyId: 'key_test' };

  // ---- stubbed composition peer (tenants service is the real one) ----------
  const communications = new Map<string, Communication>();
  const artifacts: Partial<Record<RenderFormat, RenderArtifact>> = {};
  const setStatusCalls: { id: string; status: CommunicationStatus }[] = [];

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

  function seedVersion(purpose?: TemplateVersion['purpose']): TemplateVersion {
    const version: TemplateVersion = {
      id: newId('tpv'),
      tenantId,
      templateId: newId('tpl'),
      version: 1,
      status: 'published',
      dataContract: { fields: [], sample: {} },
      intendedOutcome: 'understood',
      ...(purpose ? { purpose } : {}),
      blocks: [],
      channels: {},
      authorId: 'usr_test',
      createdAt: new Date().toISOString(),
      aiAssisted: false,
    };
    ctx.store.collection<TemplateVersion>('templateVersions').put(version);
    return version;
  }

  function makeCommunication(customerId: string, templateVersionId: string): Communication {
    const com = {
      id: newId('com'),
      tenantId,
      customerId,
      templateVersionId,
      status: 'rendered',
      composed: { title: 'Fixture Offer' },
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

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-'));
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

    // REAL tenants service so recordConsent/hasConsent exercise purpose logic
    ctx.services.tenants = createTenantService(ctx);

    makeArtifact('email-html', '<!--subject:Offer-->\n<p>See your offer: {{link}}</p>', 'text/html');
    makeArtifact('sms-text', 'Your offer: {{link}}', 'text/plain');

    ctx.services.delivery = createDeliveryService(ctx);
  });

  it('marketing version + no consent: every channel (incl. secure-link) skipped no-consent, delivery failed', async () => {
    const version = seedVersion('marketing');
    const customer = makeCustomer({ email: 'good@example.com', phone: '+15550002222' });
    const com = makeCommunication(customer.id, version.id);

    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email', 'sms', 'secure-link'],
    });

    expect(attempts).toHaveLength(3);
    expect(attempts.map((a) => a.channel)).toEqual(['email', 'sms', 'secure-link']);
    for (const attempt of attempts) {
      expect(attempt.status).toBe('failed');
      expect(attempt.failureReason).toBe('no-consent');
      expect(attempt.failoverFrom).toBeUndefined(); // consent skip is not a failover
    }
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'failed' });
  });

  it('after an explicit marketing email grant the delivery succeeds via email', async () => {
    const version = seedVersion('marketing');
    const customer = makeCustomer({ email: 'good@example.com', phone: '+15550003333' });
    const com = makeCommunication(customer.id, version.id);

    ctx.services.tenants.recordConsent(opCtx, {
      customerId: customer.id,
      channel: 'email',
      purpose: 'marketing',
      granted: true,
      source: 'signup-form',
    });

    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['sms', 'email'],
    });

    // sms has no marketing grant -> skipped; email grant -> delivered
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.channel).toBe('sms');
    expect(attempts[0]!.status).toBe('failed');
    expect(attempts[0]!.failureReason).toBe('no-consent');
    expect(attempts[1]!.channel).toBe('email');
    expect(attempts[1]!.status).toBe('delivered');
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });
  });

  it('a transactional version (no purpose field) keeps implied consent, even with a marketing deny on file', async () => {
    const version = seedVersion(); // no purpose -> transactional
    const customer = makeCustomer({ email: 'good@example.com' });
    const com = makeCommunication(customer.id, version.id);

    // a marketing opt-out must not block transactional delivery
    ctx.services.tenants.recordConsent(opCtx, {
      customerId: customer.id,
      channel: 'email',
      purpose: 'marketing',
      granted: false,
      source: 'preference-center',
    });

    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email'],
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.channel).toBe('email');
    expect(attempts[0]!.status).toBe('delivered');
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });
  });
});
