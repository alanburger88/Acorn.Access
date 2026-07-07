/**
 * GraphQL read projection — SDL + root resolver factory.
 *
 * Per platform/07-api-integration-strategy.md §3: GraphQL fits read-heavy
 * composite UIs (customer 360 timelines, analytics workbenches, cross-domain
 * joins in one round trip); all mutations stay REST, where idempotency keys,
 * role scopes, and human-approval gates are native. This endpoint is
 * therefore strictly read-only — the Query type below is the whole surface.
 */
import { buildSchema } from 'graphql';
import type {
  ArchiveRecord,
  Communication,
  CommunicationStatus,
  Customer,
  RequestCtx,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';

export const sdl = /* GraphQL */ `
  type Query {
    overview: Overview!
    communications(customerId: ID, templateId: ID, status: String): [Communication!]!
    communication(id: ID!): Communication
    customers: [Customer!]!
    customer(id: ID!): Customer
    templates: [Template!]!
    archiveRecord(communicationId: ID!): ArchiveRecord
  }

  type Overview {
    communications: Int!
    delivered: Int!
    failed: Int!
    viewed: Int!
    actionsCompleted: Int!
    outcomesAchieved: Int!
    outcomeRate: Float!
    callDeflectionProxy: Float!
  }

  type Communication {
    id: ID!
    status: String!
    templateId: ID!
    customerId: ID!
    createdAt: String!
    title: String!
    customerName: String!
    intendedOutcome: String!
    outcomeAchieved: Boolean!
    outcomeVia: String
    timeline: [TimelineEntry!]!
    artifacts: [Artifact!]!
    recommendations: [Recommendation!]!
    deliveries: [Delivery!]!
  }

  type TimelineEntry {
    at: String!
    type: String!
    summary: String!
  }

  type Artifact {
    format: String!
    sha256: String!
    size: Int!
    contentType: String!
  }

  type Recommendation {
    action: String!
    reason: String!
    ruleId: String!
    taken: Boolean
  }

  type Delivery {
    channel: String!
    status: String!
    to: String!
    attempt: Int!
    failoverFrom: String
    createdAt: String!
  }

  type Customer {
    id: ID!
    name: String!
    email: String
    phone: String
    locale: String!
    timeline: [TimelineEntry!]!
    communications: [Communication!]!
  }

  type Template {
    id: ID!
    key: String!
    name: String!
    communicationType: String!
    published: Boolean!
  }

  type ArchiveRecord {
    communicationId: ID!
    storedAt: String!
    retentionClass: String!
    legalHold: Boolean!
    artifactFormats: [String!]!
  }
`;

export const schema = buildSchema(sdl);

/**
 * Wrap a Communication entity so nested composite fields resolve lazily
 * (buildSchema root-value style: methods on returned objects act as field
 * resolvers, only invoked when the query selects them).
 */
function communicationNode(ctx: PlatformContext, rctx: RequestCtx, com: Communication) {
  const { tenantId } = rctx;
  return {
    id: com.id,
    status: com.status,
    templateId: com.templateId,
    customerId: com.customerId,
    createdAt: com.createdAt,
    title: com.composed.title,
    customerName: com.composed.customerName,
    intendedOutcome: com.composed.intendedOutcome,
    outcomeAchieved: com.outcome?.achieved ?? false,
    outcomeVia: com.outcome?.via ?? null,
    timeline: () => ctx.services.analytics.communicationTimeline(tenantId, com.id),
    artifacts: () => ctx.services.composition.listArtifacts(tenantId, com.id),
    recommendations: () => ctx.services.nba.listRecommendations(tenantId, com.id),
    deliveries: () => ctx.services.delivery.listAttempts(tenantId, com.id),
  };
}

function customerNode(ctx: PlatformContext, rctx: RequestCtx, customer: Customer) {
  const { tenantId } = rctx;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    locale: customer.locale,
    timeline: () => ctx.services.analytics.customerTimeline(tenantId, customer.id),
    communications: () =>
      ctx.services.composition
        .listCommunications(tenantId, { customerId: customer.id })
        .map((c) => communicationNode(ctx, rctx, c)),
  };
}

function archiveNode(record: ArchiveRecord) {
  return {
    communicationId: record.communicationId,
    storedAt: record.storedAt,
    retentionClass: record.retentionClass,
    legalHold: record.legalHold,
    artifactFormats: record.manifest.artifacts.map((a) => a.format),
  };
}

/** Root value for graphql() execution — every top-level Query field. */
export function createRoot(ctx: PlatformContext, rctx: RequestCtx) {
  return {
    overview: () => ctx.services.analytics.overview(rctx.tenantId),

    communications: (args: { customerId?: string; templateId?: string; status?: string }) =>
      ctx.services.composition
        .listCommunications(rctx.tenantId, {
          customerId: args.customerId,
          templateId: args.templateId,
          status: args.status as CommunicationStatus | undefined,
        })
        .map((c) => communicationNode(ctx, rctx, c)),

    communication: (args: { id: string }) => {
      const com = ctx.services.composition.getCommunication(rctx.tenantId, args.id);
      return com ? communicationNode(ctx, rctx, com) : null;
    },

    customers: () =>
      ctx.services.tenants.listCustomers(rctx).map((c) => customerNode(ctx, rctx, c)),

    customer: (args: { id: string }) => {
      // getCustomer throws not-found; GraphQL contract is a nullable Customer.
      try {
        return customerNode(ctx, rctx, ctx.services.tenants.getCustomer(rctx, args.id));
      } catch {
        return null;
      }
    },

    templates: () =>
      ctx.services.templates.listTemplates(rctx).map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        communicationType: t.communicationType,
        published: Boolean(t.publishedVersionId),
      })),

    archiveRecord: (args: { communicationId: string }) => {
      const record = ctx.services.archive.get(rctx.tenantId, args.communicationId);
      return record ? archiveNode(record) : null;
    },
  };
}
