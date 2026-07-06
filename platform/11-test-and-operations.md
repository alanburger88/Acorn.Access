# Acorn Communicate — Test Strategy & Operational Excellence

**Document:** 11-test-and-operations.md
**Status:** Build-ready v1.0
**Owners:** Principal Quality Architecture / SRE
**Applies to:** All deployment models (multi-region SaaS, private cloud, customer VPC) unless noted.

---

# PART A — TEST STRATEGY

## A.1 Principles

1. **Rendered output is a contract.** A statement, policy, or bill is a legal artifact. Renderer changes are verified byte-for-byte where deterministic, tolerance-diffed where not.
2. **AI is tested like a dependency, not magic.** Model and prompt changes pass the same gate rigor as code changes: regression evals, groundedness thresholds, injection suites.
3. **Every tenant schema is a test surface.** Data contracts between ingestion and templates are versioned, validated, and fuzzed.
4. **Accessibility and compliance are block-on-fail**, not warnings.
5. **Tests run where the customer runs.** The full gate suite is executable in customer-VPC deployments (air-gap friendly, no external test-data calls).

## A.2 Test Pyramid per Domain

Target shape: ~70% unit, ~20% component/contract, ~8% integration, ~2% E2E. Deviations per domain below are deliberate.

| Domain | Unit | Component / Contract | Integration | E2E / Golden | Notes |
|---|---|---|---|---|---|
| Ingestion & normalization | Parser units per format (CSV/JSON/XML/EDI/print-stream) | Schema-contract tests per connector | Pipeline: raw file → canonical model | Corpus replay (10k real-shaped files) | Heavy fuzzing (A.13) |
| Template & composition | Expression engine, logic blocks | Data-contract tests vs. schemas (A.6) | Compose service + content store | Template harness (A.8) | Every template version gated |
| Rendering (HTML5/PDF/PDF-UA/AFP/PCL/PS) | Layout primitives, font metrics, pagination | Renderer API contracts | Multi-engine parity checks | **Golden-output suite (A.5)** — pyramid inverts here: golden tests dominate | Deterministic render mode in CI |
| Delivery (email/SMS/RCS/WhatsApp/push/voice/print) | Channel adapters, retry logic | Provider API contract tests (recorded + sandbox) | Orchestrator + provider sandboxes | Simulation-mode journeys, failover chaos (A.11) | No live sends in CI |
| Interactive docs & viewer | Component library, action handlers | Viewer ↔ document-API contracts | Embedded actions round-trip | Playwright cross-browser + a11y | Perf budgets asserted (B.4) |
| AI assistant / NBA / journeys | Prompt builders, retrievers, guardrail code | RAG contract: chunker→index→retriever | Grounded answer pipeline | **Eval suites (A.10)** | Evals gate model/prompt changes |
| Archive & retention | WORM adapters, hash chains | Retrieval API contracts | Ingest→seal→retrieve→verify | Legal-hold + disposition scenarios | Immutability proven per release |
| Control plane / tenancy | Policy engine, quota logic | Tenant-isolation contract tests | Cross-service authz matrix | Multi-tenant E2E with 3 synthetic tenants | Isolation tests are SEV-1-grade gates |

Coverage floors (merge-blocking): 85% line / 75% branch on core services; 95% on renderer layout engine, policy engine, and tenant-isolation middleware.

## A.3 Test Environments

| Env | Purpose | Data | Providers |
|---|---|---|---|
| `ci` | Per-PR ephemeral (Kubernetes namespace per pipeline) | Synthetic only | All mocked/recorded |
| `staging` | Release candidate soak, full suite nightly | Synthetic + anonymized golden corpus | Provider sandboxes |
| `perf` | Load/chaos, production-sized (scaled 1:4) | Volume-synthetic (A.7) | Sandboxes + blackhole SMTP/SMS sinks |
| `prod-canary` | 1–5% traffic canaries | Real | Real |

## A.4 Test Data Management

| Data class | Source | Where usable | Controls |
|---|---|---|---|
| Canonical golden corpus | Hand-curated + AI-mined (A.7) | All envs | Versioned in git-LFS; changes reviewed like code |
| Synthetic tenant-shaped data | Schema-driven generators | All envs | Watermarked, delivery-blocked in prod |
| Anonymized production samples | Tenant-consented, DPA-covered, irreversibly pseudonymized (format-preserving) | `staging` only | DLP scan on ingest to staging; 90-day TTL; per-tenant opt-out honored |
| Real tenant data | Production | `prod` + `prod-canary` only | Never copied to lower envs — no exceptions, enforced by egress policy |
| Attack corpora (hostile files) | Public CVE PoCs + fuzzer finds | Isolated fuzz fleet + `ci` sandboxes | Stored encrypted, access-logged |

Rule: a test that can only be reproduced with real production data is a defective test — file a bug against the synthetic generator instead.

## A.5 Golden-Output Testing for Renderers

**Corpus:** ≥ 500 canonical documents spanning: every layout primitive, 40+ locales/scripts (incl. RTL, CJK, Thai line-breaking), tables >100pp, charts, barcodes (QR/Datamatrix/IMB), OMR marks, transpromo zones, duplex/tray directives.

**Method per output format:**

| Format | Comparison | Tolerance | Tooling |
|---|---|---|---|
| PDF | Content-stream normalization → SHA-256; fallback raster diff at 300 DPI | ≤ 0.1% differing pixels per page, ΔE < 3 per pixel; **0 tolerance** on barcode/MICR/OMR regions (region mask config) | qpdf normalize + custom pixel differ |
| PDF/UA | Structural diff of tag tree + role map + reading order; raster diff as above | Tag tree must be isomorphic; reading-order sequence exact | veraPDF + tag-tree differ |
| HTML5 (viewer) | Semantic DOM diff (normalized attrs, ignore generated IDs) + screenshot diff per breakpoint (360/768/1440px) | DOM: structural equality; screenshots ≤ 0.2% pixel delta | Playwright + DOM canonicalizer |
| AFP | MO:DCA object-level structured-field diff; raster proof via AFP→TIFF at 240/300/600 DPI | Structured fields exact except timestamps (masked); raster ≤ 0.1% | AFP explorer lib + raster differ |
| PCL / PostScript | Ghostscript raster at device resolution | ≤ 0.1% pixels; 0 on barcode regions | ghostscript + pixel differ |
| Print manifests (banner pages, tray maps, IMB ranges) | Field-level exact diff | Exact | JSON diff |

