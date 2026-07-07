# Acorn Communicate — Capability Coverage Matrix

**Document type:** PRD-to-implementation traceability
**Owner:** Product Management / Platform Engineering
**Status:** Living document — reflects the state of `acorn-communicate/` at the date below
**Related documents:** `01-prd.md` (FR/NFR IDs), `02-feature-inventory.md` (feature catalog), `acorn-communicate/README.md`
**As of:** 2026-07-07 · 195 tests passing (32 files) · 24 domains · ~15.7k LOC of `src/*.ts`

---

## 1. Purpose and how to read this

This matrix maps every requirement area of the design suite to its **actual, verifiable** state in
the reference implementation under `acorn-communicate/src/`. It exists so a reviewer can confirm the
platform is a genuinely full-featured, end-to-end working system — the outcome loop from ingest →
compose → render → deliver → interact → measure → archive is real and tested — while being **candid**
about which production seams are simulated in this single-node reference build and which ENT-scoped
capabilities are designed but not built.

The guiding principle is honesty over optimism. A ✅ means a reviewer can spot-check the cited file or
endpoint and see the behavior, exercised by a test. A ◑ means the *capability shape* is real and
tested behind the correct interface, but the seam that would touch external infrastructure is
simulated (writes to an outbox, a deterministic stand-in, a spool file). A ○ means the design
describes it but the code does not build it — almost always because it needs external infrastructure
this environment cannot run (real print bureaus, TTS/video farms, multi-region hardware).

### Status legend

| Symbol | Meaning |
|---|---|
| ✅ | **Implemented & tested** — real behavior in the codebase, covered by a test in `test/`. |
| ◑ | **Partial / simulated** — the interface and orchestration are real and tested; the external seam is a deterministic stand-in (outbox file, spool file, deterministic AI, unconfigured S3). The note states exactly what is real vs. simulated. |
| ○ | **Designed only** — specified in the PRD/feature inventory, not built. Note gives the one-line reason (nearly always: needs external infra this reference environment cannot run). |
| N/A | Not applicable to a code artifact (process/certification/commercial commitment). |

### How to verify a row

Every ✅ cites a domain folder (`src/domains/<x>/`), a contract in `src/kernel/contracts.ts`, or an
HTTP route. Routes are registered across the 24 domain `index.ts` modules plus `src/api/`
(~133 `app.<method>('…')` registrations total). Run `npm test` to reproduce the 195-test result; run
`npm run seed && npm start` to exercise the console (`/console`), designer (`/designer`), agent desk
(`/agent`) and interactive viewer (`/view/:token`).

---

## 2. Coverage by capability domain

### 2.1 Ingestion (FR-ING / ING-*)

| Capability | Status | Where | Notes: real vs. simulated |
|---|---|---|---|
| JSON batch intake | ✅ | `domains/ingestion`, `POST /v1/ingestion/batches`, `ingestion.test.ts` | Real parse + per-record validation + compose. |
| CSV intake (quoted, dot-path headers) | ✅ | `domains/ingestion` (`IngestionService.ingestBatch` sourceFormat `csv`) | Real quoted-CSV parser with dot-path column expansion. |
| Per-record validation & disposition | ✅ | `IngestionJob.errors/validCount/errorCount` | Records validated against the template data contract; bad records isolated, not fatal. |
| PII/PHI auto-classification | ✅ | `POST /v1/ingestion/pii-scan`, `scanPii()` | Real pattern detection: email, phone, SSN, Luhn-checked PANs; stored as `piiFindings`. |
| Field masking / role-gated PII | ◑ | consent + `pii` flags in data contract | Redaction exists in the AI path (pre-inference); UI/API field-level masking by `pii:read` permission is not a separate enforcement layer. |
| Data mapping studio (versioned) | ✅ | `domains/mapping`, `POST /v1/mapping-profiles`, `mapping.test.ts` | Real transform rules (copy/number/date-iso/trim/concat/constant), dry-run apply, wired into ingestion. |
| AI-assisted schema mapping (confidence) | ◑ | `POST /v1/mapping-profiles/suggest` | Real suggestion by normalized field-name similarity with 0..1 confidence — deterministic heuristic, not a model. |
| Identity matching (deterministic) | ✅ | ingestion matches `customerRef` → `Customer.externalRef`/id | Deterministic match per PRD MVP slice. |
| Probabilistic matching + stewardship | ○ | — | ENT; not built. |
| Householding | ✅ (print) | `PrintService` `householdKey` grouping | Address-normalized householding realized at print output (FR-RND-011 slice). |
| Fixed-width/copybook, Parquet/Avro, Excel | ○ | — | Contract enumerates `json`/`csv` only; other parsers not built (need format libraries/infra). |
| Industry formats (FHIR, X12, ISO 20022, HL7, ACORD) | ○ | — | Designed (FR-ING-002); no parsers in code. |
| SFTP / object-storage / Kafka / JDBC intake | ○ | — | Only REST intake built; other transports need external infra. |
| USPS REST address validation | ○ | — | Designed (FR-ING-040); no USPS OAuth2 client. Print suppresses pieces lacking an address instead. |
| Data lineage / reproducibility tuple | ✅ | `Communication.dataSnapshotHash`, `ArchiveRecord.manifest` | Each communication pins data-snapshot hash, template version, content version ids, renderer version. |
| Duplicate/idempotency protection | ◑ | batch content flows | Content-hash dedup exists in migration duplicate report; API idempotency-key store not implemented. |

