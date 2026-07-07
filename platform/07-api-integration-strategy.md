# Acorn OS — API, Integration & Developer Experience Strategy

**Document:** platform/07-api-integration-strategy.md
**Status:** Build-ready
**Owner:** Platform API Architecture
**Standards baseline:** OpenAPI 3.1 (REST) · AsyncAPI 3.0 (events) · CloudEvents 1.0 (envelopes) · OpenTelemetry (observability) · MCP (agent integration) · RFC 9457 problem+json · RFC 9421 HTTP message signatures

---

## 1. API Design Principles

Acorn OS is API-first: every capability the UI has, the API has, and the API ships first. All surfaces (REST, GraphQL, events, MCP) project the same domain model and enforce the same policy engine.

### 1.1 Resource-oriented REST

- Nouns, plural, kebab-free lowercase: `/v1/communications`, `/v1/template-versions`, `/v1/evidence-packs`.
- Sub-resources for containment: `/v1/communications/{id}/events`, `/v1/templates/{id}/versions`.
- Verbs only as explicit action endpoints on state machines, namespaced under `:`-style action paths rendered as sub-resources: `POST /v1/deliveries/{id}/cancel`, `POST /v1/template-versions/{id}/approve`, `POST /v1/renders/{id}/retry`.
- IDs are prefixed, sortable ULIDs: `comm_01J9X…`, `tmpl_…`, `dlv_…`, `rnd_…`, `cust_…`, `arch_…`. Prefixes make logs, support tickets and audit trails self-describing.
- Every resource carries `created_at`, `updated_at`, `etag`, and `tenant_id` (server-derived, never client-supplied).

### 1.2 Versioning policy

- **URL major versions**: `/v1/…`. A major version is a contract; we run N and N−1 concurrently with a published 24-month deprecation window and `Deprecation` + `Sunset` headers on N−1.
- **Additive-only within a major version**: new optional request fields, new response fields, new enum values (clients MUST tolerate unknown enum values — documented and enforced in SDKs), new endpoints. Never: field removal, type change, semantic change, new required field.
- Behavioral changes that are additive-but-risky are gated behind dated capability flags: `Acorn-Features: render-pipeline-2026-05`.
- Schema evolution is CI-enforced: `oasdiff` breaking-change check on every OpenAPI PR; AsyncAPI schemas registered in a schema registry with `BACKWARD_TRANSITIVE` compatibility.

### 1.3 Idempotency

All mutating render/delivery/communication calls require an `Idempotency-Key` header (UUIDv4 or ULID, ≤255 chars):

```
POST /v1/deliveries
Idempotency-Key: 7d1c9e0a-4f2b-4c8e-9a51-2b7f0f4e6d21
```

- Keys are scoped `(tenant, endpoint, key)` and retained 72 hours.
- Replay with the same key + same body → cached original response with `Idempotency-Replayed: true`.
- Replay with same key + different body → `409` problem+json `urn:acorn:problem:idempotency-key-conflict`.
- Batch endpoints take per-item `client_ref` for item-level idempotency inside one request.

### 1.4 Pagination

Cursor pagination everywhere; no offset pagination on any list endpoint.

```json
GET /v1/communications?limit=50&cursor=eyJrIjoiY29tbV8wMUo5...
{
  "data": [ ... ],
  "page": {
    "next_cursor": "eyJrIjoiY29tbV8wMUpB...",
    "has_more": true,
    "estimated_total": 12403
  }
}
```

Cursors are opaque, signed, and encode sort + filter state so a cursor from one query cannot be replayed against another. Default `limit=25`, max `200`.

### 1.5 Errors — RFC 9457 problem+json

```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "urn:acorn:problem:data-contract-violation",
  "title": "Payload does not satisfy data contract",
  "status": 422,
  "detail": "Field 'account.balance' is required by contract dc_stmt_v3 but missing.",
  "instance": "/v1/communications/comm_01J9XQ2M8T",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "tenant_id": "ten_meridianbank",
  "errors": [
    { "pointer": "/account/balance", "code": "required", "contract": "dc_stmt_v3" }
  ]
}
```

- Every error carries `trace_id` (W3C traceparent-correlated) so support can jump straight to the OpenTelemetry trace.
- Stable machine-readable `type` URNs; the problem catalog is published in the developer portal and shipped in SDKs as typed exceptions.
- `429` and `503` always include `Retry-After`.

### 1.6 Rate limiting & quotas

IETF RateLimit headers on every response:

```
RateLimit-Policy: "burst";q=100;w=1, "sustained";q=6000;w=60
RateLimit: "sustained";r=5240;t=42
Acorn-Quota-Monthly-Renders: limit=2000000; used=1240031
```

Limits are per-tenant per-API-family (reads, renders, deliveries, archive-search each have independent budgets so a render storm cannot starve status polling). Enterprise tenants get dedicated rate pools; overage behavior (throttle vs. bill) is a tenant plan setting.

### 1.7 Tenancy & AuthN/AuthZ

- **Tenant scoping via auth context only.** The access token carries `tenant_id` (and optional `sub_tenant_id` for service-bureau resellers). No endpoint accepts a tenant identifier in path/query/body; cross-tenant access is structurally impossible at the API gateway.
- **OAuth2 client-credentials** for machine callers; short-lived JWT access tokens (15 min) from `https://auth.acorn.dev/oauth2/token`, private_key_jwt or mTLS client auth for regulated tenants. Human sessions (portal, UI) use authorization-code + PKCE; the REST API treats both identically via scopes + roles.
- **Fine-grained scopes**, resource:verb form:

| Scope | Grants |
|---|---|
| `communications:read` / `communications:write` | Read / compose communications |
| `communications:render` | Trigger renders and previews |
| `deliveries:send` | Initiate outbound delivery (highest-risk scope) |
| `deliveries:read` | Delivery status, reconciliation reads |
| `templates:read` / `templates:write` / `templates:approve` | Template lifecycle; `approve` is separated for four-eyes |
| `content:read` / `content:write` / `content:approve` | Content objects & approvals |
| `customers:read` / `customers:write` / `consents:manage` | Profiles, preferences, consent |
| `archive:read` / `archive:evidence` | Archive search / evidence-pack generation |
| `analytics:read` / `analytics:export` | Metrics query / bulk export |
| `journeys:read` / `journeys:write` / `journeys:activate` | Journey lifecycle |
| `webhooks:manage`, `connectors:manage`, `tenants:admin`, `mcp:invoke` | Platform administration & agent access |

