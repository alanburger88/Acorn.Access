import type { Classification, CommunicationRecord, RegulatedCategory } from '../types.js';

export const CLASSIFY_VERSION = 'rule-classifier@1.0.0';

/**
 * Pluggable classification interface. The v1 default is a deterministic rule
 * classifier; model-backed classifiers implement the same contract and must
 * report what decided the classification via `decidedBy` (e.g. a model id),
 * so packet provenance stays honest about how the category was chosen.
 */
export interface Classifier {
  readonly version: string;
  classify(comm: CommunicationRecord): Classification;
}

interface Rule {
  id: string;
  category: RegulatedCategory;
  /** Rules earlier in priority win when several match. */
  priority: number;
  pattern: RegExp;
  regulatedDomains: string[];
}

/**
 * Ordered rule set. Patterns run against subject + body, case-insensitive.
 * Priorities encode regulatory severity: a message that both complains and
 * cancels is treated as a complaint first, because complaint clocks are the
 * strictest in most regimes.
 */
const RULES: Rule[] = [
  {
    id: 'rule.fraud.v1',
    category: 'fraud_report',
    priority: 10,
    pattern:
      /\b(fraud(ulent)?|unauthori[sz]ed (transaction|charge|payment|access)|identity theft|scam(med)?|stolen (card|account|identity))\b/i,
    regulatedDomains: ['financial_crime', 'consumer_protection'],
  },
  {
    id: 'rule.dsr.v1',
    category: 'data_subject_request',
    priority: 20,
    pattern:
      /\b(subject access request|right to (erasure|access|rectification|portability)|delete (all )?my (data|information|account data)|gdpr|ccpa|data protection request)\b/i,
    regulatedDomains: ['data_protection'],
  },
  {
    id: 'rule.complaint.v1',
    category: 'complaint',
    priority: 30,
    pattern:
      /\b(complain(t|ing)?|formal grievance|ombudsman|unacceptable service|escalate this|extremely (dissatisfied|unhappy)|misled|mis-?sold)\b/i,
    regulatedDomains: ['consumer_protection', 'conduct'],
  },
  {
    id: 'rule.hardship.v1',
    category: 'hardship',
    priority: 40,
    pattern:
      /\b(financial (hardship|difficulty|difficulties)|can(no|')t afford|struggling to pay|payment (plan|holiday|arrangement)|lost my job|hardship assistance)\b/i,
    regulatedDomains: ['responsible_lending', 'vulnerable_customers'],
  },
  {
    id: 'rule.billing.v1',
    category: 'billing_dispute',
    priority: 50,
    pattern:
      /\b(dispute (this|the|a) (charge|bill|invoice|fee)|overcharged|billing error|incorrect (charge|bill|invoice|amount)|double[- ]charged|refund request)\b/i,
    regulatedDomains: ['consumer_protection'],
  },
  {
    id: 'rule.cancellation.v1',
    category: 'cancellation',
    priority: 60,
    pattern:
      /\b(cancel (my|the|this) (account|subscription|policy|service|contract|order)|terminate (my|the) (contract|agreement|service)|close my account)\b/i,
    regulatedDomains: ['consumer_protection'],
  },
  {
    id: 'rule.consent.v1',
    category: 'consent_change',
    priority: 70,
    pattern:
      /\b(withdraw (my )?consent|opt[- ]?(out|in)|unsubscribe|stop (contacting|emailing|calling|texting) me|marketing preferences?|do not (call|contact))\b/i,
    regulatedDomains: ['data_protection', 'marketing'],
  },
  {
    id: 'rule.disclosure.v1',
    category: 'disclosure',
    priority: 80,
    pattern:
      /\b(terms (and|&) conditions|rate (change|increase)|fee (schedule|change)|privacy (policy|notice) update|regulatory disclosure|important notice about your)\b/i,
    regulatedDomains: ['disclosure'],
  },
];

export class RuleClassifier implements Classifier {
  readonly version = CLASSIFY_VERSION;

  classify(comm: CommunicationRecord): Classification {
    const text = `${comm.subject ?? ''}\n${comm.body}`;
    const matched = RULES.filter((r) => r.pattern.test(text)).sort(
      (a, b) => a.priority - b.priority,
    );
    const winner = matched[0];
    if (!winner) {
      return {
        category: 'general',
        regulatedDomains: [],
        confidence: 1,
        decidedBy: ['rule.default.v1'],
      };
    }
    return {
      category: winner.category,
      regulatedDomains: winner.regulatedDomains,
      confidence: 1,
      decidedBy: matched.map((r) => r.id),
    };
  }
}
