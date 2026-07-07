import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  ActionTransaction,
  AiInvocation,
  Communication,
  CompositionService,
  Customer,
  InteractionEvent,
  NbaService,
  SecureLink,
  ViewerService,
} from '../src/kernel/contracts.js';
import type { PlatformEvent } from '../src/kernel/events.js';
import { createAiGateway } from '../src/domains/ai/index.js';
import { createViewerService } from '../src/domains/viewer/index.js';

const TENANT = 'ten_viewer_test';
const COM_ID = 'com_view_1';
const CUS_ID = 'cus_view_1';
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

const communication: Communication = {
  id: COM_ID,
  tenantId: TENANT,
  templateId: 'tpl_1',
  templateVersionId: 'tpv_1',
  customerId: CUS_ID,
  status: 'delivered',
  dataSnapshotKey: 'snapshot-key',
  dataSnapshotHash: 'snapshot-hash',
  composed: {
    title: 'Your March Statement',
    brand: { name: 'Acorn', primaryColor: '#004225', accentColor: '#e07a00', logoText: 'Acorn' },
    customerName: 'Casey Customer',
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [
      {
        id: 'sec-summary',
        title: 'Account Summary',
        collapsible: false,
        explanation: 'This section shows your current balance and when it is due.',
        lines: [
          { kind: 'field-row', label: 'Total Due', value: '$120.00' },
          { kind: 'field-row', label: 'Due Date', value: 'Apr 15, 2026' },
        ],
      },
      {
        id: 'sec-payments',
        title: 'Payment Options',
        collapsible: true,
        explanation: 'You can pay online, by phone, or by mail.',
        lines: [
          { kind: 'text', text: 'You can pay your balance online at any time. Autopay is available.' },
        ],
      },
    ],
    contentVersionIds: [],
  },
  createdAt: new Date().toISOString(),
};

function mkLink(id: string, token: string, extra: Partial<SecureLink> = {}): SecureLink {
  return {
    id,
    tenantId: TENANT,
    communicationId: COM_ID,
    customerId: CUS_ID,
    token,
    expiresAt: future,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe('viewer domain', () => {
  let ctx: PlatformContext;
  let viewer: ViewerService;
  const outcomeCalls: [string, string, string][] = [];

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));

    ctx.store.collection<Communication>('communications').put(communication);
    ctx.store.collection<Customer>('customers').put({
      id: CUS_ID,
      tenantId: TENANT,
      name: 'Casey Customer',
      email: 'old@example.com',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
    });
    const links = ctx.store.collection<SecureLink>('secureLinks');
    links.put(mkLink('lnk_ok', 'tok-valid'));
    links.put(mkLink('lnk_expired', 'tok-expired', { expiresAt: past }));
    links.put(mkLink('lnk_revoked', 'tok-revoked', { revokedAt: new Date().toISOString() }));
    links.put(mkLink('lnk_otp', 'tok-otp', { otpCode: '123456' }));

    ctx.services.ai = createAiGateway(ctx);
    ctx.services.nba = { recommend: () => [] } as unknown as NbaService;
    ctx.services.composition = {
      markOutcome: (tenantId: string, id: string, via: string) => {
        outcomeCalls.push([tenantId, id, via]);
        return communication;
      },
      getArtifact: () => undefined,
      getCommunication: (_tenantId: string, id: string) =>
        id === COM_ID ? communication : undefined,
    } as unknown as CompositionService;

    viewer = createViewerService(ctx);
    ctx.services.viewer = viewer;
  });

  it('resolveLink resolves a valid token to the communication', () => {
    const resolved = viewer.resolveLink('tok-valid');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.link.id).toBe('lnk_ok');
      expect(resolved.communication.id).toBe(COM_ID);
    }
  });

  it('resolveLink reports not-found, expired and revoked links', () => {
    expect(viewer.resolveLink('tok-nope')).toEqual({ ok: false, reason: 'not-found' });
    expect(viewer.resolveLink('tok-expired')).toEqual({ ok: false, reason: 'expired' });
    expect(viewer.resolveLink('tok-revoked')).toEqual({ ok: false, reason: 'revoked' });
  });

  it('resolveLink enforces the one-time code', () => {
    expect(viewer.resolveLink('tok-otp')).toEqual({ ok: false, reason: 'otp-required' });
    expect(viewer.resolveLink('tok-otp', '000000')).toEqual({ ok: false, reason: 'otp-invalid' });
    const resolved = viewer.resolveLink('tok-otp', '123456');
    expect(resolved.ok).toBe(true);
  });

  it('ask() returns a grounded answer citing a section and persists the interaction + invocation', async () => {
    const question = 'How do I pay my balance online?';
    const answer = await viewer.ask({ tenantId: TENANT, communicationId: COM_ID, question });

    expect(answer.escalated).toBe(false);
    expect(answer.confidence).toBeGreaterThanOrEqual(0.34);
    expect(answer.citations.map((c) => c.sectionId)).toContain('sec-payments');

    const asked = ctx.store
      .collection<InteractionEvent>('interactions')
      .list(TENANT, (i) => i.kind === 'assistant-asked');
    expect(asked.length).toBe(1);
    expect(asked[0]!.detail).toBe(question);
    expect(asked[0]!.communicationId).toBe(COM_ID);

    const invocations = ctx.store.collection<AiInvocation>('aiInvocations').list(TENANT);
    expect(invocations.some((i) => i.id === answer.invocationId)).toBe(true);
  });

  it("performAction 'pay' persists the transaction, marks the outcome and emits the event", async () => {
    const events: PlatformEvent[] = [];
    ctx.bus.on('com.acorn.action.completed', (event) => {
      events.push(event);
    });

    const txn = await viewer.performAction({
      tenantId: TENANT,
      communicationId: COM_ID,
      customerId: CUS_ID,
      action: 'pay',
      payload: { amount: 120 },
    });

    expect(txn.status).toBe('completed');
    const rows = ctx.store
      .collection<ActionTransaction>('actions')
      .list(TENANT, (a) => a.action === 'pay');
    expect(rows.some((a) => a.id === txn.id)).toBe(true);

    expect(outcomeCalls).toContainEqual([TENANT, COM_ID, 'action:pay']);

    expect(events.length).toBe(1);
    expect(events[0]!.data).toEqual({ communicationId: COM_ID, customerId: CUS_ID, action: 'pay' });
  });

  it("performAction 'update-details' patches the customer record", async () => {
    await viewer.performAction({
      tenantId: TENANT,
      communicationId: COM_ID,
      customerId: CUS_ID,
      action: 'update-details',
      payload: { email: 'new@example.com', phone: '555-0100' },
    });

    const customer = ctx.store.collection<Customer>('customers').getFor(TENANT, CUS_ID);
    expect(customer?.email).toBe('new@example.com');
    expect(customer?.phone).toBe('555-0100');
  });
});
