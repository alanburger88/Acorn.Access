import { sha256Hex } from '../crypto/hash.js';
import type { Channel, CommunicationRecord, Direction, Party } from '../types.js';

export const NORMALIZE_VERSION = 'normalize@1.0.0';

/** Raw communication as submitted by a channel integration. */
export interface RawCommunication {
  tenantId: string;
  channel: Channel;
  direction: Direction;
  /** RFC 3339; defaults to ingest time when the channel has no timestamp. */
  occurredAt?: string;
  parties: Party[];
  subject?: string;
  /**
   * Channel-native content: email body, SMS text, chat transcript, call
   * transcript text, or extracted letter text. v1 accepts text only; binary
   * originals stay in the tenant content store and are referenced by
   * `rawContentRef`.
   */
  content: string;
  rawContentRef?: string;
  metadata?: Record<string, string>;
}

export interface NormalizeContext {
  /** Returns a unique communication id. Injectable for deterministic tests. */
  newId: () => string;
  /** Returns the current RFC 3339 timestamp. */
  now: () => string;
}

const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB of text per communication

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

const CHANNELS: readonly Channel[] = ['email', 'sms', 'chat', 'voice', 'letter', 'portal'];
const DIRECTIONS: readonly Direction[] = ['inbound', 'outbound'];
const PARTY_ROLES = ['customer', 'institution', 'agent', 'third_party'];

/**
 * Validate and normalize a raw communication into a CommunicationRecord.
 * The record's rawContentHash commits to the exact submitted content, so the
 * packet later proves what text the pipeline actually saw.
 */
export function normalize(raw: RawCommunication, ctx: NormalizeContext): CommunicationRecord {
  if (!raw.tenantId || typeof raw.tenantId !== 'string') {
    throw new IngestError('tenantId is required');
  }
  if (!CHANNELS.includes(raw.channel)) {
    throw new IngestError(`Unknown channel: ${String(raw.channel)}`);
  }
  if (!DIRECTIONS.includes(raw.direction)) {
    throw new IngestError(`Unknown direction: ${String(raw.direction)}`);
  }
  if (typeof raw.content !== 'string' || raw.content.trim().length === 0) {
    throw new IngestError('content must be a non-empty string');
  }
  if (Buffer.byteLength(raw.content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new IngestError(`content exceeds ${MAX_CONTENT_BYTES} bytes`);
  }
  if (!Array.isArray(raw.parties) || raw.parties.length === 0) {
    throw new IngestError('at least one party is required');
  }
  for (const party of raw.parties) {
    if (!party.id || typeof party.id !== 'string') {
      throw new IngestError('every party requires an id');
    }
    if (!PARTY_ROLES.includes(party.role)) {
      throw new IngestError(`Unknown party role: ${String(party.role)}`);
    }
  }
  if (raw.occurredAt !== undefined && Number.isNaN(Date.parse(raw.occurredAt))) {
    throw new IngestError('occurredAt must be a valid RFC 3339 timestamp');
  }

  const body = normalizeText(raw.content);

  return {
    id: ctx.newId(),
    tenantId: raw.tenantId,
    channel: raw.channel,
    direction: raw.direction,
    occurredAt: raw.occurredAt ?? ctx.now(),
    parties: raw.parties.map((p) => ({
      id: p.id,
      role: p.role,
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.address !== undefined ? { address: p.address } : {}),
    })),
    ...(raw.subject !== undefined ? { subject: raw.subject } : {}),
    body,
    rawContentHash: sha256Hex(Buffer.from(raw.content, 'utf8')),
    ...(raw.rawContentRef !== undefined ? { rawContentRef: raw.rawContentRef } : {}),
    metadata: { ...(raw.metadata ?? {}) },
  };
}

/** Collapse whitespace variants so downstream rules see consistent text. */
function normalizeText(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim();
}