**Rules:**
- Renderers run in **deterministic mode** in CI: fixed clock, fixed PRNG seed, embedded fonts pinned by hash, no system font fallback.
- Golden updates require a **two-person visual review** in the diff UI (side-by-side + blink overlay) and a changelog entry stating *why* output changed. CI publishes an HTML diff report artifact per failure.
- Cross-engine parity: the same canonical input rendered to PDF and AFP must pass a **layout-parity check** (text runs and positions extracted from both, matched within 0.5pt).
- Golden suite runtime budget: ≤ 12 min on 32 parallel CI workers (sharded by document).

## A.6 Data-Contract Testing (Ingestion ↔ Template)

- Every template declares a **typed input contract** (JSON Schema 2020-12 + semantic annotations: currency, locale, PII class). Every ingestion mapping declares a **produced contract**.
- CI computes producer/consumer compatibility (Pact-style, schema-registry backed): a mapping change that breaks any published template's contract **fails the mapping build**, listing affected templates and tenants.
- Contract evolution rules: additive fields OK; type narrowing, field removal, or nullability changes require a template major-version bump and dual-publish window.
- **Boundary battery** auto-generated from each schema: nulls, empty arrays, max-length strings, negative currency, 0-line-item invoices, 10k-line-item invoices, mixed-locale names, emoji, `Ω`/combining characters. Templates must render (or explicitly reject with a mapped error) every case — silent truncation is a failure.

## A.7 AI-Generated Test Cases & Synthetic Data

- **Schema-faithful synthesis:** generator reads the tenant's data contract and produces statistically plausible records (distributions learned from *aggregate* stats only — never row-level tenant data leaves the tenant boundary). Faker-style providers per semantic type (IBAN, NHS number, SSN-shaped-but-invalid, etc.).
- **Privacy guarantees:** synthetic values are generated from published aggregate stats (k ≥ 50 per bucket); validators assert no synthetic value collides with a real customer identifier (bloom-filter check inside tenant boundary); synthetic corpora are watermarked (`x-acorn-synthetic: true`) and rejected by production delivery.
- **AI case mining:** an LLM agent proposes edge cases from template logic ("what input makes this conditional table overflow?"), from historic incident postmortems, and from parser code paths. Proposed cases are executed automatically; failures are triaged into the permanent suite. Target: ≥ 30 mined cases per new template family, ≥ 100 per new parser.
- Volume synthesis for perf env: 50M-document corpora generated at 200k docs/min, reproducible from a seed.

## A.8 Template Test Harness in CI (Publish Gate)

Every template version must pass **all** of the following before `publish` is allowed (SaaS and on-prem alike):

| Check | Tool/Method | Threshold |
|---|---|---|
| Render success | Render against contract's boundary battery + 20 synthetic happy-path records, all target formats | 100% success, 0 warnings above `info` |
| Golden self-baseline | First publish sets baseline; re-publish diffs vs. prior version | Diff report reviewed & approved |
| Accessibility | axe-core on HTML output; veraPDF PDF/UA-1 on tagged PDF; alt-text presence; contrast ≥ 4.5:1; reading order | 0 critical/serious violations |
| Compliance rules | Policy-as-code pack per tenant (required disclosures present, retention class set, prohibited phrases absent, jurisdiction footers) | 0 violations |
| Content safety | Broken merge fields, unresolved variables, orphaned conditionals | 0 |
| Performance | Single render p95 on reference worker | ≤ 800ms simple / ≤ 2.5s complex class |
| Channel fit | Email: <102KB HTML clip check, spam-score (SpamAssassin < 3.0); SMS: segment count; print: bleed/margins vs. device profile | Pass |
| Link & asset integrity | All assets resolvable from content store, no external hotlinks in print/archive formats | 0 broken |

Harness runs as a tenant-invokable API too (`POST /templates/{id}/versions/{v}/verify`) so designers get pre-publish feedback in the studio in < 60s.

## A.9 Accessibility Regression Testing

- **Automated (every PR + every template publish):** axe-core (WCAG 2.2 AA ruleset) across viewer, portal, designer UIs and all rendered HTML documents; veraPDF for PDF/UA-1; custom checks for table header associations, form-field labels in interactive PDFs, focus order.
- **Screen-reader smoke suites (nightly + release):** scripted NVDA (Windows/Chromium), VoiceOver (macOS/Safari), TalkBack (Android) runs over 12 canonical journeys (open statement → navigate table → invoke embedded action → converse with assistant). Assertions on announced text via accessibility-tree snapshots; 100% journey completion required.
- **Assistant accessibility:** streamed answers announced via live regions; keyboard-only operation of every embedded action.
- **Manual audit:** external audit per major release (quarterly) + any viewer architecture change; findings tracked with 30-day fix SLA for AA violations.
- **Block-on-fail:** any new critical/serious automated violation blocks merge; any PDF/UA validation failure blocks template publish and release. No waiver path below VP Engineering + Accessibility Officer dual sign-off, max 30-day expiry.

## A.10 AI Evaluation Testing

**Document assistant (grounded Q&A):**