- Scopes gate the endpoint; ABAC policy (OPA/Cedar policy-as-code, see §5.5) gates the row: brand, line-of-business, region, data classification.

### 1.8 Webhook & callback signing

Outbound webhooks are signed (HMAC-SHA256, versioned scheme, rotation-friendly — full spec in §4.3). Inbound high-risk calls (e.g., `POST /v1/deliveries` from customer data centers) optionally require RFC 9421 HTTP Message Signatures bound to the client's registered key, giving non-repudiation for regulated senders.

### 1.9 Observability contract

- Every response: `Acorn-Request-Id`, `traceparent` propagation honored end-to-end.
- Server emits OpenTelemetry traces/metrics/logs; enterprise tenants can register an OTLP endpoint to receive **their own** trace spans for their API calls and delivery pipelines (tenant-filtered exporter).
- API SLOs published per endpoint family; `GET /v1/status` + status page fed by the same SLO burn data.

---

## 2. Public REST API Surface

### 2.1 Resource map

| Resource family | Key endpoints | Purpose | Notable semantics |
|---|---|---|---|
| **Communications** | `POST/GET /v1/communications`, `GET /v1/communications/{id}`, `GET …/{id}/events`, `POST …/{id}/cancel` | Compose a communication instance from template + data | Async state machine: `composing → composed → rendering → rendered → delivering → completed` |
| **Renders** | `POST /v1/renders`, `GET /v1/renders/{id}`, `GET …/{id}/artifacts`, `POST /v1/renders/preview` | Produce HTML5 / PDF(-UA) / AFP / print / large-print / braille-ready artifacts | Idempotent; preview is synchronous ≤2s for single doc |
| **Templates** | `GET/POST /v1/templates`, `GET /v1/templates/{id}/versions`, `POST /v1/template-versions/{id}/approve`, `…/test` | Template lifecycle, versioning, approval workflow | Versions immutable once approved; approval requires `templates:approve` and a different principal than author |
| **Content objects** | `GET/POST /v1/content-objects`, `…/{id}/versions`, `POST /v1/content-versions/{id}/approve` | Reusable clauses, disclosures, images, micro-copy | Effective-dating (`effective_from/to`), jurisdiction tags |
| **Data contracts** | `GET/POST /v1/data-contracts`, `POST /v1/data-contracts/{id}/validate` | JSON Schema contracts binding data payloads to templates | Contract violations → 422 with pointers |
| **Deliveries** | `POST /v1/deliveries`, `GET /v1/deliveries/{id}`, `GET /v1/deliveries?communication_id=`, `POST /v1/deliveries/{id}/cancel`, `POST /v1/delivery-reconciliations` | Omnichannel send: email, SMS, push, portal, print/mail, fax, RCS | Channel plan resolved from preferences+consent unless `channel` forced; reconcile ingests provider reports |
| **Journeys** | `GET/POST /v1/journeys`, `…/{id}/versions`, `POST …/{id}/activate`, `GET /v1/journey-runs`, `POST /v1/journey-runs/{id}/signal` | Multi-step orchestration (statement → reminder → escalation) | Runs are queryable per customer; `signal` injects external events |
| **Recommendations (NBA)** | `POST /v1/recommendations/query`, `POST /v1/recommendations/{id}/feedback` | Next-best-action / next-best-content for a customer in context | Every response carries `model_version`, `explanation`, `policy_checks` |
| **Customers** | `GET/POST /v1/customers`, `GET …/{id}/timeline`, `GET/PUT …/{id}/preferences`, `GET/POST …/{id}/consents`, `GET …/{id}/communications` | Profiles, channel preferences, consent records | Consent records are append-only with proof metadata |
| **Archive** | `POST /v1/archive/search`, `GET /v1/archive/items/{id}`, `GET …/{id}/content`, `POST /v1/evidence-packs`, `GET /v1/evidence-packs/{id}` | Immutable WORM archive: search, retrieve, legal evidence | Retrieval audited; evidence packs are hash-chained, signed bundles |
| **Analytics** | `POST /v1/analytics/queries`, `GET /v1/analytics/metrics/{metric}`, `POST /v1/analytics/exports`, `GET /v1/analytics/exports/{id}` | Metrics query + bulk export (Parquet/CSV to tenant bucket) | Query language: bounded metric expressions, not raw SQL |
| **Accessibility** | `POST /v1/accessibility/checks`, `GET /v1/accessibility/checks/{id}`, `GET /v1/accessibility/reports?template_id=` | WCAG 2.2 AA / PDF-UA validation of artifacts & templates | CI-friendly: pass/fail + machine-readable findings |
| **Compliance** | `POST /v1/compliance/checks`, `GET /v1/compliance/checks/{id}`, `GET /v1/compliance/evidence?communication_id=` | Policy rules (disclosures present, jurisdiction, language, retention class) | Checks run automatically pre-delivery; API exposes them for CI |
| **Migrations** | `POST /v1/migrations`, `POST /v1/migrations/{id}/batches`, `GET /v1/migrations/{id}/status`, `GET …/{id}/report` | Ingest legacy templates/archives (Exstream, Quadient, OpenText dumps) | Batch, resumable, per-item error report |
| **Webhooks** | `GET/POST /v1/webhook-subscriptions`, `PATCH/DELETE …/{id}`, `POST …/{id}/test`, `POST …/{id}/rotate-secret`, `POST /v1/webhook-deliveries/replay` | Subscription management (see §4.3) | Event-type filters + JSONPath payload filters |
| **Tenants & usage** | `GET /v1/tenant`, `GET /v1/tenant/usage`, `GET /v1/tenant/limits`, `GET/POST /v1/tenant/api-clients`, `GET /v1/tenant/audit-events` | Self-service tenant admin, usage metering, audit log access | `tenant` is singular — always the caller's own tenant |

### 2.2 OpenAPI-style snippets (representative)

**Create a communication (compose):**