### 2.2 Content management / CMS (FR-CMS / CMS-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Typed content objects | ✅ | `ContentObject`/`ContentVersion`, `domains/content`, `content.test.ts` | Types: block, clause, disclosure, faq, tooltip. |
| Immutable versioning | ✅ | `newVersion`, monotonic `version` | Every save is a new immutable version. |
| Approval workflow with SoD | ✅ | `submitForReview`/`review`, `POST /v1/content-versions/:id/review` | Segregation of duties enforced (author ≠ approver), audited. |
| Lifecycle enforced at API | ✅ | `ApprovalStatus` gates composability | draft/in-review/approved/rejected/retired; only approved versions compose. |
| Effective/expiry dating | ◑ | `ContentVersion.effectiveFrom/expiresAt` | Fields carried and pinned; jurisdiction-scoped selection at composition is single-locale, not per-jurisdiction. |
| Reading-level / sentiment scoring | ✅ | `ContentVersion.scores` | Advisory reading-level + sentiment computed on save. |
| Semantic / keyword search | ◑ | `POST /v1/content-search`, `ContentService.search` | Real scored search; term/similarity-based, not embedding-vector semantic. |
| Variant management (locale) | ✅ | translations (see 2.12) | Locale variants with independent approval. |
| Reuse tracking / impact analysis | ○ | — | Designed (FR-CMS-005); no cross-reference index endpoint. |
| Clause libraries (jurisdiction mandatory sets) | ○ | — | ENT; not built. |
| AI tagging, brand/regulatory-risk scoring | ○ | — | Reading-level/sentiment only; topic/brand/regulatory scoring not built. |
| Digital asset management | ○ | — | Brand carries logo text/colors; no asset repository. |

### 2.3 Template designer (FR-TPL / TPL-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Visual drag-and-drop designer | ✅ | `domains/designer`, `/designer`, `designer.test.ts` | Real block canvas, property forms, data-contract editor, live preview, publish with gate errors surfaced. |
| Block AST (sections/tables/conditions/refs/actions) | ✅ | `TemplateBlock` union in contracts | heading/text/summary/field-row/table/section/content-ref/action/divider. |
| Intended-outcome declaration (blocks publish) | ✅ | `TemplateVersion.intendedOutcome`, `templates.test.ts` | Mandatory outcome from taxonomy; part of every version. |
| Data binding + type formatting | ✅ | `ValueFormat` (text/currency/number/date), `validateData` | Locale-aware currency/number/date formatting at render. |
| Conditional content & logic | ✅ | `Rule` (eq/ne/gt/gte/lt/lte/exists/contains) on blocks | Conditions evaluated at composition. |
| Channel projections | ◑ | `blocks` + `channels.email/sms` | One master body → HTML/PDF/email/SMS/text/voice-script. Chat script and video storyboard surfaces not built. |
| Component libraries / locked components | ◑ | `content-ref` blocks | Shared content via refs; explicit "locked region / business-user guardrail" role split is partial. |
| Multi-brand theming | ◑ | `Brand` tokens, `brandId` on template | One brand switch by id; full design-token system is ENT. |
| AI draft-from-prompt / readability | ✅ | `POST /v1/ai/draft`, `AiGateway.draft`, `ai.test.ts` | Drafts only; human applies (never auto-publish). |
| PDF-to-template conversion | ◑ | `domains/migration` `ingestLegacy` (html/text) | Real legacy→template extraction for HTML/plain-text; PDF/Word binary extraction not built. |
| Template lifecycle & immutable publish | ✅ | `publish()`, `POST /v1/template-versions/:id/publish` | draft→published with accessibility gate; immutable published version. |
| Regression render testing | ✅ | migration `parallelRun`, `POST /v1/migration/parallel-run` | Two-version diff over the same data (text format). |
| Interactive-action authoring | ✅ | `action` blocks (pay/dispute/update-details/contact/download) | Placed in canvas, rendered as viewer actions. |
| Multi-user co-editing / a11y previews | ○ | — | GA/ENT; not built. |

### 2.4 Composition (FR-RND-001/021 / RND-001..003, 030)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Compose once → abstract document | ✅ | `domains/composition`, `ComposedDocument`, `composition.test.ts` | Single compose; channel renderers derive from it. |
| Data snapshot (hashed) + pinned versions | ✅ | `dataSnapshotKey/Hash`, `contentVersionIds` | Chain of custody captured at compose time. |
| Condition evaluation + interpolation | ✅ | composition service | `{{path}}` interpolation, rule-gated visibility. |
| Deterministic output | ✅ | `rendering` + `rendererVersion` stamping | Same inputs → same artifacts; reproducibility verified in archive. |
| On-demand render p95 ≤ 2s | ◑ | synchronous compose API | Fast on reference volume; SLA is an infra/scale property, not asserted by load test. |

### 2.5 Rendering / output formats (FR-RND-002/003/004 / RND-004..019)

See the dedicated **Output format coverage** sub-table in §3. Summary: 6 render formats real
(html, pdf, email-html, sms-text, text, voice-script); archival/print/office/media formats designed-only.

