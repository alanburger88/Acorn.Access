import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type { AiInvocation } from '../src/kernel/contracts.js';
import { createAiGateway } from '../src/domains/ai/index.js';
import { redactPii } from '../src/domains/ai/redact.js';

const TENANT = 'ten_ai_test';

const passages = [
  {
    id: 'sec-payments',
    title: 'Payment Options',
    text: 'You can pay your balance online at any time. Autopay is available for monthly statements.',
  },
  {
    id: 'sec-fees',
    title: 'Fees',
    text: 'A late fee applies after the due date has passed.',
  },
];

describe('ai gateway (grounded provider)', () => {
  let ctx: PlatformContext;

  beforeAll(() => {
    // Do NOT set anthropicApiKey — the deterministic grounded provider serves.
    ctx = createBaseContext(
      configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')), anthropicApiKey: undefined }),
    );
    ctx.services.ai = createAiGateway(ctx);
  });

  it('answers a question overlapping a passage with citations and confidence, persisting the invocation', async () => {
    const answer = await ctx.services.ai.answer({
      tenantId: TENANT,
      question: 'How do I pay my balance online?',
      passages,
      subject: 'com_ai_test',
    });

    expect(answer.escalated).toBe(false);
    expect(answer.confidence).toBeGreaterThanOrEqual(0.34);
    expect(answer.citations.map((c) => c.sectionId)).toContain('sec-payments');
    expect(answer.answer).toContain('According to the section "Payment Options"');

    const rows = ctx.store.collection<AiInvocation>('aiInvocations').list(TENANT);
    expect(rows.length).toBe(1);
    const invocation = rows[0]!;
    expect(invocation.id).toBe(answer.invocationId);
    expect(invocation.task).toBe('assistant-answer');
    expect(invocation.model).toBe('grounded-retrieval/1');
    expect(invocation.grounded).toBe(true);
    expect(invocation.escalated).toBe(false);
    expect(invocation.citations).toContain('sec-payments');
    expect(invocation.subject).toBe('com_ai_test');
    expect(invocation.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('escalates a gibberish question with the fixed routing message and no citations', async () => {
    const answer = await ctx.services.ai.answer({
      tenantId: TENANT,
      question: 'zorbulax quixotron flembar?',
      passages,
    });

    expect(answer.escalated).toBe(true);
    expect(answer.citations).toEqual([]);
    expect(answer.confidence).toBeLessThan(0.34);
    expect(answer.answer).toContain("I don't want to guess about this");
    expect(answer.answer).toContain('routing you to a human specialist');

    const rows = ctx.store.collection<AiInvocation>('aiInvocations').list(TENANT);
    const escalatedRow = rows.find((r) => r.id === answer.invocationId);
    expect(escalatedRow?.escalated).toBe(true);
  });

  it('redactPii masks email addresses and SSN patterns', () => {
    expect(redactPii('reach me at bob@x.com ssn 123-45-6789')).toBe(
      'reach me at [redacted] ssn [redacted]',
    );
  });
});
