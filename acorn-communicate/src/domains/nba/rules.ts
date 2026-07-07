/**
 * NBA rule table — explainable, deterministic next-best-action rules.
 * Each rule inspects the gathered facts and either fires with an action and
 * a human-readable reason (the explainability requirement) or stays silent.
 */
import type {
  AccessEvent,
  ActionTransaction,
  Communication,
  DeliveryAttempt,
  PreferenceRecord,
  Recommendation,
} from '../../kernel/contracts.js';

export interface NbaFacts {
  communication: Communication;
  accessEvents: AccessEvent[];
  actions: ActionTransaction[];
  deliveries: DeliveryAttempt[];
  preferences?: PreferenceRecord;
}

export interface NbaRule {
  ruleId: string;
  evaluate(facts: NbaFacts): { action: Recommendation['action']; reason: string } | null;
}

function parseCurrency(value: string): number {
  const n = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const rules: NbaRule[] = [
  {
    ruleId: 'pay-balance-due',
    evaluate({ communication }) {
      if (communication.composed.intendedOutcome !== 'payment_completed') return null;
      if (communication.outcome?.achieved) return null;
      for (const section of communication.composed.sections) {
        for (const line of section.lines) {
          if (line.kind === 'field-row' && /due|amount/i.test(line.label)) {
            if (parseCurrency(line.value) > 0) {
              return {
                action: 'pay',
                reason: `Your ${line.label} of ${line.value} is unpaid — you can pay securely inside this document.`,
              };
            }
          }
        }
      }
      return null;
    },
  },
  {
    ruleId: 'view-nudge',
    evaluate({ communication, accessEvents }) {
      if (communication.status === 'delivered' && accessEvents.length === 0) {
        return {
          action: 'view-document',
          reason: 'The document was delivered but has not been opened yet.',
        };
      }
      return null;
    },
  },
  {
    ruleId: 'go-paperless',
    evaluate({ preferences }) {
      if (preferences && preferences.paperless === false) {
        return {
          action: 'go-paperless',
          reason:
            'You currently receive paper communications — going paperless delivers documents faster and more securely.',
        };
      }
      return null;
    },
  },
  {
    ruleId: 'dispute-followup',
    evaluate({ actions }) {
      if (actions.some((a) => a.action === 'dispute')) {
        return {
          action: 'contact',
          reason: 'You raised a dispute — a follow-up conversation can resolve it faster.',
        };
      }
      return null;
    },
  },
  {
    ruleId: 'update-details-bounce',
    evaluate({ deliveries }) {
      if (deliveries.some((d) => d.status === 'bounced')) {
        return {
          action: 'update-details',
          reason:
            'A recent delivery bounced — updating contact details prevents missed communications.',
        };
      }
      return null;
    },
  },
];
