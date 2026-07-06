# 10 — Phased Roadmap & Cost Model

**Document:** Acorn Communicate — Build Roadmap (Part A) and Cloud Cost Architecture / Unit Economics (Part B)
**Status:** Build-ready strategy input
**As-of:** 2026-07 planning baseline
**Owner:** Product Strategy + Platform Engineering + FinOps

---

# PART A — Phased Roadmap

## A.0 Roadmap at a Glance

| Phase | Name | Duration | Headline outcome | Team size (eng) |
|---|---|---|---|---|
| 0 | Foundations | 1 quarter | Multi-tenant control plane, identity, event backbone live in staging + prod | 12–16 |
| 1 | MVP | 2 quarters | First design-partner tenants composing, delivering, archiving interactive + PDF/UA communications with AI authoring | 24–32 |
| 2 | GA | 2 quarters | Enterprise-sellable: print streams, postal, journeys, NBA v1, migration studio v1, compliance packs, GraphQL, MCP server | 40–55 |
| 3 | Enterprise | 2–3 quarters | Voice/video, personalized video, AI voice agents, BYOK/HYOK, customer-VPC, white-label/OEM, marketplace, advanced FinOps | 60–80 |
| 4 | Market leadership | ongoing | Agentic journeys, knowledge graphs, predictive optimization | 80+ |

Guiding rule (from doc 03, risk R8): each quarter has exactly one "invent" theme and one
"catch up to table stakes" theme — never two invent themes in parallel.

---

## A.1 Phase 0 — Foundations (Q1)

**Objectives**
1. Stand up the multi-tenant control plane every later service plugs into — tenancy, config,
   entitlements, metering hooks — so no service is ever built single-tenant and retrofitted.
2. Identity and authorization: OIDC/SAML SSO, SCIM, fine-grained RBAC/ABAC (tenant → workspace
   → brand → template scopes), service-to-service auth (mTLS + workload identity).
3. Event backbone: durable pub/sub (Kafka-compatible) with schema registry; every domain event
   (content.changed, render.completed, message.delivered, action.completed) versioned from day 1
   — this is the substrate for analytics, outcome measurement, and billing metering.
4. Golden-path engineering: IaC (Terraform), CI/CD, environments (dev/stage/prod), SLO
   framework, secrets management, audit logging, data classification tagging.

**Key deliverables**

| Deliverable | Definition of done |
|---|---|
| Control plane v1 | Tenant CRUD, per-tenant config/entitlements API, tenant isolation test suite passing |
| Identity v1 | SSO (OIDC+SAML), SCIM provisioning, RBAC with 4-level scope hierarchy, audit log of all authz decisions |
| Event backbone v1 | 3+ AZ cluster, schema registry with compatibility rules, dead-letter + replay tooling, 99.9% publish SLO |
| Metering v0 | Every event type carries tenant_id + billable-unit annotations; raw usage lake landing |
| Security baseline | Encryption at rest/in transit everywhere, secrets rotation, SAST/DAST in CI, pen-test scheduled |

**Entry criteria:** founding platform team hired (≥10 eng), cloud accounts + landing zone approved, architecture decision records (ADRs) for tenancy model and event schema signed off.
**Exit criteria:** two demo tenants fully isolated (verified by automated cross-tenant access tests); event backbone sustaining 10k events/s in load test; deploy-to-prod lead time <1 day.
**Team shape:** 1 platform lead, 6–8 platform/infra eng, 2–3 identity/security eng, 2 SRE, 1 PM, 1 architect.
**Dependencies:** cloud provider selection (primary + portability plan), legal review of data-residency architecture.
**Risks:** over-engineering the control plane (timebox: 1 quarter, cut scope not time); under-specifying event schemas (mitigate: schema review board, mandatory compatibility checks).

---

## A.2 Phase 1 — MVP (Q2–Q3)

**Objectives:** a design-partner tenant can ingest data, manage content, design a template,
render it as an interactive HTML5 document and PDF/PDF-UA, deliver via email/SMS/secure link,
archive it, see analytics, and use AI assistance for authoring and in-document Q&A — with
accessibility gates enforced. 3–5 design partners (1 credit union, 1 insurer, 1 utility target mix).

**Key deliverables**

