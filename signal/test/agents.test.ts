import { describe, expect, it } from 'vitest';
import { AccessDenied, viewPacket, REDACTED } from '../src/agents/access.js';
import { GrantError } from '../src/agents/grants.js';
import { principalFor, rawComplaint, testService, T0 } from './helpers.js';

describe('AgentRegistry', () => {
  it('refuses AI agents without an accountable owner or with admin scope', () => {
    const { service } = testService();
    expect(() =>
      service.registry.register(
        {
          id: 'bot-1',
          tenantId: 'tenant-a',
          name: 'bot',
          kind: 'ai_agent',
          scopes: ['packets:read'],
          allowedCategories: [],
          ownerId: '',
        },
        T0.toISOString(),
      ),
    ).toThrow(GrantError);
    expect(() =>
      service.registry.register(
        {
          id: 'bot-2',
          tenantId: 'tenant-a',
          name: 'bot',
          kind: 'ai_agent',
          scopes: ['agents:admin'],
          allowedCategories: [],
          ownerId: 'owner-1',
        },
        T0.toISOString(),
      ),
    ).toThrow(/cannot hold agents:admin/);
  });

  it('only issues tokens for scopes the agent actually holds', () => {
    const { service } = testService();
    principalFor(service, { id: 'bot', scopes: ['packets:read'] });
    expect(() => service.registry.issueToken('bot', ['outcomes:act'], 60)).toThrow(GrantError);
  });

  it('rejects forged and expired tokens', () => {
    const { service, tick } = testService();
    principalFor(service, { id: 'bot', scopes: ['packets:read'] });
    const token = service.registry.issueToken('bot', ['packets:read'], 1);

    const [sig, payload] = token.split('.');
    expect(() => service.registry.verifyToken(`${sig!.slice(0, -2)}xx.${payload}`)).toThrow(
      /Invalid token signature/,
    );

    // Tamper with claims (grant self more scopes) — signature no longer matches.
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    claims.scopes = ['packets:read', 'pii:read', 'outcomes:act'];
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(() => service.registry.verifyToken(`${sig}.${forged}`)).toThrow(/Invalid token signature/);

    tick(); // +1s -> expired
    expect(() => service.registry.verifyToken(token)).toThrow(/expired/);
  });

  it('revocation invalidates outstanding tokens immediately', () => {
    const { service } = testService();
    principalFor(service, { id: 'bot', scopes: ['packets:read'] });
    const token = service.registry.issueToken('bot', ['packets:read'], 3600);
    service.registry.revoke('bot', T0.toISOString());
    expect(() => service.registry.verifyToken(token)).toThrow(/revoked/);
  });
});

describe('packet access control', () => {
  it('redacts PII for principals without pii:read and flags the view', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());

    const bot = principalFor(service, { id: 'bot', scopes: ['packets:read'] });
    const view = viewPacket(bot, packet);
    expect(view.redacted).toBe(true);
    const customer = view.packet.payload.communication.parties[0]!;
    expect(customer.id).toBe('cust-1');
    expect(customer.name).toBe(REDACTED);
    expect(customer.address).toBe(REDACTED);

    // Stored packet is untouched and still verifies.
    expect(packet.payload.communication.parties[0]!.name).toBe('Jamie Doe');
  });

  it('returns the full packet to principals with pii:read', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());
    const human = principalFor(service, {
      id: 'op',
      kind: 'human',
      scopes: ['packets:read', 'pii:read'],
    });
    const view = viewPacket(human, packet);
    expect(view.redacted).toBe(false);
    expect(view.packet.payload.communication.parties[0]!.name).toBe('Jamie Doe');
  });

  it('enforces tenant isolation', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());
    const outsider = principalFor(service, {
      id: 'other-tenant-bot',
      tenantId: 'tenant-b',
      scopes: ['packets:read'],
    });
    expect(() => viewPacket(outsider, packet)).toThrow(AccessDenied);
  });

  it('confines AI agents to their approved categories', async () => {
    const { service } = testService();
    const complaint = await service.ingest(rawComplaint());
    const cancellation = await service.ingest(
      rawComplaint({ content: 'Please cancel my subscription today', subject: 'cancel' }),
    );

    const complaintsBot = principalFor(service, {
      id: 'complaints-bot',
      scopes: ['packets:read', 'outcomes:act'],
      allowedCategories: ['complaint'],
    });

    expect(viewPacket(complaintsBot, complaint).packet.payload.id).toBe(complaint.payload.id);
    expect(() => viewPacket(complaintsBot, cancellation)).toThrow(/not approved for category/);
    await expect(
      service.completeAction(complaintsBot, 'tenant-a', cancellation.payload.id, 0),
    ).rejects.toThrow(/not approved for category/);
  });

  it('denies actions outside granted scopes', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());
    const readOnly = principalFor(service, { id: 'ro', scopes: ['packets:read'] });
    await expect(
      service.completeAction(readOnly, 'tenant-a', packet.payload.id, 0),
    ).rejects.toThrow(/Missing required scope/);
    await expect(service.verifyPacket(readOnly, 'tenant-a', packet.payload.id)).rejects.toThrow(
      /Missing required scope/,
    );
  });
});
