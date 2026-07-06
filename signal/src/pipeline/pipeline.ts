import { hashCanonical } from '../crypto/hash.js';
import { normalize, NORMALIZE_VERSION, type NormalizeContext, type RawCommunication } from '../ingest/normalize.js';
import type { Classifier } from './classify.js';
import { deriveObligations, OBLIGATIONS_VERSION } from './obligations.js';
import { determineOutcome, OUTCOME_VERSION } from './outcome.js';
import {
  OUTCOME_PACKET_SCHEMA,
  type OutcomePacketPayload,
  type StageProvenance,
} from '../types.js';

export const PIPELINE_VERSION = 'acorn.signal-pipeline@1.0.0';

export interface PipelineContext extends NormalizeContext {
  newPacketId: () => string;
}

/**
 * Run a raw communication through normalize → classify → obligations →
 * outcome and assemble the unsigned packet payload. Every stage records the
 * hash of its input and output, so the packet is not just a conclusion but a
 * replayable trace of how the conclusion was reached.
 */
export function runPipeline(
  raw: RawCommunication,
  classifier: Classifier,
  ctx: PipelineContext,
): OutcomePacketPayload {
  const stages: StageProvenance[] = [];

  const rawHash = hashCanonical(raw as unknown as Record<string, unknown>);
  const comm = normalize(raw, ctx);
  stages.push({
    stage: 'normalize',
    version: NORMALIZE_VERSION,
    inputHash: rawHash,
    outputHash: hashCanonical(comm),
  });

  const commHash = hashCanonical(comm);
  const classification = classifier.classify(comm);
  stages.push({
    stage: 'classify',
    version: classifier.version,
    inputHash: commHash,
    outputHash: hashCanonical(classification),
  });

  const obligations = deriveObligations(comm, classification);
  stages.push({
    stage: 'obligations',
    version: OBLIGATIONS_VERSION,
    inputHash: hashCanonical({ comm: commHash, classification }),
    outputHash: hashCanonical(obligations),
  });

  const createdAt = ctx.now();
  const outcome = determineOutcome(comm, classification, obligations, createdAt, PIPELINE_VERSION);
  stages.push({
    stage: 'outcome',
    version: OUTCOME_VERSION,
    inputHash: hashCanonical({ comm: commHash, classification, obligations }),
    outputHash: hashCanonical(outcome),
  });

  return {
    schema: OUTCOME_PACKET_SCHEMA,
    id: ctx.newPacketId(),
    tenantId: raw.tenantId,
    createdAt,
    communication: comm,
    classification,
    obligations,
    outcome,
    provenance: {
      pipelineVersion: PIPELINE_VERSION,
      stages,
    },
  };
}