| Workstream | Deliverable | Notes |
|---|---|---|
| Ingestion core | Batch (SFTP/S3, CSV/JSON/XML) + REST ingestion; schema mapping UI; PII detection/tagging | 1M records/hr initial target |
| CMS core | Structured content model (blocks, variants, metadata: intent/audience/jurisdiction), versioning, approval workflow v1, localization-ready | The semantic model from doc 03 §3.1 — get this right; everything depends on it |
| Designer v1 | Browser-based template designer; components bound to content model; preview across channels; brand kits | No desktop client, ever |
| Render: interactive | Stateful HTML5 doc runtime: secure token access, embedded actions framework v1 (pay-redirect, update-info, dispute-intake), offline/expiry policies | Actions are pluggable; payments via PSP integration (Stripe/adyen-class), not in-house |
| Render: PDF/PDF-UA | Single template → tagged, PDF/UA-conformant PDF; visual parity tests vs HTML5 | Shared layout engine, two projections |
| Delivery | Email (native + SES/SendGrid-class relay), SMS (Twilio-class), secure-link (hosted doc + notification); suppression, bounce, retry policies | Deliverability engineering starts here (dedicated IPs, DKIM/DMARC tooling) |
| Archive core | Immutable store of rendered artifact + data + template version + delivery evidence; retention policies; search API | WORM tiering deferred to Phase 2/3, schema supports it now |
| Analytics core | Delivery funnel (sent→delivered→opened→action-started→action-completed), per-template dashboards, event export | Outcome events first-class from day 1 |
| AI authoring assistant | Draft/rewrite/tone/reading-level/summarize inside Designer; grounded on tenant content + brand rules; suggestion-only (human accepts) | Eval harness v1 ships with it: grounding score, PII leak check, brand-rule check |
| AI document assistant | Embedded Q&A in interactive doc, grounded strictly on the doc + approved tenant KB; hard refusal outside scope; full transcript audit | The doc 03 §3.3 flagship — pilot on 1 partner's bill/statement |
| WCAG gates | WCAG 2.2 AA + PDF/UA automated validation in render pipeline; **block-on-fail** with governed override + audit trail | Differentiator row 30; ships in MVP deliberately, not later |

**Entry criteria:** Phase 0 exit met; design partners contracted with data-sharing agreements; AI provider agreements (incl. no-training clauses) signed.
**Exit criteria:** 3+ design partners in weekly production-like use; 500k communications/month aggregate sustained; render p95 <2s on-demand; accessibility gate pass rate >98% on partner templates; document assistant answering ≥80% of in-scope questions correctly in partner evaluation; SOC 2 Type I audit underway.
**Team shape (~28 eng):** squads of 4–6 for: ingestion+CMS, designer, render, delivery+archive, analytics+metering, AI (2 squads: authoring, doc assistant + eval harness); plus 3 SRE, 2 security, 3 PM, 2 design.
**Dependencies:** PSP partnership for embedded pay; email/SMS provider contracts; AI model provider capacity commitments.
**Risks:** semantic content model churn (mitigate: 2-week spike + ADR before build; design-partner template audits up front); AI assistant scope creep (mitigate: strict in-scope taxonomy per doc type); dual-render parity bugs (mitigate: golden-file visual regression suite from week 1).

---

## A.3 Phase 2 — GA (Q4–Q5)

**Objectives:** close the enterprise table-stakes gap (print/postal, journeys, compliance
certs) and land the two strategic wedges (migration studio, MCP server) while the competitive
window is open (doc 03 §3.4, §3.7). Sellable to mid-tier banks/insurers/utilities without
caveats.

**Key deliverables**

