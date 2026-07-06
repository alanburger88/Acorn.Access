import type { OutcomePacket } from '../types.js';

/**
 * Append-only packet storage. Implementations must preserve insertion order
 * per tenant; the ledger derives chain linkage from that order. There is
 * deliberately no update or delete: corrections are expressed as amendment
 * packets appended to the chain (`payload.amends`).
 */
export interface PacketStore {
  append(packet: OutcomePacket): Promise<void>;
  get(tenantId: string, packetId: string): Promise<OutcomePacket | undefined>;
  /** All packets for a tenant in ledger order (ascending sequence). */
  list(tenantId: string): Promise<OutcomePacket[]>;
  /** Highest-sequence packet for a tenant, if any. */
  head(tenantId: string): Promise<OutcomePacket | undefined>;
}

export class MemoryPacketStore implements PacketStore {
  private readonly byTenant = new Map<string, OutcomePacket[]>();

  async append(packet: OutcomePacket): Promise<void> {
    const list = this.byTenant.get(packet.payload.tenantId) ?? [];
    list.push(packet);
    this.byTenant.set(packet.payload.tenantId, list);
  }

  async get(tenantId: string, packetId: string): Promise<OutcomePacket | undefined> {
    return this.byTenant.get(tenantId)?.find((p) => p.payload.id === packetId);
  }

  async list(tenantId: string): Promise<OutcomePacket[]> {
    return [...(this.byTenant.get(tenantId) ?? [])];
  }

  async head(tenantId: string): Promise<OutcomePacket | undefined> {
    const list = this.byTenant.get(tenantId);
    return list?.[list.length - 1];
  }
}