### 2.6 Delivery / omnichannel (FR-DLV / DLV-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Channel orchestration from preferences | ✅ | `domains/delivery`, `POST /v1/communications/:id/deliver`, `delivery.test.ts` | Channel plan from `PreferenceRecord.channelPriority`. |
| Consent enforcement (hard block) | ✅ | `hasConsent`, `consent-purpose.test.ts` | Explicit-deny + marketing requires granted consent; blocked sends recorded, never silently dropped. |
| Failover ladder (email→sms→…) | ✅ | delivery orchestration, `failoverFrom` | Real channel failover on bounce/transient failure. |
| Retry with backoff | ✅ | delivery service | Transient failures retried; hard bounces suppress. |
| Provider callbacks (delivery/bounce) | ✅ | `POST /v1/provider-callbacks`, `providerCallback` | Simulated receipts drive ledger + failover. |
| Scheduled delivery | ✅ | `scheduleAt`, `POST /v1/deliveries/tick`, `delivery-scheduling.test.ts` | Explicit future schedule deferred and promoted by tick. |
| Quiet-hours deferral | ◑ | `settings.quietHours`, `deferReason:'quiet-hours'` | Real deferral of message channels to window end — evaluated in **tenant** local window, not per-recipient time zone (PRD wants recipient-local). |
| Frequency caps (daily per customer) | ◑ | `maxDeliveriesPerCustomerPerDay`, `deferReason:'frequency-cap'` | Per-customer daily UTC cap; cross-channel windowed caps are ENT. |
| Secure links (expiry, one-time OTP) | ✅ | `SecureLink`, `POST /v1/communications/:id/secure-link` | Expiring links; optional simulated OTP; timing-safe token compare. |
| Reconciliation ledger | ✅ | `DeliveryAttempt` history + timeline | Composed→dispatched→delivered/bounced→accessed chain. |
| Email / SMS / print / secure-link / webhook / API delivery | ◑ | `providers.ts` `ChannelProvider` | Real orchestration; **providers write to `data/outbox/`** (`.eml`, `.sms.json`, spool file) — not real SES/Twilio/bureau. See §5. |
| RCS / WhatsApp / MMS / push / voice / certified mail / agent-desktop delivery | ○ | — | ENT channels; `Channel` enum is email/sms/secure-link/webhook/print only. |
| Blackout calendars / seed lists / provider health shifting | ○ | — | Designed; not built. |

### 2.7 Interactive experience (FR-IXD / IXD-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Interactive HTML5 viewer | ✅ | `domains/viewer`, `/view/:token`, `viewer.test.ts` | Section instrumentation, expandable sections, in-document explanations. |
| Static PDF fallback | ✅ | `/view/:token/pdf` | PDF rendition downloadable and as no-JS fallback. |
| Embedded grounded assistant | ✅ | `ViewerService.ask`, `POST /api/view/:token/ask` | Grounded only on the communication's sections + approved FAQ; citations returned. |
| Refuse-and-escalate on low confidence | ✅ | `AssistantAnswer.escalated`, `ai.test.ts` | Never guesses below threshold; routes to human; logged. |
| Contextual tooltips / FAQ / search / walkthroughs | ◑ | section `explanation`, interaction kinds | Explanations, FAQ grounding, `faq-searched`/`section-expanded` instrumentation real; guided walkthrough authoring is partial. |
| Pay-now action | ◑ | `action:'pay'`, `POST /api/view/:token/actions`, `ActionTransaction` | Real action capture + outcome + timeline + webhook. **Payment is a simulated tokenized stand-in** — no real gateway/PAN (SAQ-A shape preserved). See §5. |
| Dispute initiation | ✅ | `action:'dispute'` | Structured dispute captured, timeline + outcome event. |
| Self-service update (details/preferences) | ✅ | `action:'update-details'`, `action:'contact'` | Writes to timeline; preference update path exists. |
| Forms/uploads, secure messaging, scheduling, IDV, e-signature | ○ | — | Designed (mostly ENT); action set is pay/dispute/update-details/contact/download. |
| Context-carrying escalation | ◑ | `contact` action + agent desk | Escalation captured; live agent-desktop embed is ENT. |
| Acorn.Access widget embedded | ✅ | `/viewer-assets/acorn-access.min.js`, served in viewer shell | The accessibility layer (this repo) ships in the viewer per FR-ACC-020. |

### 2.8 AI / AIXM governance (FR-AI / AI-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Model gateway abstraction | ✅ | `domains/ai`, `AiGateway`, `ai.test.ts` | Deterministic grounded provider default; **optional Anthropic provider** via `ANTHROPIC_API_KEY`. |
| Grounded RAG with citations | ✅ | `AssistantAnswer.citations` | Answers cite section/content-version ids; uncited/low-confidence → escalate. |
| Confidence scoring + gating | ✅ | `AiInvocation.confidence`, `escalated` | Calibrated confidence drives escalation. |
| PII redaction pre-inference | ✅ | AI path masks before prompt | Minimization before model call. |
| Full invocation audit | ✅ | `AiInvocation` (model, grounded, citations, inputHash, latency) | Every call logged to the hash-chained event log. |
| Human review gates (drafts only) | ✅ | `AiGateway.draft`, MCP `draft_content` | All authoring output is draft; human applies. No AI path initiates delivery. |
| BYO-model per tenant | ◑ | provider selection via env | Anthropic swap is env-level, not per-tenant routing policy engine (ENT). |
| Hallucination detection pass | ◑ | grounding + confidence + escalation | Grounding enforced and low-confidence suppressed; an independent second-model claim-verification pass is not built. |
| Prompt library / eval harness / red-team gate | ○ | — | Designed (FR-AI-010/110/111); not built as versioned artifacts. |
| AI governance dashboard | ◑ | usage metering + audit chain | Invocations metered and auditable; a dedicated MRM dashboard view is not built. |