| Workstream | Deliverable | Notes |
|---|---|---|
| Print streams | AFP, PCL, PostScript output from the same template source; resource management (fonts, overlays); print-file validation | Third-party render licenses evaluated vs build; parity tests vs PDF |
| Postal/USPS | Presort (CASS/PAVE via partner), address hygiene, IMb tracking, householding, commingling handoff to PSPs, postal manifests | Partner-first: integrate certified presort engines, don't rebuild |
| Journey orchestration | Event-triggered multi-step journeys (send → wait → branch on action/no-action → escalate channel); journey designer UI; frequency capping, quiet hours, preference enforcement | Preference/consent engine graduates to per-doc-type granularity |
| NBA v1 | Rules + propensity-model next-best-action slots inside communications and journeys; experimentation framework (A/B at block level) | Feeds on Phase 1 outcome events — the flywheel starts |
| Migration studio v1 | Ingest Exstream + Inspire + DOC1 estates: parse, extract content/logic, similarity clustering + dedupe (rationalization), human-in-loop review UI, emit Acorn semantic model; automation-rate telemetry | Target ≥60% automated conversion on benchmark estates before public claims (doc 03 R3) |
| Compliance packs | SOC 2 Type II complete; HIPAA (BAA-ready architecture + controls); GDPR (DPA, DSAR tooling, residency controls); PCI SAQ-A posture for pay flows | Gate for regulated-vertical sales |
| GraphQL | Public GraphQL API over content, templates, communications, analytics; complements REST; rate limiting + persisted queries | |
| MCP server | First-party MCP server: typed tools for compose/preview/send/query-archive/get-analytics; per-tool permission scopes; human-approval steps for regulated sends; spend/rate limits; full audit | Phase 2, non-negotiable — window closes (doc 03 R6) |
| Archive hardening | Legal hold, retention schedules per jurisdiction, WORM-capable storage class integration, bulk export | |

**Entry criteria:** Phase 1 exit met; 2+ design partners committed to GA reference status; print partner (PSP) agreement for fulfillment interim.
**Exit criteria:** first production print run through a PSP with zero postal rejects; 10M communications/month aggregate; SOC 2 Type II report issued; migration benchmark published (≥60% automation on a ≥1,000-template estate); MCP server demoed with an external agent completing a governed send; 8–12 paying tenants; gross revenue retention ≥95%.
**Team shape (~48 eng):** Phase 1 squads continue; add print/output squad (6), journeys squad (5), migration squad (6, heavy AI/ML), NBA/ML squad (4), API/platform-DX squad (4); SRE to 6; security/compliance to 4; solutions engineering function starts (3).
**Dependencies:** presort/address-quality vendor contracts; audit firm engagement (started in Phase 1); PSP fulfillment partners; model capacity for migration parsing workloads.
**Risks:** print-stream fidelity issues eroding credibility with PSPs (mitigate: certification lab with physical printer targets, PSP pilot before GA); journey engine scope explosion (mitigate: 6 canonical journey patterns only at GA); migration automation shortfall (mitigate: benchmark gate before marketing claims).

---

## A.4 Phase 3 — Enterprise (Q6–Q8)

**Objectives:** win tier-1 regulated enterprises and open the OEM channel. Everything a
top-10 bank's procurement, security, and model-risk teams require; everything a PSP or
software vendor needs to embed Acorn invisibly.

**Key deliverables**

| Workstream | Deliverable | Notes |
|---|---|---|
| Voice channel | Outbound voice notifications (TTS), IVR-linked communications, call-context handoff | Provider-based telephony (Twilio-class) |
| AI voice agents | Grounded voice agent for inbound "about this communication" calls; same grounding + audit rules as doc assistant; barge-to-human always available | Extends §3.3 differentiator to voice; regulated-class doc types opt-in only |
| Personalized video | Data-driven personalized video (bill explainers, onboarding); template-based scenes + TTS narration; interactive chapters | Counter to EngageOne Video (matrix row 14 P→S); partner or build decision gate at Phase 3 start |
| BYOK/HYOK | Tenant-managed keys (BYOK) and hold-your-own-key via external KMS/HSM; per-tenant crypto-shredding | |
| Customer-VPC deployment | Terraform/Helm-packaged deployment into customer cloud accounts; version channel + managed-update tooling; degraded-mode design for AI services (VPC-local or provider-in-region model options) | Single codebase, deployment profiles — no forks |
| White-label/OEM | Multi-tier tenancy (platform → partner → end-tenant), rebrand kit (UI theming, domains, email identities), partner admin console, revenue-share billing/metering | Doc 03 §3.8; target 1 signed PSP or core-vendor OEM live |
| Marketplace | Partner-built connectors, content packs, action plugins; review + signing pipeline; rev-share | Start curated (10–20 launch partners), not open |
| Advanced FinOps | Tenant-facing cost/usage dashboards, budgets + alerts, per-communication cost attribution, AI usage metering surfaced to tenant admins | Part B §B.7 productized |
| Scale hardening | 100M+ communications/month architecture validation; multi-region active-active for control plane; RTO <1h / RPO <5min for production data | |

