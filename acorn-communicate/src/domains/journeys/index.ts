/**
 * JOURNEYS bounded context — multi-step communication orchestration. A journey
 * is an explicit state machine (send → wait → remind → end); instances run
 * steps until they park on a `wait` (resumed by lifecycle signals on the bus
 * or by `tick()` timeouts) or reach an `end` step.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Journey,
  JourneyInstance,
  JourneyService,
  JourneyStep,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import type { PlatformEvent } from '../../kernel/events.js';
import { conflict, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/journeys';

type WaitStep = Extract<JourneyStep, { kind: 'wait' }>;

/**
 * Lifecycle signal → wait kind it satisfies. Matching is EXACT on purpose:
 * an 'outcome-achieved' event does NOT satisfy a wait for 'action-completed'
 * (or 'viewed') even though it often implies one — journeys are explicit
 * state machines and implicit signal widening would make them unpredictable.
 */
const SIGNAL_EVENTS: Record<string, WaitStep['until']> = {
  'com.acorn.communication.outcome-achieved': 'outcome-achieved',
  'com.acorn.access.viewed': 'viewed',
  'com.acorn.action.completed': 'action-completed',
};

// ---------------------------------------------------------------------------
// Graph validation
// ---------------------------------------------------------------------------

function validateGraph(args: { entryStepId: string; steps: JourneyStep[] }): void {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const step of args.steps) {
    if (ids.has(step.id)) errors.push(`duplicate step id '${step.id}'`);
    ids.add(step.id);
  }
  const entry = args.steps.find((s) => s.id === args.entryStepId);
  if (!entry) errors.push(`entryStepId '${args.entryStepId}' does not reference a step`);
  for (const step of args.steps) {
    const refs: [string, string][] = [];
    if (step.kind === 'send' || step.kind === 'remind') refs.push(['next', step.next]);
    if (step.kind === 'wait') {
      refs.push(['onEvent', step.onEvent], ['onTimeout', step.onTimeout]);
    }
    for (const [field, ref] of refs) {
      if (!ids.has(ref)) errors.push(`step '${step.id}' ${field} references unknown step '${ref}'`);
    }
  }
  if (!args.steps.some((s) => s.kind === 'end')) errors.push('journey needs at least one end step');
  // A communication must exist before any wait/remind can reference it.
  // SIMPLIFICATION: rather than walking every path for "a send occurs before
  // the first wait", we pragmatically require the entry step itself to be a
  // 'send' — every practical journey starts by sending something.
  if (entry && entry.kind !== 'send') {
    errors.push(`entry step '${entry.id}' must be of kind 'send' (is '${entry.kind}')`);
  }
  if (errors.length > 0) throw invalid('journey step graph validation failed', errors);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createJourneyService(ctx: PlatformContext): JourneyService {
  const journeys = ctx.store.collection<Journey>('journeys');
  const instances = ctx.store.collection<JourneyInstance>('journeyInstances');

  function stepOf(journey: Journey, stepId: string): JourneyStep {
    const step = journey.steps.find((s) => s.id === stepId);
    if (!step) throw invalid(`journey ${journey.id} has no step '${stepId}'`);
    return step;
  }

  async function emitAdvanced(
    instance: JourneyInstance,
    fromStepId: string,
    toStepId: string,
    reason: string,
  ): Promise<void> {
    await ctx.publish({
      type: 'com.acorn.journey.advanced',
      tenantId: instance.tenantId,
      source: SOURCE,
      subject: instance.id,
      data: {
        instanceId: instance.id,
        journeyId: instance.journeyId,
        customerId: instance.customerId,
        fromStepId,
        toStepId,
        reason,
      },
    });
  }

  /** One transition: move to `toStepId`, record history, emit advanced, persist. */
  async function advance(
    instance: JourneyInstance,
    toStepId: string,
    note: string,
    reason: string,
  ): Promise<void> {
    const fromStepId = instance.currentStepId;
    instance.currentStepId = toStepId;
    instance.history.push({ at: new Date().toISOString(), stepId: toStepId, note });
    instances.put(instance);
    await emitAdvanced(instance, fromStepId, toStepId, reason);
  }

  function fail(instance: JourneyInstance, note: string): void {
    instance.status = 'failed';
    instance.endedAt = new Date().toISOString();
    delete instance.deadlineAt;
    instance.history.push({ at: instance.endedAt, stepId: instance.currentStepId, note });
    instances.put(instance);
  }

  /**
   * Execute the instance's current step in a loop until it parks on a `wait`
   * or terminates. Never throws: callers include bus handlers and tick().
   */
  async function runSteps(instance: JourneyInstance): Promise<void> {
    try {
      const journey = journeys.getFor(instance.tenantId, instance.journeyId);
      if (!journey) {
        fail(instance, `journey ${instance.journeyId} not found`);
        return;
      }
      while (instance.status === 'running') {
        const step = stepOf(journey, instance.currentStepId);
        switch (step.kind) {
          case 'send': {
            const com = await ctx.services.composition.compose({
              tenantId: instance.tenantId,
              templateId: step.templateId,
              customerId: instance.customerId,
              data: instance.data,
              ...(step.channels !== undefined ? { requestedChannels: step.channels } : {}),
              journeyRef: instance.id,
            });
            await ctx.services.delivery.deliver({
              tenantId: instance.tenantId,
              communicationId: com.id,
              ...(step.channels !== undefined ? { channels: step.channels } : {}),
            });
            instance.communicationId = com.id;
            await advance(instance, step.next, `sent ${com.id}`, 'sent');
            break;
          }
          case 'wait': {
            // Park: resumed by a matching lifecycle signal (bus subscription
            // below) or by tick() once the deadline passes.
            instance.deadlineAt = new Date(Date.now() + step.timeoutMs).toISOString();
            instances.put(instance);
            return;
          }
          case 'remind': {
            if (!instance.communicationId) {
              fail(instance, 'remind step has no communication to re-deliver');
              return;
            }
            await ctx.services.delivery.deliver({
              tenantId: instance.tenantId,
              communicationId: instance.communicationId,
              ...(step.channels !== undefined ? { channels: step.channels } : {}),
            });
            await advance(instance, step.next, 'reminder sent', 'reminded');
            break;
          }
          case 'end': {
            instance.status = step.result === 'completed' ? 'completed' : 'abandoned';
            instance.endedAt = new Date().toISOString();
            instance.history.push({
              at: instance.endedAt,
              stepId: step.id,
              note: `ended ${instance.status}`,
            });
            instances.put(instance);
            await ctx.publish({
              type: 'com.acorn.journey.completed',
              tenantId: instance.tenantId,
              source: SOURCE,
              subject: instance.id,
              data: {
                instanceId: instance.id,
                journeyId: instance.journeyId,
                customerId: instance.customerId,
                result: step.result,
              },
            });
            return;
          }
        }
      }
    } catch (err) {
      fail(instance, `step failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bus subscriptions: lifecycle signals resume instances parked on a wait
  // whose `until` matches the signal AND whose communication is the event's
  // subject. Handlers must never throw (the bus isolates failures anyway).
  for (const [eventType, until] of Object.entries(SIGNAL_EVENTS)) {
    ctx.bus.on(eventType, async (event: PlatformEvent) => {
      try {
        const communicationId =
          event.subject ?? (event.data as { communicationId?: string } | undefined)?.communicationId;
        if (!communicationId) return;
        const parked = instances.list(
          event.tenantid,
          (i) => i.status === 'running' && i.communicationId === communicationId,
        );
        for (const instance of parked) {
          const journey = journeys.getFor(instance.tenantId, instance.journeyId);
          if (!journey) continue;
          const step = journey.steps.find((s) => s.id === instance.currentStepId);
          // Exact matching only (see SIGNAL_EVENTS note above).
          if (!step || step.kind !== 'wait' || step.until !== until) continue;
          delete instance.deadlineAt;
          await advance(instance, step.onEvent, `signal ${until}`, `signal ${until}`);
          await runSteps(instance);
        }
      } catch (err) {
        // never propagate out of a bus handler
        // eslint-disable-next-line no-console
        console.error(`[journeys] signal handler failed for ${eventType}:`, err);
      }
    });
  }

  const service: JourneyService = {
    createJourney(rctx, args) {
      validateGraph(args);
      if (journeys.list(rctx.tenantId, (j) => j.key === args.key).length > 0) {
        throw conflict(`journey with key '${args.key}' already exists`);
      }
      const journey: Journey = {
        id: newId('jny'),
        tenantId: rctx.tenantId,
        key: args.key,
        name: args.name,
        entryStepId: args.entryStepId,
        steps: args.steps,
        active: true,
        createdAt: new Date().toISOString(),
      };
      journeys.put(journey);
      return journey;
    },

    listJourneys(rctx) {
      return journeys.list(rctx.tenantId);
    },

    getJourney(rctx, journeyId) {
      const journey = journeys.getFor(rctx.tenantId, journeyId);
      if (!journey) throw notFound('journey', journeyId);
      return journey;
    },

    async start({ tenantId, journeyId, customerId, data }) {
      const journey = journeys.getFor(tenantId, journeyId);
      if (!journey) throw notFound('journey', journeyId);
      if (!journey.active) throw invalid(`journey ${journeyId} is not active`);
      const now = new Date().toISOString();
      const instance: JourneyInstance = {
        id: newId('jni'),
        tenantId,
        journeyId,
        customerId,
        status: 'running',
        currentStepId: journey.entryStepId,
        data,
        history: [{ at: now, stepId: journey.entryStepId, note: 'started' }],
        startedAt: now,
      };
      instances.put(instance);
      await ctx.publish({
        type: 'com.acorn.journey.started',
        tenantId,
        source: SOURCE,
        subject: instance.id,
        data: { instanceId: instance.id, journeyId, customerId },
      });
      await runSteps(instance);
      return instance;
    },

    getInstance(tenantId, id) {
      return instances.getFor(tenantId, id);
    },

    listInstances(tenantId, filter) {
      return instances.list(tenantId, (instance) => {
        if (filter?.journeyId && instance.journeyId !== filter.journeyId) return false;
        if (filter?.customerId && instance.customerId !== filter.customerId) return false;
        if (filter?.status && instance.status !== filter.status) return false;
        return true;
      });
    },

    async tick(now = Date.now()) {
      const due = instances.listAll(
        (i) =>
          i.status === 'running' && i.deadlineAt !== undefined && Date.parse(i.deadlineAt) <= now,
      );
      let advanced = 0;
      for (const instance of due) {
        const journey = journeys.getFor(instance.tenantId, instance.journeyId);
        if (!journey) continue;
        const step = journey.steps.find((s) => s.id === instance.currentStepId);
        if (!step || step.kind !== 'wait') {
          // stale deadline on a non-wait step: clear it and move on
          delete instance.deadlineAt;
          instances.put(instance);
          continue;
        }
        delete instance.deadlineAt;
        await advance(instance, step.onTimeout, 'timeout', 'timeout');
        await runSteps(instance);
        advanced++;
      }
      return advanced;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const CREATE_ROLES = ['business-author', 'designer', 'tenant-admin'] as const;
const OPERATE_ROLES = ['operator', 'developer', 'tenant-admin'] as const;

const createJourneySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  entryStepId: z.string().min(1),
  // Steps are a discriminated union with cross-referencing ids — the step
  // graph is validated structurally in the service (validateGraph), so the
  // HTTP schema only asserts "an array of objects" here.
  steps: z.array(z.any()).min(1),
});

const startSchema = z.object({
  customerId: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export function registerJourneyRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const svc = () => ctx.services.journeys;

  app.post('/v1/journeys', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...CREATE_ROLES]);
    const body = parseBody(createJourneySchema, req.body);
    const journey = svc().createJourney(rctx, {
      key: body.key,
      name: body.name,
      entryStepId: body.entryStepId,
      steps: body.steps as JourneyStep[],
    });
    reply.status(201).send(journey);
  });

  app.get('/v1/journeys', async (req) => {
    const rctx = requireAuth(ctx, req);
    return svc().listJourneys(rctx);
  });

  app.get('/v1/journeys/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return svc().getJourney(rctx, id);
  });

  app.post('/v1/journeys/:id/start', async (req, reply) => {
    const rctx = requireAuth(ctx, req, [...OPERATE_ROLES]);
    const { id } = req.params as { id: string };
    const body = parseBody(startSchema, req.body);
    const instance = await svc().start({
      tenantId: rctx.tenantId,
      journeyId: id,
      customerId: body.customerId,
      data: body.data,
    });
    reply.status(201).send(instance);
  });

  app.get('/v1/journey-instances', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { journeyId, customerId, status } = req.query as {
      journeyId?: string;
      customerId?: string;
      status?: JourneyInstance['status'];
    };
    return svc().listInstances(rctx.tenantId, {
      ...(journeyId ? { journeyId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(status ? { status } : {}),
    });
  });

  app.get('/v1/journey-instances/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const instance = svc().getInstance(rctx.tenantId, id);
    if (!instance) throw notFound('journey instance', id);
    return instance;
  });

  // Manual wait-deadline sweep for ops/testing; production runs this on a timer.
  app.post('/v1/journeys/tick', async (req) => {
    requireAuth(ctx, req, [...OPERATE_ROLES]);
    const advanced = await svc().tick();
    return { advanced };
  });
}
