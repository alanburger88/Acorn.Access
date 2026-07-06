import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../src/api/server.js';
import { SignalService } from '../src/service.js';
import { rawComplaint } from './helpers.js';

const ADMIN_KEY = 'test-admin-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const service = new SignalService({ tokenSecret: 'api-test-secret' });
  server = createApiServer(service, { adminKey: ADMIN_KEY });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json() };
}

describe('Acorn.Signal API end-to-end', () => {
  let ingestToken: string;
  let botToken: string;
  let operatorToken: string;
  let packetId: string;

  it('serves the demo console at / without auth', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Acorn');
    expect(html).toContain('Demo Console');
  });

  it('reports health without auth', async () => {
    const { status, json } = await api('GET', '/v1/health');
    expect(status).toBe(200);
    expect(json.status).toBe('ok');
  });

  it('rejects agent registration without the admin key', async () => {
    const { status } = await api('POST', '/v1/agents', { id: 'x' });
    expect(status).toBe(403);
    const bad = await api('POST', '/v1/agents', { id: 'x' }, { 'x-admin-key': 'wrong' });
    expect(bad.status).toBe(403);
  });

  it('registers actors and issues scoped tokens', async () => {
    const admin = { 'x-admin-key': ADMIN_KEY };
    const mk = (agent: object) => api('POST', '/v1/agents', agent, admin);

    expect(
      (
        await mk({
          id: 'ingest-svc',
          tenantId: 'tenant-a',
          name: 'Email connector',
          kind: 'service',
          scopes: ['communications:ingest'],
          allowedCategories: [],
          ownerId: 'owner-1',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await mk({
          id: 'triage-bot',
          tenantId: 'tenant-a',
          name: 'Triage agent',
          kind: 'ai_agent',
          scopes: ['packets:read', 'packets:verify', 'outcomes:act'],
          allowedCategories: ['complaint'],
          ownerId: 'owner-1',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await mk({
          id: 'operator-1',
          tenantId: 'tenant-a',
          name: 'Case operator',
          kind: 'human',
          scopes: ['packets:read', 'packets:verify', 'outcomes:act', 'pii:read'],
          allowedCategories: [],
          ownerId: 'operator-1',
        })
      ).status,
    ).toBe(201);

    const t1 = await api('POST', '/v1/agents/ingest-svc/tokens', { scopes: ['communications:ingest'] }, admin);
    const t2 = await api('POST', '/v1/agents/triage-bot/tokens', { scopes: ['packets:read', 'packets:verify', 'outcomes:act'] }, admin);
    const t3 = await api('POST', '/v1/agents/operator-1/tokens', { scopes: ['packets:read', 'packets:verify', 'outcomes:act', 'pii:read'] }, admin);
    expect(t1.status).toBe(201);
    ingestToken = t1.json.token;
    botToken = t2.json.token;
    operatorToken = t3.json.token;
  });

  it('ingests a communication and returns a signed packet', async () => {
    const { status, json } = await api('POST', '/v1/communications', rawComplaint(), {
      authorization: `Bearer ${ingestToken}`,
    });
    expect(status).toBe(201);
    packetId = json.packet.payload.id;
    expect(json.packet.payload.classification.category).toBe('complaint');
    expect(json.packet.integrity.signature.alg).toBe('Ed25519');
    expect(json.packet.integrity.sequence).toBe(0);
  });

  it('refuses ingestion without the ingest scope', async () => {
    const { status } = await api('POST', '/v1/communications', rawComplaint(), {
      authorization: `Bearer ${botToken}`,
    });
    expect(status).toBe(403);
  });

  it('serves redacted packets to the bot and full packets to the operator', async () => {
    const bot = await api('GET', `/v1/tenants/tenant-a/packets/${packetId}`, undefined, {
      authorization: `Bearer ${botToken}`,
    });
    expect(bot.status).toBe(200);
    expect(bot.json.redacted).toBe(true);
    expect(bot.json.packet.payload.communication.parties[0].name).toBe('[redacted]');

    const op = await api('GET', `/v1/tenants/tenant-a/packets/${packetId}`, undefined, {
      authorization: `Bearer ${operatorToken}`,
    });
    expect(op.json.redacted).toBe(false);
    expect(op.json.packet.payload.communication.parties[0].name).toBe('Jamie Doe');
  });

  it('verifies packets and audits the chain over HTTP', async () => {
    const v = await api('GET', `/v1/tenants/tenant-a/packets/${packetId}/verify`, undefined, {
      authorization: `Bearer ${botToken}`,
    });
    expect(v.status).toBe(200);
    expect(v.json.verification.valid).toBe(true);

    const a = await api('GET', '/v1/tenants/tenant-a/audit', undefined, {
      authorization: `Bearer ${botToken}`,
    });
    expect(a.json.audit.valid).toBe(true);
  });

  it('lets the approved bot complete actions until the outcome resolves', async () => {
    const first = await api(
      'POST',
      `/v1/tenants/tenant-a/packets/${packetId}/actions/0/complete`,
      {},
      { authorization: `Bearer ${botToken}` },
    );
    expect(first.status).toBe(200);
    expect(first.json.packet.payload.amends).toBe(packetId);
    expect(first.json.packet.payload.outcome.actions[0].completedBy).toBe('agent:triage-bot');

    const second = await api(
      'POST',
      `/v1/tenants/tenant-a/packets/${packetId}/actions/1/complete`,
      {},
      { authorization: `Bearer ${operatorToken}` },
    );
    expect(second.json.packet.payload.outcome.status).toBe('resolved');

    // Reading by the original id returns the latest amendment.
    const read = await api('GET', `/v1/tenants/tenant-a/packets/${packetId}`, undefined, {
      authorization: `Bearer ${operatorToken}`,
    });
    expect(read.json.packet.payload.outcome.status).toBe('resolved');

    // Chain stays valid across amendments.
    const audit = await api('GET', '/v1/tenants/tenant-a/audit', undefined, {
      authorization: `Bearer ${botToken}`,
    });
    expect(audit.json.audit).toEqual({ valid: true, packetCount: 3, brokenAt: [] });
  });

  it('lists the chain, hiding categories an agent is not approved for', async () => {
    // Add a cancellation packet; triage-bot is confined to complaints.
    await api(
      'POST',
      '/v1/communications',
      rawComplaint({ subject: 'cancel', content: 'Please cancel my subscription today.' }),
      { authorization: `Bearer ${ingestToken}` },
    );

    const operator = await api('GET', '/v1/tenants/tenant-a/packets', undefined, {
      authorization: `Bearer ${operatorToken}`,
    });
    expect(operator.status).toBe(200);
    const categories = operator.json.packets.map((p: any) => p.category);
    expect(categories).toContain('cancellation');
    expect(operator.json.packets.length).toBe(4); // original + 2 amendments + cancellation
    // Summaries carry no PII fields.
    expect(JSON.stringify(operator.json)).not.toContain('Jamie Doe');

    const bot = await api('GET', '/v1/tenants/tenant-a/packets', undefined, {
      authorization: `Bearer ${botToken}`,
    });
    expect(bot.json.packets.every((p: any) => p.category === 'complaint')).toBe(true);
    expect(bot.json.packets.length).toBe(3);
  });

  it('rejects unauthenticated and cross-tenant access', async () => {
    expect((await api('GET', `/v1/tenants/tenant-a/packets/${packetId}`)).status).toBe(401);
    expect(
      (
        await api('GET', `/v1/tenants/tenant-b/audit`, undefined, {
          authorization: `Bearer ${botToken}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('GET', `/v1/tenants/tenant-a/packets/nope`, undefined, {
          authorization: `Bearer ${botToken}`,
        })
      ).status,
    ).toBe(404);
  });
});