**Entry criteria:** Phase 2 exit; 2+ tier-1 prospects in structured evaluation; OEM LOI signed.
**Exit criteria:** 1+ tier-1 regulated enterprise in production; 1+ OEM partner live with ≥2 sub-tenants; customer-VPC deployment running at a bank with quarterly managed updates proven; 100M/month load test passed; FedRAMP readiness assessment complete (authorization pursued only with committed gov pipeline).
**Team shape (~70 eng):** add voice/video squad (6), VPC/deployment squad (6), OEM/tenancy squad (5), marketplace squad (4), FinOps squad (3); dedicated performance team (4); professional services + partner engineering org spun up (8–12, outside core eng count).
**Dependencies:** HSM/KMS integrations; telephony + video rendering partners; OEM contract framework (legal); FedRAMP sponsor if pursued.
**Risks:** VPC deployment forking the codebase (mitigate: deployment-profile architecture reviewed at Phase 3 entry, single main branch enforced); OEM channel conflict (doc 03 R7 — rules of engagement before first OEM sale); voice agents in regulated flows triggering compliance incidents (mitigate: opt-in per doc class, human-review sampling, kill switch per tenant).

---

## A.5 Phase 4 — Market Leadership (Q9+)

**Objectives:** compound the data and agent moats. Communications stop being scheduled
artifacts and become policy-governed, agent-negotiated interactions.

**Key deliverables (thematic, re-planned quarterly)**

| Theme | Deliverable direction |
|---|---|
| Agentic journeys | Journeys where an AI agent chooses channel/timing/content-variant per customer within hard policy bounds; approval simulation ("show me what the agent would do this month") before enablement; full decision audit |
| Knowledge graphs | Cross-tenant-schema customer-communication graph per tenant: entities (customer, product, obligation, communication, outcome) enabling "every customer with an unresolved dispute older than 30 days who wasn't contacted" as a first-class query and journey trigger |
| Predictive optimization | Send-time, channel-mix, content-variant, and reading-level optimization trained on outcome labels (doc 03 §4.2 flywheel); uplift reported per tenant against their own baseline |
| Agent-to-agent | Acorn's MCP surface consumed by customer-side agents (a consumer's assistant negotiating paperless enrollment or payment plans with a bank's Acorn instance) — standards-track participation |
| Regulatory intelligence | Regulation-change feeds mapped automatically to affected content (matrix row 28 at Strong), with drafted compliant revisions queued for human approval |

**Entry criteria:** Phase 3 exit; ≥25 production tenants; outcome-event corpus ≥500M events.
**Exit criteria (leadership signals):** top-right analyst placement; ≥30% of new bookings influenced by AI/agentic differentiators; ≥3 OEM partners; net revenue retention ≥120%.
**Team shape:** 80+ eng; dedicated ML platform org; research partnerships.
**Risks:** agentic autonomy incidents (mitigate: simulation-first enablement, bounded policies, insurance/legal review); model cost drift (Part B §B.6 controls become existential at this scale).

---

## A.6 Cross-Phase Dependency Summary

| Dependency | Needed by | Owner | Lead time |
|---|---|---|---|
| Semantic content model ADR | Phase 1 start | Architecture | Phase 0 |
| AI provider contracts (no-training, capacity, region options) | Phase 1 start | Legal/Procurement | 6–10 weeks |
| PSP print fulfillment partner | Phase 2 print pilot | BD | 1 quarter |
| Presort/address vendor | Phase 2 | BD/Eng | 1 quarter |
| SOC 2 audit firm | Type I in Phase 1, Type II in Phase 2 | Security | Start Phase 0 |
| PSP/OEM legal framework | Phase 3 | Legal | 2 quarters |
| Outcome-event corpus | Phase 4 ML | Product analytics | Accumulates from Phase 1 |

---

## A.7 Indicative R&D Investment by Phase

Fully-loaded cost assumption: $250k/eng-year blended (salary, benefits, tooling, cloud dev
spend); PM/design/SRE/security included in headcounts above where noted, otherwise +25%
loading applied. Planning figures ±25%.

| Phase | Duration | Avg eng FTE | Eng cost | Non-eng loading (25%) | Cloud (pre-rev + staging) | Phase total | Cumulative |
|---|---|---|---|---|---|---|---|
| 0 | 1 qtr | 14 | $0.9M | $0.2M | $0.1M | ~$1.2M | $1.2M |
| 1 | 2 qtr | 28 | $3.5M | $0.9M | $0.4M | ~$4.8M | $6.0M |
| 2 | 2 qtr | 48 | $6.0M | $1.5M | $0.8M | ~$8.3M | $14.3M |
| 3 | 3 qtr | 70 | $13.1M | $3.3M | $1.5M | ~$17.9M | $32.2M |
| 4 | per year | 85+ | $21M+/yr | $5M+/yr | scales with revenue | — | — |