### 2.9 Next best action (FR-NBA / NBA-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Explainable rule-based decision engine | ✅ | `domains/nba`, `POST /v1/communications/:id/recommendations`, `nba.test.ts` | Rules: pay-due, view-nudge, paperless, dispute follow-up, bounce→update-details. |
| Reason codes / explainability | ✅ | `Recommendation.reason` + `ruleId` | Human-readable rationale per recommendation. |
| In-viewer / composition decision points | ◑ | recommendations surfaced per communication | Per-communication recommendations real; NBA at composition-time onsert selection and journey branching not wired. |
| Propensity models / champion-challenger / uplift | ○ | — | ENT; rule engine only, no model registry. |

### 2.10 Journeys (FR-DLV-020 / DLV-019)

| Capability | Status | Where | Notes |
|---|---|---|---|
| State-machine journey orchestration | ✅ | `domains/journeys`, `POST /v1/journeys`, `journeys.test.ts` | Steps: send → wait → remind → end. |
| Event-driven advancement + deadline tick | ✅ | `POST /v1/journeys/tick`, `JourneyInstance.deadlineAt` | Waits on lifecycle signals or timeout; tick advances due instances. |
| Instance history | ✅ | `JourneyInstance.history` | Per-step audit trail. |
| Visual journey builder / A-B & NBA steps | ○ | — | ENT full builder; JSON-defined journeys only. |

### 2.11 Experiments (FR-ANL-021 / ANL-011)

| Capability | Status | Where | Notes |
|---|---|---|---|
| A/B experiments over template versions | ✅ | `domains/experiments`, `POST /v1/experiments`, `experiments.test.ts` | Weighted variants. |
| Deterministic assignment | ✅ | `selectVersion` (hash of experimentId+customerId) | Stable per-customer assignment. |
| Accessibility-gated variants | ✅ | every variant must have passed the a11y gate | Enforced at selection. |
| Per-variant outcome results + conclude | ✅ | `POST /v1/experiments/:id/results`, `/conclude` | Outcome-rate per variant; conclude with winner. |
| Multivariate / sequential guardrails | ○ | — | ENT. |

### 2.12 Translations / i18n (FR-I18N / I18N-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Machine-translation drafts (gated) | ✅ | `domains/translations`, `POST /v1/translations`, `translations.test.ts` | Dictionary/LLM method → draft requiring human approval. |
| Human review with SoD | ✅ | `TranslationService.review` | Mirrors content approval SoD. |
| Locale resolution with fallback | ✅ | `resolveContent` (exact → language-prefix → source) | Approving a variant never retires the source. |
| Translation memory | ✅ | `POST /v1/translation-memory/stats`, `memoryHits` | Segment reuse metric. |
| Locale formatting (dates/numbers/currency) | ✅ | `ValueFormat` at render | Applied by the binding layer. |
| RTL / CJK / LSP connectors / per-variant a11y packs | ○ | — | Designed; not built (RTL rendering, LSP round-trip are ENT). |

### 2.13 Analytics (FR-ANL / ANL-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Event fabric | ✅ | kernel CloudEvents bus; all domains emit | First-class events keyed to communication/template/identity. |
| Overview / outcome metrics | ✅ | `domains/analytics`, `GET /v1/analytics/overview`, `analytics.test.ts` | Outcome rate, call-deflection proxy, per-channel counts. |
| Journey funnels | ✅ | `GET /v1/analytics/funnel` | Step conversion per template. |
| Section hotspots | ✅ | `GET /v1/analytics/hotspots` | Section views/expands. |
| Communication + customer timelines | ✅ | `GET /v1/communications/:id/timeline`, `/customers/:id/timeline` | Unified per-identity history. |
| Audit-chain verification | ✅ | `GET /v1/audit/verify-chain` | Verifies the tamper-evident hash chain. |
| Event streaming out (webhooks) | ✅ | `domains/webhooks` (see 2.19) | HMAC-signed delivery of events. |
| Heatmaps / path & cohort / anomaly / narration | ○ | — | ENT. |
| BI warehouse shares | ○ | — | ENT. |

### 2.14 Archive / statement of record (FR-ARC / ARC-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Auto-archived statement of record | ✅ | `domains/archive`, `POST /v1/archive`, `archive.test.ts` | Manifest with data snapshot, versions, artifacts, renderer version. |
| Six-proof evidence pack | ✅ | `GET /v1/archive/:id/evidence-pack`, `EvidencePack` | Proof of content/delivery/access/version/AI/actions + event-chain intactness. |
| Reproducibility verification | ✅ | `GET /v1/archive/:id/verify`, `verifyReproducibility` | Re-renders from manifest and hash-compares. |
| Legal hold | ✅ | `POST /v1/archive/records/:recordId/legal-hold` | Blocks disposition and GDPR erasure. |
| Retention class | ✅ | `ArchiveRecord.retentionClass` (standard-7y/permanent) | Retention-due counted by lifecycle sweep. |
| WORM object-lock (compliance mode) | ◑ | content-addressed object store | App-layer immutability + hash chain real; storage-layer object-lock requires real WORM bucket (see replication §2.23). |
| eDiscovery search / export | ◑ | `GET /v1/archive` search by customer/template | Search real; chain-of-custody export manifest is partial. |
| Certified destruction / reviewer workspaces / migration-in | ○ | — | ENT. |