| Eval | Set size | Metric | Gate threshold |
|---|---|---|---|
| Golden Q&A | 1,200 questions across 25 document types × 8 languages | Answer correctness (LLM-judge + human-validated rubric, judge calibrated quarterly against human labels, agreement ≥ 0.9 Cohen's κ) | ≥ 95% correct; no per-doc-type bucket < 90% |
| Groundedness | Same corpus | Every factual claim maps to a retrieved passage; citation-span validity | ≥ 98% grounded claims; ≥ 97% valid citations |
| Hallucination rate | 400 adversarial "not in document" questions | Model must decline or say "not in this document" | ≤ 0.5% fabricated answers |
| Refusal correctness | 200 out-of-scope asks (legal/medical advice, other customers' data) | Correct refusal + safe redirect | ≥ 99% |
| Prompt injection | 600-case attack suite: instructions embedded in document text, uploaded files, field values, URLs; data-exfil probes; role-override; multilingual + encoded (base64/homoglyph) variants | Attack success rate | 0 successful exfil/priv-esc; ≤ 1% benign-behavior deviation |
| Latency/cost regression | Golden set replay | p95 first token, tokens/answer | Within ±15% of baseline |

**Next Best Action (NBA):**
- Offline replay evals on held-out interaction logs: uplift vs. control, calibration (Brier score), and **fairness**: demographic-parity difference and equal-opportunity difference ≤ 0.05 across protected-class proxies available per jurisdiction; disparate-impact ratio ≥ 0.8. Any breach blocks model promotion and pages the ML on-call.
- Constraint tests: NBA may never recommend actions violating tenant suppression lists, contact-frequency caps, or consent state — property-based tests over 10k synthetic customer states, 0 violations allowed.

**Change management:** any change to model version, prompt, retrieval config, chunking, guardrail, or temperature = a **model change** and runs the full eval battery in CI (≤ 45 min budget, sharded). Results stored immutably per release for audit. Shadow mode (new config answers logged, not served) for 48h in production before full cut-over.

## A.11 Delivery Testing

- **Provider sandboxes:** contract tests against SES/SendGrid mail sandboxes, Twilio/Sinch test creds, Meta WhatsApp test numbers, RCS test agents, FCM/APNs dev, print-facility test endpoints. Recorded-replay (VCR-style) in PR CI; live sandbox nightly.
- **Simulation mode:** first-class platform feature — a journey runs end-to-end, producing delivery *intents* and rendered artifacts with zero external submission; assertions on channel selection, timing, suppression, and fallback. Used in CI and by tenants pre-launch.
- **Chaos-tested failover:** monthly automated chaos runs in `perf`: kill primary email provider mid-batch → assert secondary picks up within 60s with 0 duplicates and 0 losses (idempotency-key verification); degrade SMS provider to 50% error → assert circuit-break + reroute; **digital→print failover**: force hard bounces / expired consent → assert print fallback composes, batches to the correct facility, and respects postal cutoffs.
- Bounce/complaint webhook handling tested with recorded provider payloads (all providers, all event types, out-of-order and duplicate delivery).

## A.12 Load & Performance Testing

- **Batch renders:** weekly perf-env run must sustain **2M renders/hour per 100 render workers** (statement-class docs, see B.1) for 4h with < 0.01% failures. **Checkpointed restart** drill included: kill 30% of workers at T+2h → job resumes from checkpoints, 0 duplicate documents (dedupe on document ID + content hash), total completion penalty ≤ 8 min.
- **On-demand:** k6 scenarios at 2× peak (peak = 500 RPS render API per region): p99 render < 2s asserted.
- **Viewer:** Lighthouse CI on every viewer PR; LCP < 1.5s / INP < 200ms budgets on 4G-throttled profile.
- **Assistant:** 200 concurrent conversations sustained; first token p95 < 1.5s.
- **Soak:** 72h staging soak per release: memory-leak detection (RSS growth < 2%/24h per service), connection-pool exhaustion checks.
- Regression policy: any p95 regression > 10% vs. 4-week baseline blocks release.

## A.13 Security Testing

| Layer | Practice | Cadence / Gate |
|---|---|---|
| SAST | Semgrep + CodeQL, custom rules for tenant-ID handling (every DB/query path must carry tenant scope) | Every PR; high/critical block merge |
| Dependencies | SCA (OSV + commercial feed), lockfile-only builds, SBOM (CycloneDX) per artifact | Every build; critical vulns block release |
| Containers/IaC | Trivy image scan, distroless bases, Checkov/tfsec on Terraform, admission policies | Every build/apply |
| DAST | Authenticated ZAP + fuzz of public APIs against `staging` | Nightly |
| Secrets | gitleaks pre-commit + org-wide scanning | Every push |
| Pen-test | External firm: full platform 2×/year; AI attack-surface (assistant, MCP endpoints) 1×/year; per new major surface | Findings: crit 7d / high 30d fix SLA |
| Tenant isolation | Automated cross-tenant probe suite: every API exercised with Tenant-A token against Tenant-B resources (403/404 required), signed-URL scope checks, cache-poisoning probes | Every deploy; **any leak = release abort + SEV-1 process (C.6 runbook 6)** |

**Hostile-file fuzzing of ingestion parsers** — PDF/XML/EDI/AFP/print-streams are primary attack surfaces:
- Continuous coverage-guided fuzzing (libFuzzer/AFL++ harnesses per parser) on dedicated fleet, 10k CPU-hours/week; OSS-Fuzz-style corpus mgmt.
- Structured attack corpora: XXE/billion-laughs XML, zip/decompression bombs, malformed xref PDFs, JS-bearing PDFs, font-table exploits, EDI delimiter abuse, AFP structured-field overflows, polyglot files.
- Parsers run in **sandboxed workers** (gVisor, no network egress, 512MB/30s caps); a crash is a bug, a sandbox escape attempt is a SEV-1. New-crash rate must be 0 for 2 weeks before a parser GA.

## A.14 Migration Verification Testing

For customers migrating from legacy CCM (Quadient/OpenText/Smart Communications etc.):
- **Parallel-run comparison harness:** same production input batch → legacy output + Acorn output → automated compare (raster diff for PDF/print with configurable masks for known-acceptable deltas like font substitution; field-extraction compare for amounts, dates, addresses, barcodes — **0 tolerance on monetary values and addresses**).
- Acceptance gate per migrated template: ≥ 99.5% documents auto-matched; 100% of mismatches human-adjudicated; sign-off recorded in migration studio with evidence pack.
- Ramp protocol: 1% → 10% → 50% → 100% traffic with parallel-run continuing one full billing cycle at each stage.

## A.15 Compliance Regression Testing

- **Evidence-pack generation verified per release:** CI produces a complete evidence pack (control mappings, test results, a11y reports, eval results, SBOMs, isolation-probe results) and a validator asserts pack completeness against the control catalog (SOC 2, ISO 27001, HIPAA, PCI-scope controls). Missing evidence = release blocked.
- Retention/disposition scenario tests: create → hold → attempted delete (must fail) → hold release → disposition (must succeed + certificate) — run per release against archive.
- Consent & preference regression: 40 scenarios (withdrawn consent mid-journey, jurisdictional quiet hours, GDPR erasure vs. archive legal basis) asserted in simulation mode.

## A.16 Test Gates Matrix

| Suite | PR merge | Deploy to prod | Template publish | Model/prompt change | Tenant onboarding |
|---|---|---|---|---|---|
| Unit + component (affected) | **Gate** | Gate (full) | — | Gate (AI services) | — |
| Data-contract compatibility | **Gate** | Gate | **Gate** | — | **Gate** (tenant schemas) |
| Golden-output renderer suite | Gate (renderer-touching PRs) | **Gate** (full corpus) | **Gate** (template's own baseline) | — | Gate (tenant golden docs) |
| Accessibility (axe + PDF/UA) | **Gate** (UI/renderer PRs) | **Gate** | **Gate** | — | Advisory report |
| Compliance policy pack | — | **Gate** (evidence pack) | **Gate** | — | **Gate** (tenant policy pack) |
| AI evals (golden Q&A, groundedness, injection) | Gate (AI-code PRs, smoke subset) | **Gate** (full) | — | **Gate** (full battery + 48h shadow) | Gate (tenant doc-corpus eval sample) |
| NBA fairness/bias | — | Gate (if NBA changed) | — | **Gate** | Gate (if NBA enabled) |
| Delivery contract/sandbox | Gate (channel PRs) | **Gate** | — | — | **Gate** (tenant provider creds + simulation run) |
| Chaos/failover | — | Monthly (release-independent) | — | — | — |
| Load/perf regression | — | **Gate** (weekly cert; blocking regressions) | Perf check per template | Latency/cost eval | Capacity review |
| Security (SAST/SCA/containers) | **Gate** | **Gate** | — | — | — |
| Tenant-isolation probes | Gate (authz-touching PRs) | **Gate** | — | — | **Gate** |
| Migration parallel-run | — | — | Gate (migrated templates) | — | **Gate** (migration customers) |

---

# PART B — PERFORMANCE BENCHMARKS & SLOs

All numbers are per-region, steady-state targets measured over 28-day windows unless noted. "Simple" doc = ≤ 4 pages, no charts; "complex" = ≤ 40 pages, charts/tables; "heavy" = > 40 pages or graphics-dense.

## B.1 Render Throughput (Batch)

| Workload | Target per 100 render workers (8 vCPU/16GB each) | Failure budget | Restartability |
|---|---|---|---|
| Simple PDF | 2.0M docs/hour | < 0.01% | Checkpoint every 10k docs; resume < 60s |
| Complex PDF | 600k docs/hour | < 0.01% | Same |
| PDF/UA tagged | 450k docs/hour | < 0.01% | Same |
| AFP (print) | 1.2M docs/hour | < 0.005% | Same; job-integrity manifest per spool |
| HTML5 package | 1.5M docs/hour | < 0.01% | Same |
| Mixed statement run (80/15/5 simple/complex/heavy) | 1.4M docs/hour | < 0.01% | End-to-end batch of 10M docs completes < 8h incl. QA sampling |

Linear scale-out verified to 1,000 workers (≥ 85% scaling efficiency). Priority preemption: on-demand renders never queue behind batch (separate pools; batch may burst into on-demand pool only below 40% utilization).

## B.2 On-Demand Latency SLOs

| Operation | p50 | p95 | p99 | Availability SLO |
|---|---|---|---|---|
| On-demand render, simple (API call → PDF bytes) | 250ms | 900ms | **< 2s** | 99.95% |
| On-demand render, complex | 700ms | 1.8s | 4s | 99.95% |
| Interactive HTML compose (viewer payload) | 150ms | 500ms | 1.2s | 99.95% |
| Preview render in designer | 400ms | 1.5s | 3s | 99.9% |

## B.3 Delivery Submission Latency (accepted by Acorn → submitted to provider)

| Channel | p95 | p99 | Notes |
|---|---|---|---|
| Email | 2s | 5s | Excl. provider queuing; throughput 5M/hour/region |
| SMS/RCS | 1.5s | 4s | Rate-shaped to provider caps |
| WhatsApp | 2s | 6s | Template-message path |
| Push | 1s | 2.5s | |
| Voice (initiation) | 3s | 8s | |
| Print (spool → facility manifest ack) | 15 min | 30 min | Batch-windowed; cutoff logic in C runbook 7 |

## B.4 Viewer Performance Budgets (4G-throttled, mid-tier device)

| Metric | Budget |
|---|---|
| LCP | **< 1.5s** |
| INP | < 200ms |
| CLS | < 0.1 |
| TTFB (document API) | < 300ms p95 |
| Initial JS payload | < 180KB gz |
| Page-to-page nav within document | < 400ms |
| Offline-cached reopen | < 800ms LCP |

## B.5 Assistant & AI Latency

| Metric | p50 | p95 | Target |
|---|---|---|---|
| First token (grounded answer) | 600ms | **< 1.5s** | Streaming mandatory |
| Full answer (≤ 300 tokens) | 2.5s | 6s | |
| Retrieval stage | 80ms | 250ms | Vector + keyword hybrid |
| NBA decision API | 40ms | 120ms | p99 < 250ms |
| Availability (with model-provider failover) | — | — | 99.9%; degraded "search-only" mode below that |

## B.6 Archive, Search, API, Events

| Metric | Target |
|---|---|
| Archive retrieval (single doc, hot tier ≤ 13 months) | **p99 < 2s**; p50 < 300ms |
| Archive retrieval (cold tier) | p99 < 5 min (async with notification), bulk export 1M docs < 12h |
| Archive ingest seal (doc → immutably stored + hash-chained) | p99 < 30s |
| Search (metadata + full-text, tenant-scoped) | **p95 < 500ms**; p99 < 1.2s |
| Core REST APIs (CRUD control plane) | p99 < 400ms |
| Ingestion API (accept 10MB file) | p99 < 3s to acknowledged/queued |
| Event end-to-end lag (business event → journey evaluation) | p95 < 5s; p99 < 15s |
| Delivery-status webhook fan-out to tenant | p95 < 10s from provider callback |
| Kafka consumer lag (steady state) | < 30s across all consumer groups; alert at 2 min (see runbook 8) |

## B.7 Capacity Planning Model

Per-tenant sizing formula (region capacity = Σ tenants × peak factors):

```
render_workers = ceil( peak_docs_per_hour / (rate_per_worker × 0.7 utilization) )
  rate_per_worker: simple 20k/h, complex 6k/h, AFP 12k/h
delivery_workers = ceil( peak_msgs_per_hour / 250k ) per channel
kafka_partitions  = ceil( peak_events_per_sec / 5k ) per topic, min 12
assistant_capacity = concurrent_conversations × 1.2 model-TPS headroom
storage: archive = docs × avg 350KB × 1.4 (index+tags) × replication 2 (region-pair)
```

Rules: maintain **N+1 region headroom** — any region must absorb its DR-pair's peak at ≤ 80% utilization; autoscaling handles 3× baseline in 5 min, 10× (batch spike) via pre-warmed batch pools scheduled from the job calendar; quarterly capacity reviews reforecast from tenant growth + seasonal calendars (tax season, open enrollment, year-end statements modeled explicitly).

## B.8 Cost-Performance Targets (SaaS, blended, at scale)

| Unit | Target COGS | Stretch |
|---|---|---|
| 1k batch renders (simple PDF) | $0.35 | $0.25 |
| 1k batch renders (complex/tagged) | $1.10 | $0.80 |
| 1k on-demand renders | $0.90 | $0.65 |
| 1k email deliveries (incl. provider fees) | $0.80 | $0.60 |
| 1k SMS deliveries (excl. carrier pass-through) | $0.30 platform overhead | $0.20 |
| 1k assistant conversations (avg 4 turns) | $9.00 | $6.00 (caching + routing to small models for classify/route steps) |
| 1k archive doc-months | $0.05 | $0.035 (tiering) |
| Gross-margin guardrail | ≥ 75% blended | ≥ 80% |

Levers tracked in FinOps reviews (C.14): spot/preemptible batch pools (target 70% of batch on spot), render-output caching (identical input hash → cache hit, target 12% hit rate), model routing and prompt caching (target 40% token-cost reduction), storage tiering at 13 months.

---

# PART C — OPERATIONAL EXCELLENCE

## C.1 Multi-Region HA/DR

**Architecture:**
- **Control plane active-active** across ≥ 3 regions (tenant config, templates, identity): CRDT/consensus-backed global store, writes quorum-committed, reads local. Control-plane outage in one region is invisible to others.
- **Data planes regional** (render, delivery, archive, events): tenant data pinned to a home region + designated DR pair for residency compliance (EU↔EU, US↔US pairs). Cross-region replication: async streaming, **RPO ≤ 5 min**; archive objects replicated with dual-region write-ack for sealed documents (RPO ≈ 0 for archive).
- **RTO ≤ 1 hour** for full regional evacuation: DNS/anycast shift + pre-provisioned warm capacity in DR pair (see B.7 headroom rule). In-flight batch jobs resume from checkpoints in DR region.
- Delivery idempotency keys are globally replicated so failover cannot double-send.

**Verification:**
- **DR game days quarterly per region-pair:** full evacuation drill of a synthetic "shadow tenant" monthly (automated), and a real-tenant-traffic regional failover in a maintenance window 2×/year. Measured RTO/RPO published internally; miss = corrective-action items with owner and date.
- Backup-restore verification: C.11.
- Customer-VPC deployments: DR is customer-operated; we ship the same drill automation (`acornctl dr-drill`) and require an annual attested drill for SLA-backed contracts.

## C.2 Zero-Downtime Deploys

- **Blue-green** for stateful/serving tiers; **rolling canary** for stateless services: 1% → 5% → 25% → 100% over ≥ 45 min, auto-advanced by health checks.
- **Automated rollback on SLO burn:** canary analysis (Kayenta-style) compares canary vs. baseline on error rate, p95/p99 latency, render-golden-sample checks (canary renders 50 golden docs and diffs them live), and AI eval smoke (30-question subset). Burn rate > 2× on any gated SLO → auto-rollback, no human required, page fires with the analysis attached.
- DB migrations: expand-migrate-contract only; contract step ships ≥ 1 release later; every migration has a tested `down` path or explicit forward-fix plan reviewed by two engineers.
- **Feature flags with tenant targeting:** flag service supports per-tenant, per-region, percentage, and ring targeting (ring 0 internal tenant → ring 1 design partners → GA). Flags expire: any flag > 90 days old without an expiry review fails CI lint. Kill switches (flag flips, not deploys) required for: new renderer engine paths, AI model routes, each delivery provider, NBA serving.
- Deploy cadence: control plane continuous (multiple/day); render engines weekly train with full golden certification; on-prem/VPC: quarterly LTS releases + security patches, same gates.

## C.3 Observability

- **OpenTelemetry everywhere:** traces, metrics, logs from all services; W3C trace context propagated through the full pipeline — one trace spans **ingest → compose → render → deliver → provider callback**, and a document ID ↔ trace ID index lets support pull the complete story of any single customer document in one query.
- Sampling: 100% of errors and slow (>p95) traces, 5% baseline; batch jobs sampled per-chunk not per-doc.
- **Dashboards:** RED (rate/errors/duration) per service API; USE (utilization/saturation/errors) per pool (render workers, Kafka, DB, GPU/model gateways); per-tenant overlays for the top-50 tenants; AI-specific: groundedness sampling score, token spend, guardrail trip rate, model-provider latency by route.
- **SLO catalog with error budgets:** every SLO in B.2–B.6 has a recorded SLI query, owner team, and 28-day error budget. Multi-window multi-burn-rate alerts (2%/1h page; 5%/6h page; 10%/3d ticket). Budget exhausted → feature freeze for that service until budget recovers or an explicit exec exception is logged.
- Log policy: structured JSON, tenant ID mandatory field, **no document content or PII in logs** (enforced by log-scrubbing middleware + sampled DLP scans of the log lake); 30-day hot / 13-month cold retention.

## C.4 Alerting Philosophy & On-Call

- **Page only on customer-impacting symptoms** (SLO burn, delivery failures, data-integrity signals) — never on raw causes (CPU, single-pod restarts) unless they're proven leading indicators. Every page must be actionable and link a runbook; a page without a runbook link is itself a defect.
- Alert hygiene: weekly review; any alert that fired > 3× in a week without action is deleted or fixed. Target < 2 pages per shift-week; sustained breach triggers reliability investment.
- On-call: per-domain rotations (Serving, Pipeline/Batch, Delivery, AI, Data/Archive) + an Incident Commander rotation; follow-the-sun across US/EU/APAC hubs, 1-week shifts, secondary escalation at 5 min unacked. On-call is compensated; postmortem action items get 20% sprint reservation.

## C.5 Incident Management

**Severity matrix:**

| Sev | Definition (examples) | Response | Comms |
|---|---|---|---|
| SEV-1 | Cross-tenant data exposure; archive integrity breach; total regional outage; mass mis-delivery (wrong recipient documents); missed print SLA affecting regulatory mail | IC + exec on bridge ≤ 15 min, 24/7 staffing | Status page ≤ 30 min, affected-tenant direct notice ≤ 1h, updates every 30 min |
| SEV-2 | Single channel down; batch pipeline stalled > 30 min; assistant down (docs still viewable); SLO hard-down for a tenant cohort | IC ≤ 30 min | Status page ≤ 1h, hourly updates |
| SEV-3 | Degraded performance within failover; single-tenant functional issue | Owning team, business hours+ | Ticket comms |
| SEV-4 | Cosmetic/minor, no SLO impact | Backlog | None |

- **Comms templates** pre-approved by legal for: security incident (with/without confirmed exposure), delivery incident (incl. "documents may arrive delayed/duplicated" wording), print-SLA miss, AI-behavior incident. Stored in the incident tool, filled by IC, reviewed by comms lead for SEV-1/2.
- **Postmortems:** blameless, required for SEV-1/2 and any SEV-3 with novel failure mode; due in 5 business days; template = timeline, contributing factors (≥ 3 whys), what-went-well, action items with owners/dates. SEV-1 postmortems reviewed at monthly ops review; action-item completion tracked with 30/60/90-day SLAs.

## C.6 Runbook Library — 8 Core Runbooks

**RB-01: Batch render job stuck / degraded**
1. Confirm: job dashboard — throughput vs. plan, checkpoint age, worker error rate. Distinguish *stuck* (checkpoint age > 15 min) vs. *slow* (throughput < 70% plan).
2. Triage causes in order: (a) poison document — check dead-letter queue, quarantine doc IDs, resume; (b) font/asset store latency; (c) worker OOM pattern (heavy-doc skew) → shift shard to heavy-doc pool; (d) downstream archive backpressure.
3. Actions: `acornctl batch pause/resume/requeue-from-checkpoint <job>`; scale pool +50%; if poison docs > 0.1% of batch, halt and page Pipeline lead.
4. SLA math: compute projected completion vs. tenant batch SLA; if breach projected, trigger tenant comms per C.5 and consider priority preemption of lower-tier jobs.
5. Exit: throughput ≥ plan for 15 min, DLQ triaged, incident note with doc IDs affected.

**RB-02: Delivery provider outage & failover**
1. Confirm: provider error rate > 20% or provider status page; check circuit-breaker state (`delivery.circuit.<provider>`).
2. Failover: flip provider kill-switch flag (per channel, per region). Verify secondary provider health + remaining rate headroom vs. current volume; if headroom < 100%, enable send-rate shaping and prioritize transactional over marketing classes.
3. Verify no duplicates: idempotency-key rejection metric should show reroute, not resend.
4. Watch: bounce classification differences between providers (avoid false suppressions).
5. Recovery: restore primary at 10% shadow traffic for 30 min before full return. Log provider-SLA claim evidence.

**RB-03: Email deliverability / reputation incident**
1. Detect: bounce rate > 2%, complaint rate > 0.08%, blocklist alert (Spamhaus/SNDS/Google Postmaster), or open-rate cliff per sending domain/IP.
2. Immediately: pause campaigns on affected IP pool (transactional continues on isolated pool — verify isolation); identify offending tenant/stream via per-tenant sending metrics.
3. Diagnose: recent template change (spam-score history), list-quality drop (new import?), DKIM/SPF/DMARC break (verify DNS), snowshoe complaint pattern.
4. Remediate: suppress affected segments, delist requests with evidence, warm replacement IPs if pool is burned (14-day warm-up schedule in tooling), tenant remediation plan if tenant-caused (contract allows sending suspension).
5. Exit: complaint < 0.05%, inbox-placement seed tests ≥ 92%, postmortem if tenant-facing.

**RB-04: Archive retrieval failures**
1. Classify: elevated 5xx on retrieval API vs. integrity-verification failures (hash-chain mismatch — **treat integrity mismatch as SEV-1 immediately**).
2. For availability: check object-store health per region → fail reads over to replica region (flag `archive.read.region-failover`); check index (search) vs. blob path separately — if index-only, serve by-ID retrievals and post degraded-search status.
3. For integrity: isolate affected object range, do NOT serve; pull dual-region copies + hash-chain audit log; engage security (possible tampering) and run `acornctl archive verify --range`.
4. Legal-hold operations always take precedence: confirm hold queries unaffected before status "resolved".
5. Exit: p99 < 2s restored, integrity audit clean, sample-verify 10k random docs.

**RB-05: AI model provider outage / model rollback**
1. Detect: model-gateway error rate > 5% or first-token p95 > 4s per route.
2. Failover order (pre-configured per route): primary provider region → secondary region → secondary provider (equivalence-tested model) → degraded mode (assistant offers extractive search + "AI answers temporarily unavailable" banner; NBA falls back to rules-based defaults). Flip via `ai.route.<capability>` flags — no deploy.
3. **Model rollback** (bad behavior, not outage): quality alarms = groundedness sampler < 95%, guardrail trip spike, tenant reports. Flip route to last-known-good model+prompt pin (kept warm); capture failing conversations (tenant-consented sample) for eval-suite additions.
4. Cost guard: failover provider may cost 2–3× — FinOps auto-alert at +30% hourly AI spend; acceptable during incident, review at 24h.
5. Exit: primary restored via 48h shadow-eval pass; postmortem includes eval-gap analysis (why didn't the battery catch it).

**RB-06: Tenant data-isolation incident (potential cross-tenant exposure) — always SEV-1 security incident**
1. **Do not triage quietly.** Page security on-call + IC immediately; start incident channel with restricted membership; preserve all evidence (no log truncation, snapshot relevant DBs).
2. Contain: identify the leak vector (API authz, cache key, search index, misrouted delivery, shared-render artifact). Kill-switch the affected surface (feature flag or API route disable) — availability loss is acceptable, exposure is not.
3. Scope: from audit logs, enumerate exactly which tenant's data was exposed, to whom, over what window; document-level list. Isolation-probe suite run against the patched path before re-enable.
4. Legal/notify: counsel engaged ≤ 2h; regulatory clocks (GDPR 72h, state breach laws, contractual notice terms per affected tenant) tracked in incident tool; use pre-approved security comms template.
5. Eradicate & verify: fix, deploy with isolation-probe gate, then targeted pen-test of the vector within 2 weeks.
6. Postmortem is mandatory board-visible; add regression probes to the permanent isolation suite.

**RB-07: Print SLA at risk (missed postal cutoff)**
1. Detect: print batch projected-completion alarm fires when `ETA + transmit + facility-processing > facility cutoff − 30 min buffer` (cutoffs configured per facility/mail class).
2. Options in order: (a) scale render pool for the batch (preemption authority: batch tier bumps to P0); (b) split batch — transmit completed spools now, remainder to later cutoff or secondary facility (check facility onboarding matrix for tenant's stock/envelope availability); (c) reroute to alternate facility (address-hygiene + postal-permit compatibility check is automated); (d) negotiate late acceptance with facility (contacts in facility registry).
3. If cutoff will be missed: classify mail criticality — **regulatory-deadline mail** (e.g., adverse-action, policy cancellation) escalates to SEV-1 with tenant notice ≤ 1h and legal review; standard mail = SEV-2 with next-cycle recovery plan.
4. Record: pieces affected, new induction date, evidence for postal-SLA/penalty clauses.
5. Follow-up: root-cause the schedule slip (late tenant file? render regression?) — late-file incidents feed tenant onboarding SLAs.

**RB-08: Event backbone (Kafka) lag / backlog**
1. Confirm: consumer-group lag dashboard; classify — single group (consumer bug) vs. broad (broker/cluster) vs. single partition (hot key / poison message).
2. Single group: check consumer error logs; poison message → skip-and-DLQ via offset advance tooling (`acornctl events skip --group --partition --offset`, dual-approval required); redeploy last-good consumer version.
3. Hot partition: identify key (usually a mega-tenant burst); enable per-tenant event throttling flag; consider partition-count increase (planned op, not mid-incident unless lag > 1h).
4. Cluster: check broker disk/ISR shrink; expand brokers or fail over to DR cluster (mirrored via cluster-linking; RPO ≤ 5 min applies).
5. Impact comms: journey timers and NBA freshness degrade with lag — auto-banner in tenant console when lag > 5 min ("event processing delayed"). Deliveries already submitted are unaffected; state that explicitly.
6. Exit: lag < 30s for 30 min; verify no journey double-fires (idempotent journey steps assert this) and reconcile event counts vs. producer offsets.

## C.8 SIEM Integration & Security Monitoring

- All authn/authz decisions, admin actions, data exports, template publishes, model-config changes, and archive access emit CEF/OCSF events to the SIEM (SaaS: our Chronicle/Sentinel instance; VPC deployments: customer's SIEM via syslog/HTTPS forwarder, documented event schema).
- Detections: impossible travel on admin accounts, mass-export anomalies (docs retrieved > 5× tenant baseline), cross-tenant probe patterns, guardrail-trip clustering (coordinated prompt-injection campaigns), sandbox-escape indicators from parser workers, delivery-destination anomalies (sudden new-domain concentration).
- SOC coverage 24/7 (follow-the-sun); detection-to-triage < 15 min for critical alerts; purple-team exercises quarterly validate top-20 detections.

## C.9 Vulnerability Management SLAs

| Severity (CVSS + exploitability context) | Internet-facing / parser surface | Internal |
|---|---|---|
| Critical (or known-exploited/KEV) | 72h patch or mitigate | 7d |
| High | 7d | 30d |
| Medium | 30d | 90d |
| Low | 90d | Best effort, tracked |

Weekly vuln review; SLA breaches auto-escalate to service owner's director. Base images rebuilt weekly regardless; emergency rebuild pipeline < 4h from CVE to fleet rollout. On-prem: patched LTS images published on the same SLAs with customer notification.

## C.10 Policy-as-Code & Infrastructure-as-Code

- 100% of infrastructure in Terraform (modules versioned, no console changes — drift detection hourly, auto-ticket + auto-revert for security-relevant drift).
- OPA/Rego policy packs enforced at three points: CI (plan-time), admission control (Kubernetes/Gatekeeper), and runtime audit. Policies cover: tenant-residency pinning, encryption-at-rest flags, public-exposure bans, mandatory tags (tenant, cost-center, data-class), image provenance (cosign-signed only).
- Compliance policy packs (A.15) share the same engine — one policy language from infra to document content rules.
- Change management: all prod change via PR + CI; break-glass path logged, time-boxed (4h), and auto-reviewed next business day.

## C.11 Backup / Restore Verification

- Backups: control-plane DBs — continuous WAL + daily snapshot, 35-day PITR; archive — object versioning + dual-region (immutable, backup ≠ delete-protection substitute: object lock is primary); Kafka — tiered storage + cluster linking; configs/templates — versioned store, exportable per tenant.
- **Restore verification, not backup verification:** weekly automated restore of a random control-plane DB snapshot into an isolated env + smoke suite; monthly random-sample archive restore (10k docs, hash-verify); quarterly full "rebuild a region from backups" exercise as part of DR game day. Restore-test failure = SEV-2.
- Backup access is a privileged operation (separate credentials, dual-control for full-DB restores) — backups are a ransomware target.

## C.12 Quota & Rate-Limit Operations

- Every tenant has quota envelopes: API RPS, render jobs/hour, delivery msgs/hour per channel, AI tokens/day, storage. Defaults by tier; overrides via ticketed config change (PR-reviewed).
- Enforcement returns 429 + `Retry-After` + quota headers; batch submissions over quota are queued (not rejected) with ETA in the response.
- Ops dashboards: top-10 tenants by utilization %, tenants > 80% of any quota (proactive CSM outreach), noisy-neighbor detection (per-tenant resource attribution on shared pools; auto-throttle above 3× fair share with tenant notification).
- Quota-raise SLA: standard raises < 1 business day; emergency (tenant incident) via on-call, logged.

## C.13 SLA Monitoring & Tenant-Facing Status

- Contract SLAs computed from the same SLI pipeline as internal SLOs (no parallel bookkeeping); per-tenant SLA reports auto-generated monthly with credit calculation where owed.
- Public status page (component-level: Rendering, Delivery per channel, Viewer, Assistant, Archive, APIs) + **per-tenant private status** view showing only their regions/channels and their open incident impact; webhook + email subscriptions.
- Status automation: SLO burn-rate pages auto-create a draft status incident; IC confirms wording (templates from C.5) — target < 30 min to first public post for SEV-1/2. Post-incident, RCA summary published to affected tenants within 5 business days.

## C.14 FinOps Operations

- **Per-tenant cost attribution:** every workload tagged (tenant, capability, environment); shared pools attributed by metered consumption (render-seconds, tokens, GB-months, messages). Daily per-tenant COGS dashboard; margin per tenant visible to finance and account teams.
- **Anomaly alerts:** per-tenant and per-capability spend baselines; alert at +40% day-over-day or +25% week-over-week with attribution drill-down (which job/model/route). AI spend is its own class: **per-tenant AI budgets** with soft alert at 80%, hard cap behavior configurable (throttle vs. bill-through, contractual).
- Unit-economics review monthly against B.8 targets; regressions get an engineering owner.
- Efficiency automation: idle-pool reaper, spot orchestration for batch (fallback to on-demand at deadline risk — integrates with RB-07 math), storage-tiering jobs, prompt/model routing reports (tokens per answer trend).

## C.15 Developer Documentation Outline (docs.acorn-communicate.com)

1. **Getting Started** — 15-minute quickstart (ingest a CSV → render a statement → deliver via email sandbox → view in portal); environment setup; auth (API keys, OAuth, service principals); Postman/Insomnia collections; sample tenant with seeded data.
2. **Concepts** — architecture overview; tenancy & data residency; canonical data model; templates & versioning; rendering pipeline & output formats; delivery orchestration & fallback; journeys & events; interactive documents & embedded actions; the grounded assistant (how grounding, citations, and guardrails work); NBA; archive & retention model; deployment models (SaaS / private cloud / VPC).
3. **API Reference** — REST + event webhooks (OpenAPI, per-version); ingestion API; composition & render API; delivery API; documents & archive API; search API; journeys API; admin & tenancy API; rate limits, idempotency, pagination, error catalog.
4. **MCP Guide** — exposing Acorn tools to AI agents via MCP; tool catalog (compose, render, query-archive, delivery-status); auth & scoping for agent access; safety model (what agents can/can't do); building agentic workflows; example: claims-status agent.
5. **Connector SDK** — building ingestion connectors (source adapters, format parsers, schema mapping); delivery-provider connectors; connector testing kit (contract tests, sandbox harness); certification checklist & marketplace submission.
6. **Template Designer Guide** — studio tour; data binding & contracts; layout & style system; conditional logic and reusable content blocks; localization workflow; accessibility authoring (tagging, alt text, reading order); channel variants (email/print/HTML from one template); the pre-publish verify harness; versioning & approval workflows.
7. **Migration Studio Guide** — supported legacy formats (Quadient, OpenText Exstream, Smart Communications, custom DOCX/AFP libraries); AI-assisted conversion workflow; parallel-run comparison harness usage; adjudication UI; cutover ramp playbook; migration evidence packs.
8. **Ops Guides** — deploying in your VPC (Terraform modules, sizing calculator from B.7); private-cloud install; observability integration (OTel export, SIEM forwarding); backup/DR drill tooling (`acornctl dr-drill`); quota administration; security hardening checklist; upgrade & LTS policy; troubleshooting index keyed to error catalog; the 8 core runbooks (C.6) adapted for self-hosted operators.

---

*End of document. Companion docs: 09-security-architecture.md (threat model detail), 10-compliance-framework.md (control catalog referenced by A.14).*
