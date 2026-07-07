/**
 * TENANTS bounded context — tenancy, API-key identity/access, brands,
 * customers, consent and communication preferences.
 *
 * Exposes `createTenantService` (implements TenantService from
 * kernel/contracts.ts) and `registerTenantRoutes` (/v1 HTTP surface).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ApiKey,
  Brand,
  Channel,
  ConsentRecord,
  Customer,
  PreferenceRecord,
  RequestCtx,
  Role,
  Tenant,
  TenantService,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId, newSecret } from '../../kernel/ids.js';

const SOURCE = '/domains/tenants';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_CHANNELS: Channel[] = ['email', 'secure-link'];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createTenantService(ctx: PlatformContext): TenantService {
  const tenants = ctx.store.collection<Tenant>('tenants');
  const apiKeys = ctx.store.collection<ApiKey>('apiKeys');
  const brands = ctx.store.collection<Brand>('brands');
  const customers = ctx.store.collection<Customer>('customers');
  const consents = ctx.store.collection<ConsentRecord>('consents');
  const preferences = ctx.store.collection<PreferenceRecord>('preferences');

  function requireAdmin(rctx: RequestCtx): void {
    if (!rctx.roles.includes('tenant-admin')) {
      throw forbidden('requires role tenant-admin');
    }
  }

  function mintKey(tenantId: string, args: { name: string; roles: Role[]; actorId?: string }): {
    key: ApiKey;
    secret: string;
  } {
    const secret = newSecret();
    const key: ApiKey = {
      id: newId('key'),
      tenantId,
      name: args.name,
      secretHash: sha256(secret),
      roles: args.roles,
      actorId: args.actorId ?? newId('usr'),
      createdAt: new Date().toISOString(),
    };
    apiKeys.put(key);
    return { key, secret };
  }

  const service: TenantService = {
    createTenant(args) {
      const id = newId('ten');
      const tenant: Tenant = {
        id,
        tenantId: id,
        name: args.name,
        industry: args.industry,
        createdAt: new Date().toISOString(),
        settings: { defaultLocale: 'en-US', aiEnabled: true },
      };
      tenants.put(tenant);
      // Bootstrap admin key: the secret is returned exactly once here.
      const { key, secret } = mintKey(id, { name: 'bootstrap-admin', roles: ['tenant-admin'] });
      void ctx.publish({
        type: 'com.acorn.tenant.created',
        tenantId: id,
        source: SOURCE,
        subject: id,
        data: { tenantId: id, name: tenant.name, industry: tenant.industry },
      });
      return { tenant, adminKey: { id: key.id, secret } };
    },

    getTenant(tenantId) {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw notFound('tenant', tenantId);
      return tenant;
    },

    createApiKey(rctx, args) {
      requireAdmin(rctx);
      return mintKey(rctx.tenantId, { name: args.name, roles: args.roles });
    },

    revokeApiKey(rctx, keyId) {
      requireAdmin(rctx);
      const key = apiKeys.getFor(rctx.tenantId, keyId);
      if (!key) throw notFound('api key', keyId);
      apiKeys.put({ ...key, revokedAt: new Date().toISOString() });
    },

    authenticate(secret) {
      const hash = sha256(secret);
      const key = apiKeys
        .listAll((k) => k.secretHash === hash && !k.revokedAt)
        .at(0);
      if (!key) return undefined;
      return { tenantId: key.tenantId, actorId: key.actorId, roles: key.roles, keyId: key.id };
    },

    createBrand(rctx, args) {
      const brand: Brand = { id: newId('brd'), tenantId: rctx.tenantId, ...args };
      return brands.put(brand);
    },

    listBrands(rctx) {
      return brands.list(rctx.tenantId);
    },

    createCustomer(rctx, args) {
      if (args.email !== undefined && !EMAIL_RE.test(args.email)) {
        throw invalid(`invalid email format: ${args.email}`);
      }
      const customer: Customer = {
        id: newId('cus'),
        tenantId: rctx.tenantId,
        createdAt: new Date().toISOString(),
        ...args,
      };
      customers.put(customer);
      void ctx.publish({
        type: 'com.acorn.customer.created',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: customer.id,
        data: { customerId: customer.id, name: customer.name, externalRef: customer.externalRef },
      });
      return customer;
    },

    getCustomer(rctx, id) {
      const customer = customers.getFor(rctx.tenantId, id);
      if (!customer) throw notFound('customer', id);
      return customer;
    },

    listCustomers(rctx) {
      return customers.list(rctx.tenantId);
    },

    recordConsent(rctx, args) {
      // ensure the customer exists (throws notFound otherwise)
      service.getCustomer(rctx, args.customerId);
      const record: ConsentRecord = {
        id: newId('cns'),
        tenantId: rctx.tenantId,
        recordedAt: new Date().toISOString(),
        ...args,
      };
      consents.put(record);
      void ctx.publish({
        type: 'com.acorn.consent.recorded',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: record.id,
        data: {
          consentId: record.id,
          customerId: record.customerId,
          channel: record.channel,
          purpose: record.purpose,
          granted: record.granted,
        },
      });
      return record;
    },

    getConsents(rctx, customerId) {
      return consents.list(rctx.tenantId, (r) => r.customerId === customerId);
    },

    setPreferences(rctx, customerId, args) {
      // ensure the customer exists (throws notFound otherwise)
      service.getCustomer(rctx, customerId);
      const existing = preferences
        .list(rctx.tenantId, (p) => p.customerId === customerId)
        .at(0);
      const record: PreferenceRecord = {
        id: existing?.id ?? newId('prf'),
        tenantId: rctx.tenantId,
        customerId,
        channelPriority: args.channelPriority,
        language: args.language ?? existing?.language,
        paperless: args.paperless ?? existing?.paperless ?? false,
        updatedAt: new Date().toISOString(),
      };
      preferences.put(record);
      void ctx.publish({
        type: 'com.acorn.preference.updated',
        tenantId: rctx.tenantId,
        source: SOURCE,
        subject: record.id,
        data: {
          preferenceId: record.id,
          customerId,
          channelPriority: record.channelPriority,
          paperless: record.paperless,
        },
      });
      return record;
    },

    getPreferences(rctx, customerId) {
      return preferences.list(rctx.tenantId, (p) => p.customerId === customerId).at(0);
    },

    hasConsent(tenantId, customerId, channel, purpose = 'transactional') {
      const records = consents
        .list(
          tenantId,
          (r) => r.customerId === customerId && r.channel === channel && r.purpose === purpose,
        )
        // latest record wins: order by recordedAt, tie-broken by ULID id
        // (monotonic within process)
        .sort((a, b) =>
          a.recordedAt === b.recordedAt
            ? a.id.localeCompare(b.id)
            : a.recordedAt.localeCompare(b.recordedAt),
        );
      const latest = records.at(-1);
      if (latest) return latest.granted;
      // No consent record on file:
      // - transactional (service) communications carry IMPLIED consent — the
      //   customer has a business relationship with the tenant and must
      //   receive statements, bills and notices on any channel (incl. print).
      // - marketing communications require EXPLICIT opt-in — no record means
      //   no consent (GDPR/CCPA/CAN-SPAM/TCPA posture, platform/06).
      return purpose === 'transactional';
    },

    preferredChannels(tenantId, customerId) {
      const prefs = preferences.list(tenantId, (p) => p.customerId === customerId).at(0);
      if (prefs && prefs.channelPriority.length > 0) return prefs.channelPriority;
      return DEFAULT_CHANNELS;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const channelSchema = z.enum(['email', 'sms', 'secure-link', 'webhook', 'print']);

const roleSchema = z.enum([
  'tenant-admin',
  'business-author',
  'designer',
  'compliance-approver',
  'operator',
  'developer',
  'auditor',
  'service-agent',
]);

const createTenantSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1).optional(),
});

const createApiKeySchema = z.object({
  name: z.string().min(1),
  roles: z.array(roleSchema).min(1),
});

const createBrandSchema = z.object({
  name: z.string().min(1),
  primaryColor: z.string().min(1),
  accentColor: z.string().min(1),
  logoText: z.string().min(1),
  fromEmail: z.string().email(),
  fromSms: z.string().min(1),
});

const createCustomerSchema = z.object({
  externalRef: z.string().min(1).optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  locale: z.string().min(2).default('en-US'),
  address: z
    .object({
      line1: z.string(),
      city: z.string(),
      region: z.string(),
      postalCode: z.string(),
      country: z.string(),
    })
    .optional(),
});

const recordConsentSchema = z.object({
  channel: channelSchema,
  purpose: z.enum(['transactional', 'marketing']),
  granted: z.boolean(),
  source: z.string().min(1),
});

const setPreferencesSchema = z.object({
  channelPriority: z.array(channelSchema).min(1),
  language: z.string().min(2).optional(),
  paperless: z.boolean().optional(),
});

export function registerTenantRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const tenants = () => ctx.services.tenants;

  // UNAUTHENTICATED bootstrap endpoint. In production this sits behind the
  // control plane (tenant provisioning), never on the public data plane.
  app.post('/v1/tenants', async (req) => {
    const body = parseBody(createTenantSchema, req.body);
    return tenants().createTenant(body);
  });

  app.get('/v1/tenant', async (req) => {
    const rctx = requireAuth(ctx, req);
    return tenants().getTenant(rctx.tenantId);
  });

  app.post('/v1/api-keys', async (req) => {
    const rctx = requireAuth(ctx, req, ['tenant-admin']);
    const body = parseBody(createApiKeySchema, req.body);
    return tenants().createApiKey(rctx, body);
  });

  app.delete('/v1/api-keys/:id', async (req, reply) => {
    const rctx = requireAuth(ctx, req, ['tenant-admin']);
    const { id } = req.params as { id: string };
    tenants().revokeApiKey(rctx, id);
    reply.status(204);
  });

  app.post('/v1/brands', async (req) => {
    const rctx = requireAuth(ctx, req, ['designer']); // tenant-admin passes implicitly
    const body = parseBody(createBrandSchema, req.body);
    return tenants().createBrand(rctx, body);
  });

  app.get('/v1/brands', async (req) => {
    const rctx = requireAuth(ctx, req);
    return tenants().listBrands(rctx);
  });

  app.post('/v1/customers', async (req) => {
    const rctx = requireAuth(ctx, req, ['operator', 'developer']); // + tenant-admin implicitly
    const body = parseBody(createCustomerSchema, req.body);
    return tenants().createCustomer(rctx, body);
  });

  app.get('/v1/customers', async (req) => {
    const rctx = requireAuth(ctx, req);
    return tenants().listCustomers(rctx);
  });

  app.get('/v1/customers/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return tenants().getCustomer(rctx, id);
  });

  app.post('/v1/customers/:id/consents', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(recordConsentSchema, req.body);
    return tenants().recordConsent(rctx, { customerId: id, ...body });
  });

  app.get('/v1/customers/:id/consents', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return tenants().getConsents(rctx, id);
  });

  app.put('/v1/customers/:id/preferences', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const body = parseBody(setPreferencesSchema, req.body);
    return tenants().setPreferences(rctx, id, body);
  });

  app.get('/v1/customers/:id/preferences', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return tenants().getPreferences(rctx, id) ?? null;
  });
}
