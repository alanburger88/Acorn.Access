/** MCP stdio server: protocol handshake, allow-listed tools, RBAC, audit. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { wireServices } from '../src/wiring.js';
import { createMcpHandler } from '../src/mcp/server.js';
import { AUDIT_EVENT_TYPE } from '../src/mcp/tools.js';
import type { RequestCtx } from '../src/kernel/contracts.js';

let ctx: PlatformContext;
let admin: RequestCtx;
let handler: (line: string) => Promise<string | undefined>;
let nextId = 0;

const rpc = async (method: string, params?: unknown) => {
  const line = JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params });
  const raw = await handler(line);
  return raw ? JSON.parse(raw) : undefined;
};
const callTool = async (name: string, args?: unknown) =>
  (await rpc('tools/call', { name, arguments: args })).result;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'acorn-mcp-'));
  ctx = createBaseContext(configFromEnv({ dataDir: tmp, outboxDir: join(tmp, 'outbox'), port: 0 }));
  wireServices(ctx);
  const { adminKey } = ctx.services.tenants.createTenant({ name: 'MCP Test Co' });
  admin = ctx.services.tenants.authenticate(adminKey.secret)!;
  ctx.services.tenants.createCustomer(admin, { name: 'Mo Model', email: 'mo@example.com', locale: 'en-US' });
  handler = createMcpHandler(ctx, admin);
});

describe('mcp protocol', () => {
  it('performs the initialize handshake', async () => {
    const res = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    expect(res.result.protocolVersion).toBe('2025-06-18');
    expect(res.result.serverInfo.name).toBe('acorn-os');
    // notification gets no response
    expect(await handler(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toBeUndefined();
  });

  it('lists at least 12 allow-listed tools with schemas', async () => {
    const res = await rpc('tools/list');
    expect(res.result.tools.length).toBeGreaterThanOrEqual(12);
    for (const tool of res.result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
    const names = res.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('explain_communication');
    expect(names).not.toContain('initiate_delivery'); // sensitive action excluded
  });

  it('handles malformed input and unknown methods without crashing', async () => {
    const bad = JSON.parse((await handler('this is not json'))!);
    expect(bad.error.code).toBe(-32700);
    const unknown = await rpc('resources/list');
    expect(unknown.error.code).toBe(-32601);
  });
});

describe('mcp tools', () => {
  it('executes read tools against the real platform', async () => {
    const templates = await callTool('list_templates');
    expect(templates.isError).toBeFalsy();
    expect(JSON.parse(templates.content[0].text)).toEqual([]);

    const overview = await callTool('get_analytics_overview');
    expect(JSON.parse(overview.content[0].text).communications).toBe(0);

    const comms = await callTool('search_communications', {});
    expect(JSON.parse(comms.content[0].text)).toEqual([]);
  });

  it('returns in-band errors instead of protocol failures', async () => {
    const missing = await callTool('generate_evidence_pack', { communicationId: 'com_missing' });
    expect(missing.isError).toBe(true);

    const unknownTool = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
    expect(unknownTool.result?.isError ?? unknownTool.error !== undefined).toBeTruthy();
  });

  it('enforces least privilege on sensitive tools', async () => {
    const dev: RequestCtx = { ...admin, roles: ['developer'] };
    const devHandler = createMcpHandler(ctx, dev);
    const raw = await devHandler(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 999,
        method: 'tools/call',
        params: { name: 'generate_evidence_pack', arguments: { communicationId: 'com_x' } },
      }),
    );
    const res = JSON.parse(raw!);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('permission denied');
  });

  it('marks drafts as requiring human approval', async () => {
    const draft = await callTool('draft_content', {
      instruction: 'improve readability',
      baseText: 'You must remit payment prior to the due date.',
    });
    expect(draft.isError).toBeFalsy();
    expect(draft.content[0].text.toLowerCase()).toContain('human review');
  });

  it('audits every tool invocation to the event log', async () => {
    const audits = ctx.log.query(admin.tenantId, { type: AUDIT_EVENT_TYPE });
    expect(audits.length).toBeGreaterThanOrEqual(5);
    const data = audits.at(-1)!.data as { tool: string; actorId: string };
    expect(data.tool).toBeTruthy();
    expect(data.actorId).toBe(admin.actorId);
  });
});
