import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RegulatedCategory } from '../types.js';

/**
 * Access scopes grantable to actors (human operators and approved AI agents).
 *
 * - communications:ingest — submit communications for packet production
 * - packets:read    — read packet payloads (PII redacted unless pii:read)
 * - packets:verify  — run integrity verification and chain audits
 * - outcomes:act    — complete outcome actions (appends amendment packets)
 * - pii:read        — see party names/addresses inside packets
 * - agents:admin    — register agents and issue tokens
 */
export type Scope =
  | 'communications:ingest'
  | 'packets:read'
  | 'packets:verify'
  | 'outcomes:act'
  | 'pii:read'
  | 'agents:admin';

export const ALL_SCOPES: readonly Scope[] = [
  'communications:ingest',
  'packets:read',
  'packets:verify',
  'outcomes:act',
  'pii:read',
  'agents:admin',
];

export interface AgentRegistration {
  id: string;
  tenantId: string;
  name: string;
  kind: 'human' | 'ai_agent' | 'service';
  scopes: Scope[];
  /** Restrict an AI agent to specific categories; empty = all categories. */
  allowedCategories: RegulatedCategory[];
  /** AI agents must name an accountable human owner. */
  ownerId: string;
  createdAt: string;
  revokedAt?: string;
}

export interface TokenClaims {
  agentId: string;
  tenantId: string;
  scopes: Scope[];
  /** Unix epoch seconds. */
  exp: number;
}

export class GrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantError';
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Registry of approved actors plus stateless HMAC token issuance.
 * Tokens are `sig.payload` where sig = HMAC-SHA256(secret, payload) and
 * payload is base64url(JSON claims). Verification also checks the agent is
 * still registered and unrevoked, so revocation takes effect immediately
 * regardless of token expiry.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRegistration>();
  private readonly secret: Buffer;

  constructor(tokenSecret?: string, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.secret = tokenSecret ? Buffer.from(tokenSecret, 'utf8') : randomBytes(32);
  }

  register(input: Omit<AgentRegistration, 'createdAt' | 'revokedAt'>, createdAt: string): AgentRegistration {
    if (this.agents.has(input.id)) {
      throw new GrantError(`Agent ${input.id} is already registered`);
    }
    if (input.kind === 'ai_agent' && !input.ownerId) {
      throw new GrantError('AI agents require an accountable ownerId');
    }
    if (input.kind === 'ai_agent' && input.scopes.includes('agents:admin')) {
      throw new GrantError('AI agents cannot hold agents:admin');
    }
    for (const scope of input.scopes) {
      if (!ALL_SCOPES.includes(scope)) {
        throw new GrantError(`Unknown scope: ${String(scope)}`);
      }
    }
    const registration: AgentRegistration = { ...input, createdAt };
    this.agents.set(input.id, registration);
    return registration;
  }

  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  list(tenantId: string): AgentRegistration[] {
    return [...this.agents.values()].filter((a) => a.tenantId === tenantId);
  }

  revoke(agentId: string, revokedAt: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new GrantError(`Agent ${agentId} not found`);
    agent.revokedAt = revokedAt;
  }

  /** Issue a token for a subset of the agent's granted scopes. */
  issueToken(agentId: string, scopes: Scope[], ttlSeconds: number): string {
    const agent = this.agents.get(agentId);
    if (!agent) throw new GrantError(`Agent ${agentId} not found`);
    if (agent.revokedAt) throw new GrantError(`Agent ${agentId} is revoked`);
    for (const scope of scopes) {
      if (!agent.scopes.includes(scope)) {
        throw new GrantError(`Agent ${agentId} does not hold scope ${scope}`);
      }
    }
    const claims: TokenClaims = {
      agentId,
      tenantId: agent.tenantId,
      scopes,
      exp: this.now() + ttlSeconds,
    };
    const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
    const sig = b64url(createHmac('sha256', this.secret).update(payload).digest());
    return `${sig}.${payload}`;
  }

  /** Verify a token and return its claims plus the live registration. */
  verifyToken(token: string): { claims: TokenClaims; agent: AgentRegistration } {
    const dot = token.indexOf('.');
    if (dot === -1) throw new GrantError('Malformed token');
    const sig = token.slice(0, dot);
    const payload = token.slice(dot + 1);
    const expected = createHmac('sha256', this.secret).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new GrantError('Invalid token signature');
    }
    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
    } catch {
      throw new GrantError('Malformed token payload');
    }
    if (claims.exp <= this.now()) throw new GrantError('Token expired');
    const agent = this.agents.get(claims.agentId);
    if (!agent) throw new GrantError('Agent no longer registered');
    if (agent.revokedAt) throw new GrantError('Agent is revoked');
    return { claims, agent };
  }
}