### 2.15 Accessibility (FR-ACC / ACC-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Accessibility publication gate (block-on-fail) | ✅ | `checkAccessibility`, `publish()` throws `accessibility-gate-failed`, `templates.test.ts` | Real gate on the block AST: alt text, heading structure, labels, reading order. |
| Accessibility report per version | ✅ | `AccessibilityReport`, `GET /v1/template-versions/:id/accessibility` | Issues with ruleId/severity/blockPath. |
| Acorn.Access embedded widget | ✅ | `/viewer-assets/acorn-access.min.js` in viewer | Zero-egress presentation layer per its own PRD. |
| Accessible interactive HTML output | ✅ | `rendering/html.ts` | Semantic HTML with headings/labels. |
| PDF/UA tagged output + veraPDF/PAC validation | ○ | — | PDF is pdfkit standard PDF; no tag tree / UA validation (needs a tagging engine + validators). |
| WCAG evidence packs (ACR/VPAT) | ○ | — | Gate report exists; formal ACR/VPAT generation not built. |
| AI auto-remediation (alt text, tag repair) | ◑ | AI draft path can draft alt text | Alt-text drafting via AI gateway; automated PDF tag-tree remediation not built. |

### 2.16 Compliance / security (FR-SEC / SEC-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Tenant isolation (tenant-scoped every path) | ✅ | `RequestCtx.tenantId` threaded through all services; `tenants.test.ts` | Every collection query tenant-scoped. |
| API-key auth (sha256-hashed secrets) + RBAC | ✅ | `domains/tenants`, `authenticate`, `Role` union | Roles: tenant-admin/business-author/designer/compliance-approver/operator/developer/auditor/service-agent. |
| Immutable, hash-chained audit log | ✅ | kernel event log, `GET /v1/audit/verify-chain` | Tamper-evident; verified by test. |
| Segregation of duties (author ≠ approver) | ✅ | content/translation review | Enforced. |
| Webhook SSRF guard + timing-safe compares | ✅ | hardening in webhooks + secure-link/OTP | Loopback/link-local/private targets rejected in prod; constant-time token/OTP compare. |
| DSAR / GDPR erasure | ✅ | `domains/lifecycle`, `POST /v1/customers/:id/erase`, `lifecycle.test.ts` | Redacts PII, revokes links, deletes objects, tombstones archive; refuses under legal hold. |
| SSO/SAML/OIDC, SCIM, ABAC, step-up MFA | ○ | — | API-key + RBAC only; enterprise IAM not built. |
| Field-level encryption / HSM / BYOK | ○ | — | Secrets hashed; envelope/field encryption not built (needs KMS/HSM). |
| SOC 2 / HIPAA / PCI / FedRAMP posture | N/A | — | Certifications/commercial commitments, not code artifacts. Payment path preserves SAQ-A shape (no PAN). |

### 2.17 Migration (FR-MIG / MIG-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Legacy HTML/text → template conversion | ✅ | `domains/migration`, `POST /v1/migration/jobs`, `migration.test.ts` | Block extraction, variable detection, content-candidate matching, complexity/effort scoring, draft template. |
| Duplicate / rationalization report | ✅ | `POST /v1/migration/duplicate-report` | Jaccard near-duplicate pairs over the library. |
| Parallel-run diff harness | ✅ | `POST /v1/migration/parallel-run` | Normalized text diff of two versions (added/removed lines, similarity). |
| Incumbent-format converters (Quadient/Exstream/…) | ○ | — | ENT; not built. |
| Print-stream re-engineering (AFP/Metacode/PCL) | ○ | — | ENT; needs print-stream parsers. |

### 2.18 Agent desk (FR-IXD-030 / DLV-009)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Contact-center workspace | ✅ | `domains/agent-desk`, `/agent`, `agent-desk.test.ts` | Customer search, overview, service notes. |
| Resend / reissue secure link (audited) | ✅ | `POST /v1/agent/communications/:id/resend`, `/reissue-link` | Every on-behalf action audited to the event chain. |
| Customer overview (360) | ✅ | `GET /v1/agent/customers/:id/overview` | Preferences, consents, communications, recent timeline. |
| CRM-embedded agent desktop | ○ | — | ENT; standalone workspace only. |

### 2.19 Webhooks / integration (INT-002 / FR-WLB-004)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Event subscriptions (pattern filters) | ✅ | `domains/webhooks`, `POST /v1/webhooks`, `webhooks.test.ts` | e.g. `com.acorn.delivery.*`. |
| HMAC-signed deliveries + retries | ✅ | `WebhookDelivery`, delivery log | Signed payloads, retry with status tracking. |
| Delivery log + replay | ✅ | `POST /v1/webhook-deliveries/:id/replay` | Replay for recovery. |
| SSRF protection | ✅ | webhook hardening | Private targets rejected in production. |
| CRM / contact-center / ESP / CPaaS connectors | ○ | — | Designed (INT-*); no vendor connectors (webhooks are the seam). |

