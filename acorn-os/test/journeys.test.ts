import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type {
  Communication,
  CompositionService,
  DeliveryService,
  JourneyInstance,
  JourneyService,
  JourneyStep,
  RequestCtx,
} from '../src/kernel/contracts.js';
import { createJourneyService } from '../src/domains/journeys/index.js';

describe('journeys domain', () => {
  const tenantId = 'ten_JOURNEYTEST';
  const rctx: RequestCtx = {
    tenantId,
    actorId: 'usr_test',
    roles: ['tenant-admin'],
    keyId: 'key_test',
  };

  let ctx: PlatformContext;
  let svc: JourneyService;

  // ---- stubbed peers -------------------------------------------------------
  let comCounter = 0;
  const composeCalls: {
    tenantId: string;
    templateId: string;
    customerId: string;
    data: Record<string, unknown>;
    requestedChannels?: string[];
    journeyRef?: string;
  }[] = [];
  const deliver = vi.fn(async (_args: { communicationId: string }) => []);

  const deliveriesFor = (communicationId: string): number =>
    deliver.mock.calls.filter(([args]) => args.communicationId === communicationId).length;

  const steps: JourneyStep[] = [
    { id: 'send', kind: 'send', templateId: 'tpl_fixture', channels: ['email'], next: 'wait1' },
    {
      id: 'wait1',
      kind: 'wait',
      until: 'outcome-achieved',
      timeoutMs: 1000,
      onEvent: 'end-done',
      onTimeout: 'remind',
    },
    { id: 'remind', kind: 'remind', channels: ['sms'], next: 'wait2' },
    {
      id: 'wait2',
      kind: 'wait',
      until: 'outcome-achieved',
      timeoutMs: 1000,
      onEvent: 'end-done',
      onTimeout: 'end-abandoned',
    },
    { id: 'end-done', kind: 'end', result: 'completed' },
    { id: 'end-abandoned', kind: 'end', result: 'abandoned' },
  ];

  let journeyId: string;
  /** instance completed via signal in test (c); history asserted in test (f) */
  let signalInstance: JourneyInstance;

  async function startInstance(customerId: string): Promise<JourneyInstance> {
    return svc.start({ tenantId, journeyId, customerId, data: { amount: 42 } });
  }

  async function signalOutcome(communicationId: string): Promise<void> {
    await ctx.publish({
      type: 'com.acorn.communication.outcome-achieved',
      tenantId,
      source: '/test',
      subject: communicationId,
      data: { communicationId },
    });
  }

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.composition = {
      compose: async (args: (typeof composeCalls)[number]) => {
        composeCalls.push(args);
        const com = {
          id: `com_${++comCounter}`,
          tenantId: args.tenantId,
          customerId: args.customerId,
          templateId: args.templateId,
          status: 'rendered',
          journeyRef: args.journeyRef,
          createdAt: new Date().toISOString(),
        };
        return com as unknown as Communication;
      },
    } as unknown as CompositionService;
    ctx.services.delivery = { deliver } as unknown as DeliveryService;
    svc = createJourneyService(ctx);
    ctx.services.journeys = svc;
    journeyId = svc.createJourney(rctx, {
      key: 'payment-chase',
      name: 'Payment chase',
      entryStepId: 'send',
      steps,
    }).id;
  });

  it('rejects an invalid graph (dangling next, entry not send)', () => {
    expect(() =>
      svc.createJourney(rctx, {
        key: 'bad-dangling',
        name: 'Dangling next',
        entryStepId: 's1',
        steps: [
          { id: 's1', kind: 'send', templateId: 'tpl_x', next: 'nowhere' },
          { id: 'done', kind: 'end', result: 'completed' },
        ],
      }),
    ).toThrow(/graph validation failed/);

    expect(() =>
      svc.createJourney(rctx, {
        key: 'bad-entry',
        name: 'Entry not send',
        entryStepId: 'w1',
        steps: [
          {
            id: 'w1',
            kind: 'wait',
            until: 'viewed',
            timeoutMs: 10,
            onEvent: 'done',
            onTimeout: 'done',
          },
          { id: 'done', kind: 'end', result: 'completed' },
        ],
      }),
    ).toThrow(/graph validation failed/);

    // duplicate key on the already-created fixture journey
    expect(() =>
      svc.createJourney(rctx, { key: 'payment-chase', name: 'Dup', entryStepId: 'send', steps }),
    ).toThrow(/already exists/);
  });

  it('start composes with journeyRef and parks on the wait step with a deadline', async () => {
    const instance = await startInstance('cus_b');
    expect(instance.status).toBe('running');
    expect(instance.currentStepId).toBe('wait1');
    expect(instance.deadlineAt).toBeDefined();
    expect(Date.parse(instance.deadlineAt!)).toBeGreaterThan(Date.now());

    const composed = composeCalls.at(-1)!;
    expect(composed.journeyRef).toBe(instance.id);
    expect(composed.templateId).toBe('tpl_fixture');
    expect(composed.requestedChannels).toEqual(['email']);
    expect(composed.data).toEqual({ amount: 42 });

    expect(instance.communicationId).toBeDefined();
    expect(deliveriesFor(instance.communicationId!)).toBe(1);
  });

  it('advances to completed when the outcome-achieved signal arrives', async () => {
    signalInstance = await startInstance('cus_c');
    await signalOutcome(signalInstance.communicationId!);

    const updated = svc.getInstance(tenantId, signalInstance.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.currentStepId).toBe('end-done');
    expect(updated.deadlineAt).toBeUndefined();
    expect(updated.endedAt).toBeDefined();

    const completedEvents = ctx.log.query(tenantId, {
      type: 'com.acorn.journey.completed',
      subject: signalInstance.id,
    });
    expect(completedEvents).toHaveLength(1);
    expect((completedEvents[0]!.data as { result: string }).result).toBe('completed');
  });

  it('tick fires the timeout path: reminder then abandonment', async () => {
    const instance = await startInstance('cus_d');
    const comId = instance.communicationId!;
    expect(deliveriesFor(comId)).toBe(1);

    // first timeout: wait1 → remind (re-delivers the same communication) → wait2
    const firstDeadline = Date.parse(instance.deadlineAt!);
    const advanced = await svc.tick(firstDeadline + 1);
    expect(advanced).toBeGreaterThanOrEqual(1);

    let updated = svc.getInstance(tenantId, instance.id)!;
    expect(updated.status).toBe('running');
    expect(updated.currentStepId).toBe('wait2');
    expect(updated.deadlineAt).toBeDefined();
    expect(deliveriesFor(comId)).toBe(2);

    // second timeout: wait2 → end-abandoned
    const secondDeadline = Date.parse(updated.deadlineAt!);
    await svc.tick(secondDeadline + 1);
    updated = svc.getInstance(tenantId, instance.id)!;
    expect(updated.status).toBe('abandoned');
    expect(updated.currentStepId).toBe('end-abandoned');
    expect(deliveriesFor(comId)).toBe(2); // no further deliveries after abandonment
  });

  it('ignores signals for a non-matching communicationId', async () => {
    const instance = await startInstance('cus_e');
    await signalOutcome('com_someone_elses');

    const updated = svc.getInstance(tenantId, instance.id)!;
    expect(updated.status).toBe('running');
    expect(updated.currentStepId).toBe('wait1');
    expect(updated.deadlineAt).toBeDefined();
  });

  it('records every transition in the instance history', () => {
    const updated = svc.getInstance(tenantId, signalInstance.id)!;
    expect(updated.history.map((h) => h.stepId)).toEqual(['send', 'wait1', 'end-done', 'end-done']);
    expect(updated.history[0]!.note).toBe('started');
    expect(updated.history[1]!.note).toMatch(/^sent com_/);
    expect(updated.history[2]!.note).toBe('signal outcome-achieved');
    expect(updated.history[3]!.note).toBe('ended completed');
  });
});
