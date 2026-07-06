/**
 * Core domain types for Acorn.Signal.
 *
 * The vocabulary is deliberately small and stable: a raw communication enters
 * through a channel adapter as a `CommunicationRecord`, flows through the
 * deterministic pipeline, and leaves as a signed, hash-chained `OutcomePacket`.
 */

export type Channel = 'email' | 'sms' | 'chat' | 'voice' | 'letter' | 'portal';

export type Direction = 'inbound' | 'outbound';

export interface Party {
  /** Stable party identifier within the tenant (e.g. CRM id). */
  id: string;
  role: 'customer' | 'institution' | 'agent' | 'third_party';
  /** Display name; treated as PII for redaction purposes. */
  name?: string;
  /** Channel address (email address, phone number, postal address); PII. */
  address?: string;
}

/** A normalized customer communication, produced by a channel adapter. */
export interface CommunicationRecord {
  id: string;
  tenantId: string;
  channel: Channel;
  direction: Direction;
  /** RFC 3339 timestamp the communication occurred / was received. */
  occurredAt: string;
  parties: Party[];
  subject?: string;
  /** Plain-text body after channel-specific extraction (transcript, OCR text, …). */
  body: string;
  /** SHA-256 of the original raw payload, hex encoded. */
  rawContentHash: string;
  /** Opaque reference to the raw payload in the tenant's content store. */
  rawContentRef?: string;
  /** Channel-specific metadata retained for audit (headers, call ids, …). */
  metadata: Record<string, string>;
}

/** Regulated-communication categories recognized by the v1 rule classifier. */
export type RegulatedCategory =
  | 'complaint'
  | 'billing_dispute'
  | 'consent_change'
  | 'cancellation'
  | 'data_subject_request'
  | 'hardship'
  | 'fraud_report'
  | 'disclosure'
  | 'general';

export interface Classification {
  category: RegulatedCategory;
  /** Regulatory domain(s) the category maps to for the tenant's jurisdiction. */
  regulatedDomains: string[];
  /** 0..1 confidence. Rule classifier emits 1 for exact rule hits. */
  confidence: number;
  /** Identifiers of the rules (or model version) that produced the decision. */
  decidedBy: string[];
}

export type ObligationType =
  | 'acknowledge'
  | 'respond'
  | 'resolve'
  | 'escalate'
  | 'record_consent'
  | 'fulfil_dsr'
  | 'notify_regulator';

export interface Obligation {
  id: string;
  type: ObligationType;
  description: string;
  /** RFC 3339 deadline derived from the category's regulatory clock, if any. */
  deadline?: string;
  /** Rule identifier that generated the obligation. */
  source: string;
}

export type OutcomeStatus =
  | 'acknowledged'
  | 'action_required'
  | 'resolved'
  | 'escalated'
  | 'rejected';

export interface OutcomeAction {
  /** What must (or did) happen, e.g. "send_acknowledgement". */
  action: string;
  /** Obligation this action satisfies, if any. */
  obligationId?: string;
  /** 'pending' until an actor closes it out via the outcomes API. */
  status: 'pending' | 'done';
  /** Actor that completed the action ('human:<id>' or 'agent:<id>'). */
  completedBy?: string;
  completedAt?: string;
}

export interface Outcome {
  status: OutcomeStatus;
  summary: string;
  actions: OutcomeAction[];
  /** Actor that determined the outcome ('pipeline:<version>', 'human:<id>', 'agent:<id>'). */
  determinedBy: string;
  determinedAt: string;
}

/** Per-stage provenance so every packet field is traceable to the code that produced it. */
export interface StageProvenance {
  stage: 'normalize' | 'classify' | 'obligations' | 'outcome';
  version: string;
  /** SHA-256 (hex) of the canonicalized stage input. */
  inputHash: string;
  /** SHA-256 (hex) of the canonicalized stage output. */
  outputHash: string;
}

export const OUTCOME_PACKET_SCHEMA = 'acorn.signal/outcome-packet@1';

/**
 * The signable core of an Outcome Packet. Everything inside `payload` is
 * covered by the content hash and signature; nothing outside it is.
 */
export interface OutcomePacketPayload {
  schema: typeof OUTCOME_PACKET_SCHEMA;
  id: string;
  tenantId: string;
  createdAt: string;
  /**
   * Id of the packet this one supersedes, if this is an amendment. Packets
   * are immutable once appended; outcome changes append a new packet that
   * amends the previous one, so the full history stays on the chain.
   */
  amends?: string;
  communication: CommunicationRecord;
  classification: Classification;
  obligations: Obligation[];
  outcome: Outcome;
  provenance: {
    pipelineVersion: string;
    stages: StageProvenance[];
  };
}

export interface PacketIntegrity {
  /** Canonicalization algorithm applied before hashing/signing. */
  canonicalization: 'JCS';
  /** SHA-256 (hex) of the canonicalized payload. */
  payloadHash: string;
  /** Position of this packet in the tenant ledger, starting at 0. */
  sequence: number;
  /** payloadHash of the previous packet in the tenant ledger, or null for the first. */
  previousPacketHash: string | null;
  signature: {
    alg: 'Ed25519';
    /** Identifier of the signing key (SHA-256 fingerprint of the public key). */
    keyId: string;
    /** Base64 signature over canonicalized {payloadHash, sequence, previousPacketHash}. */
    value: string;
  };
}

/** A complete, verifiable Outcome Packet: signed payload + chain linkage. */
export interface OutcomePacket {
  payload: OutcomePacketPayload;
  integrity: PacketIntegrity;
}

export interface VerificationResult {
  valid: boolean;
  checks: {
    payloadHash: boolean;
    signature: boolean;
    chainLink: boolean;
  };
  errors: string[];
}
