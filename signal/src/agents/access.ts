import type { AgentRegistration, Scope, TokenClaims } from './grants.js';
import { GrantError } from './grants.js';
import type { OutcomePacket } from '../types.js';

export class AccessDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDenied';
  }
}

export interface Principal {
  claims: TokenClaims;
  agent: AgentRegistration;
}

export function requireScope(principal: Principal, scope: Scope): void {
  if (!principal.claims.scopes.includes(scope)) {
    throw new AccessDenied(`Missing required scope: ${scope}`);
  }
}

export function requireTenant(principal: Principal, tenantId: string): void {
  if (principal.claims.tenantId !== tenantId) {
    throw new AccessDenied('Token is not valid for this tenant');
  }
}

/**
 * Category confinement for AI agents: an agent granted only `complaint`
 * packets must not see cancellations, even with packets:read.
 */
export function requireCategoryAccess(principal: Principal, packet: OutcomePacket): void {
  const allowed = principal.agent.allowedCategories;
  if (allowed.length > 0 && !allowed.includes(packet.payload.classification.category)) {
    throw new AccessDenied(
      `Agent is not approved for category ${packet.payload.classification.category}`,
    );
  }
}

export const REDACTED = '[redacted]';

/**
 * Produce the packet view a principal is allowed to see. Without pii:read,
 * party names and addresses are replaced with a marker. Redaction is view
 * layer only — the stored packet is untouched, and the response flags itself
 * as redacted so consumers know the payload will not re-verify against the
 * integrity block byte-for-byte.
 */
export function viewPacket(
  principal: Principal,
  packet: OutcomePacket,
): { packet: OutcomePacket; redacted: boolean } {
  requireScope(principal, 'packets:read');
  requireTenant(principal, packet.payload.tenantId);
  requireCategoryAccess(principal, packet);

  if (principal.claims.scopes.includes('pii:read')) {
    return { packet, redacted: false };
  }

  const redactedPacket: OutcomePacket = {
    ...packet,
    payload: {
      ...packet.payload,
      communication: {
        ...packet.payload.communication,
        parties: packet.payload.communication.parties.map((p) => ({
          id: p.id,
          role: p.role,
          ...(p.name !== undefined ? { name: REDACTED } : {}),
          ...(p.address !== undefined ? { address: REDACTED } : {}),
        })),
      },
    },
  };
  return { packet: redactedPacket, redacted: true };
}

export { GrantError };
