/**
 * OpenAPI 3.1 description of the Acorn Communicate REST surface.
 *
 * Hand-authored against the actual route registrations in src/domains/* and
 * src/api/graphql (enumerated from the code, not aspirational). Schema depth
 * is pragmatic: a handful of high-traffic entities are modelled as shared
 * component schemas (Communication, Template, ContentObject, DeliveryAttempt,
 * Problem); everything else uses a generic open object schema — the source of
 * truth for exact shapes is src/kernel/contracts.ts.
 *
 * Served UNAUTHENTICATED at GET /v1/openapi.json — the spec is public;
 * the API it describes is not.
 */
import type { FastifyInstance } from 'fastify';
import type { PlatformContext } from '../kernel/context.js';

type Dict = Record<string, unknown>;

const ref = (name: string): Dict => ({ $ref: `#/components/schemas/${name}` });
const anyObject = ref('AnyObject');
const arrayOf = (schema: Dict): Dict => ({ type: 'array', items: schema });

const pathParam = (name: string, description: string): Dict => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const queryParam = (name: string, description: string, required = false): Dict => ({
  name,
  in: 'query',
  required,
  description,
  schema: { type: 'string' },
});

interface OpArgs {
  tag: string;
  summary: string;
  /** omit auth entirely (public endpoint) */
  public?: boolean;
  parameters?: Dict[];
  requestSchema?: Dict;
  responseSchema?: Dict;
  responseContentType?: string;
}

/** Build one operation object with the shared problem+json error envelope. */
function op(args: OpArgs): Dict {
  const operation: Dict = {
    tags: [args.tag],
    summary: args.summary,
    security: args.public ? [] : [{ bearerAuth: [] }],
    responses: {
      '200': {
        description: 'Success',
        content: {
          [args.responseContentType ?? 'application/json']: {
            schema: args.responseSchema ?? anyObject,
          },
        },
      },
      default: {
        description: 'Error (RFC 9457 problem+json)',
        content: { 'application/problem+json': { schema: ref('Problem') } },
      },
    },
  };
  if (args.parameters?.length) operation.parameters = args.parameters;
  if (args.requestSchema) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: args.requestSchema } },
    };
  }
  return operation;
}

const idParam = pathParam('id', 'Resource id');

