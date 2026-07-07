import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type { PlatformEvent } from '../src/kernel/events.js';
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
import { inQuietHours, quietHoursEnd } from '../src/domains/delivery/scheduling.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe('delivery scheduling (scheduled delivery, quiet hours, frequency caps)', () => {
  const tenantId = 'ten_SCHEDTEST';
  let ctx: PlatformContext;
  let outboxDir: string;

  // ---- stubbed peers (mirrors test/delivery.test.ts) ------------------------
  const communications = new Map<string, Communication>();
  const artifacts: Partial<Record<RenderFormat, RenderArtifact>> = {};
  const setStatusCalls: { id: string; status: CommunicationStatus }[] = [];
  const events: PlatformEvent[] = [];

  function makeCustomer(args: Partial<Customer>): Customer {
    const customer: Customer = {
      id: newId('cus'),
      tenantId,
      name: 'Sched Customer',
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

  /** Seed/replace the tenant row read by the delivery domain's quiet-hours/cap checks. */
  function setTenantSettings(settings: Partial<Tenant['settings']>): void {
    ctx.store.collection<Tenant>('tenants').put({
      id: tenantId,
      tenantId,
      name: 'Sched Test Tenant',
      createdAt: new Date().toISOString(),
      settings: { defaultLocale: 'en-US', aiEnabled: false, ...settings },
    });
  }

  function outboxFilesFor(attemptId: string): string[] {
    if (!existsSync(outboxDir)) return [];
    return readdirSync(outboxDir).filter((f) => f.includes(attemptId));
  }

  const hhmm = (minuteOfDay: number): string => {
    const m = ((minuteOfDay % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-sched-'));
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
      hasConsent: () => true,
      preferredChannels: (): Channel[] => ['email', 'sms', 'secure-link'],
    } as unknown as TenantService;

    ctx.bus.on('com.acorn.delivery.*', (e) => {
      events.push(e);
    });

    makeArtifact('email-html', '<!--subject:Sched-->\n<p>View: {{link}}</p>', 'text/html');
    makeArtifact('sms-text', 'Ready: {{link}}', 'text/plain');
    makeArtifact('pdf', '%PDF-1.7 fixture', 'application/pdf');

    ctx.services.delivery = createDeliveryService(ctx);
  });

  it('defers an explicit future scheduleAt, and tick promotes it after the time', async () => {
    setTenantSettings({}); // no quiet hours, no cap
    const customer = makeCustomer({ email: 'sched@example.com' });
    const com = makeCommunication(customer.id);
    const scheduleAt = new Date(Date.now() + 60 * MINUTE_MS).toISOString();

    const attempts = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email'],
      scheduleAt,
    });

    // one scheduled row, no provider touched, communication status untouched
    expect(attempts).toHaveLength(1);
    const row = attempts[0]!;
    expect(row.status).toBe('scheduled');
    expect(row.deferReason).toBe('explicit-schedule');
    expect(row.provider).toBe('scheduler');
    expect(row.to).toBe('(deferred)');
    expect(row.attempt).toBe(0);
    expect(row.channel).toBe('email');
    expect(Date.parse(row.scheduledFor!)).toBe(Date.parse(scheduleAt));
    expect(outboxFilesFor(row.id)).toEqual([]);
    expect(existsSync(outboxDir) ? readdirSync(outboxDir) : []).toEqual([]);
    expect(setStatusCalls.filter((c) => c.id === com.id)).toEqual([]);
    const scheduledEvents = events.filter((e) => e.type === 'com.acorn.delivery.scheduled');
    expect(scheduledEvents).toHaveLength(1);
    expect(scheduledEvents[0]!.subject).toBe(com.id);
    expect(scheduledEvents[0]!.data).toMatchObject({
      communicationId: com.id,
      customerId: customer.id,
      scheduledFor: row.scheduledFor,
      reason: 'explicit-schedule',
    });

    // tick before the scheduled time promotes nothing
    expect(await ctx.services.delivery.tick(Date.now())).toBe(0);
    expect(
      ctx.services.delivery
        .listAttempts(tenantId, com.id)
        .filter((a) => a.status === 'scheduled'),
    ).toHaveLength(1);

    // tick after the scheduled time promotes and runs the real orchestration
    const promoted = await ctx.services.delivery.tick(Date.parse(scheduleAt) + 1);
    expect(promoted).toBe(1);

    const promotedEvents = events.filter((e) => e.type === 'com.acorn.delivery.promoted');
    expect(promotedEvents).toHaveLength(1);
    expect(promotedEvents[0]!.data).toMatchObject({
      communicationId: com.id,
      scheduledAttemptId: row.id,
    });

    const listed = ctx.services.delivery.listAttempts(tenantId, com.id);
    expect(listed.filter((a) => a.status === 'scheduled')).toHaveLength(0);
    const emailAttempt = listed.find((a) => a.provider === 'sim-email');
    expect(emailAttempt).toBeDefined();
    expect(emailAttempt!.status).toBe('delivered');
    expect(outboxFilesFor(emailAttempt!.id)).toEqual([`${emailAttempt!.id}.eml`]);
    expect(setStatusCalls).toContainEqual({ id: com.id, status: 'delivered' });
  });

  it('quiet hours defer email plans to the window end, but not secure-link-only plans', async () => {
    const now = Date.now();
    const nowMin = Math.floor((now % DAY_MS) / MINUTE_MS);
    // window spanning "now" in UTC: started 60 min ago, ends 45 min from now
    const window = { start: hhmm(nowMin - 60), end: hhmm(nowMin + 45) };
    setTenantSettings({ quietHours: window });
    try {
      const customer = makeCustomer({ email: 'quiet@example.com' });
      const com = makeCommunication(customer.id);
      const attempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: com.id,
        channels: ['email'],
      });

      expect(attempts).toHaveLength(1);
      const row = attempts[0]!;
      expect(row.status).toBe('scheduled');
      expect(row.deferReason).toBe('quiet-hours');
      // scheduledFor ~ window end (end minute is truncated; allow ±2 min)
      const midnight = now - (now % DAY_MS);
      let expectedEnd = midnight + ((nowMin + 45) % 1440) * MINUTE_MS;
      if (expectedEnd <= now) expectedEnd += DAY_MS; // window end wrapped past midnight
      expect(Math.abs(Date.parse(row.scheduledFor!) - expectedEnd)).toBeLessThanOrEqual(
        2 * MINUTE_MS,
      );
      expect(outboxFilesFor(row.id)).toEqual([]);

      // a secure-link-only plan is not an outbound message: goes out immediately
      const linkCom = makeCommunication(makeCustomer({}).id);
      const linkAttempts = await ctx.services.delivery.deliver({
        tenantId,
        communicationId: linkCom.id,
        channels: ['secure-link'],
      });
      expect(linkAttempts).toHaveLength(1);
      expect(linkAttempts[0]!.channel).toBe('secure-link');
      expect(linkAttempts[0]!.status).toBe('delivered');
    } finally {
      setTenantSettings({});
    }
  });

  it('inQuietHours / quietHoursEnd handle a 21:00→08:00 wrap-midnight window', () => {
    const window = { start: '21:00', end: '08:00' };
    const at = (h: number, m = 0): number => Date.UTC(2026, 0, 15, h, m);

    expect(inQuietHours(at(23), window)).toBe(true); // inside, before midnight
    expect(inQuietHours(at(7), window)).toBe(true); // inside, after midnight
    expect(inQuietHours(at(12), window)).toBe(false); // outside

    // end-time math: before-midnight instants resolve to TOMORROW 08:00,
    // after-midnight instants to TODAY 08:00
    expect(quietHoursEnd(at(23), window)).toBe(Date.UTC(2026, 0, 16, 8, 0));
    expect(quietHoursEnd(at(7), window)).toBe(Date.UTC(2026, 0, 15, 8, 0));

    // non-wrapping window sanity
    const day = { start: '09:00', end: '17:00' };
    expect(inQuietHours(at(12), day)).toBe(true);
    expect(inQuietHours(at(8), day)).toBe(false);
    expect(inQuietHours(at(17), day)).toBe(false);
    expect(quietHoursEnd(at(12), day)).toBe(Date.UTC(2026, 0, 15, 17, 0));
  });

  it('frequency cap 1: first deliver executes, second same-day deliver defers to next UTC midnight', async () => {
    setTenantSettings({ maxDeliveriesPerCustomerPerDay: 1 });
    try {
      const customer = makeCustomer({ email: 'capped@example.com' });

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
      const row = second[0]!;
      expect(row.status).toBe('scheduled');
      expect(row.deferReason).toBe('frequency-cap');
      const scheduledForMs = Date.parse(row.scheduledFor!);
      expect(scheduledForMs % DAY_MS).toBe(0); // exactly a UTC midnight
      expect(scheduledForMs).toBeGreaterThan(Date.now());
      expect(scheduledForMs).toBeLessThanOrEqual(Date.now() + DAY_MS);
      expect(outboxFilesFor(row.id)).toEqual([]);
    } finally {
      setTenantSettings({});
    }
  });

  it('re-delivery replaces the pending scheduled row instead of duplicating it', async () => {
    setTenantSettings({});
    const customer = makeCustomer({ email: 'replace@example.com' });
    const com = makeCommunication(customer.id);
    const t1 = new Date(Date.now() + 60 * MINUTE_MS).toISOString();
    const t2 = new Date(Date.now() + 120 * MINUTE_MS).toISOString();

    const [row1] = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email'],
      scheduleAt: t1,
    });
    const [row2] = await ctx.services.delivery.deliver({
      tenantId,
      communicationId: com.id,
      channels: ['email', 'sms'],
      scheduleAt: t2,
    });

    expect(row2!.id).toBe(row1!.id); // same row, updated in place
    expect(Date.parse(row2!.scheduledFor!)).toBe(Date.parse(t2));
    expect(row2!.deferReason).toBe('explicit-schedule');

    const scheduledRows = ctx.services.delivery
      .listAttempts(tenantId, com.id)
      .filter((a) => a.status === 'scheduled');
    expect(scheduledRows).toHaveLength(1);
    expect(scheduledRows[0]!.id).toBe(row1!.id);
    expect(Date.parse(scheduledRows[0]!.scheduledFor!)).toBe(Date.parse(t2));
  });
});
