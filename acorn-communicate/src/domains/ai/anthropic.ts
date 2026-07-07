/**
 * Optional Anthropic LLM provider for the AI GATEWAY.
 *
 * Used only when ctx.config.anthropicApiKey is set. The model may only cite
 * the numbered passages supplied in the prompt; questions are PII-redacted
 * before leaving the platform. ANY failure (network, non-200, parse) falls
 * back to the deterministic grounded provider — this function never throws
 * into the viewer path.
 */
import type { PlatformContext } from '../../kernel/context.js';
import { GROUNDED_MODEL, ROUTING_MESSAGE, groundedAnswer, type Passage, type ProviderAnswer } from './grounded.js';
import { redactPii } from './redact.js';

const SYSTEM_PROMPT =
  'You answer questions about a customer document. Use ONLY the numbered passages provided. ' +
  'Cite passages like [1]. If the passages do not contain the answer, reply exactly UNANSWERABLE.';

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

export async function anthropicAnswer(
  ctx: PlatformContext,
  args: { question: string; passages: Passage[] },
): Promise<ProviderAnswer> {
  const { question, passages } = args;
  try {
    const numbered = passages
      .map((p, i) => `[${i + 1}] ${p.title}\n${p.text}`)
      .join('\n\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ctx.config.anthropicApiKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ctx.config.anthropicModel,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Passages:\n${numbered}\n\nQuestion: ${redactPii(question)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}`);
    const data = (await res.json()) as AnthropicResponse;
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    if (!text) throw new Error('anthropic returned empty content');

    if (text === 'UNANSWERABLE' || text.startsWith('UNANSWERABLE')) {
      return {
        answer: ROUTING_MESSAGE,
        confidence: 0,
        citations: [],
        escalated: true,
        model: ctx.config.anthropicModel,
      };
    }

    const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
      .map((n) => passages[n - 1])
      .filter((p): p is Passage => p !== undefined)
      .map((p) => ({ sectionId: p.id, title: p.title }));

    return {
      answer: text,
      confidence: cited.length > 0 ? 0.9 : 0.3,
      citations: cited,
      escalated: false,
      model: ctx.config.anthropicModel,
    };
  } catch {
    // Never surface provider failures to the viewer — fall back to the
    // deterministic grounded provider.
    const fallback = groundedAnswer(question, passages);
    return { ...fallback, model: GROUNDED_MODEL };
  }
}