Checkpoint: cumulative spend to GA (~$14M) should be validated against pipeline at Phase 2
entry — if <$5M ARR equivalent in committed design-partner conversion + qualified pipeline at
that gate, slow Phase 3 hiring rather than cut Phase 2 scope.

---

# PART B — Cost Model

## B.1 Cost Architecture Principles

1. **Every billable action emits a metered event** (Phase 0 metering hooks) with tenant_id,
   workload class, and resource attribution — cost allocation is a data pipeline, not a
   spreadsheet.
2. **Four unit economics govern the platform.** All architecture decisions are evaluated
   against their effect on: cost per rendered communication, cost per delivered message, cost
   per archived GB-month, cost per AI-assisted action.
3. **Workload isolation by class, not by tenant (until Enterprise tier).** Batch render,
   on-demand render, interactive serving, AI inference, and analytics run in separate
   autoscaling pools with independent SLOs — a 5M-document batch job must never affect
   interactive p95.
4. **Cheapest-capable resource wins.** Small model before large model, cache before render,
   warm storage before hot, spot before on-demand, batch before real-time — with automatic
   escalation when quality/SLO demands it.

## B.2 Unit Economics — Targets

Targets at GA scale (aggregate ≥10M comms/month), infrastructure cost only (excl. eng, support,
third-party per-message carrier fees shown separately). Figures are planning targets ±40%;
recalibrate quarterly against actuals.

| Unit | Definition | Target cost | Dominant drivers |
|---|---|---|---|
| Rendered communication (batch) | Compose+render one doc (HTML5 + PDF projections) in batch | $0.0015–0.004 | CPU-seconds of render, template complexity, cache hit rate |
| Rendered communication (on-demand) | Same, real-time API, p95 <2s | $0.004–0.010 | Provisioned headroom, cold-start avoidance |
| Delivered message — email | Delivery infra + tracking (excl. relay fees ~$0.0004–0.001) | $0.0005–0.001 | Relay fees, IP/deliverability infra amortization |
| Delivered message — SMS | Infra only (carrier fees $0.004–0.008 US pass-through) | $0.0002 | Carrier fees dominate; treat as pass-through |
| Delivered message — secure link | Hosted interactive doc serving, 90-day active window | $0.001–0.003 | Serving compute, per-view assistant availability |
| Archived GB-month (blended) | Storage + index + retrieval provisioning across tiers | $0.006–0.015 | Tiering mix, compression, index size |
| AI-assisted action — authoring suggestion | One assistant interaction in Designer | $0.002–0.02 | Model routing mix, prompt cache hit rate |
| AI-assisted action — doc assistant turn | One grounded Q&A turn in a delivered doc | $0.003–0.03 | Context size (mitigated by prompt caching), model tier |
| AI migration — per legacy template | Parse+extract+rationalize one template (automated share) | $0.10–0.60 | Batch inference pricing, estate similarity (dedupe reduces marginal cost) |

## B.3 Autoscaling & Workload Isolation

| Pool | Workload | Compute strategy | Scaling signal | Isolation guarantee |
|---|---|---|---|---|
| Batch render | Scheduled statement runs | Kubernetes jobs on spot/preemptible (target 60–70% spot mix), queue-drained | Queue depth + deadline SLA | Separate node groups; cannot preempt interactive |
| On-demand render | API-triggered compose | Provisioned baseline + fast horizontal autoscale; warm render workers | RPS + p95 latency | Dedicated pool, per-tenant rate limits |
| Interactive serving | HTML5 doc runtime, actions | Stateless serving + CDN; edge caching of doc shell | Concurrent sessions | CDN absorbs spikes; origin autoscales |
| AI inference | Assistants, generation, evaluation | Provider APIs (Phases 1–2) → mixed provider + dedicated capacity (Phase 3+); routing layer owns placement | Token throughput + queue latency per priority class | Per-tenant token budgets enforce fairness |
| Analytics/ML | Event processing, dashboards, training | Streaming (provisioned small) + batch (spot) | Lag + backlog | Never shares pools with serving |
| Migration | Estate parsing | Pure batch, spot, off-peak, batch-inference AI pricing | Job backlog | Fully async; days-long SLAs acceptable |

