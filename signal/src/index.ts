/**
 * Acorn.Signal — Agent-Ready Customer Communication Infrastructure.
 *
 * Public surface: the SignalService (ingest → signed Outcome Packet on a
 * per-tenant hash chain), the standalone verifier, the agent registry, and
 * the HTTP API factory.
 */

export * from './types.js';
export { canonicalize, canonicalBytes } from './canonical/jcs.js';
export { sha256Hex, hashCanonical } from './crypto/hash.js';
export {
  generateSignerKeys,
  loadSignerKeys,
  PacketSigner,
  verifySignature,
  type SignerKeys,
} from './crypto/signer.js';
export { PacketLedger, verifyPacket, type ChainAuditResult } from './ledger/ledger.js';
export { MemoryPacketStore, type PacketStore } from './ledger/store.js';
export {
  normalize,
  IngestError,
  NORMALIZE_VERSION,
  type RawCommunication,
  type NormalizeContext,
} from './ingest/normalize.js';
export { RuleClassifier, CLASSIFY_VERSION, type Classifier } from './pipeline/classify.js';
export { deriveObligations, OBLIGATIONS_VERSION } from './pipeline/obligations.js';
export { determineOutcome, OUTCOME_VERSION } from './pipeline/outcome.js';
export { runPipeline, PIPELINE_VERSION, type PipelineContext } from './pipeline/pipeline.js';
export {
  AgentRegistry,
  GrantError,
  ALL_SCOPES,
  type AgentRegistration,
  type Scope,
  type TokenClaims,
} from './agents/grants.js';
export {
  AccessDenied,
  viewPacket,
  requireScope,
  requireTenant,
  requireCategoryAccess,
  REDACTED,
  type Principal,
} from './agents/access.js';
export { SignalService, type SignalServiceOptions, type PacketSummary } from './service.js';
export { createApiServer, type ApiOptions } from './api/server.js';