```yaml
paths:
  /v1/communications:
    post:
      operationId: createCommunication
      summary: Compose a communication from a template and a data payload
      security: [{ oauth2: [communications:write] }]
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [template_id, customer_id, data]
              properties:
                template_id:      { type: string, example: tmpl_stmt_credit_card }
                template_version: { type: string, description: "Pinned version; omit for latest approved", example: tv_01J9WZ7Q }
                customer_id:      { type: string, example: cust_01HZY4N2 }
                data:             { type: object, description: "Must satisfy the template's data contract" }
                data_contract_id: { type: string, example: dc_stmt_v3 }
                interactive:
                  type: object
                  properties:
                    actions_enabled: { type: array, items: { enum: [pay_now, dispute_charge, update_address, chat_with_ai] } }
                metadata:         { type: object, additionalProperties: { type: string } }
      responses:
        '202':
          description: Composition accepted (async)
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Communication' }
        '422': { $ref: '#/components/responses/DataContractViolation' }
components:
  schemas:
    Communication:
      type: object
      properties:
        id:        { type: string, example: comm_01J9XQ2M8T }
        status:    { enum: [composing, composed, rendering, rendered, delivering, completed, failed, canceled] }
        template:  { $ref: '#/components/schemas/TemplateRef' }
        customer_id: { type: string }
        renders:   { type: array, items: { $ref: '#/components/schemas/RenderRef' } }
        deliveries:{ type: array, items: { $ref: '#/components/schemas/DeliveryRef' } }
        compliance:{ $ref: '#/components/schemas/ComplianceSummary' }
        links:
          type: object
          properties:
            events: { type: string, example: /v1/communications/comm_01J9XQ2M8T/events }
```

**Render with formats:**

```yaml
  /v1/renders:
    post:
      operationId: createRender
      security: [{ oauth2: [communications:render] }]
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [communication_id, formats]
              properties:
                communication_id: { type: string }
                formats:
                  type: array
                  items: { enum: [html5-interactive, pdf, pdf-ua, print-afp, print-pdfvt, large-print, sms-text, email-mime] }
                accessibility_profile: { enum: [standard, pdf-ua, large-print-18pt, screen-reader-optimized] }
                watermark: { type: string, description: "e.g. SPECIMEN for previews" }
      responses:
        '202': { description: Render job accepted, content: { application/json: { schema: { $ref: '#/components/schemas/Render' } } } }
```

**Delivery:**

```yaml
  /v1/deliveries:
    post:
      operationId: createDelivery
      security: [{ oauth2: [deliveries:send] }]
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [communication_id]
              properties:
                communication_id: { type: string }
                channel_plan:
                  description: Omit to let preference+consent engine decide
                  type: object
                  properties:
                    primary:  { enum: [email, sms, push, portal, print-mail, rcs, fax] }
                    fallback: { type: array, items: { type: string } }
                    fallback_after: { type: string, example: PT48H }
                schedule_at: { type: string, format: date-time }
                priority:    { enum: [bulk, standard, expedited], default: standard }
      responses:
        '202': { description: Delivery accepted }
        '409':
          description: Consent or suppression blocks delivery
          content:
            application/problem+json:
              example:
                type: urn:acorn:problem:consent-blocked
                title: Customer has no valid consent for any permitted channel
```

**Archive search:**

```yaml
  /v1/archive/search:
    post:
      operationId: searchArchive
      security: [{ oauth2: [archive:read] }]
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                query:      { type: string, description: "Full-text over extracted content" }
                customer_id:{ type: string }
                filters:
                  type: object
                  properties:
                    communication_type: { type: array, items: { type: string } }
                    delivered_between:  { type: object, properties: { from: {type: string, format: date-time}, to: {type: string, format: date-time} } }
                    channel:            { type: array, items: { type: string } }
                    retention_class:    { type: string }
                purpose:    { type: string, description: "Required audit purpose code, e.g. customer-dispute, regulator-request" }
      responses:
        '200': { description: Cursor-paginated results with content hashes and retention metadata }
```

### 2.3 Worked example — compose → render → deliver → track a statement

```bash
# 0) Token (client credentials)
curl -s https://auth.acorn.dev/oauth2/token \
  -d grant_type=client_credentials \
  -d client_id=$ACORN_CLIENT_ID \
  -d client_secret=$ACORN_CLIENT_SECRET \
  -d scope="communications:write communications:render deliveries:send deliveries:read"
# → { "access_token": "eyJhbGciOi...", "expires_in": 900 }

# 1) Compose the statement
curl -s -X POST https://api.acorn.dev/v1/communications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: stmt-2026-06-acct-4417-0001" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": "tmpl_stmt_credit_card",
    "customer_id": "cust_01HZY4N2",
    "data_contract_id": "dc_stmt_v3",
    "data": {
      "account": { "number_masked": "****4417", "balance": 1240.55, "due_date": "2026-07-25" },
      "period": { "from": "2026-06-01", "to": "2026-06-30" },
      "transactions": [
        { "date": "2026-06-03", "merchant": "ACME GROCERS", "amount": 84.12 },
        { "date": "2026-06-11", "merchant": "CITY TRANSIT", "amount": 42.00 }
      ]
    },
    "interactive": { "actions_enabled": ["pay_now", "dispute_charge", "chat_with_ai"] },
    "metadata": { "batch": "2026-06-monthly", "source_system": "core-banking" }
  }'
# → 202 { "id": "comm_01J9XQ2M8T", "status": "composing", ... }

# 2) Render interactive HTML5 + accessible PDF
curl -s -X POST https://api.acorn.dev/v1/renders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: stmt-2026-06-acct-4417-0001-r1" \
  -d '{
    "communication_id": "comm_01J9XQ2M8T",
    "formats": ["html5-interactive", "pdf-ua"],
    "accessibility_profile": "pdf-ua"
  }'
# → 202 { "id": "rnd_01J9XQ5K1C", "status": "queued" }

# 2a) Poll (or subscribe to render.completed webhook)
curl -s https://api.acorn.dev/v1/renders/rnd_01J9XQ5K1C -H "Authorization: Bearer $TOKEN"
# → { "status": "completed",
#     "artifacts": [
#       { "format": "html5-interactive", "url": "https://artifacts.acorn.dev/...", "sha256": "9f1c...", "expires_at": "..." },
#       { "format": "pdf-ua", "url": "https://artifacts.acorn.dev/...", "pages": 4, "accessibility": { "pdf_ua": "pass" } } ] }

# 3) Deliver — preference engine picks channel; print-mail fallback after 48h
curl -s -X POST https://api.acorn.dev/v1/deliveries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: stmt-2026-06-acct-4417-0001-d1" \
  -d '{
    "communication_id": "comm_01J9XQ2M8T",
    "channel_plan": { "primary": "email", "fallback": ["portal", "print-mail"], "fallback_after": "PT48H" }
  }'
# → 202 { "id": "dlv_01J9XQ8P2Z", "status": "scheduled", "resolved_channel": "email",
#         "consent_check": { "status": "granted", "consent_id": "cns_01HZZ..." } }

# 4) Track — status + the full communication event stream
curl -s https://api.acorn.dev/v1/deliveries/dlv_01J9XQ8P2Z -H "Authorization: Bearer $TOKEN"
# → { "status": "delivered", "channel": "email", "provider_message_id": "ses-0102...",
#     "timeline": [ {"at":"...","event":"delivery.dispatched"}, {"at":"...","event":"delivery.delivered"} ] }

curl -s "https://api.acorn.dev/v1/communications/comm_01J9XQ2M8T/events?limit=50" \
  -H "Authorization: Bearer $TOKEN"
# → CloudEvents: communication.composed, render.completed, compliance.check.passed,
#   delivery.dispatched, delivery.delivered, access.opened, interaction.action.invoked (pay_now)...
```