**Noisy-neighbor controls:** per-tenant concurrency + rate limits at API gateway; per-tenant
render-queue weights; Enterprise tier can buy dedicated pools (priced as provisioned-capacity
add-on).

## B.4 Render Reuse & Caching

Render cost is the largest controllable infra line. Strategy, in order of leverage:

1. **Fragment render cache:** template regions that don't vary per recipient (headers, legal
   blocks, marketing panels) render once per template-version × channel and are composited.
   Expected effect on typical statements: 40–70% of layout work cached. Cache key =
   (template_version, fragment_id, locale, channel, brand).
2. **Prompt/context caching for AI (see B.6):** the analogous win on the AI side.
3. **Deferred projection:** render HTML5 + PDF at production time only if delivery requires
   it; archive stores data + template ref and re-renders on retrieval for low-access doc
   classes ("lazy archive render"), trading storage for compute. Enabled per doc class where
   regulation permits reproduction-based archives; default remains store-the-artifact.
4. **CDN + shell caching for interactive docs:** doc runtime shell is one cached asset;
   per-recipient payload is a small encrypted data blob.
5. **Batch packing:** group renders by template_version to maximize fragment-cache locality;
   measured target ≥85% fragment-cache hit rate on mature templates.

## B.5 Storage Tiering

| Tier | Store class | Use | Target cost/GB-mo | Transition rule |
|---|---|---|---|---|
| Hot | SSD-backed object + search index | 0–90 days: active docs, interactive state, recent archive queries | $0.02–0.03 (+index) | Age > 90d and access < 1/mo → Warm |
| Warm | Standard object storage | 90d–2y: occasional retrieval (service inquiries) | $0.010–0.023 | Age > 2y → Cold |
| Cold | Infrequent-access / archive-instant class | 2y–retention end: compliance retrieval, minutes-SLA | $0.002–0.005 | Retention schedule |
| WORM | Object-lock (compliance mode) parallel copy | Regulated doc classes (SEC 17a-4-style, legal hold) from day of production | $0.004–0.012 | Immutable until retention expiry; legal hold overrides |

Levers: content-addressed dedupe of identical artifacts (shared legal inserts), columnar
compression of data payloads (3–8×), index-lite design for Cold (metadata-only search,
artifact fetched on demand). Blended archive target from B.2 assumes ~10/25/60/5%
hot/warm/cold/WORM mix at steady state.

## B.6 AI Cost Controls

AI is the fastest-growing and most volatile COGS line (doc 03 risk R5). Controls, all
enforced by a central **model gateway** every AI call traverses:

| Control | Mechanism | Expected saving |
|---|---|---|
| Model routing (small-first) | Classifier routes each request: small model for classification/extraction/routine rewrites; large model for complex drafting, compliance reasoning; escalation on low confidence. Target mix ≥70% of calls on small/medium tiers | 50–75% vs all-large |
| Prompt caching | Stable prefixes (system policies, tenant brand rules, document context for multi-turn assistant sessions) cached at provider; doc-assistant sessions especially (same doc context every turn) | 60–90% of input-token cost on cached segments |
| Batch inference | Migration parsing, content rationalization, bulk compliance re-checks, eval runs → provider batch APIs (typically ~50% discount, hours-SLA) | ~50% on batch-eligible workloads (est. 30–40% of total tokens) |
| Response caching | Identical grounded questions on identical doc versions (top-N FAQ per template) served from semantic cache with freshness rules | 20–40% of doc-assistant calls at scale |
| Output budgets | Max-token policies per action type; retrieval-narrowing before generation | 10–20% |
| Tenant budgets & visibility | Hard/soft token budgets per tenant per feature; admin dashboards (spend to date, projection, per-feature breakdown); overage behavior configurable (throttle / degrade-to-smaller-model / bill) | Prevents blowouts; enables AI metering revenue |
| Eval-tier routing | Evaluation gates (grounding, PII, brand) run on small specialized models/classifiers, not frontier models | Keeps safety overhead <15% of AI spend |

**Governance:** weekly AI COGS review until GA, then monthly; per-feature $/action tracked
against B.2 targets; any feature exceeding target 2 consecutive months gets a routing/caching
remediation plan or a pricing change.

