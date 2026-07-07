import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  AccessEvent,
  ActionTransaction,
  Communication,
  ComposedDocument,
  DeliveryAttempt,
  InteractionEvent,
} from '../src/kernel/contracts.js';
import { createAnalyticsService } from '../src/domains/analytics/index.js';

const TENANT = 'ten_analytics';

function doc(): ComposedDocument {
  return {
    title: 'Statement',
    brand: { name: 'Acorn', primaryColor: '#004400', accentColor: '#88cc66', logoText: 'Acorn' },
    customerName: 'Jane',
    locale: 'en-US',
    intendedOutcome: 'payment_completed',
    sections: [],
    contentVersionIds: [],
  };
}

function comm(
  id: string,
  status: Communication['status'],
  outcome?: Communication['outcome'],
): Communication {
  return {
    id,
    tenantId: TENANT,
    templateId: 'tpl_1',
    templateVersionId: 'tpv_1',
    customerId: 'cus_1',
    status,
    dataSnapshotKey: `${TENANT}/snap`,
    dataSnapshotHash: 'snap-hash',
    composed: doc(),
    createdAt: new Date().toISOString(),
    outcome,
  };
}

describe('analytics domain', () => {
  let ctx: PlatformContext;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.analytics = createAnalyticsService(ctx);

    const now = new Date().toISOString();
    const communications = ctx.store.collection<Communication>('communications');
    // A: delivered, viewed, interacted with, acted on, outcome achieved
    communications.put(comm('com_A', 'delivered', { achieved: true, at: now, via: 'pay' }));
    // B: failed, no engagement
    communications.put(comm('com_B', 'failed'));

    const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');
    deliveries.put({
      id: 'dlv_1', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      channel: 'email', provider: 'sim-email', to: 'jane@example.com', status: 'delivered',
      attempt: 1, createdAt: now, updatedAt: now,
    });
    deliveries.put({
      id: 'dlv_2', tenantId: TENANT, communicationId: 'com_B', customerId: 'cus_1',
      channel: 'sms', provider: 'sim-sms', to: '+15550100', status: 'bounced',
      attempt: 1, createdAt: now, updatedAt: now,
    });

    ctx.store.collection<AccessEvent>('accessEvents').put({
      id: 'acc_1', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      linkId: 'lnk_1', at: now, authMethod: 'link',
    });

    const interactions = ctx.store.collection<InteractionEvent>('interactions');
    interactions.put({
      id: 'ixn_1', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      at: now, kind: 'section-viewed', detail: 'sec-summary',
    });
    interactions.put({
      id: 'ixn_2', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      at: now, kind: 'section-viewed', detail: 'sec-summary',
    });
    interactions.put({
      id: 'ixn_3', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      at: now, kind: 'section-expanded', detail: 'sec-summary',
    });

    ctx.store.collection<ActionTransaction>('actions').put({
      id: 'act_1', tenantId: TENANT, communicationId: 'com_A', customerId: 'cus_1',
      action: 'pay', status: 'completed', payload: {}, at: now,
    });
  });

  it('overview aggregates counts, byChannel, and rates', () => {
    const o = ctx.services.analytics.overview(TENANT);
    expect(o.communications).toBe(2);
    expect(o.delivered).toBe(1);
    expect(o.failed).toBe(1);
    expect(o.viewed).toBe(1);
    expect(o.actionsCompleted).toBe(1);
    expect(o.outcomesAchieved).toBe(1);
    expect(o.outcomeRate).toBe(0.5);
    expect(o.callDeflectionProxy).toBe(1); // 1 self-served, 0 contacts
    expect(o.byChannel.email).toEqual({ sent: 1, delivered: 1, failed: 0 });
    expect(o.byChannel.sms).toEqual({ sent: 0, delivered: 0, failed: 1 });
  });

  it('funnel returns steps in order with descending counts', () => {
    const funnel = ctx.services.analytics.funnel(TENANT, 'tpl_1');
    expect(funnel.map((s) => s.step)).toEqual([
      'composed', 'delivered', 'viewed', 'interacted', 'action-completed', 'outcome',
    ]);
    expect(funnel.map((s) => s.count)).toEqual([2, 1, 1, 1, 1, 1]);
    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i]!.count).toBeLessThanOrEqual(funnel[i - 1]!.count);
    }
  });

  it('hotspots aggregates section views and expands', () => {
    expect(ctx.services.analytics.hotspots(TENANT, 'tpl_1')).toEqual([
      { sectionId: 'sec-summary', views: 2, expands: 1 },
    ]);
  });

  it('timelines match subject OR data.communicationId, sorted, humanized', async () => {
    await ctx.publish({
      type: 'com.acorn.communication.composed',
      tenantId: TENANT,
      source: '/domains/composition',
      subject: 'com_A', // matched by subject
      data: { communicationId: 'com_A', customerId: 'cus_1' },
    });
    await ctx.publish({
      type: 'com.acorn.delivery.delivered',
      tenantId: TENANT,
      source: '/domains/delivery',
      subject: 'dlv_1', // matched only via data.communicationId
      data: { communicationId: 'com_A', customerId: 'cus_1', channel: 'email' },
    });

    const timeline = ctx.services.analytics.communicationTimeline(TENANT, 'com_A');
    expect(timeline).toHaveLength(2);
    expect(timeline.map((t) => t.type)).toContain('com.acorn.communication.composed');
    expect(timeline.map((t) => t.type)).toContain('com.acorn.delivery.delivered');
    const delivered = timeline.find((t) => t.type === 'com.acorn.delivery.delivered');
    expect(delivered?.summary).toBe('delivery.delivered via email');
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.at >= timeline[i - 1]!.at).toBe(true);
    }

    const customerTimeline = ctx.services.analytics.customerTimeline(TENANT, 'cus_1');
    expect(customerTimeline).toHaveLength(2);
    expect(ctx.services.analytics.customerTimeline(TENANT, 'cus_other')).toHaveLength(0);
  });
});