The same sequence exists as `acorn communications demo-statement` in the CLI and as a Postman collection folder.

---

## 3. GraphQL Strategy

### 3.1 Where GraphQL fits — and where it doesn't

| Use GraphQL for | Use REST for |
|---|---|
| Read-heavy composite UIs: customer 360 timeline, analytics workbench, archive search console, template catalog browser, journey monitoring dashboards | All render/delivery mutations (idempotency keys, rate pools, and audit semantics are REST-native) |
| Cross-domain joins in one round trip (communication + template + delivery + interactions + consent) | High-volume machine-to-machine composition pipelines |
| Partner portals embedding Acorn data views | Bulk export, file transfer, migration ingest |

GraphQL is a **read/query projection**. The only mutations exposed are low-risk UI conveniences (saving a workbench view, annotating a timeline); anything that renders, sends, approves, or deletes goes through REST so idempotency, scopes, and human-approval gates stay uniform.

### 3.2 Schema strategy — federated subgraphs

Apollo Federation v2-compatible supergraph at `https://graphql.acorn.dev/v1`, composed from domain-owned subgraphs: `communications`, `templates-content`, `customers-consent`, `delivery`, `archive`, `analytics`, `journeys`. Each subgraph is owned by the same team that owns the corresponding REST domain and is generated from the same domain model — no schema drift.

### 3.3 Representative SDL

```graphql
type Communication @key(fields: "id") {
  id: ID!
  status: CommunicationStatus!
  createdAt: DateTime!
  template: TemplateVersion!            # resolved by templates-content subgraph
  customer: Customer!                   # resolved by customers-consent subgraph
  renders: [Render!]!
  deliveries(first: Int = 10, after: String): DeliveryConnection!
  interactions: [Interaction!]!         # opens, action invocations, AI-assistant sessions
  complianceEvidence: ComplianceSummary @requiresScope(scope: "archive:read")
}

type TemplateVersion @key(fields: "id") {
  id: ID!
  template: Template!
  semver: String!
  status: TemplateVersionStatus!        # DRAFT | IN_REVIEW | APPROVED | RETIRED
  approvedBy: Principal
  dataContract: DataContract!
  accessibilityReport: AccessibilityReport
}

type Customer @key(fields: "id") {
  id: ID!
  displayName: String! @pii(class: "name")
  preferences: ChannelPreferences!
  consents: [ConsentRecord!]!
  timeline(
    first: Int = 25
    after: String
    kinds: [TimelineEventKind!]         # COMMUNICATION, DELIVERY, INTERACTION, CONSENT_CHANGE, JOURNEY_STEP
    from: DateTime
  ): TimelineConnection!
}

type Query {
  communication(id: ID!): Communication
  customer(id: ID!): Customer
  archiveSearch(input: ArchiveSearchInput!): ArchiveResultConnection! @requiresScope(scope: "archive:read")
  metric(name: String!, window: MetricWindow!, dimensions: [DimensionFilter!]): MetricSeries!
}
```

Example composite query powering the customer-timeline screen in one round trip:

```graphql
query CustomerTimeline($id: ID!, $after: String) {
  customer(id: $id) {
    displayName
    preferences { preferredChannel quietHours }
    timeline(first: 25, after: $after) {
      edges { node {
        __typename
        ... on CommunicationEvent { communication { id status template { template { name } } } }
        ... on DeliveryEvent { channel status providerMessageId }
        ... on InteractionEvent { action occurredAt aiAssisted }
      } }
      pageInfo { endCursor hasNextPage }
    }
  }
}
```

### 3.4 Operational guardrails

- **Persisted queries only in production** for third-party clients: operations are registered at build time (hash → document); arbitrary query strings are rejected outside sandbox tenants. Kills injection-style query abuse and makes cost predictable.
- **Cost limits**: static cost analysis (per-field weights, connection multipliers) with a per-tenant cost budget per minute; depth ≤ 10, node budget ≤ 50k per operation. Rejections return `EXCEEDED_QUERY_COST` with the computed cost.
- **Field-level authz**: `@requiresScope` and `@pii` directives enforced in the gateway against the same OAuth scopes + OPA policies as REST; a token without `archive:read` sees `complianceEvidence: null` plus an `errors[]` entry, never a leak.
- Response caching with tenant-partitioned cache keys; `@defer` for slow analytics fields.

---

## 4. Eventing & Webhooks

### 4.1 CloudEvents event catalog

All events are CloudEvents 1.0, JSON format. Envelope conventions:

