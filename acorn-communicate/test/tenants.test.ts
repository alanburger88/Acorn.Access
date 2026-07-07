import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import type { RequestCtx } from '../src/kernel/contracts.js';
import { createTenantService } from '../src/domains/tenants/index.js';

describe('tenants domain', () => {
  let ctx: PlatformContext;
  let adminSecret: string;
  let adminKeyId: string;
  let tenantId: string;
  let adminCtx: RequestCtx;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.tenants = createTenantService(ctx);
  });

  it('creates a tenant with defaults and a bootstrap admin key', () => {
    const { tenant, adminKey } = ctx.services.tenants.createTenant({
      name: 'First Acorn Bank',
      industry: 'banking',
    });
    tenantId = tenant.id;
    adminSecret = adminKey.secret;
    adminKeyId = adminKey.id;

    expect(tenant.id).toMatch(/^ten_/);
    expect(tenant.tenantId).toBe(tenant.id);
    expect(tenant.settings.defaultLocale).toBe('en-US');
    expect(tenant.settings.aiEnabled).toBe(true);
    expect(adminKey.secret).toBeTruthy();
    expect(adminKey.id).toMatch(/^key_/);
  });

  it('authenticates the admin secret (roundtrip)', () => {
    const rctx = ctx.services.tenants.authenticate(adminSecret);
    expect(rctx).toBeDefined();
    expect(rctx!.tenantId).toBe(tenantId);
    expect(rctx!.keyId).toBe(adminKeyId);
    expect(rctx!.roles).toContain('tenant-admin');
    expect(rctx!.actorId).toMatch(/^usr_/);
    adminCtx = rctx!;
  });

  it('returns undefined for a wrong secret', () => {
    expect(ctx.services.tenants.authenticate('definitely-not-a-key')).toBeUndefined();
  });

  it('rejects createApiKey without tenant-admin role (SoD)', () => {
    const nonAdmin: RequestCtx = { ...adminCtx, roles: ['operator'] };
    expect(() =>
      ctx.services.tenants.createApiKey(nonAdmin, { name: 'sneaky', roles: ['tenant-admin'] }),
    ).toThrowError(PlatformError);
    try {
      ctx.services.tenants.createApiKey(nonAdmin, { name: 'sneaky', roles: ['tenant-admin'] });
    } catch (err) {
      expect((err as PlatformError).status).toBe(403);
    }
  });

  it('a revoked key no longer authenticates', () => {
    const { key, secret } = ctx.services.tenants.createApiKey(adminCtx, {
      name: 'ops',
      roles: ['operator'],
    });
    expect(ctx.services.tenants.authenticate(secret)).toBeDefined();
    ctx.services.tenants.revokeApiKey(adminCtx, key.id);
    expect(ctx.services.tenants.authenticate(secret)).toBeUndefined();
  });

  it('consent defaults to allow (transactional) and explicit deny blocks', () => {
    const customer = ctx.services.tenants.createCustomer(adminCtx, {
      name: 'Casey Customer',
      email: 'casey@example.com',
      locale: 'en-US',
    });

    // implied consent for service communications when no record exists
    expect(ctx.services.tenants.hasConsent(tenantId, customer.id, 'email')).toBe(true);
    expect(ctx.services.tenants.hasConsent(tenantId, customer.id, 'print')).toBe(true);

    ctx.services.tenants.recordConsent(adminCtx, {
      customerId: customer.id,
      channel: 'email',
      purpose: 'transactional',
      granted: false,
      source: 'preference-center',
    });
    expect(ctx.services.tenants.hasConsent(tenantId, customer.id, 'email')).toBe(false);

    // latest record wins
    ctx.services.tenants.recordConsent(adminCtx, {
      customerId: customer.id,
      channel: 'email',
      purpose: 'transactional',
      granted: true,
      source: 'preference-center',
    });
    expect(ctx.services.tenants.hasConsent(tenantId, customer.id, 'email')).toBe(true);
  });

  it('preferredChannels falls back to email,secure-link and honors preferences', () => {
    const customer = ctx.services.tenants.createCustomer(adminCtx, {
      name: 'Pat Prefers',
      locale: 'en-GB',
    });
    expect(ctx.services.tenants.preferredChannels(tenantId, customer.id)).toEqual([
      'email',
      'secure-link',
    ]);

    ctx.services.tenants.setPreferences(adminCtx, customer.id, {
      channelPriority: ['sms', 'email'],
      paperless: true,
    });
    expect(ctx.services.tenants.preferredChannels(tenantId, customer.id)).toEqual(['sms', 'email']);
    const prefs = ctx.services.tenants.getPreferences(adminCtx, customer.id);
    expect(prefs?.paperless).toBe(true);
  });

  it('rejects an invalid customer email', () => {
    expect(() =>
      ctx.services.tenants.createCustomer(adminCtx, {
        name: 'Bad Email',
        email: 'not-an-email',
        locale: 'en-US',
      }),
    ).toThrowError(PlatformError);
  });

  it('getCustomer throws notFound for unknown id', () => {
    try {
      ctx.services.tenants.getCustomer(adminCtx, 'cus_missing');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(404);
      expect((err as PlatformError).code).toBe('not-found');
    }
  });
});
