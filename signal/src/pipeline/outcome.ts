import type {
  Classification,
  CommunicationRecord,
  Obligation,
  Outcome,
  OutcomeStatus,
} from '../types.js';

export const OUTCOME_VERSION = 'outcome-rules@1.0.0';

/**
 * Determine the initial outcome for a communication. The pipeline never
 * claims resolution it cannot prove: inbound regulated communications open
 * as `action_required` (or `escalated` where an escalate obligation exists),
 * and only an explicit completion via the outcomes API moves them to
 * `resolved`. Outbound communications and general inbound mail are
 * acknowledged as recorded.
 */
export function determineOutcome(
  comm: CommunicationRecord,
  classification: Classification,
  obligations: Obligation[],
  determinedAt: string,
  pipelineVersion: string,
): Outcome {
  let status: OutcomeStatus;
  if (comm.direction === 'outbound' || classification.category === 'general') {
    status = 'acknowledged';
  } else if (obligations.some((o) => o.type === 'escalate')) {
    status = 'escalated';
  } else {
    status = 'action_required';
  }

  return {
    status,
    summary: summarize(comm, classification, status),
    actions: obligations.map((o) => ({
      action: `${o.type}:${o.id}`,
      obligationId: o.id,
      status: 'pending',
    })),
    determinedBy: `pipeline:${pipelineVersion}`,
    determinedAt,
  };
}

function summarize(
  comm: CommunicationRecord,
  classification: Classification,
  status: OutcomeStatus,
): string {
  const who = comm.parties.find((p) => p.role === 'customer')?.id ?? 'unknown customer';
  return (
    `${comm.direction} ${comm.channel} from party ${who} classified as ` +
    `${classification.category}; initial outcome: ${status}`
  );
}