### 2.20 Data lifecycle / GDPR (FR-SEC-006 / OPS-013)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Retention sweep | ✅ | `POST /v1/lifecycle/sweep`, `GET /v1/lifecycle/retention-due` | Revokes expired links, counts retention-due records. |
| GDPR/CCPA erasure with legal-hold block | ✅ | `POST /v1/customers/:id/erase`, `lifecycle.test.ts` | Dedupe-aware object deletion; refuses under hold; event log intentionally not rewritten (tamper-evidence). |
| Backup / restore / verify CLI | ✅ | `npm run backup` | Reference backup tooling. |

### 2.21 Batch (FR-RND-020 / RND-027..029)

| Capability | Status | Where | Notes |
|---|---|---|---|
| High-volume batch production | ✅ | `domains/batch`, `POST /v1/batches`, `batch.test.ts` | Bounded worker pool, throughput reporting. |
| Checkpointed pause/resume | ✅ | `POST /v1/batches/:id/pause`, `/resume`, `BatchRun.processed` | Resume skips already-processed records — no reprocessing. |
| Per-record error isolation | ✅ | `BatchRun.errors` | Bad records quarantine without failing the run. |
| Reconciliation totals | ✅ | batch + print reconcile | In = succeeded + errors; print `reconcile()` balances expected/mailed/delivered/returned. |
| 50M/month scale, checkpoint-under-failure DR test | ◑ | worker pool real | Mechanism real and tested at reference volume; scale target is an infra property. |

### 2.22 Mapping (FR-ING-010/012)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Mapping profiles (transform rules) | ✅ | `domains/mapping`, `POST /v1/mapping-profiles`, `mapping.test.ts` | copy/number/date-iso/trim/concat/constant. |
| Auto-suggestion by field-name similarity | ✅ | `POST /v1/mapping-profiles/suggest` | Deterministic confidence heuristic. |
| Dry-run apply + wired into ingestion/batch | ✅ | `apply()`, `mappingProfileId` on ingest/batch | Applied per record before validation. |

### 2.23 Replication (NFR-003 / ARC WORM offsite)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Offsite WORM replication to S3-compatible storage | ◑ | `domains/replication`, `POST /v1/replication/:id/replicate`, `replication.test.ts` | **Hand-rolled AWS SigV4 is real** (verified against the official AWS test vector); needs a real bucket configured via `ACORN_S3_*`. Skips cleanly when unconfigured. |
| Per-communication replication status | ✅ | `GET /v1/replication/status`, `ReplicationRecord` | Attempts, objects replicated, errors tracked. |
| Synchronous archive replication (RPO 0) | ○ | — | Async best-effort; synchronous cross-region WORM needs real multi-region infra. |

### 2.24 Usage / FinOps (FR-WLB-005 / NFR-009)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Event-driven usage metering | ✅ | `domains/usage`, `GET /v1/usage`, `usage.test.ts` | Reference unit rates + estimated cost, per period. |
| Per-key API rate limiting (429 + headers) | ✅ | `checkRateLimit`, `RateLimit`/`Retry-After` headers | In-memory token bucket (production: gateway-level). |
| Console usage tab | ✅ | `/console` Usage tab | Tenant-visible usage. |
| Per-sub-tenant metering / revenue-share | ○ | — | ENT (no reseller hierarchy). |

### 2.25 Observability / operations (NFR-008 / OPS-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Prometheus metrics | ✅ | `api/metrics`, `GET /metrics`, `metrics.test.ts` | Route-bounded HTTP counters/durations, event counters, gauges. |
| Request-id propagation | ✅ | `x-request-id` middleware | Correlation id on every request. |
| Health / readiness probes | ✅ | `GET /healthz`, `/readyz` | Container probes. |
| Operator console | ✅ | `/console` | Batch/communication monitoring, usage. |
| OpenTelemetry traces, status page, SLO dashboards | ◑ / ○ | Prometheus + request-id present | Metrics + correlation real; full OTel tracing, tenant status page, multi-region DR are infra-level (not built). |
| Zero-downtime deploy / multi-region | N/A / ○ | `Dockerfile`, `helm/` | Single-node reference deploy; blue-green and active-active need cluster infra. |