```json
{
  "specversion": "1.0",
  "id": "evt_01J9XR4T7Q",
  "source": "//acorn.dev/tenants/ten_meridianbank/deliveries",
  "type": "dev.acorn.delivery.delivered.v1",
  "subject": "dlv_01J9XQ8P2Z",
  "time": "2026-07-06T14:31:07Z",
  "datacontenttype": "application/json",
  "dataschema": "https://schemas.acorn.dev/events/delivery.delivered/1.2.json",
  "traceparent": "00-4bf92f3577b34da6...-01",
  "acorntenant": "ten_meridianbank",
  "data": { "delivery_id": "dlv_01J9XQ8P2Z", "communication_id": "comm_01J9XQ2M8T", "channel": "email", "provider": "ses", "provider_message_id": "ses-0102..." }
}
```

Conventions: `type` = `dev.acorn.<domain>.<event>.v<major>`; `data` schema versioned independently (minor additive), registered in the schema registry and published via AsyncAPI; payloads carry IDs + minimal denormalized context, never full PII documents — consumers fetch details via API with their own authorization.

| Domain | Event types (v1) | Fired when |
|---|---|---|
| `communication.*` | `created`, `composed`, `compose.failed`, `canceled`, `completed` | Composition state machine transitions |
| `render.*` | `queued`, `completed`, `failed`, `artifact.expiring` | Render pipeline |
| `delivery.*` | `scheduled`, `dispatched`, `delivered`, `bounced`, `failed`, `fallback.triggered`, `suppressed`, `reconciled` | Channel delivery lifecycle incl. print/mail reconciliation |
| `access.*` | `opened`, `viewed`, `downloaded`, `link.expired` | Recipient accesses content (portal/HTML/PDF link) |
| `interaction.*` | `action.invoked`, `action.completed`, `form.submitted`, `payment.initiated` | Embedded interactive actions in documents |
| `action.*` | `approval.requested`, `approval.granted`, `approval.rejected` | Human-in-the-loop gates (template approval, MCP sensitive tools) |
| `ai.*` | `assistant.session.started`, `assistant.session.ended`, `draft.created`, `recommendation.served`, `recommendation.accepted`, `guardrail.triggered` | AI assistant & NBA activity — every AI event carries `model_version` + `policy_snapshot_id` |
| `archive.*` | `item.stored`, `item.retrieved`, `retention.hold.applied`, `retention.expired`, `evidencepack.ready` | Immutable archive lifecycle; `item.retrieved` includes audit purpose code |
| `consent.*` | `granted`, `revoked`, `preference.updated`, `suppression.added` | Consent/preference changes (drives journey re-planning) |

### 4.2 AsyncAPI catalog

The full catalog is published as an AsyncAPI 3.0 document per domain at `https://developers.acorn.dev/asyncapi/`, generated from the schema registry in CI. Snippet:

```yaml
asyncapi: 3.0.0
info: { title: Acorn Delivery Events, version: 1.4.0 }
channels:
  deliveryEvents:
    address: acorn.{tenant}.delivery.v1
    messages:
      deliveryDelivered:
        contentType: application/cloudevents+json
        payload: { $ref: 'https://schemas.acorn.dev/events/delivery.delivered/1.2.json' }
operations:
  onDeliveryDelivered:
    action: receive
    channel: { $ref: '#/channels/deliveryEvents' }
```

### 4.3 Webhooks

Subscription management via `/v1/webhook-subscriptions`:

```json
POST /v1/webhook-subscriptions
{
  "url": "https://hooks.meridianbank.com/acorn",
  "event_types": ["delivery.*", "interaction.action.invoked", "consent.revoked"],
  "filter": "$.data.channel == 'print-mail' || $.type != 'dev.acorn.delivery.delivered.v1'",
  "api_version": "v1",
  "description": "Core banking reconciliation feed"
}
→ 201 { "id": "whs_01J9XS...", "secret": "whsec_9f2c...", "status": "enabled" }
```

- **Signing**: `Acorn-Signature: t=1751812267,v1=hex(hmac_sha256(secret, t + "." + body))`. Timestamp tolerance ±5 min (replay defense). **Rotation**: `POST …/rotate-secret` returns a new secret while the old one keeps signing (dual `v1=` values) for 24h — zero-downtime rotation.
- **Retries**: at-least-once, exponential backoff with jitter — 30s, 2m, 10m, 1h, 6h, then hourly up to 72h. Non-2xx or >10s response = failure. After exhaustion the event lands in the per-subscription **DLQ**, visible at `GET /v1/webhook-subscriptions/{id}/dead-letters`. Sustained failure (>95% over 24h) auto-disables the subscription and emits a `webhook.subscription.disabled` event + email.
- **Replay**: `POST /v1/webhook-deliveries/replay { "subscription_id": "whs_…", "from": "2026-07-01T00:00:00Z", "event_types": ["delivery.*"] }` re-emits from the 30-day event store; replayed events carry `Acorn-Replayed: true`.
- Ordering is per-`subject` best-effort; consumers must key on `id` for dedupe and treat delivery as at-least-once.

### 4.4 Kafka / stream access (enterprise)

For tenants that outgrow webhooks (>~50 events/s sustained):

- **Tenant-scoped topics**: dedicated topics `acorn.<tenant>.<domain>.v1` on Acorn's Kafka (or mirrored into the tenant's own MSK/Confluent/Event Hubs via cluster linking). SASL/OAUTHBEARER auth bound to the same OAuth client; ACLs allow consume-only on the tenant's topics.
- **Filtered firehose** (for Acorn-hosted analytics partners): single multi-tenant stream with broker-side filtering on the `acorntenant` attribute — only offered where contractually permitted, never default.
- Same CloudEvents payloads as webhooks (binary Kafka protocol binding: attributes in headers), same schema registry, 7-day retention (30-day for enterprise), consumer lag exported to the tenant's OTLP endpoint.
- Guidance published as a decision tree in the portal: webhooks → Kafka at scale; both can run simultaneously during migration.

---

## 5. MCP Strategy

Acorn ships a first-party **MCP server** so AI agents — the embedded document assistant, tenant-built agents, and third-party copilots — operate the platform through allow-listed tools, resources, and prompts rather than raw APIs. MCP is a governed *capability projection*, not a bypass: every tool call traverses the same authz, policy, and audit pipeline as REST.

### 5.1 Deployment model

