/**
 * AI GATEWAY bounded context.
 *
 * Single choke point for every model call in the platform: routes to the
 * Anthropic provider when an API key is configured, otherwise to the
 * deterministic grounded-retrieval provider. EVERY call — whichever provider
 * served it — is persisted as an AiInvocation (auditability / proof-of-AI
 * chain of custody) and announced via com.acorn.ai.invoked.
 */
import { createHash } from 'node:crypto';
import type { AiGateway, AiInvocation } from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { newId } from '../../kernel/ids.js';
import { anthropicAnswer } from './anthropic.js';
import { GROUNDED_MODEL, groundedAnswer, groundedDraft, type ProviderAnswer } from './grounded.js';

const SOURCE = '/domains/ai';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function createAiGateway(ctx: PlatformContext): AiGateway {
  const invocations = ctx.store.collection<AiInvocation>('aiInvocations');

  function record(args: {
    tenantId: string;
    task: AiInvocation['task'];
    model: string;
    confidence: number;
    citations: string[];
    inputHash: string;
    output: string;
    latencyMs: number;
    subject?: string;
    escalated: boolean;
  }): AiInvocation {
    const invocation: AiInvocation = {
      id: newId('aii'),
      tenantId: args.tenantId,
      task: args.task,
      model: args.model,
      grounded: true,
      confidence: args.confidence,
      citations: args.citations,
      inputHash: args.inputHash,
      outputPreview: args.output.slice(0, 140),
      latencyMs: args.latencyMs,
      at: new Date().toISOString(),
      subject: args.subject,
      escalated: args.escalated,
    };
    invocations.put(invocation);
    void ctx.publish({
      type: 'com.acorn.ai.invoked',
      tenantId: args.tenantId,
      source: SOURCE,
      subject: invocation.subject,
      data: {
        invocationId: invocation.id,
        task: invocation.task,
        model: invocation.model,
        confidence: invocation.confidence,
        escalated: invocation.escalated,
      },
    });
    return invocation;
  }

  return {
    async answer({ tenantId, question, passages, subject }) {
      const started = Date.now();
      let result: ProviderAnswer;
      if (ctx.config.anthropicApiKey) {
        result = await anthropicAnswer(ctx, { question, passages });
      } else {
        result = groundedAnswer(question, passages);
      }
      const latencyMs = Date.now() - started;
      const invocation = record({
        tenantId,
        task: 'assistant-answer',
        model: result.model,
        confidence: result.confidence,
        citations: result.citations.map((c) => c.sectionId),
        inputHash: sha256(question + passages.map((p) => p.id).join(',')),
        output: result.answer,
        latencyMs,
        subject,
        escalated: result.escalated,
      });
      return {
        answer: result.answer,
        confidence: result.confidence,
        citations: result.citations,
        escalated: result.escalated,
        invocationId: invocation.id,
      };
    },

    async draft({ tenantId, instruction, baseText, subject }) {
      const started = Date.now();
      const text = groundedDraft(instruction, baseText);
      const latencyMs = Date.now() - started;
      const invocation = record({
        tenantId,
        task: 'draft-content',
        model: GROUNDED_MODEL,
        confidence: 1,
        citations: [],
        inputHash: sha256(instruction + (baseText ?? '')),
        output: text,
        latencyMs,
        subject,
        escalated: false,
      });
      return { text, invocationId: invocation.id };
    },
  };
}