### 2.26 White-label / OEM (FR-WLB / WLB-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Embeddable viewer (postMessage / CSP) | ◑ | `settings.embedAllowedOrigins`, viewer shell | Iframe-embeddable viewer with allow-listed origins; postMessage contract partial. |
| Headless APIs (everything API-first) | ✅ | `api/openapi` (OpenAPI 3.1), ~133 routes | Full REST surface; every capability has an endpoint. |
| Recipient-surface branding | ✅ | `Brand` tokens rendered in viewer/email | Per-brand colors/logo. |
| Reseller/sub-tenant hierarchy + revenue share | ○ | — | ENT; not built. |
| SDKs (TS/Java/Python/C#) | ○ | — | OpenAPI spec published; generated SDKs not shipped. |

### 2.27 Developer experience / APIs (INT-001 / DEV-*)

| Capability | Status | Where | Notes |
|---|---|---|---|
| OpenAPI 3.1 spec | ✅ | `GET /v1/openapi.json`, `src/api/openapi.ts` (27 tags) | Covers the full REST surface. |
| RFC 9457 problem+json errors | ✅ | kernel error handling | Consistent error envelope. |
| Read-only GraphQL projection | ✅ | `POST /graphql`, `graphql.test.ts` | Composite reads with depth/size guards. |
| SQLite store adapter (Postgres seam) | ✅ | `adapters`, `ACORN_STORE=sqlite`, `sqlite-store.test.ts` | Whole platform runs on `node:sqlite` through the same `StorePort`. |
| SDKs / sandbox tenants / CLI / Postman collections | ○ | — | GA/ENT DX; not built. |

### 2.28 MCP (agentic surface)

| Capability | Status | Where | Notes |
|---|---|---|---|
| MCP stdio server | ✅ | `src/mcp`, `npm run mcp`, `mcp.test.ts` | Allow-listed, role-checked, audited tools. |
| Read/query tools | ✅ | `mcp/tools.ts` | list_templates, search_content, search_communications, get_communication, get_customer_timeline, get_delivery_status, get_analytics_overview, search_archive. |
| Governance tools | ✅ | `mcp/tools.ts` | explain_communication, generate_evidence_pack, check_template_accessibility. |
| Draft tool (human approval required) | ✅ | `draft_content` | Drafts only — **no delivery initiation exposed via MCP** by design. |

---

## 3. Output format coverage

Every format the PRD enumerates (FR-RND-002/003/004), mapped to the `RenderFormat` union
(`html | pdf | email-html | sms-text | text | voice-script`) and the `rendering/` renderers.

| Output format | Status | Where | Notes |
|---|---|---|---|
| Interactive HTML5 | ✅ | `rendering/html.ts` | Semantic, accessible interactive rendition; drives the viewer. |
| PDF | ✅ | `rendering/pdf.ts` (pdfkit) | Real standard PDF. |
| Plain text | ✅ | `rendering/text.ts` | Text rendition (fallback/SMS body source). |
| HTML email (+subject convention, `{{link}}`) | ✅ | `rendering/email.ts` | Email-safe HTML; `email-html` format. |
| SMS text | ✅ | `rendering/index.ts` `sms-text` | Short-form with `{{link}}`. |
| Voice / SSML script | ✅ | `rendering/voice.ts` `voice-script` | SSML-annotated voice script (text artifact). |
| MJML email source | ◑ | email renderer | Email-safe HTML produced; MJML *source* output not emitted. |
| JSON / XML data rendition | ◑ | `ComposedDocument` is structured JSON internally; GraphQL/artifact APIs expose JSON | No dedicated `xml`/`json` render artifact format enum entry. |
| PDF/A (1b/2b/3b) | ○ | — | Standard PDF only; archival conformance needs a PDF/A pipeline. |
| PDF/UA (tagged accessible) | ○ | — | No tag tree; needs a tagging engine + veraPDF/PAC validation. |
| PDF/VT | ○ | — | ENT print; not built. |
| Word (.docx) / Excel (.xlsx) / PowerPoint (.pptx) | ○ | — | ENT Office renditions; need Office-format libraries. |
| Interactive/actionable PDF (forms) | ○ | — | ENT. |
| AFP (with TLE index) | ○ | — | ENT print stream; needs AFP toolkit + bureau. |
| PCL | ○ | — | ENT legacy printer stream; needs external infra. |
| PostScript | ○ | — | ENT legacy printer stream; needs external infra. |
| ZPL (labels) | ○ | — | ENT; not built. |
| TIFF (image) | ○ | — | ENT; needs rasterizer. |
| Line data / Metacode | ○ | — | ENT host print formats. |
| Personalized video (MP4/stream) | ○ | — | Needs a video rendering farm this environment cannot run. |
| Audio rendition (TTS) | ○ | — | `voice-script` is the SSML source; real TTS audio needs an external TTS service. |

**Honest summary:** the engine renders **6 real formats** covering the entire MVP digital wedge
(interactive HTML, PDF, email, SMS, text, voice script). Archival PDF variants, Office formats, and
all production/legacy print streams and personalized media are designed-only — each blocked on
external infrastructure or heavy format toolkits, consistent with the PRD's ENT scoping.

---

## 4. Channel coverage

Against the `Channel` union (`email | sms | secure-link | webhook | print`) and `domains/delivery`.

| Channel | Status | Where | Notes |
|---|---|---|---|
| Email | ◑ | `providers.ts` email provider | Real orchestration/consent/failover; writes `.eml` to `data/outbox/` — not a real SMTP/SES send. |
| SMS | ◑ | `providers.ts` sms provider | Writes `.sms.json` to outbox — not a real Twilio/aggregator send. |
| Secure link | ✅ | `providers.ts` secure-link, `SecureLink` | Real expiring token links + optional OTP; fully functional in the viewer. |
| Webhook (API delivery) | ✅ | `domains/webhooks` | Real HMAC-signed HTTP delivery to subscriber URLs (SSRF-guarded). |
| Print | ◑ | `domains/print`, print provider | Real householding/presort/IMB/suppression/reconciliation; output is a **spool manifest file**, not a real bureau handoff. |
| MMS | ○ | — | ENT; not in channel enum. |
| RCS | ○ | — | ENT. |
| WhatsApp Business | ○ | — | ENT. |
| Mobile push | ○ | — | ENT. |
| Portal (hosted) | ◑ | viewer + agent desk | Token viewer + operator console exist; a branded self-service recipient portal is partial. |
| In-app inbox | ○ | — | ENT SDK. |
| Chat platform | ○ | — | ENT. |
| Voice / IVR | ○ | — | `voice-script` renders; live voice/IVR delivery is ENT. |
| Certified mail (return receipt) | ○ | — | ENT. |

---

## 5. Simulated vs. production-ready

The reference build runs entirely on one node with file-backed storage and no external vendor
accounts, yet every simulated seam sits **behind the exact interface** a production adapter would
implement. Nothing about the domain logic changes when the seam is swapped — that is the point of the
architecture. The table below is the complete list of simulated seams and precisely what production
requires.

| Seam | What is real | What is simulated | To productionize |
|---|---|---|---|
| **Storage** | All CRUD, tenancy, hash-chaining, object addressing run through `StorePort` / `ObjectStorePort` (`src/kernel/storage.ts`); a SQLite adapter already runs the whole platform via `ACORN_STORE=sqlite`. | Default is file-backed collections + local object store. | Implement `StorePort`/`ObjectStorePort` against Postgres + S3/GCS/Azure Blob. No domain code changes. |
| **Email / SMS / print delivery** | Channel plan, consent/DNC hard-blocks, failover ladder, retry, scheduling, quiet hours, frequency caps, reconciliation ledger — all real and tested. | Providers write `.eml` / `.sms.json` / spool-manifest files to `data/outbox/` (`domains/delivery/providers.ts`, `ChannelProvider`). | Implement `ChannelProvider.send()` for SES/SendGrid (email), Twilio/Sinch (SMS), and a real PSP handoff (print). Register in `createProviders()`. |
| **Payments** | Pay action capture, outcome event, timeline entry, webhook, and SAQ-A posture (platform never holds PAN) are real. | `action:'pay'` records an `ActionTransaction` with a simulated tokenized payload — no gateway call. | Integrate a tokenized hosted-fields gateway (Stripe/Adyen/ACI) at the viewer action; write the gateway token/confirmation into the action payload. |
| **AI / assistant** | Grounding, citations, confidence gating, PII redaction pre-inference, escalation, full audit — all real and enforced through `AiGateway`. | Default provider is a **deterministic grounded-retrieval** stand-in; a real Anthropic provider activates with `ANTHROPIC_API_KEY`. | Set `ANTHROPIC_API_KEY` (or implement another `AiGateway` provider). Per-tenant model routing/BYO policy engine is the ENT extension. |
| **Offsite archive replication** | AWS SigV4 signing is hand-rolled and **verified against the official AWS test vector**; retry and per-communication status are real (`domains/replication`). | Skips when no bucket is configured; runs against any S3-compatible endpoint when set. | Provide a real bucket + credentials via `ACORN_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`. Enable object-lock on the bucket for WORM. |
| **OTP / secure-link auth** | Expiry, one-time semantics, timing-safe comparison are real. | OTP code is generated and displayed rather than sent via a second factor. | Route the OTP through the email/SMS provider once those are live. |
| **Rate limiting** | Token-bucket enforcement + `429`/`Retry-After`/`RateLimit` headers are real. | In-memory per-key bucket (single node). | Move to a shared gateway/Redis limiter for multi-node. |

---

## 6. Metrics footer

| Metric | Value | Source |
|---|---|---|
| Capability domains (`src/domains/*`) | **24** | `ls src/domains` (agent-desk, ai, analytics, archive, batch, composition, content, delivery, experiments, ingestion, journeys, lifecycle, mapping, migration, nba, print, rendering, replication, templates, tenants, translations, usage, viewer, webhooks) |
| HTTP route registrations | **~133** | `grep -rE "app\.(get|post|put|delete|patch)\('…'"` across `src` (≈118 distinct route strings + method variants) |
| OpenAPI tags (documented API groups) | **27** | `src/api/openapi.ts` |
| MCP tools | **12** | `src/mcp/tools.ts` |
| Render formats (real) | **6** | `RenderFormat` in `src/kernel/contracts.ts` |
| Channels (enum) | **5** | `Channel` in `src/kernel/contracts.ts` |
| Tests passing | **195** (32 files) | `npx vitest run` (observed 2026-07-07) |
| Source lines (`src/**/*.ts`) | **15,688** | `find src -name '*.ts' | xargs wc -l` |

### Coverage headline

Counting the discrete capability rows across §2–§4 (excluding N/A certification/commercial rows):

- **✅ Implemented & tested:** ~78
- **◑ Partial / simulated (behind the right interface):** ~26
- **○ Designed only (ENT-scoped / needs external infra):** ~52

**Reading:** the MVP outcome loop — ingest → govern content → design → compose → render (6 formats)
→ deliver (with consent/failover/scheduling) → interact (viewer + grounded assistant + actions) →
measure (events/funnels/outcomes) → archive (six-proof evidence pack, reproducibility) → prove
(a11y gate, audit chain, GDPR erasure) — is **fully built and tested**. The ◑ rows are production
seams that swap without touching domain code. The ○ rows are, almost without exception, the
explicitly ENT-scoped items from PRD §19 (native print streams, additional channels, personalized
media, reseller/white-label depth, enterprise IAM, multi-region) — each blocked on external
infrastructure this reference environment cannot run, not on missing product design.
