/** GraphQL read surface + OpenAPI spec endpoint, over the full platform. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';

let platform: Platform;
let adminSecret: string;

const gql = (query: string, secret = adminSecret) =>
  platform.app.inject({
    method: 'POST',
    url: '/graphql',
    headers: { authorization: `Bearer ${secret}` },
    payload: { query },
  });

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acorn-gql-'));
  platform = buildPlatform(
    configFromEnv({ dataDir: tmp, outboxDir: join(tmp, 'outbox'), baseUrl: 'http://gql.local', port: 0 }),
  );
  await platform.app.ready();

  const tenant = await platform.app.inject({
    method: 'POST',
    url: '/v1/tenants',
    payload: { name: 'GQL Test Co' },
  });
  adminSecret = tenant.json().adminKey.secret;
  await platform.app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: { authorization: `Bearer ${adminSecret}` },
    payload: { name: 'Quinn Query', email: 'quinn@example.com', locale: 'en-US' },
  });
});

afterAll(async () => {
  await platform.app.close();
});

describe('graphql endpoint', () => {
  it('answers a composite read query', async () => {
    const res = await gql('{ overview { communications delivered } customers { id name email } }');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toBeUndefined();
    expect(body.data.overview.communications).toBe(0);
    expect(body.data.customers).toHaveLength(1);
    expect(body.data.customers[0].name).toBe('Quinn Query');
  });

  it('lists templates and serves the SDL', async () => {
    const res = await gql('{ templates { id key published } }');
    expect(res.json().data.templates).toEqual([]);

    const sdlRes = await platform.app.inject({
      method: 'GET',
      url: '/graphql/schema',
      headers: { authorization: `Bearer ${adminSecret}` },
    });
    expect(sdlRes.statusCode).toBe(200);
    expect(sdlRes.body).toContain('type Query');
  });

  it('rejects mutations, oversized and over-deep queries', async () => {
    const mutation = await gql('mutation { anything }');
    expect(mutation.statusCode).toBe(400);

    const deep = await gql('{ a { b { c { d { e { f { g { h { i { j } } } } } } } } } }');
    expect(deep.statusCode).toBe(400);

    const huge = await gql(`{ overview { communications } } ${'#'.repeat(10_001)}`);
    expect(huge.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await platform.app.inject({
      method: 'POST',
      url: '/graphql',
      payload: { query: '{ overview { communications } }' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('surfaces resolver errors GraphQL-style (transport 200)', async () => {
    const res = await gql('{ communication(id: "com_missing") { id status } }');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.communication).toBeNull();
  });
});

describe('openapi spec', () => {
  it('serves a public OpenAPI 3.1 document covering the surface', async () => {
    const res = await platform.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi.startsWith('3.1')).toBe(true);
    expect(doc.info.title).toContain('Acorn Communicate');
    for (const path of ['/v1/communications', '/v1/templates', '/graphql', '/v1/print-batches', '/v1/journeys']) {
      expect(Object.keys(doc.paths)).toContain(path);
    }
  });
});
