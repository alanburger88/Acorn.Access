import type { RawCommunication } from '../src/ingest/normalize.js';
import { SignalService } from '../src/service.js';
import type { Principal } from '../src/agents/access.js';
import type { Scope } from '../src/agents/grants.js';
import type { RegulatedCategory } from '../src/types.js';

export const T0 = new Date('2026-07-06T12:00:00.000Z');

/** Deterministic service: fixed clock start, sequential ids. */
export function testService(): { service: SignalService; tick: () => void } {
  let now = T0.getTime();
  let seq = 0;
  const service = new SignalService({
    now: () => new Date(now),
    newId: () => `id${String(++seq).padStart(4, '0')}`,
    tokenSecret: 'test-secret',
  });
  return { service, tick: () => (now += 1000) };
}

export function rawComplaint(overrides: Partial<RawCommunication> = {}): RawCommunication {
  return {
    tenantId: 'tenant-a',
    channel: 'email',
    direction: 'inbound',
    occurredAt: '2026-07-06T09:30:00.000Z',
    parties: [
      { id: 'cust-1', role: 'customer', name: 'Jamie Doe', address: 'jamie@example.com' },
      { id: 'inst-1', role: 'institution' },
    ],
    subject: 'Formal complaint about my account',
    content:
      'I wish to complain about the service I received last week. This is a formal grievance and I expect a response.',
    metadata: { messageId: '<m1@example.com>' },
    ...overrides,
  };
}

/** Register an actor and mint a principal without going through HTTP. */
export function principalFor(
  service: SignalService,
  opts: {
    id?: string;
    tenantId?: string;
    kind?: 'human' | 'ai_agent' | 'service';
    scopes: Scope[];
    allowedCategories?: RegulatedCategory[];
    tokenScopes?: Scope[];
  },
): Principal {
  const id = opts.id ?? `actor-${opts.scopes.join('+')}`;
  service.registry.register(
    {
      id,
      tenantId: opts.tenantId ?? 'tenant-a',
      name: id,
      kind: opts.kind ?? 'ai_agent',
      scopes: opts.scopes,
      allowedCategories: opts.allowedCategories ?? [],
      ownerId: 'owner-1',
    },
    T0.toISOString(),
  );
  const token = service.registry.issueToken(id, opts.tokenScopes ?? opts.scopes, 3600);
  return service.registry.verifyToken(token);
}
