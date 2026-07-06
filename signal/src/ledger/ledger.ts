import { hashCanonical } from '../crypto/hash.js';
import { PacketSigner, verifySignature } from '../crypto/signer.js';
import type {
  OutcomePacket,
  OutcomePacketPayload,
  VerificationResult,
} from '../types.js';
import type { PacketStore } from './store.js';

export interface ChainAuditResult {
  valid: boolean;
  packetCount: number;
  /** Ids of packets that failed verification, in chain order. */
  brokenAt: string[];
}

/**
 * Per-tenant append-only hash chain of Outcome Packets.
 *
 * Each packet's integrity block commits to the payload hash, its sequence
 * number, and the previous packet's payload hash, and the whole triple is
 * Ed25519-signed. Tampering with any historical packet therefore breaks
 * either its own signature or the link every later packet asserts.
 */
export class PacketLedger {
  constructor(
    private readonly store: PacketStore,
    private readonly signer: PacketSigner,
  ) {}

  /** Seal a payload onto the tenant's chain and persist it. */
  async seal(payload: OutcomePacketPayload): Promise<OutcomePacket> {
    const head = await this.store.head(payload.tenantId);
    const payloadHash = hashCanonical(payload);
    const sequence = head ? head.integrity.sequence + 1 : 0;
    const previousPacketHash = head ? head.integrity.payloadHash : null;
    const signedMessage = { payloadHash, sequence, previousPacketHash };
    const packet: OutcomePacket = {
      payload,
      integrity: {
        canonicalization: 'JCS',
        payloadHash,
        sequence,
        previousPacketHash,
        signature: {
          alg: 'Ed25519',
          keyId: this.signer.keyId,
          value: this.signer.sign(signedMessage),
        },
      },
    };
    await this.store.append(packet);
    return packet;
  }

  async get(tenantId: string, packetId: string): Promise<OutcomePacket | undefined> {
    return this.store.get(tenantId, packetId);
  }

  async list(tenantId: string): Promise<OutcomePacket[]> {
    return this.store.list(tenantId);
  }

  /**
   * Resolve the latest version of a packet by following amendment links.
   * Returns undefined if the id is unknown.
   */
  async latest(tenantId: string, packetId: string): Promise<OutcomePacket | undefined> {
    const all = await this.store.list(tenantId);
    let current = all.find((p) => p.payload.id === packetId);
    if (!current) return undefined;
    // Amendments always come later in the chain; walk forward.
    for (const p of all) {
      if (p.payload.amends === current.payload.id) current = p;
    }
    return current;
  }

  /** Verify a single packet against its predecessor in the chain. */
  async verify(tenantId: string, packetId: string): Promise<VerificationResult> {
    const packet = await this.store.get(tenantId, packetId);
    if (!packet) {
      return {
        valid: false,
        checks: { payloadHash: false, signature: false, chainLink: false },
        errors: [`Packet ${packetId} not found`],
      };
    }
    const all = await this.store.list(tenantId);
    const predecessor = all.find(
      (p) => p.integrity.sequence === packet.integrity.sequence - 1,
    );
    return verifyPacket(packet, this.signer.publicKeyPem, predecessor ?? null);
  }

  /** Walk the whole tenant chain and verify every packet and link. */
  async audit(tenantId: string): Promise<ChainAuditResult> {
    const all = await this.store.list(tenantId);
    const brokenAt: string[] = [];
    let previous: OutcomePacket | null = null;
    for (const packet of all) {
      const result = verifyPacket(packet, this.signer.publicKeyPem, previous);
      if (!result.valid) brokenAt.push(packet.payload.id);
      previous = packet;
    }
    return { valid: brokenAt.length === 0, packetCount: all.length, brokenAt };
  }
}

/**
 * Stateless packet verification. Requires only the packet, the signer's
 * public key, and the preceding packet (null for sequence 0) — so an
 * external auditor can run it without access to Acorn.Signal internals.
 */
export function verifyPacket(
  packet: OutcomePacket,
  publicKeyPem: string,
  predecessor: OutcomePacket | null,
): VerificationResult {
  const errors: string[] = [];

  const recomputedHash = hashCanonical(packet.payload);
  const payloadHashOk = recomputedHash === packet.integrity.payloadHash;
  if (!payloadHashOk) errors.push('Payload hash mismatch: payload was altered after sealing');

  const signedMessage = {
    payloadHash: packet.integrity.payloadHash,
    sequence: packet.integrity.sequence,
    previousPacketHash: packet.integrity.previousPacketHash,
  };
  const signatureOk = verifySignature(
    signedMessage,
    packet.integrity.signature.value,
    publicKeyPem,
  );
  if (!signatureOk) errors.push('Signature verification failed');

  let chainOk: boolean;
  if (packet.integrity.sequence === 0) {
    chainOk = packet.integrity.previousPacketHash === null;
    if (!chainOk) errors.push('Genesis packet must have null previousPacketHash');
  } else if (!predecessor) {
    chainOk = false;
    errors.push('Predecessor packet missing from chain');
  } else {
    chainOk = packet.integrity.previousPacketHash === predecessor.integrity.payloadHash;
    if (!chainOk) errors.push('Chain link mismatch: previousPacketHash does not match predecessor');
  }

  return {
    valid: payloadHashOk && signatureOk && chainOk,
    checks: { payloadHash: payloadHashOk, signature: signatureOk, chainLink: chainOk },
    errors,
  };
}