## B.7 FinOps Dashboards

| Dashboard | Audience | Contents |
|---|---|---|
| Platform COGS | Eng leadership | $/rendered, $/delivered, $/GB-mo, $/AI-action vs targets; spot coverage; cache hit rates; per-pool utilization |
| Tenant P&L | Product/finance | Per-tenant revenue vs attributed cost, gross margin, trend, anomaly flags |
| AI spend | Eng + product | Token volume by model tier/feature/tenant; routing mix; cache hit rate; batch share; budget breaches |
| Tenant-facing usage (Phase 3) | Customer admins | Their communications, AI actions, storage, projected bill, budget controls |
| Unit-cost regression gate | CI/CD | Load-test-derived $/1k renders on release candidates; block release on >10% regression without waiver |

## B.8 Serverless vs Provisioned

| Workload | Choice | Rationale |
|---|---|---|
| API/control plane | Provisioned containers + autoscale | Steady traffic; serverless per-request premium not justified |
| On-demand render | Provisioned warm pool | Cold starts violate p95 <2s; render runtimes are heavy (fonts, engines) |
| Batch render | Spot Kubernetes jobs | Interruptible, deadline-scheduled; cheapest compute available |
| Webhooks/light transforms | Serverless functions | Spiky, tiny, thousands of tenant-configured variants |
| Interactive doc origin | Provisioned small + CDN | CDN takes the spike; origin stays flat |
| AI inference | Provider APIs → reserved capacity when >~60% sustained utilization justifies commitment | Utilization-based crossover, re-evaluated quarterly |
| Analytics streaming | Provisioned small | Constant flow |
| Analytics batch/ML training | Spot | Interruptible |

Rule of thumb applied: serverless when utilization <15% or concurrency is spiky and units are
small; provisioned+autoscale otherwise; spot for anything queue-drained and restartable.

## B.9 Example Tenant Cost Breakdown — 10M Communications/Month

Profile: regional bank; 10M comms/mo = 6.5M email, 1.5M SMS, 1.0M print (via PSP), 1.0M
secure-link interactive; 100% also archived (avg artifact+data 250KB compressed → ~2.5TB/mo
new archive, 7-year retention, steady-state ~180TB after 6 years — modeled here at year-2
steady state ≈ 55TB); doc assistant enabled on secure-link + email-web views: 300k assistant
turns/mo; authoring team: 15k AI authoring actions/mo.

**B.9.1 Monthly infrastructure + pass-through cost (planning estimate)**

| Line | Volume | Unit cost | Monthly cost | Notes |
|---|---|---|---|---|
| Batch render (8.5M) | 8.5M | $0.0025 | $21,250 | 85% fragment-cache hit assumed |
| On-demand render (1.5M) | 1.5M | $0.006 | $9,000 | Interactive + triggered comms |
| Email delivery infra | 6.5M | $0.0007 | $4,550 | Excl. relay fees below |
| Email relay fees (pass-through) | 6.5M | $0.0006 | $3,900 | Provider-dependent |
| SMS infra | 1.5M | $0.0002 | $300 | |
| SMS carrier fees (pass-through) | 1.5M | $0.006 | $9,000 | US mix |
| Secure-link serving | 1.0M active docs | $0.002 | $2,000 | CDN + origin + doc state |
| Print-file generation | 1.0M | $0.003 | $3,000 | AFP/PDF print streams; PSP print+postage billed separately to tenant (~$0.55–0.75/piece, pass-through) |
| Archive storage (55TB blended) | 55,000 GB-mo | $0.010 | $550 | Tier mix per B.5 |
| Archive ingest/index compute | 10M docs | $0.0004 | $4,000 | Indexing, dedupe, WORM copy |
| Doc assistant AI | 300k turns | $0.012 | $3,600 | Post prompt-cache + routing blended rate |
| Authoring AI | 15k actions | $0.008 | $120 | |
| AI evaluation gates | 10M evals | $0.0002 | $2,000 | Small-model/classifier tier |
| Analytics pipeline | ~60M events | $0.00005 | $3,000 | Streaming + storage + dashboards |
| Shared platform allocation | — | — | $6,000 | Control plane, identity, monitoring amortized |
| **Total attributed cost** | | | **≈ $72,300** | ≈ **$0.0072 per communication** blended |
| — of which pass-through (relay/carrier) | | | $12,900 | Rebilled at cost or small margin |
| — of which AI | | | $5,720 | 8% of total — watch this line's growth |

