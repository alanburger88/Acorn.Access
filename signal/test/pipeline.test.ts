import { describe, expect, it } from 'vitest';
import { normalize, IngestError } from '../src/ingest/normalize.js';
import { RuleClassifier } from '../src/pipeline/classify.js';
import { runPipeline } from '../src/pipeline/pipeline.js';
import { rawComplaint, testService } from './helpers.js';
import type { PipelineContext } from '../src/pipeline/pipeline.js';

function ctx(): PipelineContext {
  let n = 0;
  return {
    newId: () => `comm_fixed${++n}`,
    newPacketId: () => 'op_fixed',
    now: () => '2026-07-06T12:00:00.000Z',
  };
}

describe('normalize', () => {
  it('normalizes whitespace and hashes the original content', () => {
    const comm = normalize(
      rawComplaint({ content: 'Line one\r\nwith\t tabs   and  spaces. I complain.' }),
      ctx(),
    );
    expect(comm.body).toBe('Line one\nwith tabs and spaces. I complain.');
    // Hash commits to the ORIGINAL content, not the normalized body.
    const again = normalize(
      rawComplaint({ content: 'Line one\r\nwith\t tabs   and  spaces. I complain.' }),
      ctx(),
    );
    expect(comm.rawContentHash).toBe(again.rawContentHash);
  });

  it('rejects invalid input', () => {
    expect(() => normalize(rawComplaint({ tenantId: '' }), ctx())).toThrow(IngestError);
    expect(() => normalize(rawComplaint({ content: '   ' }), ctx())).toThrow(IngestError);
    expect(() => normalize(rawComplaint({ parties: [] }), ctx())).toThrow(IngestError);
    expect(() =>
      normalize(rawComplaint({ channel: 'fax' as unknown as 'email' }), ctx()),
    ).toThrow(IngestError);
    expect(() => normalize(rawComplaint({ occurredAt: 'yesterday' }), ctx())).toThrow(IngestError);
  });
});

describe('RuleClassifier', () => {
  const classifier = new RuleClassifier();
  const classify = (content: string, subject?: string) =>
    classifier.classify(normalize(rawComplaint({ content, subject }), ctx()));

  it('classifies each regulated category', () => {
    expect(classify('There is an unauthorised transaction on my card').category).toBe('fraud_report');
    expect(classify('Please delete all my data under GDPR').category).toBe('data_subject_request');
    expect(classify('I want to complain about the branch').category).toBe('complaint');
    expect(classify('I am struggling to pay this month, can I get a payment plan?').category).toBe('hardship');
    expect(classify('I was double-charged on my last invoice').category).toBe('billing_dispute');
    expect(classify('Please cancel my subscription immediately').category).toBe('cancellation');
    expect(classify('I withdraw my consent for marketing').category).toBe('consent_change');
    expect(classify('Important notice about your rate change', 'Rate change').category).toBe('disclosure');
    expect(classify('Thanks for the great service!').category).toBe('general');
  });

  it('resolves multi-match by regulatory priority (fraud beats cancellation)', () => {
    const c = classify('Someone scammed me — cancel my account now please');
    expect(c.category).toBe('fraud_report');
    expect(c.decidedBy).toContain('rule.fraud.v1');
    expect(c.decidedBy).toContain('rule.cancellation.v1');
  });
});

