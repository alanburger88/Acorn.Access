import { randomUUID } from 'node:crypto';
import { AccessDenied, requireScope, requireTenant, requireCategoryAccess, viewPacket, type Principal } from './agents/access.js';
import { AgentRegistry } from './agents/grants.js';
import type { RawCommunication } from './ingest/normalize.js';
import { PacketLedger, type ChainAuditResult } from './ledger/ledger.js';
import { MemoryPacketStore, type PacketStore } from './ledger/store.js';
import { RuleClassifier, type Classifier } from './pipeline/classify.js';
import { runPipeline, PIPELINE_VERSION, type PipelineContext } from './pipeline/pipeline.js';
import { generateSignerKeys, PacketSigner, type SignerKeys } from './crypto/signer.js';
import type {
  Channel,
  Direction,
  OutcomePacket,
  OutcomePacketPayload,
  OutcomeStatus,
  RegulatedCategory,
  VerificationResult,
} from './types.js';

/** Non-PII packet summary used by chain listings. */
export interface PacketSummary {
  id: string;
  sequence: number;
  createdAt: string;
  channel: Channel;
  direction: Direction;
  category: RegulatedCategory;
  status: OutcomeStatus;
  amends: string | null;
  payloadHash: string;
  previousPacketHash: string | null;
}

export interface SignalServiceOptions {
  store?: PacketStore;
  classifier?: Classifier;
  keys?: SignerKeys;
  tokenSecret?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  newId?: () => string;
}

/**
 * The Acorn.Signal core service: ingests communications, produces signed
 * Outcome Packets on a per-tenant hash chain, and mediates all packet access
 * through scoped principals.
 */
export class SignalService {
  readonly ledger: PacketLedger;
  readonly registry: AgentRegistry;
  readonly signer: PacketSigner;
  private readonly classifier: Classifier;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(options: SignalServiceOptions = {}) {
    const keys = options.keys ?? generateSignerKeys();
    this.signer = new PacketSigner(keys);
    this.ledger = new PacketLedger(options.store ?? new MemoryPacketStore(), this.signer);
    this.clock = options.now ?? (() => new Date());
    this.registry = new AgentRegistry(options.tokenSecret, () =>
      Math.floor(this.clock().getTime() / 1000),
    );
    this.classifier = options.classifier ?? new RuleClassifier();
    this.newId = options.newId ?? randomUUID;
  }

  get pipelineVersion(): string {
    return PIPELINE_VERSION;
  }

  private pipelineContext(): PipelineContext {
    return {
      newId: () => `comm_${this.newId()}`,
      newPacketId: () => `op_${this.newId()}`,
      now: () => this.clock().toISOString(),
    };
  }

  /** Ingest a raw communication and seal its Outcome Packet onto the chain. */
  async ingest(raw: RawCommunication): Promise<OutcomePacket> {
    const payload = runPipeline(raw, this.classifier, this.pipelineContext());
    return this.ledger.seal(payload);
  }

  /** Latest version of a packet (follows amendments), as the principal may see it. */
  async getPacket(
    principal: Principal,
    tenantId: string,
    packetId: string,
  ): Promise<{ packet: OutcomePacket; redacted: boolean } | undefined> {
    const packet = await this.ledger.latest(tenantId, packetId);
    if (!packet) return undefined;
    return viewPacket(principal, packet);
  }

  /**
   * Non-PII chain listing for consoles and dashboards. Requires packets:read;
   * packets outside an AI agent's approved categories are omitted entirely.
   */
  async listPackets(principal: Principal, tenantId: string): Promise<PacketSummary[]> {
    requireScope(principal, 'packets:read');
    requireTenant(principal, tenantId);
    const all = await this.ledger.list(tenantId);
    const allowed = principal.agent.allowedCategories;
    return all
      .filter(
        (p) => allowed.length === 0 || allowed.includes(p.payload.classification.category),
      )
      .map((p) => ({
        id: p.payload.id,
        sequence: p.integrity.sequence,
        createdAt: p.payload.createdAt,
        channel: p.payload.communication.channel,
        direction: p.payload.communication.direction,
        category: p.payload.classification.category,
        status: p.payload.outcome.status,
        amends: p.payload.amends ?? null,
        payloadHash: p.integrity.payloadHash,
        previousPacketHash: p.integrity.previousPacketHash,
      }));
  }

  async verifyPacket(
    principal: Principal,
    tenantId: string,
    packetId: string,
  ): Promise<VerificationResult> {
    requireScope(principal, 'packets:verify');
    requireTenant(principal, tenantId);
    return this.ledger.verify(tenantId, packetId);
  }

  async auditChain(principal: Principal, tenantId: string): Promise<ChainAuditResult> {
    requireScope(principal, 'packets:verify');
    requireTenant(principal, tenantId);
    return this.ledger.audit(tenantId);
  }

  /**
   * Complete an outcome action. Appends an amendment packet with the action
   * marked done (and the outcome resolved when no pending actions remain).
   * The original packet stays on the chain untouched.
   */
  async completeAction(
    principal: Principal,
    tenantId: string,
    packetId: string,
    actionIndex: number,
  ): Promise<OutcomePacket> {
    requireScope(principal, 'outcomes:act');
    requireTenant(principal, tenantId);
    const current = await this.ledger.latest(tenantId, packetId);
    if (!current) throw new AccessDenied(`Packet ${packetId} not found`);
    requireCategoryAccess(principal, current);

    const actions = current.payload.outcome.actions;
    const target = actions[actionIndex];
    if (!target) throw new RangeError(`No action at index ${actionIndex}`);
    if (target.status === 'done') throw new RangeError(`Action ${actionIndex} is already done`);

    const nowIso = this.clock().toISOString();
    const actorKind = principal.agent.kind === 'ai_agent' ? 'agent' : 'human';
    const updatedActions = actions.map((a, i) =>
      i === actionIndex
        ? {
            ...a,
            status: 'done' as const,
            completedBy: `${actorKind}:${principal.agent.id}`,
            completedAt: nowIso,
          }
        : a,
    );
    const allDone = updatedActions.every((a) => a.status === 'done');

    const amended: OutcomePacketPayload = {
      ...current.payload,
      id: `op_${this.newId()}`,
      createdAt: nowIso,
      amends: current.payload.id,
      outcome: {
        ...current.payload.outcome,
        actions: updatedActions,
        ...(allDone
          ? {
              status: 'resolved' as const,
              summary: `${current.payload.outcome.summary}; all required actions completed`,
              determinedBy: `${actorKind}:${principal.agent.id}`,
              determinedAt: nowIso,
            }
          : {}),
      },
    };
    return this.ledger.seal(amended);
  }
}
