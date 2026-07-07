/**
 * Regression tests for a batch of security / correctness fixes:
 *  (a) OTP brute-force lockout on secure links (viewer.resolveLink)
 *  (b) webhook list omits the HMAC secret it returns once on subscribe
 *  (c) rate-limit bucket map is memory-bounded (MAX_BUCKETS eviction)
 *  (d) mapping setPath refuses prototype-pollution paths
 *  (e) CSV coercion keeps leading-zero identifiers as strings
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPlatform, type Platform } from '../src/server.js';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type { Communication, Customer, SecureLink, ViewerService } from '../src/kernel/contracts.js';
import { createViewerService } from '../src/domains/viewer/index.js';
import { createUsageService } from '../src/domains/usage/index.js';
import { setPath } from '../src/domains/mapping/transforms.js';
import { parseCsv } from '../src/domains/ingestion/csv.js';

// ---------------------------------------------------------------------------
// (a) OTP brute-force lockout
// ---------------------------------------------------------------------------

describe('OTP brute-force lockout (viewer.resolveLink)', () => {
  const TENANT = 'ten_otp';
  const COM = 'com_otp';
  const CUS = 'cus_otp';
  let ctx: PlatformContext;
  let viewer: ViewerService;
  const linkRow = (id: string): SecureLink | undefined =>
    ctx.store.collection<SecureLink>('secureLinks').get(id);

  const future = new Date(Date.now() + 86_400_000).toISOString();

  function mkLink(id: string, token: string, otpCode: string): SecureLink {
    return {
      id,
      tenantId: TENANT,
      communicationId: COM,
      customerId: CUS,
      token,
      otpCode,
      expiresAt: future,
      createdAt: new Date().toISOString(),
    };
  }

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-sec-')) }));
    ctx.store.collection<Communication>('communications').put({
      id: COM,
      tenantId: TENANT,
      customerId: CUS,
      status: 'delivered',
      composed: { intendedOutcome: 'payment_completed' },
    } as unknown as Communication);
    const links = ctx.store.collection<SecureLink>('secureLinks');
    links.put(mkLink('lnk_lock', 'tok-lock', '123456'));
    links.put(mkLink('lnk_good', 'tok-good', '654321'));
    viewer = createViewerService(ctx);
    ctx.services.viewer = viewer;
  });

  it('revokes the link after 5 wrong codes and persists revokedAt', () => {
    // First four wrong attempts: rejected as otp-invalid, link still live.
    for (let i = 1; i <= 4; i++) {
      expect(viewer.resolveLink('tok-lock', '000000')).toEqual({ ok: false, reason: 'otp-invalid' });
      expect(linkRow('lnk_lock')?.revokedAt).toBeUndefined();
    }
    // Fifth wrong attempt trips the lockout.
    expect(viewer.resolveLink('tok-lock', '000000')).toEqual({ ok: false, reason: 'revoked' });

    const row = ctx.store.collection<SecureLink>('secureLinks').get('lnk_lock');
    expect(row?.revokedAt).toBeTruthy();
    // Once revoked, even the correct code is refused (revoked check precedes otp).
    expect(viewer.resolveLink('tok-lock', '123456')).toEqual({ ok: false, reason: 'revoked' });
  });

  it('a correct code before lockout resolves normally', () => {
    const resolved = viewer.resolveLink('tok-good', '654321');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.communication.id).toBe(COM);
  });
});

// ---------------------------------------------------------------------------
// (b) webhook list must not re-expose the HMAC secret
// ---------------------------------------------------------------------------

describe('webhook list omits the HMAC secret', () => {
  let platform: Platform;
  let adminSecret: string;
  const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

  beforeAll(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-wh-'));
    platform = buildPlatform(
      configFromEnv({
        dataDir: tmp,
        outboxDir: join(tmp, 'outbox'),
        baseUrl: 'http://wh.local',
        port: 0,
        anthropicApiKey: undefined,
      }),
    );
    await platform.app.ready();
    const tenant = await platform.app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Webhook Corp' },
    });
    adminSecret = tenant.json().adminKey.secret;
  });

  afterAll(async () => {
    await platform.app.close();
  });

  it('subscribe returns the secret once, but GET /v1/webhooks never does', async () => {
    const sub = await platform.app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: auth(adminSecret),
      payload: { url: 'https://example.com/hook', events: ['*'] },
    });
    expect([200, 201]).toContain(sub.statusCode);
    // POST response DID include the secret.
    expect(typeof sub.json().secret).toBe('string');
    expect(sub.json().secret.length).toBeGreaterThan(0);

    const list = await platform.app.inject({
      method: 'GET',
      url: '/v1/webhooks',
      headers: auth(adminSecret),
    });
    expect(list.statusCode).toBe(200);
    const items = list.json() as Record<string, unknown>[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const item of items) {
      expect('secret' in item).toBe(false);
      expect(item.url).toBe('https://example.com/hook');
    }
  });
});

// ---------------------------------------------------------------------------
// (c) rate-limit bucket cap (memory-DoS guard)
// ---------------------------------------------------------------------------

describe('rate-limit bucket map is memory-bounded', () => {
  it('evicts oldest buckets past MAX_BUCKETS while staying correct for fresh keys', () => {
    const usage = createUsageService(
      createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-rl-')) })),
    );

    // Hammer 10_100 distinct keys — well past the 10_000 bucket cap. Each key
    // is seen exactly once, so its count is 1 while it lives in the map.
    for (let i = 0; i < 10_100; i++) usage.checkRateLimit(`k${i}`);

    // A brand-new key still gets a correct, fresh window (proves the map is
    // still usable and not corrupted by the eviction sweep).
    const fresh = usage.checkRateLimit('brand-new-key');
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(fresh.limit - 1);

    // An EARLY key ('k0') was evicted to honour the cap: re-calling it behaves
    // as a brand-new window (count resets to 1 -> remaining === limit - 1). Had
    // its bucket survived, this second hit would report remaining === limit - 2.
    const early = usage.checkRateLimit('k0');
    expect(early.remaining).toBe(early.limit - 1);
  });
});

// ---------------------------------------------------------------------------
// (d) setPath prototype-pollution guard
// ---------------------------------------------------------------------------

describe('setPath refuses prototype-pollution paths', () => {
  it('ignores __proto__ and constructor.prototype targets, leaves globals clean', () => {
    const a: Record<string, unknown> = {};
    setPath(a, '__proto__.polluted', true);
    setPath(a, 'constructor.prototype.x', 1);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    // The guard is a no-op: nothing was written onto the target object either.
    expect(a).toEqual({});

    // A normal nested path still works.
    const b: Record<string, unknown> = {};
    setPath(b, 'a.b.c', 5);
    expect(b).toEqual({ a: { b: { c: 5 } } });
  });
});

// ---------------------------------------------------------------------------
// (e) CSV leading-zero coercion
// ---------------------------------------------------------------------------

describe('CSV coercion preserves leading-zero identifiers', () => {
  it("keeps '00123' a string while '123' and '0' coerce to numbers", () => {
    const rows = parseCsv('account,plain,zeroval\n00123,123,0');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.account).toBe('00123');
    expect(typeof row.account).toBe('string');
    expect(row.plain).toBe(123);
    expect(row.zeroval).toBe(0);
  });
});
