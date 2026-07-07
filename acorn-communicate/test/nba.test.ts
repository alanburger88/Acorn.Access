import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  ActionTransaction,
  Communication,
  DeliveryAttempt,
  NbaService,
  Recommendation,
} from '../src/kernel/contracts.js';
import { createNbaService } from '../src/domains/nba/index.js';

const TENANT = 'ten_nba_test';
const COM_ID = 'com_nba_1';
const CUS_ID = 'cus_nba_1';

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
    title: 'Unpaid Statement',
    brand: { name: 'Acorn', primaryColor: '#004225', accentColor: '#e07a00', logoText: 'Acorn' },
    customerName: 'Nia Nutbrown',
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [
      {
        id: 'sec-summary',
        title: 'Summary',
        collapsible: false,
        lines: [{ kind: 'field-row', label: 'Total Due', value: '$120.00' }],
      },
    ],
    contentVersionIds: [],
  },
  createdAt: new Date().toISOString(),
};

describe('nba domain', () => {
  let ctx: PlatformContext;
  let nba: NbaService;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.store.collection<Communication>('communications').put(communication);
    nba = createNbaService(ctx);
    ctx.services.nba = nba;
  });

  it('R1 pay-balance-due fires for an unpaid statement with a positive due amount', () => {
    const recs = nba.recommend(TENANT, COM_ID);
    const pay = recs.find((r) => r.ruleId === 'pay-balance-due');
    expect(pay).toBeDefined();
    expect(pay!.action).toBe('pay');
    expect(pay!.reason).toContain('Total Due');
    expect(pay!.reason).toContain('$120.00');
  });

  it('R2 view-nudge fires for a delivered but unviewed communication', () => {
    const recs = nba.recommend(TENANT, COM_ID);
    const nudge = recs.find((r) => r.ruleId === 'view-nudge');
    expect(nudge).toBeDefined();
    expect(nudge!.action).toBe('view-document');
  });

  it('refresh is idempotent — recomputation replaces rows instead of duplicating them', () => {
    const first = nba.recommend(TENANT, COM_ID);
    const second = nba.recommend(TENANT, COM_ID);
    expect(second.length).toBe(first.length);

    const stored = ctx.store
      .collection<Recommendation>('recommendations')
      .list(TENANT, (r) => r.communicationId === COM_ID);
    expect(stored.length).toBe(second.length);
    const ruleIds = stored.map((r) => r.ruleId);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it('R5 update-details-bounce fires after a bounced delivery attempt', () => {
    ctx.store.collection<DeliveryAttempt>('deliveries').put({
      id: 'dlv_bounced_1',
      tenantId: TENANT,
      communicationId: COM_ID,
      customerId: CUS_ID,
      channel: 'email',
      provider: 'sim-email',
      to: 'nia@example.com',
      status: 'bounced',
      attempt: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const recs = nba.recommend(TENANT, COM_ID);
    const bounce = recs.find((r) => r.ruleId === 'update-details-bounce');
    expect(bounce).toBeDefined();
    expect(bounce!.action).toBe('update-details');
  });

  it('marks a recommendation taken=true when a matching action transaction exists', () => {
    ctx.store.collection<ActionTransaction>('actions').put({
      id: 'act_seed_pay',
      tenantId: TENANT,
      communicationId: COM_ID,
      customerId: CUS_ID,
      action: 'pay',
      status: 'completed',
      payload: { amount: 120 },
      at: new Date().toISOString(),
    });

    const recs = nba.recommend(TENANT, COM_ID);
    const pay = recs.find((r) => r.ruleId === 'pay-balance-due');
    expect(pay).toBeDefined();
    expect(pay!.taken).toBe(true);
  });
});