**B.9.2 Sensitivity (same tenant)**

| Scenario | Δ Total | Driver |
|---|---|---|
| Fragment cache degrades 85%→50% | +$14k/mo | Render CPU dominates — cache health is a P1 SLO |
| Doc assistant adoption 3%→10% of delivered docs | +$8.4k/mo AI | Must be priced (metered) — see B.10 |
| Archive at 7-yr steady state (180TB) | +$1.3k/mo | Storage is cheap; indexing compute matters more |
| All-large-model routing (no gateway controls) | +$15–25k/mo AI | Justifies the model gateway on this tenant alone |

**B.9.3 Contrast profile — small credit union, 500k comms/month**

Same model, different economics: 400k email, 50k SMS, 50k print files; assistant on 5% of
docs (25k turns); minimal on-demand.

| Line group | Monthly cost | Notes |
|---|---|---|
| Render (batch-heavy) | $1,400 | Lower cache locality on small estates partially offsets volume discount |
| Delivery infra + pass-through | $900 | |
| Archive (2.8TB steady-state yr 2) | $310 | Ingest compute dominates storage |
| AI (assistant + authoring + eval gates) | $520 | |
| Analytics + shared platform allocation | $3,200 | Fixed allocation dominates at this size |
| **Total** | **≈ $6,300** | ≈ **$0.0126 per communication** — 75% above the 10M-tenant blended rate |

Implication: small tenants carry proportionally more fixed platform allocation — the platform
fee component (B.10) must recover this, and the Growth edition should run on pooled (not
dedicated) resources to keep the floor low.

## B.10 Pricing-Model Implications

Cost structure supports a three-part model — align price metrics with cost metrics so margin
is stable at any mix:

| Component | Metric | Rationale / target |
|---|---|---|
| Platform fee | Annual, tiered by edition (Growth / Enterprise / OEM) + deployment profile (SaaS < private cloud < VPC) | Covers fixed platform allocation + support; VPC priced 1.8–2.5× SaaS edition for identical entitlements (real delivery cost is higher) |
| Usage | Per-communication bands by channel class (composed+delivered as one unit; print files priced, print/postage pass-through); archive per GB-month by tier; overage pricing published | For the B.9 tenant at ~$0.02–0.035 blended list per communication, infra gross margin ≈ 70–80% |
| AI metering | Per AI action (authoring, assistant turns, migration templates, agentic decisions) sold as prepaid packs + drawdown, with tenant budget controls from B.6 as the trust feature | Keeps AI margin ≥60% under adoption growth; packs convert AI COGS volatility into committed revenue |

Additional implications:

1. **Never price AI as "unlimited included"** — B.9.2 shows adoption swings AI COGS 3–5×;
   unlimited AI converts our best differentiator into a margin leak. Include a generous
   starter allowance instead.
2. **Outcome-linked pricing (Phase 4 option):** outcome measurement (doc 03 §3.5) enables
   per-completed-action or deflected-call pricing for specific use cases; pilot only after the
   outcome data flywheel is credible, and always atop the platform fee floor.
3. **OEM pricing:** wholesale per-communication + per-AI-action rates with volume ladder and
   partner-managed budgets; partner owns end pricing. Wholesale floors must clear
   fully-loaded cost + 50% to protect against OEM mix concentration.
4. **Commit discounts mirror cost curves:** annual volume commitments discount usage (our
   batch/spot economics improve with predictable volume); reserved AI capacity discounts pass
   through partially when we hold reserved inference capacity (B.8).
5. **Publish the unit metrics.** Cost-per-communication transparency (tenant FinOps dashboard,
   B.7) is itself differentiation against incumbent opaque licensing — make the meter a
   feature, not fine print.

## B.11 Cost-Model Review Cadence

| Review | Frequency | Trigger for action |
|---|---|---|
| Unit costs vs B.2 targets | Monthly | >20% over target 2 consecutive months |
| AI routing/cache mix | Weekly until GA, then monthly | Small-model share <60% or cache hit <50% |
| Tenant gross margin | Monthly | Any tenant <50% infra GM |
| Pricing vs cost drift | Quarterly | Blended list price implies <65% infra GM at current mix |
| Spot coverage & interruption impact | Monthly | Spot share <50% on batch pools |
