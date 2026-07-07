import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';

let platform: Platform;
let adminSecret: string;

const auth = () => ({ authorization: `Bearer ${adminSecret}` });

interface ParsedSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const SAMPLE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{((?:[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*",?)*)\})? (-?(?:[0-9]*\.)?[0-9]+(?:[eE][+-]?[0-9]+)?)$/;

/** Parse the exposition body line-by-line, asserting every sample line matches. */
function parseExposition(body: string): ParsedSample[] {
  const samples: ParsedSample[] = [];
  for (const line of body.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('# HELP ') || line.startsWith('# TYPE ')) continue;
    const m = SAMPLE_RE.exec(line);
    expect(m, `exposition line does not parse: ${JSON.stringify(line)}`).toBeTruthy();
    const labels: Record<string, string> = {};
    for (const pair of m![2]?.match(/[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*"/g) ?? []) {
      const eq = pair.indexOf('=');
      labels[pair.slice(0, eq)] = pair.slice(eq + 2, -1);
    }
    samples.push({ name: m![1]!, labels, value: Number(m![3]) });
  }
  return samples;
}

function find(samples: ParsedSample[], name: string, labels: Record<string, string> = {}) {
  return samples.find(
    (s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v),
  );
}

async function scrape(): Promise<{ body: string; samples: ParsedSample[] }> {
  // inject requests originate from 127.0.0.1 → loopback exemption, no auth
  const res = await platform.app.inject({ method: 'GET', url: '/metrics' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
  return { body: res.body, samples: parseExposition(res.body) };
}

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'acorn-metrics-'));
  platform = buildPlatform(configFromEnv({ dataDir: tmp, port: 0, baseUrl: 'http://mx.local' }));
  await platform.app.ready();
  const res = await platform.app.inject({
    method: 'POST',
    url: '/v1/tenants',
    payload: { name: 'Metrics Tenant', industry: 'banking' },
  });
  expect([200, 201]).toContain(res.statusCode);
  adminSecret = res.json().adminKey.secret;
});

afterAll(async () => {
  await platform.app.close();
});

describe('observability: request ids + /metrics', () => {
  it('sets x-request-id on normal responses and echoes a sane inbound id', async () => {
    const res = await platform.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();

    const echoed = await platform.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: { ...auth(), 'x-request-id': 'my-trace-1' },
    });
    expect(echoed.statusCode).toBe(200);
    expect(echoed.headers['x-request-id']).toBe('my-trace-1');

    // garbage inbound ids are regenerated, never reflected
    const bad = await platform.app.inject({
      method: 'GET',
      url: '/v1/templates',
      headers: { ...auth(), 'x-request-id': 'has spaces and "quotes"' },
    });
    expect(bad.headers['x-request-id']).toBeTruthy();
    expect(bad.headers['x-request-id']).not.toBe('has spaces and "quotes"');
    expect(String(bad.headers['x-request-id'])).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });

  it('exposes http, event, collection, and process metrics on /metrics', async () => {
    // traffic: one 404 and one customer creation on top of the templates GETs above
    const missing = await platform.app.inject({
      method: 'GET',
      url: '/v1/definitely-not-a-route',
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);

    const cust = await platform.app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: auth(),
      payload: { name: 'Metric Customer', email: 'metric@example.com', locale: 'en-US' },
    });
    expect([200, 201]).toContain(cust.statusCode);

    const { samples } = await scrape();

    // http request counter with route PATTERN, method, status
    const templatesOk = find(samples, 'acorn_http_requests_total', {
      method: 'GET',
      route: '/v1/templates',
      status: '200',
    });
    expect(templatesOk).toBeDefined();
    expect(templatesOk!.value).toBeGreaterThanOrEqual(1);

    // 404s recorded (collapsed under the 'unmatched' route label)
    const notFound = samples.find(
      (s) => s.name === 'acorn_http_requests_total' && s.labels.status === '404',
    );
    expect(notFound).toBeDefined();
    expect(notFound!.labels.route).toBe('unmatched');

    // cumulative duration sum/count
    const durCount = find(samples, 'acorn_http_request_duration_seconds_count', {
      method: 'GET',
      route: '/v1/templates',
    });
    expect(durCount).toBeDefined();
    expect(durCount!.value).toBeGreaterThanOrEqual(1);
    const durSum = find(samples, 'acorn_http_request_duration_seconds_sum', {
      method: 'GET',
      route: '/v1/templates',
    });
    expect(durSum).toBeDefined();
    expect(durSum!.value).toBeGreaterThanOrEqual(0);

    // event counter with stripped + truncated type label
    const tenantCreated = find(samples, 'acorn_events_total', { type: 'tenant.created' });
    expect(tenantCreated).toBeDefined();
    expect(tenantCreated!.value).toBeGreaterThanOrEqual(1);

    // collection gauge: exactly the one customer created above
    const customers = find(samples, 'acorn_collection_documents', { collection: 'customers' });
    expect(customers).toBeDefined();
    expect(customers!.value).toBe(1);

    // process gauges present
    expect(find(samples, 'acorn_process_uptime_seconds')!.value).toBeGreaterThan(0);
    expect(find(samples, 'acorn_process_resident_memory_bytes')!.value).toBeGreaterThan(0);
    expect(find(samples, 'acorn_process_heap_used_bytes')!.value).toBeGreaterThan(0);

    // the scrape endpoint itself is never counted
    expect(samples.some((s) => s.labels.route === '/metrics')).toBe(false);
  });

  it('exposition includes HELP/TYPE lines per family with valid types', async () => {
    const { body } = await scrape();
    const lines = body.split('\n').filter(Boolean);
    const typeLines = lines.filter((l) => l.startsWith('# TYPE '));
    expect(typeLines.length).toBeGreaterThanOrEqual(5);
    for (const l of typeLines) {
      expect(l).toMatch(/^# TYPE [a-zA-Z_:][a-zA-Z0-9_:]* (counter|gauge)$/);
    }
    for (const name of [
      'acorn_http_requests_total',
      'acorn_events_total',
      'acorn_collection_documents',
    ]) {
      expect(lines).toContain(
        `# TYPE ${name} ${name === 'acorn_collection_documents' ? 'gauge' : 'counter'}`,
      );
      expect(lines.some((l) => l.startsWith(`# HELP ${name} `))).toBe(true);
    }
  });

  it('counters are monotonically non-decreasing across scrapes', async () => {
    const first = await scrape();
    // more traffic between scrapes
    await platform.app.inject({ method: 'GET', url: '/v1/templates', headers: auth() });
    const second = await scrape();

    const counterNames = [
      'acorn_http_requests_total',
      'acorn_http_request_duration_seconds_sum',
      'acorn_http_request_duration_seconds_count',
      'acorn_events_total',
    ];
    for (const before of first.samples.filter((s) => counterNames.includes(s.name))) {
      const after = second.samples.find(
        (s) =>
          s.name === before.name &&
          JSON.stringify(Object.entries(s.labels).sort()) ===
            JSON.stringify(Object.entries(before.labels).sort()),
      );
      expect(after, `${before.name} sample disappeared`).toBeDefined();
      expect(after!.value).toBeGreaterThanOrEqual(before.value);
    }
    // and traffic between the scrapes actually incremented the route counter
    const beforeVal = find(first.samples, 'acorn_http_requests_total', {
      route: '/v1/templates',
      method: 'GET',
      status: '200',
    })!.value;
    const afterVal = find(second.samples, 'acorn_http_requests_total', {
      route: '/v1/templates',
      method: 'GET',
      status: '200',
    })!.value;
    expect(afterVal).toBe(beforeVal + 1);
  });

  it('rejects non-loopback scrapes without a valid bearer key, allows with one', async () => {
    const denied = await platform.app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.1.2.3',
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await platform.app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.1.2.3',
      headers: auth(),
    });
    expect(allowed.statusCode).toBe(200);
  });
});