describe('runPipeline', () => {
  it('produces a payload with full stage provenance', () => {
    const payload = runPipeline(rawComplaint(), new RuleClassifier(), ctx());
    expect(payload.schema).toBe('acorn.signal/outcome-packet@1');
    expect(payload.provenance.stages.map((s) => s.stage)).toEqual([
      'normalize',
      'classify',
      'obligations',
      'outcome',
    ]);
    for (const stage of payload.provenance.stages) {
      expect(stage.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stage.outputHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('derives complaint obligations with regulatory deadlines', () => {
    const payload = runPipeline(rawComplaint(), new RuleClassifier(), ctx());
    expect(payload.classification.category).toBe('complaint');
    expect(payload.obligations.map((o) => o.type)).toEqual(['acknowledge', 'resolve']);
    // occurredAt 2026-07-06T09:30Z + 3 days
    expect(payload.obligations[0]!.deadline).toBe('2026-07-09T09:30:00.000Z');
    expect(payload.obligations[1]!.deadline).toBe('2026-08-05T09:30:00.000Z');
  });

  it('opens inbound regulated communications as action_required with pending actions', () => {
    const payload = runPipeline(rawComplaint(), new RuleClassifier(), ctx());
    expect(payload.outcome.status).toBe('action_required');
    expect(payload.outcome.actions).toHaveLength(2);
    expect(payload.outcome.actions.every((a) => a.status === 'pending')).toBe(true);
  });

  it('escalates fraud reports', () => {
    const payload = runPipeline(
      rawComplaint({ content: 'I found a fraudulent charge', subject: 'fraud' }),
      new RuleClassifier(),
      ctx(),
    );
    expect(payload.outcome.status).toBe('escalated');
  });

  it('acknowledges outbound and general communications', () => {
    const outbound = runPipeline(
      rawComplaint({ direction: 'outbound', content: 'Important notice about your rate change' }),
      new RuleClassifier(),
      ctx(),
    );
    expect(outbound.outcome.status).toBe('acknowledged');

    const general = runPipeline(
      rawComplaint({ content: 'Just saying hello', subject: 'hi' }),
      new RuleClassifier(),
      ctx(),
    );
    expect(general.outcome.status).toBe('acknowledged');
    expect(general.obligations).toHaveLength(0);
  });

  it('is deterministic: identical input yields an identical payload', () => {
    const a = runPipeline(rawComplaint(), new RuleClassifier(), ctx());
    const b = runPipeline(rawComplaint(), new RuleClassifier(), ctx());
    expect(a).toEqual(b);
  });
});

describe('outcome amendments', () => {
  it('completing all actions appends amendment packets and resolves the outcome', async () => {
    const { service, tick } = testService();
    const packet = await service.ingest(rawComplaint());
    expect(packet.payload.outcome.status).toBe('action_required');

    const { principalFor } = await import('./helpers.js');
    const operator = principalFor(service, {
      kind: 'human',
      scopes: ['packets:read', 'outcomes:act'],
    });

    tick();
    const afterFirst = await service.completeAction(operator, 'tenant-a', packet.payload.id, 0);
    expect(afterFirst.payload.amends).toBe(packet.payload.id);
    expect(afterFirst.payload.outcome.status).toBe('action_required');
    expect(afterFirst.payload.outcome.actions[0]!.status).toBe('done');
    expect(afterFirst.payload.outcome.actions[0]!.completedBy).toBe(`human:${operator.agent.id}`);

    tick();
    // Amendments resolve by the ORIGINAL packet id — callers keep one handle.
    const afterSecond = await service.completeAction(operator, 'tenant-a', packet.payload.id, 1);
    expect(afterSecond.payload.outcome.status).toBe('resolved');

    // The whole history (original + 2 amendments) is on-chain and valid.
    const auditor = principalFor(service, { id: 'auditor', scopes: ['packets:verify'] });
    const audit = await service.auditChain(auditor, 'tenant-a');
    expect(audit).toEqual({ valid: true, packetCount: 3, brokenAt: [] });

    // latest() follows the amendment trail from the original id.
    const latest = await service.ledger.latest('tenant-a', packet.payload.id);
    expect(latest!.payload.id).toBe(afterSecond.payload.id);
  });

  it('rejects double completion of an action', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());
    const { principalFor } = await import('./helpers.js');
    const operator = principalFor(service, { kind: 'human', scopes: ['outcomes:act'] });
    await service.completeAction(operator, 'tenant-a', packet.payload.id, 0);
    await expect(
      service.completeAction(operator, 'tenant-a', packet.payload.id, 0),
    ).rejects.toThrow(/already done/);
  });
});