export function buildOpenApiDocument(ctx: PlatformContext): Dict {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Acorn Communicate API',
      version: '0.2.0',
      description: [
        'API-first customer communications platform: content, templates,',
        'composition, omnichannel delivery, interactive viewing, analytics,',
        'and compliance archive.',
        '',
        '## Authentication',
        'All /v1 endpoints (except `POST /v1/tenants` bootstrap and this spec)',
        'require `Authorization: Bearer <api-key-secret>`. Create a tenant via',
        '`POST /v1/tenants` to receive an admin key, then mint role-scoped keys',
        'with `POST /v1/api-keys`. Viewer routes under /view and /api/view are',
        'public, authorized by the secure-link token instead.',
        '',
        'Mutations are REST-only; `POST /graphql` is a read-only projection',
        'for composite queries (see platform API strategy).',
      ].join('\n'),
    },
    servers: [{ url: ctx.config.baseUrl, description: 'This deployment' }],
    tags: [
      { name: 'tenants', description: 'Tenant bootstrap, API keys, brands' },
      { name: 'customers', description: 'Customers, consent, channel preferences' },
      { name: 'content', description: 'Approved content objects and versions' },
      { name: 'templates', description: 'Templates, versions, accessibility gate' },
      { name: 'rendering', description: 'Preview rendering' },
      { name: 'communications', description: 'Composition, artifacts, delivery, outcomes' },
      { name: 'deliveries', description: 'Delivery attempts and provider callbacks' },
      { name: 'webhooks', description: 'Event subscriptions and delivery replay' },
      { name: 'analytics', description: 'Outcome metrics, funnels, hotspots, audit chain' },
      { name: 'archive', description: 'Statement of record, evidence packs, legal hold' },
      { name: 'ingestion', description: 'Batch ingestion and PII scanning' },
      { name: 'journeys', description: 'Journey definitions and instances' },
      { name: 'print', description: 'Print batches, pieces, mail events' },
      { name: 'graphql', description: 'Read-only GraphQL projection' },
      { name: 'translations', description: 'Locale variants with human approval and memory' },
      { name: 'experiments', description: 'A/B experiments over template versions' },
      { name: 'usage', description: 'Usage metering and estimated cost (FinOps)' },
      { name: 'ai', description: 'AI authoring drafts (human approval required)' },
      { name: 'migration', description: 'Migration Studio: legacy ingestion, rationalization, parallel-run' },
      { name: 'agent-desk', description: 'Contact-center assist (audited on-behalf actions)' },
      { name: 'lifecycle', description: 'Retention sweeps and GDPR erasure' },
      { name: 'viewer (public)', description: 'Secure-link viewer (token-authorized, no API key)' },
      { name: 'meta', description: 'Service metadata' },
    ],
    paths: {
      // -- tenants ---------------------------------------------------------
      '/v1/tenants': {
        post: op({
          tag: 'tenants',
          summary: 'Bootstrap a tenant (returns the one-time admin API key)',
          public: true,
          requestSchema: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' }, industry: { type: 'string' } },
          },
        }),
      },
      '/v1/tenant': { get: op({ tag: 'tenants', summary: 'Get the current tenant' }) },
      '/v1/api-keys': {
        post: op({
          tag: 'tenants',
          summary: 'Create a role-scoped API key (secret returned once)',
          requestSchema: {
            type: 'object',
            required: ['name', 'roles'],
            properties: {
              name: { type: 'string' },
              roles: arrayOf({ type: 'string' }),
            },
          },
        }),
      },
      '/v1/api-keys/{id}': {
        delete: op({ tag: 'tenants', summary: 'Revoke an API key', parameters: [idParam] }),
      },
      '/v1/brands': {
        post: op({ tag: 'tenants', summary: 'Create a brand', requestSchema: anyObject }),
        get: op({ tag: 'tenants', summary: 'List brands', responseSchema: arrayOf(anyObject) }),
      },

      // -- customers -------------------------------------------------------
      '/v1/customers': {
        post: op({ tag: 'customers', summary: 'Create a customer', requestSchema: anyObject }),
        get: op({ tag: 'customers', summary: 'List customers', responseSchema: arrayOf(anyObject) }),
      },
      '/v1/customers/{id}': {
        get: op({ tag: 'customers', summary: 'Get a customer', parameters: [idParam] }),
      },
      '/v1/customers/{id}/consents': {
        post: op({
          tag: 'customers',
          summary: 'Record a consent decision',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
        get: op({
          tag: 'customers',
          summary: 'List consent records',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/customers/{id}/preferences': {
        put: op({
          tag: 'customers',
          summary: 'Set channel preferences',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
        get: op({ tag: 'customers', summary: 'Get channel preferences', parameters: [idParam] }),
      },
      '/v1/customers/{id}/timeline': {
        get: op({
          tag: 'customers',
          summary: 'Customer event timeline',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },

      // -- content ---------------------------------------------------------
      '/v1/content': {
        post: op({ tag: 'content', summary: 'Create a content object (draft v1)', requestSchema: anyObject }),
        get: op({
          tag: 'content',
          summary: 'List content objects',
          parameters: [queryParam('type', 'Filter by content type')],
          responseSchema: arrayOf(ref('ContentObject')),
        }),
      },
      '/v1/content/{id}': {
        get: op({
          tag: 'content',
          summary: 'Get a content object',
          parameters: [idParam],
          responseSchema: ref('ContentObject'),
        }),
      },
      '/v1/content/{id}/versions': {
        post: op({
          tag: 'content',
          summary: 'Create a new draft version',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
        get: op({
          tag: 'content',
          summary: 'List versions',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/content-versions/{id}/submit': {
        post: op({ tag: 'content', summary: 'Submit a version for review', parameters: [idParam] }),
      },
      '/v1/content-versions/{id}/review': {
        post: op({
          tag: 'content',
          summary: 'Approve or reject a version (segregation of duties enforced)',
          parameters: [idParam],
          requestSchema: {
            type: 'object',
            required: ['decision'],
            properties: {
              decision: { type: 'string', enum: ['approved', 'rejected'] },
              note: { type: 'string' },
            },
          },
        }),
      },
      '/v1/content-search': {
        get: op({
          tag: 'content',
          summary: 'Search approved content',
          parameters: [queryParam('q', 'Search query', true)],
          responseSchema: arrayOf(anyObject),
        }),
      },

      // -- templates -------------------------------------------------------
      '/v1/templates': {
        post: op({ tag: 'templates', summary: 'Create a template (draft v1)', requestSchema: anyObject }),
        get: op({ tag: 'templates', summary: 'List templates', responseSchema: arrayOf(ref('Template')) }),
      },
      '/v1/templates/{id}': {
        get: op({
          tag: 'templates',
          summary: 'Get a template',
          parameters: [idParam],
          responseSchema: ref('Template'),
        }),
      },
      '/v1/templates/{id}/versions': {
        post: op({
          tag: 'templates',
          summary: 'Create a new template version',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
        get: op({
          tag: 'templates',
          summary: 'List template versions',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/template-versions/{id}/publish': {
        post: op({
          tag: 'templates',
          summary: 'Publish a version (blocks on accessibility gate failure with 422)',
          parameters: [idParam],
        }),
      },
      '/v1/template-versions/{id}/accessibility': {
        get: op({ tag: 'templates', summary: 'Run/read the accessibility report', parameters: [idParam] }),
      },
      '/v1/template-versions/{id}/validate-data': {
        post: op({
          tag: 'templates',
          summary: 'Validate a data record against the version data contract',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
      },

      // -- rendering -------------------------------------------------------
      '/v1/renders/preview': {
        post: op({
          tag: 'rendering',
          summary: 'Render a one-off preview (returns the artifact bytes)',
          requestSchema: anyObject,
          responseContentType: 'application/octet-stream',
          responseSchema: { type: 'string', format: 'binary' },
        }),
      },

      // -- communications --------------------------------------------------
      '/v1/communications': {
        post: op({
          tag: 'communications',
          summary: 'Compose (and render) a communication from a published template + data',
          requestSchema: {
            type: 'object',
            required: ['templateId', 'customerId', 'data'],
            properties: {
              templateId: { type: 'string' },
              customerId: { type: 'string' },
              data: { type: 'object' },
              requestedChannels: arrayOf({ type: 'string' }),
            },
          },
          responseSchema: ref('Communication'),
        }),
        get: op({
          tag: 'communications',
          summary: 'List communications',
          parameters: [
            queryParam('customerId', 'Filter by customer'),
            queryParam('templateId', 'Filter by template'),
            queryParam('status', 'Filter by lifecycle status'),
          ],
          responseSchema: arrayOf(ref('Communication')),
        }),
      },
      '/v1/communications/{id}': {
        get: op({
          tag: 'communications',
          summary: 'Get a communication',
          parameters: [idParam],
          responseSchema: ref('Communication'),
        }),
      },
      '/v1/communications/{id}/artifacts': {
        get: op({
          tag: 'communications',
          summary: 'List render artifacts',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/communications/{id}/artifacts/{format}/download': {
        get: op({
          tag: 'communications',
          summary: 'Download an artifact by format',
          parameters: [idParam, pathParam('format', 'Render format (html | pdf | email-html | sms-text | text)')],
          responseContentType: 'application/octet-stream',
          responseSchema: { type: 'string', format: 'binary' },
        }),
      },
      '/v1/communications/{id}/outcome': {
        post: op({
          tag: 'communications',
          summary: 'Mark the intended outcome achieved',
          parameters: [idParam],
          requestSchema: anyObject,
          responseSchema: ref('Communication'),
        }),
      },
      '/v1/communications/{id}/deliver': {
        post: op({
          tag: 'communications',
          summary: 'Deliver via preference-ordered channels with consent + failover',
          parameters: [idParam],
          requestSchema: anyObject,
          responseSchema: arrayOf(ref('DeliveryAttempt')),
        }),
      },
      '/v1/communications/{id}/secure-link': {
        get: op({ tag: 'communications', summary: 'Get the secure viewer link', parameters: [idParam] }),
      },
      '/v1/communications/{id}/timeline': {
        get: op({
          tag: 'communications',
          summary: 'Lifecycle timeline from the tamper-evident event log',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/communications/{id}/recommendations': {
        get: op({
          tag: 'communications',
          summary: 'List next-best-action recommendations',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/communications/{id}/recommendations/refresh': {
        post: op({
          tag: 'communications',
          summary: 'Recompute explainable recommendations',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },

      // -- deliveries ------------------------------------------------------
      '/v1/deliveries': {
        get: op({
          tag: 'deliveries',
          summary: 'List delivery attempts',
          parameters: [queryParam('communicationId', 'Filter by communication')],
          responseSchema: arrayOf(ref('DeliveryAttempt')),
        }),
      },
      '/v1/provider-callbacks': {
        post: op({
          tag: 'deliveries',
          summary: 'Simulated provider receipt callback (delivered/bounced)',
          requestSchema: anyObject,
          responseSchema: ref('DeliveryAttempt'),
        }),
      },

      // -- webhooks --------------------------------------------------------
      '/v1/webhooks': {
        post: op({ tag: 'webhooks', summary: 'Subscribe to platform events', requestSchema: anyObject }),
        get: op({ tag: 'webhooks', summary: 'List subscriptions', responseSchema: arrayOf(anyObject) }),
      },
      '/v1/webhooks/{id}': {
        delete: op({ tag: 'webhooks', summary: 'Unsubscribe', parameters: [idParam] }),
      },
      '/v1/webhook-deliveries': {
        get: op({
          tag: 'webhooks',
          summary: 'List webhook delivery attempts',
          parameters: [queryParam('subscriptionId', 'Filter by subscription')],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/webhook-deliveries/{id}/replay': {
        post: op({ tag: 'webhooks', summary: 'Replay a webhook delivery', parameters: [idParam] }),
      },

      // -- analytics -------------------------------------------------------
      '/v1/analytics/overview': {
        get: op({ tag: 'analytics', summary: 'Outcome metrics overview' }),
      },
      '/v1/analytics/funnel': {
        get: op({
          tag: 'analytics',
          summary: 'Template outcome funnel',
          parameters: [queryParam('templateId', 'Template to report on', true)],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/analytics/hotspots': {
        get: op({
          tag: 'analytics',
          summary: 'Section-level engagement hotspots for a template',
          parameters: [queryParam('templateId', 'Template to report on', true)],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/audit/verify-chain': {
        get: op({ tag: 'analytics', summary: 'Verify the tamper-evident event chain' }),
      },

      // -- archive ---------------------------------------------------------
      '/v1/archive': {
        get: op({
          tag: 'archive',
          summary: 'Search archive records',
          parameters: [
            queryParam('customerId', 'Filter by customer'),
            queryParam('templateId', 'Filter by template'),
          ],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/archive/{communicationId}': {
        get: op({
          tag: 'archive',
          summary: 'Get the statement-of-record for a communication',
          parameters: [pathParam('communicationId', 'Communication id')],
        }),
      },
      '/v1/archive/{communicationId}/evidence-pack': {
        get: op({
          tag: 'archive',
          summary: 'Generate the six-proof evidence pack',
          parameters: [pathParam('communicationId', 'Communication id')],
        }),
      },
      '/v1/archive/{communicationId}/verify': {
        post: op({
          tag: 'archive',
          summary: 'Re-render from the manifest and verify hash reproducibility',
          parameters: [pathParam('communicationId', 'Communication id')],
        }),
      },
      '/v1/archive/records/{recordId}/legal-hold': {
        post: op({
          tag: 'archive',
          summary: 'Set or release legal hold',
          parameters: [pathParam('recordId', 'Archive record id')],
          requestSchema: anyObject,
        }),
      },

      // -- ingestion -------------------------------------------------------
      '/v1/ingestion/batches': {
        post: op({
          tag: 'ingestion',
          summary: 'Ingest a JSON/CSV batch (validate, PII-scan, compose, deliver)',
          requestSchema: anyObject,
        }),
      },
      '/v1/ingestion/jobs': {
        get: op({ tag: 'ingestion', summary: 'List ingestion jobs', responseSchema: arrayOf(anyObject) }),
      },
      '/v1/ingestion/jobs/{id}': {
        get: op({ tag: 'ingestion', summary: 'Get an ingestion job', parameters: [idParam] }),
      },
      '/v1/ingestion/pii-scan': {
        post: op({ tag: 'ingestion', summary: 'Standalone PII/PHI scan of a payload', requestSchema: anyObject }),
      },

      // -- journeys --------------------------------------------------------
      '/v1/journeys': {
        post: op({ tag: 'journeys', summary: 'Create a journey definition', requestSchema: anyObject }),
        get: op({ tag: 'journeys', summary: 'List journeys', responseSchema: arrayOf(anyObject) }),
      },
      '/v1/journeys/{id}': {
        get: op({ tag: 'journeys', summary: 'Get a journey', parameters: [idParam] }),
      },
      '/v1/journeys/{id}/start': {
        post: op({
          tag: 'journeys',
          summary: 'Start a journey instance for a customer',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
      },
      '/v1/journey-instances': {
        get: op({
          tag: 'journeys',
          summary: 'List journey instances',
          parameters: [
            queryParam('journeyId', 'Filter by journey'),
            queryParam('customerId', 'Filter by customer'),
            queryParam('status', 'Filter by status'),
          ],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/journey-instances/{id}': {
        get: op({ tag: 'journeys', summary: 'Get a journey instance', parameters: [idParam] }),
      },
      '/v1/journeys/tick': {
        post: op({ tag: 'journeys', summary: 'Advance instances whose wait deadlines passed' }),
      },

      // -- print -----------------------------------------------------------
      '/v1/print-batches': {
        post: op({
          tag: 'print',
          summary: 'Spool a print batch (householding, presort, IMB, manifest)',
          requestSchema: anyObject,
        }),
        get: op({ tag: 'print', summary: 'List print batches', responseSchema: arrayOf(anyObject) }),
      },
      '/v1/print-batches/{id}': {
        get: op({ tag: 'print', summary: 'Get a print batch', parameters: [idParam] }),
      },
      '/v1/print-batches/{id}/pieces': {
        get: op({
          tag: 'print',
          summary: 'List pieces in a batch',
          parameters: [idParam],
          responseSchema: arrayOf(anyObject),
        }),
      },
      '/v1/print-batches/{id}/manifest': {
        get: op({ tag: 'print', summary: 'Download the spool manifest', parameters: [idParam] }),
      },
      '/v1/print-pieces/{id}/events': {
        post: op({
          tag: 'print',
          summary: 'Record a mail event (printed/mailed/delivered/returned)',
          parameters: [idParam],
          requestSchema: anyObject,
        }),
      },
      '/v1/print-batches/{id}/reconcile': {
        post: op({ tag: 'print', summary: 'Reconcile mailed vs delivered vs returned', parameters: [idParam] }),
      },

      // -- graphql ---------------------------------------------------------
      // -- translations ----------------------------------------------------
      '/v1/content/{id}/translations': {
        post: op({
          tag: 'translations',
          summary: 'Machine-translate approved content into a locale (draft requiring human approval)',
          parameters: [idParam],
          requestSchema: {
            type: 'object',
            required: ['locale'],
            properties: { locale: { type: 'string' } },
          },
        }),
        get: op({ tag: 'translations', summary: 'List translations of a content object', parameters: [idParam] }),
      },
      '/v1/translations': {
        get: op({ tag: 'translations', summary: 'List translations (filter by contentId)' }),
      },
      '/v1/translations/{id}/review': {
        post: op({
          tag: 'translations',
          summary: 'Approve or reject a translation (segregation of duties enforced)',
          parameters: [idParam],
          requestSchema: {
            type: 'object',
            required: ['decision'],
            properties: {
              decision: { type: 'string', enum: ['approved', 'rejected'] },
              note: { type: 'string' },
            },
          },
        }),
      },
      '/v1/translation-memory/stats': {
        get: op({ tag: 'translations', summary: 'Translation memory statistics' }),
      },
      // -- experiments -------------------------------------------------------
      '/v1/experiments': {
        post: op({
          tag: 'experiments',
          summary: 'Create an A/B experiment over template versions (accessibility-gated variants)',
          requestSchema: {
            type: 'object',
            required: ['templateId', 'name', 'variants'],
            properties: {
              templateId: { type: 'string' },
              name: { type: 'string' },
              variants: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['versionId', 'weight'],
                  properties: { versionId: { type: 'string' }, weight: { type: 'number' } },
                },
              },
            },
          },
        }),
        get: op({ tag: 'experiments', summary: 'List experiments' }),
      },
      '/v1/experiments/{id}': {
        get: op({ tag: 'experiments', summary: 'Get an experiment', parameters: [idParam] }),
      },
      '/v1/experiments/{id}/results': {
        get: op({ tag: 'experiments', summary: 'Per-variant assignment/engagement/outcome results', parameters: [idParam] }),
      },
      '/v1/experiments/{id}/conclude': {
        post: op({
          tag: 'experiments',
          summary: 'Conclude an experiment (winner never bypasses the publish gate)',
          parameters: [idParam],
          requestSchema: {
            type: 'object',
            properties: { winnerVersionId: { type: 'string' } },
          },
        }),
      },
      // -- usage / FinOps ----------------------------------------------------
      '/v1/usage': {
        get: op({ tag: 'usage', summary: 'Usage summary with reference rates and estimated cost (?period=YYYY-MM)' }),
      },
      '/v1/usage/periods': {
        get: op({ tag: 'usage', summary: 'List periods with recorded usage' }),
      },
      // -- migration studio --------------------------------------------------
      '/v1/migration/jobs': {
        post: op({
          tag: 'migration',
          summary: 'Ingest a legacy communication (HTML/text) into a draft template',
          requestSchema: {
            type: 'object',
            required: ['name', 'sourceFormat', 'payload'],
            properties: {
              name: { type: 'string' },
              sourceFormat: { type: 'string', enum: ['html', 'text'] },
              payload: { type: 'string' },
              brandId: { type: 'string' },
            },
          },
        }),
        get: op({ tag: 'migration', summary: 'List migration jobs' }),
      },
      '/v1/migration/jobs/{id}': {
        get: op({ tag: 'migration', summary: 'Get a migration job', parameters: [idParam] }),
      },
      '/v1/migration/duplicate-report': {
        get: op({ tag: 'migration', summary: 'Near-duplicate content pairs for rationalization (?threshold=)' }),
      },
      '/v1/migration/parallel-run': {
        post: op({
          tag: 'migration',
          summary: 'Diff the rendered output of two template versions with the same data',
          requestSchema: {
            type: 'object',
            required: ['versionAId', 'versionBId'],
            properties: {
              versionAId: { type: 'string' },
              versionBId: { type: 'string' },
              data: { type: 'object' },
            },
          },
        }),
      },
      // -- agent desk ---------------------------------------------------------
      '/v1/agent/customers': {
        get: op({ tag: 'agent-desk', summary: 'Search customers (?q=), service-agent roles only' }),
      },
      '/v1/agent/customers/{id}/overview': {
        get: op({ tag: 'agent-desk', summary: 'Customer overview (audited)', parameters: [idParam] }),
      },
      '/v1/agent/communications/{id}/resend': {
        post: op({
          tag: 'agent-desk',
          summary: 'Re-deliver a communication on behalf of the customer (audited)',
          parameters: [idParam],
          requestSchema: { type: 'object', properties: { channels: { type: 'array', items: { type: 'string' } } } },
        }),
      },
      '/v1/agent/communications/{id}/reissue-link': {
        post: op({ tag: 'agent-desk', summary: 'Revoke live links and issue a fresh secure link (audited)', parameters: [idParam] }),
      },
      '/v1/agent/customers/{id}/notes': {
        post: op({
          tag: 'agent-desk',
          summary: 'Attach a service note to the customer timeline (audited)',
          parameters: [idParam],
          requestSchema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } },
        }),
      },
      // -- lifecycle ----------------------------------------------------------
      '/v1/lifecycle/sweep': {
        post: op({ tag: 'lifecycle', summary: 'Run the housekeeping sweep (expired links, retention-due)' }),
      },
      '/v1/lifecycle/retention-due': {
        get: op({ tag: 'lifecycle', summary: 'Count archive records past their retention class' }),
      },
      '/v1/customers/{id}/erase': {
        post: op({
          tag: 'lifecycle',
          summary: 'GDPR/CCPA erasure (blocked by legal hold; compliance roles only)',
          parameters: [idParam],
          requestSchema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
        }),
      },
      // -- ai ---------------------------------------------------------------
      '/v1/ai/draft': {
        post: op({
          tag: 'ai',
          summary: 'Generate an AI draft (always requires human approval before use)',
          requestSchema: {
            type: 'object',
            required: ['instruction'],
            properties: { instruction: { type: 'string' }, baseText: { type: 'string' } },
          },
        }),
      },
      '/graphql': {
        post: op({
          tag: 'graphql',
          summary: 'Execute a read-only GraphQL query (mutations stay REST)',
          requestSchema: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string' },
              variables: { type: 'object' },
              operationName: { type: 'string' },
            },
          },
        }),
      },
      '/graphql/schema': {
        get: op({
          tag: 'graphql',
          summary: 'Download the GraphQL SDL',
          responseContentType: 'text/plain',
          responseSchema: { type: 'string' },
        }),
      },

      // -- viewer (public, secure-link token authorized) ---------------------
      '/view/{token}': {
        get: op({
          tag: 'viewer (public)',
          summary: 'Open the interactive viewer for a secure link',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          responseContentType: 'text/html',
          responseSchema: { type: 'string' },
        }),
        post: op({
          tag: 'viewer (public)',
          summary: 'Submit the one-time code (OTP) challenge',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          requestSchema: anyObject,
          responseContentType: 'text/html',
          responseSchema: { type: 'string' },
        }),
      },
      '/view/{token}/pdf': {
        get: op({
          tag: 'viewer (public)',
          summary: 'Download the PDF artifact via secure link',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          responseContentType: 'application/pdf',
          responseSchema: { type: 'string', format: 'binary' },
        }),
      },
      '/api/view/{token}/interactions': {
        post: op({
          tag: 'viewer (public)',
          summary: 'Record a viewer interaction event',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          requestSchema: anyObject,
        }),
      },
      '/api/view/{token}/actions': {
        post: op({
          tag: 'viewer (public)',
          summary: 'Perform an in-document action (pay, dispute, update-details, contact)',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          requestSchema: anyObject,
        }),
      },
      '/api/view/{token}/ask': {
        post: op({
          tag: 'viewer (public)',
          summary: 'Ask the grounded document assistant',
          public: true,
          parameters: [pathParam('token', 'Secure-link token')],
          requestSchema: anyObject,
        }),
      },

      // -- meta --------------------------------------------------------------
      '/v1/openapi.json': {
        get: op({ tag: 'meta', summary: 'This OpenAPI document', public: true }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key secret from POST /v1/tenants or POST /v1/api-keys',
        },
      },
      schemas: {
        // Generic open object used where exact shapes live in
        // src/kernel/contracts.ts — pragmatic, not aspirational.
        AnyObject: { type: 'object', additionalProperties: true },
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details',
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            errors: {},
          },
          required: ['type', 'title', 'status'],
        },
        Communication: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            templateId: { type: 'string' },
            templateVersionId: { type: 'string' },
            customerId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['composed', 'rendered', 'delivering', 'delivered', 'failed', 'archived'],
            },
            dataSnapshotHash: { type: 'string' },
            composed: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            outcome: { type: 'object', additionalProperties: true },
          },
          required: ['id', 'templateId', 'customerId', 'status', 'createdAt'],
        },
        Template: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            key: { type: 'string' },
            name: { type: 'string' },
            communicationType: { type: 'string' },
            brandId: { type: 'string' },
            publishedVersionId: { type: 'string' },
            latestVersionId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'key', 'name', 'communicationType'],
        },
        ContentObject: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantId: { type: 'string' },
            key: { type: 'string' },
            type: { type: 'string', enum: ['block', 'clause', 'disclosure', 'faq', 'tooltip'] },
            title: { type: 'string' },
            approvedVersionId: { type: 'string' },
            latestVersionId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'key', 'type', 'title'],
        },
        DeliveryAttempt: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            communicationId: { type: 'string' },
            customerId: { type: 'string' },
            channel: { type: 'string', enum: ['email', 'sms', 'secure-link', 'webhook', 'print'] },
            provider: { type: 'string' },
            to: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'sent', 'delivered', 'bounced', 'failed'] },
            attempt: { type: 'integer' },
            failoverFrom: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'communicationId', 'channel', 'status', 'attempt'],
        },
      },
    },
  };
}

export function registerOpenApiRoute(app: FastifyInstance, ctx: PlatformContext): void {
  // Public: the spec describes the API but exposes no tenant data.
  app.get('/v1/openapi.json', async (_req, reply) => {
    return reply.type('application/json; charset=utf-8').send(buildOpenApiDocument(ctx));
  });
}