- Endpoint: `https://mcp.acorn.dev/v1` (Streamable HTTP transport) — **logically tenant-isolated server instances**: the OAuth-bound session pins tenant, and each tenant's instance has its own tool allow-list, rate budget, and audit stream. VPC-deployed tenants run the MCP server in-cluster from our Helm chart.
- **OAuth-bound sessions**: MCP authorization per the MCP auth spec — clients obtain tokens from `auth.acorn.dev` with the `mcp:invoke` scope plus the fine-grained scopes for the tools they need. Session ≠ authorization: every individual tool call re-validates the token and scopes.
- Server version is pinned per tenant; tool schema changes follow the same additive-only rules as REST.

### 5.2 Tool catalog

Risk tiers: **T1 read** (no side effects) · **T2 sandbox** (side effects confined to previews/drafts) · **T3 sensitive** (real-world effect; human approval gate mandatory).

| Tool | Description | Input → Output (summary) | Required scope | Tier |
|---|---|---|---|---|
| `search_communications` | Find communications by customer, type, date, status | `{query?, customer_id?, filters}` → paginated summaries (IDs, status, no content) | `communications:read` | T1 |
| `get_communication` | Fetch one communication's metadata + artifact links | `{communication_id}` → full metadata, artifact refs | `communications:read` | T1 |
| `explain_communication` | Plain-language explanation of a communication's content, data lineage, and why it was sent (grounded in template + data contract + journey) | `{communication_id, audience: "agent"\|"customer"}` → structured explanation with citations to source fields | `communications:read` | T1 |
| `get_customer_timeline` | Chronological events for a customer | `{customer_id, kinds?, from?, limit?}` → timeline entries | `customers:read` | T1 |
| `compose_preview` | Compose a communication **in sandbox** — nothing persisted to production, nothing deliverable | `{template_id, data}` → preview communication id (sandbox), validation results | `communications:write` (sandbox) | T2 |
| `render_preview` | Render watermarked preview artifacts | `{communication_id\|preview_id, formats}` → artifact URLs (SPECIMEN watermark, 1h TTL) | `communications:render` | T2 |
| `check_accessibility` | Run WCAG/PDF-UA checks on a template version or artifact | `{template_version_id\|artifact_ref}` → pass/fail + findings | `templates:read` | T1 |
| `check_compliance` | Run policy checks (disclosures, jurisdiction, language) | `{communication_id\|template_version_id, jurisdiction?}` → findings + policy citations | `communications:read` | T1 |
| `search_content` | Search approved content library (clauses, disclosures) | `{query, filters}` → content object summaries | `content:read` | T1 |
| `draft_content` | Create a **draft** content object or template change — always status `DRAFT`, requires human approval workflow to activate | `{kind, brief, base_content_id?}` → draft id + link to approval queue | `content:write` | T2 |
| `get_delivery_status` | Delivery status + timeline | `{delivery_id\|communication_id}` → status, channel, events | `deliveries:read` | T1 |
| `initiate_delivery` | **SENSITIVE** — request a real delivery; creates an approval task, does NOT send until a human approves (auto-approval only via tenant policy for narrow, pre-declared cases) | `{communication_id, channel_plan?, justification}` → `{approval_request_id, status: "pending_approval"}` | `deliveries:send` | **T3** |
| `search_archive` | Search the immutable archive (purpose code required) | `{query, filters, purpose}` → result summaries + hashes | `archive:read` | T1 |
| `generate_evidence_pack` | Build a signed evidence bundle for legal/regulatory use | `{communication_ids\|search_ref, purpose, requested_for}` → `{approval_request_id}` then `evidence_pack_id` on approval | `archive:evidence` | **T3** |

Tool inputs/outputs are strict JSON Schemas published alongside the catalog; unknown fields are rejected, outputs are schema-validated before return (a malformed internal response never reaches the model).

### 5.3 Resources & prompts

**Resources** (read-only, URI-addressable, subscribable):

| Resource URI pattern | Content |
|---|---|
| `acorn://templates/{id}` and `acorn://templates?status=approved` | Template metadata, data contract, sample data |
| `acorn://content-library/{id}` | Approved content objects with jurisdiction/effective-date tags |
| `acorn://data-contracts/{id}` | JSON Schema contracts — lets an agent construct valid payloads |
| `acorn://analytics/summaries/{metric}?window=7d` | Pre-aggregated, PII-free analytics summaries |
| `acorn://policies/communication-standards` | Tenant tone-of-voice & regulatory writing rules (grounding for drafts) |

**Prompts** — a curated, versioned prompt library, tenant-extensible but centrally approved: `summarize-customer-history`, `draft-regulatory-notice` (binds required disclosures automatically), `explain-statement-to-customer` (reading-level constrained), `triage-delivery-failure`. Prompts are content-managed artifacts with the same versioning/approval workflow as templates.

### 5.4 Security model

