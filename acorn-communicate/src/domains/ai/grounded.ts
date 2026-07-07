/**
 * Deterministic grounded-retrieval provider for the AI GATEWAY.
 *
 * Answers are extracted verbatim from the supplied passages — this provider
 * never generates facts, so it can never hallucinate. Low-confidence
 * questions are escalated to a human with a fixed routing message.
 */

export interface Passage {
  id: string;
  title: string;
  text: string;
}

export interface ProviderAnswer {
  answer: string;
  confidence: number;
  citations: { sectionId: string; title: string }[];
  escalated: boolean;
  /** model identifier recorded on the AiInvocation row */
  model: string;
}

export const GROUNDED_MODEL = 'grounded-retrieval/1';

export const ROUTING_MESSAGE =
  "I don't want to guess about this. I couldn't find a confident answer in your document's approved information, " +
  "so I'm routing you to a human specialist — please use the Contact action below and we'll follow up.";

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'my', 'your', 'our', 'their', 'his', 'her', 'its',
  'what', 'how', 'why', 'when', 'where', 'who', 'which',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'shall', 'may', 'might',
  'i', 'me', 'you', 'we', 'they', 'it', 'this', 'that', 'these', 'those',
  'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'not', 'no',
  'with', 'at', 'by', 'from', 'about', 'as', 'if', 'so', 'than', 'then',
  'there', 'here', 'have', 'has', 'had', 'get', 'got',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function questionTerms(question: string): string[] {
  return [...new Set(tokenize(question).filter((t) => !STOPWORDS.has(t)))];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escalate(confidence: number): ProviderAnswer {
  return {
    answer: ROUTING_MESSAGE,
    confidence,
    citations: [],
    escalated: true,
    model: GROUNDED_MODEL,
  };
}

/**
 * Answer a question grounded ONLY in the supplied passages.
 *
 * Scoring: score(passage) = |question terms found in passage text+title| /
 * |question terms|, +0.2 bonus if any term appears in the title, capped at 1.
 * Passages scoring ≥ 60% of the top score (max 3) become citations.
 * confidence = top score; below 0.34 the assistant declines to guess.
 */
export function groundedAnswer(question: string, passages: Passage[]): ProviderAnswer {
  const terms = questionTerms(question);
  if (terms.length === 0 || passages.length === 0) return escalate(0);

  const scored = passages
    .map((passage) => {
      const bodyTokens = new Set(tokenize(`${passage.text} ${passage.title}`));
      const titleTokens = new Set(tokenize(passage.title));
      const matched = terms.filter((t) => bodyTokens.has(t));
      let score = matched.length / terms.length;
      if (terms.some((t) => titleTokens.has(t))) score += 0.2;
      score = Math.min(1, score);
      return { passage, score, matched };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  if (top.score < 0.34) return escalate(top.score);

  const cited = scored.filter((s) => s.score > 0 && s.score >= top.score * 0.6).slice(0, 3);
  const citations = cited.map((s) => ({ sectionId: s.passage.id, title: s.passage.title }));

  // Answer = the top passage's sentences that contain matched terms (max 3).
  const matchedSet = new Set(top.matched);
  const sentences = splitSentences(top.passage.text);
  const relevant = sentences
    .filter((sentence) => tokenize(sentence).some((t) => matchedSet.has(t)))
    .slice(0, 3);
  const body = (relevant.length > 0 ? relevant : sentences.slice(0, 1)).join(' ');

  return {
    answer: `According to the section "${top.passage.title}": ${body}`,
    confidence: top.score,
    citations,
    escalated: false,
    model: GROUNDED_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Deterministic drafting (readability transformer)
// ---------------------------------------------------------------------------

const JARGON: [RegExp, string][] = [
  [/\bremit\b/gi, 'send'],
  [/\bdelinquent\b/gi, 'overdue'],
  [/\bprior to\b/gi, 'before'],
  [/\bin the event that\b/gi, 'if'],
  [/\butilize\b/gi, 'use'],
];

function simplifySentence(sentence: string): string {
  if (sentence.split(/\s+/).length <= 25) return sentence;
  let out = sentence.replace(/,\s*which\s+/g, '. This ');
  out = out.replace(/;\s+(\S)/g, (_m, c: string) => `. ${c.toUpperCase()}`);
  return out;
}

/**
 * Deterministic content drafting. When the instruction targets readability,
 * the base text is simplified (jargon replaced, long sentences split);
 * otherwise the base text (or a skeleton draft) is returned.
 */
export function groundedDraft(instruction: string, baseText?: string): string {
  if (instruction.toLowerCase().includes('readab') && baseText !== undefined) {
    let text = baseText;
    for (const [re, replacement] of JARGON) text = text.replace(re, replacement);
    return splitSentences(text).map(simplifySentence).join(' ');
  }
  return baseText ?? `Draft: ${instruction}`;
}
