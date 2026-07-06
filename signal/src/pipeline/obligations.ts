import type {
  Classification,
  CommunicationRecord,
  Obligation,
  ObligationType,
} from '../types.js';

export const OBLIGATIONS_VERSION = 'obligation-rules@1.0.0';

interface ObligationRule {
  type: ObligationType;
  description: string;
  /** Days from the communication's occurredAt until the deadline; omit for no clock. */
  deadlineDays?: number;
  source: string;
}

/**
 * Regulatory-clock defaults per category. Deliberately conservative: tenants
 * override per jurisdiction via configuration in later versions; v1 ships one
 * defensible default set so every packet carries explicit obligations.
 */
const CATEGORY_OBLIGATIONS: Record<string, ObligationRule[]> = {
  complaint: [
    {
      type: 'acknowledge',
      description: 'Acknowledge receipt of the complaint to the customer',
      deadlineDays: 3,
      source: 'obl.complaint.ack.v1',
    },
    {
      type: 'resolve',
      description: 'Issue a final response to the complaint',
      deadlineDays: 30,
      source: 'obl.complaint.final.v1',
    },
  ],
  billing_dispute: [
    {
      type: 'acknowledge',
      description: 'Acknowledge the billing dispute',
      deadlineDays: 5,
      source: 'obl.billing.ack.v1',
    },
    {
      type: 'resolve',
      description: 'Investigate and resolve the disputed charge',
      deadlineDays: 30,
      source: 'obl.billing.resolve.v1',
    },
  ],
  consent_change: [
    {
      type: 'record_consent',
      description: 'Record the consent change and apply it across processing systems',
      deadlineDays: 2,
      source: 'obl.consent.record.v1',
    },
  ],
  cancellation: [
    {
      type: 'acknowledge',
      description: 'Confirm receipt of the cancellation request',
      deadlineDays: 3,
      source: 'obl.cancel.ack.v1',
    },
    {
      type: 'resolve',
      description: 'Process the cancellation and confirm the effective date',
      deadlineDays: 14,
      source: 'obl.cancel.process.v1',
    },
  ],
  data_subject_request: [
    {
      type: 'acknowledge',
      description: 'Acknowledge the data subject request',
      deadlineDays: 3,
      source: 'obl.dsr.ack.v1',
    },
    {
      type: 'fulfil_dsr',
      description: 'Fulfil the data subject request',
      deadlineDays: 30,
      source: 'obl.dsr.fulfil.v1',
    },
  ],
  hardship: [
    {
      type: 'respond',
      description: 'Respond with available hardship assistance options',
      deadlineDays: 5,
      source: 'obl.hardship.respond.v1',
    },
    {
      type: 'escalate',
      description: 'Route to the vulnerable-customer team for assessment',
      deadlineDays: 2,
      source: 'obl.hardship.escalate.v1',
    },
  ],
  fraud_report: [
    {
      type: 'escalate',
      description: 'Escalate to the fraud investigation team',
      deadlineDays: 1,
      source: 'obl.fraud.escalate.v1',
    },
    {
      type: 'respond',
      description: 'Inform the customer of interim protective measures',
      deadlineDays: 2,
      source: 'obl.fraud.respond.v1',
    },
  ],
  disclosure: [
    {
      type: 'respond',
      description: 'Deliver the disclosure and retain proof of delivery',
      source: 'obl.disclosure.deliver.v1',
    },
  ],
  general: [],
};

/** Derive obligations for a classified communication. Pure and deterministic. */
export function deriveObligations(
  comm: CommunicationRecord,
  classification: Classification,
): Obligation[] {
  const rules = CATEGORY_OBLIGATIONS[classification.category] ?? [];
  const baseMs = Date.parse(comm.occurredAt);
  return rules.map((rule, index) => ({
    id: `${comm.id}-obl-${index}`,
    type: rule.type,
    description: rule.description,
    ...(rule.deadlineDays !== undefined
      ? { deadline: new Date(baseMs + rule.deadlineDays * 86_400_000).toISOString() }
      : {}),
    source: rule.source,
  }));
}