1. **Tenant isolation** — session pinned to one tenant; tool implementations execute with tenant-scoped credentials; no tool can name another tenant's resource.
2. **Least privilege per tool** — each tool maps to exactly the REST scopes it needs; a token missing `archive:evidence` never sees `generate_evidence_pack` in `tools/list` (capability hiding, not just call rejection).
3. **Allow-listing per tenant/role** — tenant admins enable tools per role/agent identity (e.g., customer-service agents get T1 + `render_preview`; marketing copilot adds `draft_content`; nothing gets `initiate_delivery` without a signed risk acceptance). Managed at `PUT /v1/tenant/mcp/allowlists`.
4. **Human-in-the-loop for T3** — sensitive tools return an `approval_request_id`; the action executes only after an authorized human approves in the console (or via `POST /v1/approval-requests/{id}/approve` with `deliveries:send` + approver role ≠ requesting agent's principal). Approvals emit `action.approval.*` events and are archived.
5. **Full audit logging** — every `tools/call`: principal, agent identity, session id, arguments (PII-redacted copy + sealed full copy), result digest, policy decisions, trace id — written to the immutable audit store, queryable at `/v1/tenant/audit-events?actor_type=mcp`.
6. **Input/output validation** — strict schema validation both directions; output size caps; artifact URLs returned as short-TTL signed links, never inline bulk content.
7. **Prompt-injection defenses** — all retrieved content (archived documents, customer messages, template bodies, connector data) is treated as **data, not instructions**: wrapped in typed content blocks with provenance labels; tool descriptions are static and server-controlled; resource content never alters the allow-list or session scopes; T3 gates are enforced server-side so no injected instruction can bypass approval; anomaly detection flags sessions whose tool-call patterns deviate from the agent's declared purpose.
8. **Policy-as-code** — every tool call passes through the same OPA/Cedar policy evaluation as REST (`can(principal, action, resource, context)`); policies are versioned, tested, and the `policy_snapshot_id` is recorded in the audit event.
9. Rate limits per session and per agent identity, independent of the tenant's REST budget.

### 5.5 The platform as MCP client

Acorn also acts as an **MCP client**, connecting outward to customers' MCP servers (CRM, core banking, policy admin, knowledge bases) as grounding and action sources for composition, NBA, and the in-document AI assistant:

- Tenant registers external MCP servers at `POST /v1/connectors/mcp-servers` with OAuth credentials, an **allow-list of remote tools** Acorn may call, and a data classification for what those tools return.
- Same governance as our server, mirrored: every outbound call is audited; remote tool outputs are treated as untrusted data (provenance-tagged, schema-checked, PII-classified before entering composition context); remote tools with side effects require the same human-approval gates; egress only through the connector runtime with per-server network policy.
- Use cases: "ground this statement explanation in the CRM case history" (client → tenant CRM MCP), "verify current balance before rendering" (client → core-banking MCP), "file the dispute the customer initiated from the document" (T3-equivalent, approval-gated action on the tenant's system).
- Circuit breakers + response caching per remote server; degraded-grounding behavior is explicit (the assistant discloses when a grounding source was unavailable).

---

## 6. Integration Connectors

### 6.1 Connector framework & SDK

All connectors — first-party and partner-built — are built on one **Connector SDK** (TypeScript & Java) and run in the connector runtime (isolated per tenant, egress-controlled):

- **Auth module**: OAuth2 (all grant flavors), API key, mTLS, AWS SigV4, JWT assertion; secrets held in the platform vault, rotated, never visible to connector code in plaintext logs.
- **Schema mapping**: declarative mapping DSL (JSONata-based) from source schema → Acorn data contracts, with typed transforms, lookup tables, and unit tests; mappings are versioned tenant artifacts.
- **Sync modes**: request/response (lookup at compose time), scheduled batch pull, **CDC** (Debezium-compatible change streams → data contract events), push (source webhooks in).
- **Retry semantics**: per-operation idempotency, exponential backoff with jitter, poison-message DLQ per connector, checkpointed cursors for batch/CDC (resume, never re-send), rate-limit awareness (honors source `Retry-After`).
- **Health & observability**: standardized health checks, throughput/lag/error metrics via OpenTelemetry, connector status surfaced at `GET /v1/connectors/{id}/health`.
- Certification pipeline: contract tests + security review before a connector is listed in the marketplace.

### 6.2 First-party connector catalog

| Category | Connectors | Primary use |
|---|---|---|
| CRM | Salesforce (REST + Pub/Sub API CDC), Microsoft Dynamics 365 (Dataverse) | Customer profiles, cases, journey triggers, write-back of communication activity |
| ERP | SAP (OData/IDoc), Oracle, NetSuite | Invoice/billing data for composition |
| Core banking | FIS (Horizon/IBS), Fiserv (DNA/Premier, Communicator replacement paths), Jack Henry (SilverLake/jXchange, Banno) | Statement/notice data, balance verification, event triggers |
| Insurance | Guidewire (PolicyCenter/ClaimCenter Cloud APIs), Duck Creek | Policy docs, claims correspondence, renewal journeys |
| Healthcare | FHIR R4/R5 (SMART on FHIR auth) — Epic/Oracle Health-compatible; X12 835/837 intake | EOBs, statements, care communications (HIPAA-scoped runtime) |
| Utility billing | Oracle Utilities (CC&B), SAP IS-U, Harris | Bills, outage & usage notices |
| Lending | Encompass (ICE), MeridianLink, Sagent/Black Knight servicing | Origination disclosures, servicing letters |
| Document mgmt | SharePoint (Graph API), OpenText Content Server/xECM, Documentum | Template/content sync, archive federation |
| Cloud storage | S3, GCS, Azure Blob (tenant-owned buckets, assumed-role/workload identity) | Batch intake, export destination, evidence delivery |
| Warehouses | Snowflake, BigQuery, Databricks (Delta Sharing) | Analytics export, audience/segment pull |
| Marketing automation / CDP | Braze, Adobe, Segment, mParticle | Segment sync, suppression lists, campaign coordination |
| Identity | Okta, Entra ID, Ping (SCIM in; OIDC federation) | Workforce SSO + user provisioning |
| Contact center | Genesys Cloud, NICE CXone, Five9 | Screen-pop of communication context, post-call fulfillment triggers |
| Print service providers | Broadridge, RRD, O'Neil, tenant-preferred PSPs | Print-file handoff (AFP/PDF-VT), SLA tracking, mail reconciliation |
| Postal / address | **Modern USPS APIs (api.usps.com — OAuth2; legacy Web Tools retired Jan 2026)**: Addresses, Domestic Prices, Tracking, Informed Delivery; NCOA via licensed processors; Lob/PostGrid for API-first mail; international PAF/AddressComplete | Address validation/standardization at intake, move updates, mail tracking |
| E-signature | DocuSign, Adobe Acrobat Sign | Signature ceremonies launched from interactive documents |
| Payments | Stripe, tokenized/hosted-fields gateways (Fiserv/FIS native rails for banks) | `pay_now` embedded actions — **hosted fields/tokenization only; card data never touches Acorn (SAQ-A posture, minimal PCI scope)** |

### 6.3 Transport-level intake

For legacy batch estates (the dominant migration reality):

| Transport | Details |
|---|---|
| SFTP | Per-tenant endpoints, SSH-key + IP allow-list, PGP-at-rest, filename-convention triggers, control-file (manifest) validation |
| Batch upload API | `POST /v1/batches` multipart or S3-presigned; manifest + checksum required; per-record error report |
| Managed file transfer | Interop with GoAnywhere/MOVEit/Sterling via SFTP/AS2 profiles |
| Message queues | AMQP/JMS bridges (IBM MQ, RabbitMQ) → CloudEvents ingestion |
| Kafka in | Consume from tenant clusters (SASL/mTLS), schema-registry aware |
| CDC | Debezium-format streams from tenant databases |
| Database connectors | Read-only JDBC pulls (scheduled), pushdown filters, column-level allow-lists |
| Webhooks in | `POST /v1/inbound-webhooks/{connector_id}` with per-source signature verification |

Every intake path lands in the same validation pipeline: manifest → data-contract validation → quarantine-on-error with per-record diagnostics → composition. No transport bypasses contracts.

---

## 7. Developer Experience

### 7.1 Developer portal — `developers.acorn.dev`

- **Interactive API docs** generated from the OpenAPI 3.1 source of truth: try-it console bound to your sandbox tenant, per-language snippets, problem-catalog browser, changelog with `Sunset` tracking.
- **GraphQL explorer** (persisted-query aware; free-form allowed against sandbox), schema reference with field-level scope annotations.
- **AsyncAPI catalog**: every event type, versioned payload schemas, example CloudEvents, webhook-vs-Kafka decision guide.
- **MCP docs**: tool catalog with schemas and risk tiers, quickstart for connecting Claude/agent frameworks, allow-list administration guide, approval-workflow walkthrough.
- Guides: migration cookbooks (Exstream/Quadient), compliance recipes, accessibility handbook.

### 7.2 SDKs, CLI, and tooling

**SDKs** — TypeScript, Python, Java, C# — generated from OpenAPI plus a handwritten ergonomic layer:

```python
from acorn import Acorn
acorn = Acorn(client_id=..., client_secret=...)  # token mgmt, retries, idempotency keys automatic
comm = acorn.communications.create(template_id="tmpl_stmt_credit_card",
                                   customer_id="cust_01HZY4N2", data=payload)
render = acorn.renders.create(communication_id=comm.id, formats=["pdf-ua"]).wait()
delivery = acorn.deliveries.create(communication_id=comm.id)
for event in acorn.events.stream(types=["delivery.*"]):   # webhook-verify or SSE tail
    ...
```

SDKs bake in: auto token refresh, idempotency-key generation, RateLimit-aware retries, problem+json → typed exceptions, webhook signature verification helpers, OpenTelemetry instrumentation.

**CLI** — `npm i -g @acorn/cli`:

```
acorn login                          # device flow into sandbox or prod profile
acorn templates scaffold statement   # local template project w/ data contract + sample data
acorn preview --watch                # local live-preview server, renders on save via preview API
acorn render test --golden ./golden  # trigger test renders, diff against golden outputs
acorn events tail --types "delivery.*,ai.*"      # live event stream to terminal
acorn deliveries simulate --channel email        # no-op provider delivery simulation
acorn a11y check ./dist/statement.pdf            # accessibility gate for CI
acorn compliance check --template tmpl_x --jurisdiction US-CA
acorn webhooks listen --forward http://localhost:3000/hooks   # local tunnel for webhook dev
```

**Sandbox tenants**: every developer account gets an isolated sandbox with synthetic customers (Faker-derived, deterministic seed), pre-approved sample templates, all delivery providers stubbed as **no-op simulators** that emit realistic event sequences (including bounces and print reconciliation) without sending anything. Sandbox data is wipeable via `acorn sandbox reset`.

**Postman collections**: published + version-synced per API family, with the §2.3 worked example as a runnable folder.

**Terraform provider** — `registry.terraform.io/acorn/acorn`:

```hcl
resource "acorn_webhook_subscription" "recon" {
  url         = "https://hooks.meridianbank.com/acorn"
  event_types = ["delivery.*", "consent.revoked"]
}
resource "acorn_connector" "salesforce" {
  type   = "salesforce"
  config = { instance_url = var.sf_url, sync_mode = "cdc" }
}
resource "acorn_feature_flag" "interactive_actions" { key = "interactive-actions", enabled = true }
```

Manages tenants/sub-tenants, API clients + scopes, webhook subscriptions, connectors, MCP allow-lists, feature flags — drift-detected, review-gated infrastructure for regulated customers.

**Customer-VPC deploys**: signed Helm charts + container images (SBOM + cosign attestations) for the render engine, MCP server, and connector runtime in customer VPCs; control plane stays managed.

**Testing & CI toolchain**: template test harness with **golden-output testing** (pixel/structural PDF diff + DOM diff for HTML, tolerance rules for dates/ids); render preview APIs for ephemeral CI checks; delivery simulation providers; `POST /v1/accessibility/checks` and `POST /v1/compliance/checks` as CI gates (GitHub Action `acorn/check-action` published); event replay tools (`acorn events replay --from …`) against local consumers; analytics export for downstream test assertions.

### 7.3 First 15 minutes

*Minute 0–2*: Sign up at developers.acorn.dev → sandbox tenant auto-provisioned, API client + scopes issued, keys shown once. *Minute 2–4*: `npm i -g @acorn/cli && acorn login` (device flow); `acorn quickstart statement` scaffolds a template project — MJML-like layout, `dc_quickstart.json` data contract, synthetic sample data. *Minute 4–7*: `acorn preview --watch` opens a live browser preview; edit the template, watch it re-render; flip the format toggle to see the PDF-UA output. *Minute 7–10*: run the worked example — `acorn demo compose-render-deliver` executes the §2.3 sequence against sandbox; the terminal prints each CloudEvent as the no-op email provider "delivers" the statement, and the portal's event inspector shows the same trace. *Minute 10–13*: `acorn webhooks listen --forward localhost:3000` + the starter Express/FastAPI snippet from the docs — see a signed `delivery.delivered` webhook verify and parse locally. *Minute 13–15*: open the MCP quickstart, paste the sandbox MCP URL into Claude, and ask it to `search_communications` and `explain_communication` on the statement just sent. A developer ends the first session having composed, rendered, delivered, tracked, received a webhook, and driven the platform from an AI agent — without sending a single real message.

---

## Appendix A — Cross-surface consistency rules

1. One domain model: REST resources, GraphQL types, event payloads, and MCP tool schemas are generated from the same source-of-truth definitions; CI fails on drift.
2. One policy engine: OPA/Cedar decisions are identical across REST/GraphQL/MCP for the same principal+action+resource.
3. One audit spine: every mutation, from any surface, lands in the immutable audit store with `trace_id`, principal, and policy snapshot.
4. One deprecation process: OpenAPI, AsyncAPI, SDL, and MCP catalogs share the changelog, `Deprecation`/`Sunset` signaling, and the 24-month window.
