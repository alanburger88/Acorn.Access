# Acorn OS — Product Requirements Document

**Document type:** Platform PRD
**Owner:** Product Management
**Status:** Approved for planning
**Related documents:** `00-product-vision.md`, `02-feature-inventory.md`, `../PRD/Acorn.Access-PRD.md`

---

## 1. Scope, conventions, and definitions

### 1.1 Requirement conventions

- **Requirement IDs** are stable and immutable: `FR-<DOMAIN>-<NNN>` for functional requirements, `NFR-<NNN>` for non-functional requirements.
- **Priority:** P0 = must ship in the release it is scoped to; P1 = ship in release unless de-scoped with sign-off; P2 = opportunistic.
- **Release:** `MVP` (first shippable product, Section 18), `ENT` (Enterprise release, Section 19). A requirement marked `MVP` may deepen in ENT; the row states the MVP slice where relevant.
- "Shall" is normative. Acceptance criteria (AC) are testable statements; each P0 requirement group carries ACs.

### 1.2 Terminology (normative)

| Term | Definition |
|---|---|
| **Communication** | The unit of work: a rendered, delivered, measurable artifact in any channel (interactive HTML5, PDF, email, SMS, print piece, voice script, video). Preferred over "document." |
| **Tenant** | A contractually isolated customer of the platform. Tenants may own reseller sub-tenants (see FR-WLB). |
| **Workspace** | A governance boundary inside a tenant (e.g., line of business, brand, environment) with its own roles, content, and templates. |
| **Template** | A designed, versioned definition that binds content objects, data bindings, logic, and layout for one or more channels; carries a mandatory intended outcome. |
| **Content object** | A governed, reusable unit of content (block, clause, disclosure, image, chart definition, FAQ entry) with versioning, approvals, and effective dating. |
| **Journey** | An orchestrated, stateful sequence of communications and decisions across channels and time. |
| **Interaction** | Any customer event on a communication: open, scroll, expand, search, assistant question, payment, dispute, signature, etc. |
| **Intended outcome** | The declared purpose of a template from the governed taxonomy: `understood`, `paid`, `renewed`, `disputed`, `signed`, `self_served`, `call_avoided`, `converted`, `informed_no_action`. |
| **Statement of record** | The archived, immutable, reproducible communication with full chain of custody. |

### 1.3 Product-wide invariants (apply to every FR)

- **INV-1:** Every API surface is tenant-scoped; no cross-tenant data access under any code path.
- **INV-2:** Every state-changing action (human or AI) produces an immutable audit event: actor, timestamp, before/after, justification where applicable.
- **INV-3:** AI-originated changes are attributed to the AI service and the human approver; no AI change reaches a customer without passing the applicable review gate (FR-AI-020).
- **INV-4:** Publication gates (approval FR-CMS-020, accessibility FR-ACC-010, compliance FR-AI-060) are enforced in the pipeline; they cannot be bypassed via API.
- **INV-5:** Every template declares an intended outcome and success criteria before publication (FR-TPL-001).

### 1.4 Intended-outcome taxonomy (normative)

Every template declares exactly one primary intended outcome (FR-TPL-001). Default success criteria are tenant-overridable per template.

| Outcome | Definition | Default success event | Default window |
|---|---|---|---|
| `understood` | Recipient comprehended the communication | Interactive open + ≥ 60% scroll depth OR assistant session resolved without escalation; AND no related inbound call | 14 days |
| `paid` | Payment obligation settled | Payment completed (in-viewer or reconciled external payment) | 7 days from first access |
| `renewed` | Policy/contract/subscription continued | Renewal transaction confirmed by tenant system event | 30 days |
| `disputed` | Recipient exercised dispute/appeal rights (where that is the desired action) | Structured dispute submitted with case ID | 30 days |
| `signed` | Legally required signature captured | E-signature completion event | 14 days |
| `self_served` | Recipient completed the intended task without human help | Target action completed with no escalation event | Session + 7 days |
| `call_avoided` | Communication resolved the matter without contact-center demand | No call tagged to the communication in the attribution window | 14 days |
| `converted` | Recipient adopted the promoted option (paperless, autopay, plan) | Enrollment event | 30 days |
| `informed_no_action` | Regulatory notice; no action desired | Proof of delivery (+ proof of access where channel allows) | Delivery + access window |

Secondary outcomes may be tracked additively; attribution methodology (windows, holdouts) is published to tenants per template (see Vision §13, attribution risk).

### 1.5 Persona-to-domain traceability

| Persona | Primary domains | Representative requirements |
|---|---|---|
| Business user | CMS, Designer, Analytics | FR-TPL-008, FR-CMS-005, FR-ANL-030 |
| Template designer | Designer, Rendering, Accessibility, I18N | FR-TPL-002..022, FR-ACC-010, FR-I18N-003 |
| Developer | Ingestion, Integration, White-label, NFR | FR-ING-012, FR-WLB-004, NFR-007/008 |
| Compliance officer | CMS, AI governance, Archive, Accessibility | FR-CMS-004/012, FR-AI-060/100, FR-ARC-003 |
| Operations | Rendering, Delivery, NFR | FR-RND-020, FR-DLV-040, NFR-001..008 |
| Executive | Analytics | FR-ANL-030, FR-ANL-015-class reporting |
| End customer | Interactive Experience, Delivery, Accessibility | FR-IXD-*, FR-DLV-010/030, FR-ACC-020 |

---

## 2. Data ingestion (FR-ING)

The ingestion subsystem accepts enterprise data in any common format, produces validated, typed, privacy-annotated communication data sets, and resolves identity. Design intent: a tenant integration engineer onboards a new feed — mapping, validation, PII policy, identity rules — in days without platform engineering involvement; everything downstream (composition, orchestration, analytics, archive) consumes one canonical, annotated data model.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-ING-001 | Ingest structured data: JSON, XML (with XSD validation), CSV, fixed-width (COBOL copybook-driven layouts), Excel (.xlsx), Parquet, Avro. | P0 | MVP |
| FR-ING-002 | Ingest industry formats: EDI/X12 (incl. 834/835/837), HL7 v2.x, FHIR R4/R5, ACORD (AL3 + XML), ISO 20022 (pain/pacs/camt). | P0 | MVP: FHIR, X12 835/837, ISO 20022 camt; ENT: full set |
| FR-ING-003 | Ingest documents as data sources: PDF and Word extraction (text, tables, key-value) for migration and content reuse pipelines. | P1 | MVP |
| FR-ING-004 | Ingest legacy print streams for re-composition and migration: AFP, Metacode, PCL, PostScript, line data — parsed to structured data + layout model. | P0 | ENT |
| FR-ING-005 | Delivery mechanisms: REST API (sync ≤ 10 MB, async unlimited), SFTP watch folders, object storage (S3/Azure Blob/GCS) event-driven pickup, Kafka/event-stream consumers, JDBC pull on schedule. | P0 | MVP: REST, SFTP, object storage; ENT: Kafka, JDBC |
| FR-ING-010 | **Schema detection & mapping.** AI-assisted schema inference on sample files; visual mapping studio to the tenant's canonical communication data model; mapping versioning; AI-suggested mappings with per-field confidence scores requiring human confirmation below a configurable threshold. | P0 | MVP |
| FR-ING-011 | Validation: type/format/range/required-field rules, cross-field rules, referential checks; per-record disposition (accept, quarantine, reject) with quarantine review UI and reprocessing. | P0 | MVP |
| FR-ING-012 | Transformation functions: computed fields, lookups, normalization, currency/date/locale handling, scriptable expressions in a sandboxed language. | P0 | MVP |
| FR-ING-020 | **PII/PHI detection**: automatic classification of fields and free text (names, SSN/TIN, MRN, account numbers, addresses, DOB, health codes) using pattern + model-based detection; classification stored as data annotations. | P0 | MVP |
| FR-ING-021 | **Masking & minimization**: role-based field masking in all UIs and logs; tokenization for downstream systems; configurable retention of raw payloads (default: purge after successful composition + configurable window). | P0 | MVP |
| FR-ING-030 | **Identity matching**: deterministic + probabilistic matching of inbound records to customer identities; match-confidence tiers; steward review queue for ambiguous matches; survivorship rules. | P0 | MVP: deterministic; ENT: probabilistic + stewardship |
| FR-ING-031 | **Householding**: group identities into households by address + relationship rules for statement bundling and delivery consolidation; tenant-configurable rules. | P0 | ENT |
| FR-ING-040 | **Address validation & standardization** via the modern USPS APIs platform (OAuth2 REST — the legacy USPS Web Tools API was shut down January 2026): CASS-certified standardization, DPV, NCOA move-update integration, and international address validation via pluggable providers (Loqate/Melissa-class). Provider abstraction layer; no direct coupling to a single vendor. | P0 | MVP: USPS REST validation; ENT: NCOA, international |
| FR-ING-041 | Address quality outcomes recorded per identity (deliverable, vacant, undeliverable) and consumed by delivery orchestration (FR-DLV-050) for channel failover decisions. | P1 | ENT |
| FR-ING-050 | **Data lineage**: every composed communication traces each rendered value to its source file/message, field, mapping version, and transformation chain; lineage queryable per communication for audit and defect analysis. | P0 | MVP |
| FR-ING-051 | **Data contracts**: per-feed schema contracts with compatibility checking; breaking upstream changes are detected at intake and quarantine the feed (not silently mis-map) with tenant alerting. | P1 | MVP |
| FR-ING-052 | Duplicate-submission protection: idempotency keys on API intake and content-hash dedup on file intake with configurable windows; duplicate batches are rejected with reference to the original run. | P0 | MVP |

**AC-ING (P0 gate):**
1. A 5 GB fixed-width file with copybook maps, validates, and lands as typed data with ≤ 0.01% unexplained record loss and a per-record disposition report.
2. AI schema mapping on a novel JSON feed proposes ≥ 90% of fields correctly on the benchmark corpus; every low-confidence field is flagged for human confirmation; no mapping activates without human approval.
3. A record containing an SSN in a free-text memo field is auto-classified as PII; the value is masked for a user without the `pii:read` permission in UI, API, and logs.
4. Address validation round-trips against the USPS OAuth2 REST API and returns standardized address + DPV code; provider failure degrades to queue-and-retry, never silent pass-through.

---

## 3. Enterprise CMS for communications (FR-CMS)

Design intent: the CMS is the single governed source of everything the enterprise says. A clause exists once; every channel projection, language variant, and template references it. Change control, effective dating, and impact analysis make a regulatory content change a same-week operation with automatic evidence — the direct answer to the "compose many times" failure of legacy CCM.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-CMS-001 | Content object model: typed objects (text block, rich block, clause, disclosure, image, table definition, chart definition, FAQ entry, tooltip, assistant knowledge snippet) with metadata, tags, ownership, and workspace scoping. | P0 | MVP |
| FR-CMS-002 | Full versioning: every save is an immutable version; side-by-side visual + text compare of any two versions; one-click rollback (as a new version); version pinning by templates. | P0 | MVP |
| FR-CMS-003 | **Approval workflows**: configurable multi-step review chains (author → legal → compliance → brand), parallel and sequential steps, delegation, SLA timers with escalation, and full approval audit trail. | P0 | MVP: single/dual-step; ENT: arbitrary graphs |
| FR-CMS-004 | **Effective/expiry dating**: content object versions carry effective-from/expiry timestamps per jurisdiction; the rendering pipeline selects the version effective at composition time; expired mandatory content blocks composition with a hard error. | P0 | MVP |
| FR-CMS-005 | **Reuse tracking & impact analysis**: for any content object, list every template, journey, and channel variant that references it (transitively); "what breaks if I change this" report before edit; bulk update with staged re-approval of impacted templates. | P0 | MVP: direct references; ENT: transitive + bulk |
| FR-CMS-006 | Variant management: content object variants by language, brand, jurisdiction, channel, and reading level, resolved at composition by variant-selection rules. | P0 | MVP |
| FR-CMS-010 | **Semantic search** across all content objects (meaning-based, not keyword-only), with filters by type, status, jurisdiction, owner; duplicate/near-duplicate detection to drive consolidation. | P1 | MVP: search; ENT: dedup |
| FR-CMS-011 | **AI tagging & scoring** on save: auto-tags (topic, product, regulation), brand-compliance score against the tenant's brand guide, reading-level score (Flesch-Kincaid + model-based), sentiment score, and **regulatory-risk score** with cited rationale. Scores are advisory annotations; thresholds may be wired into approval gates per workspace. | P0 | MVP: tagging + reading level; ENT: full scoring gates |
| FR-CMS-012 | Clause/disclosure libraries: jurisdiction-aware mandatory-content sets ("this communication type in state X must include clauses A, B") validated at template publication. | P0 | ENT |
| FR-CMS-020 | Publication gate: no content object version is composable until approved; draft/approved/published/retired lifecycle enforced by the API, not the UI. | P0 | MVP |
| FR-CMS-021 | Digital asset management: images, fonts, logos with usage-rights metadata, license expiry alerts, and automatic format/resolution derivatives per channel. | P1 | MVP |
| FR-CMS-022 | Content calendar: dashboard of upcoming effective/expiry events across the workspace with owner alerts at configurable lead times. | P2 | ENT |
| FR-CMS-023 | Workspace governance: content sharing policies between workspaces (share, copy-with-link-back, deny) with tenant-level mandatory objects (e.g., corporate legal footer) that workspaces cannot override. | P1 | ENT |

**AC-CMS (P0 gate):**
1. Editing a disclosure used by 40 templates surfaces all 40 in impact analysis before save; publishing the new version re-queues each impacted template for re-approval per workspace policy.
2. A composition run on 2026-01-15 for jurisdiction CA selects the clause version effective 2026-01-01, not the version expiring 2025-12-31; a run where no effective version exists fails the batch record with a specific error code.
3. Rollback of a content object creates a new approved-pending version identical to the target; history shows both operations immutably.

---

## 4. Template designer (FR-TPL)

Design intent: one designer, every channel, two personas. Designers own structure, logic, and channel projections; business users edit designated content within guardrails. AI accelerates every step but never publishes anything. The designer is where the outcome contract is made: no intended outcome, no publication.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-TPL-001 | **Intended outcome declaration**: every template requires an intended outcome from the governed taxonomy plus at least one measurable success criterion (event + window). Publication is blocked without it. Outcome definitions flow to analytics (FR-ANL-030). | P0 | MVP |
| FR-TPL-002 | Drag-and-drop visual designer: grid/flow layout, sections, repeating regions (line items), tables, charts, images, headers/footers, page/screen breaks; undo/redo; multi-user presence with edit locking at section granularity. | P0 | MVP |
| FR-TPL-003 | **Channel design surfaces**: one template, multiple channel projections — responsive/interactive HTML5, print/PDF (pixel-precise, master pages, imposition awareness), email (table-based/MJML-safe), SMS/RCS, chat/agent script, voice script (SSML-annotated), video storyboard (scene list + data-driven text/media slots). Shared content, per-channel layout. | P0 | MVP: interactive, PDF/print, email, SMS; ENT: voice script, video storyboard, chat |
| FR-TPL-004 | **Data binding**: bind any element to the canonical data model with type-aware formatting (locale currency/date/number), null/missing-data policies per element, and sample-data-driven live preview. | P0 | MVP |
| FR-TPL-005 | **Conditional content & logic**: visibility and variant-selection rules on any element/section driven by data, segment, consent, jurisdiction, channel, and A/B assignment; rule editor with plain-language rendering of logic ("shows when balance > 0 AND state = CA"); logic testable against sample records. | P0 | MVP |
| FR-TPL-006 | Component libraries: workspace- and tenant-level shared components (address block, payment summary, legal footer) with versioning and push-update of instances; locked components for regulated regions of a template that business users cannot alter. | P0 | MVP |
| FR-TPL-007 | **Multi-brand theming**: design tokens (color, type, spacing, logo slots) per brand; one template renders per-brand without duplication; brand assignment by rule or data. | P0 | MVP: 1 brand switch; ENT: full token system + reseller brands |
| FR-TPL-008 | Role-split editing: designer role edits layout/logic; business-user role edits only designated editable regions (text within guardrails: no layout, locked clauses immutable) with its own lightweight approval path. | P0 | MVP |
| FR-TPL-010 | **Preview matrix**: instant preview by device (mobile/tablet/desktop), channel, brand, language/translation, dark mode, accessibility simulations (screen-reader announcement order, color-blindness filters, 200% zoom reflow), and print (pagination, duplex, envelope window position). Preview uses real sample records or generated test data (FR-AI-090). | P0 | MVP: device/channel/print/dark-mode; ENT: full a11y + translation matrix |
| FR-TPL-011 | Test-data management: attach sample record sets to templates; edge-case coverage indicator (which conditional branches are exercised); AI-generated synthetic edge cases on demand. | P1 | MVP |
| FR-TPL-020 | **Embedded AI design assistant** (all actions draft-only, human accepts, logged per INV-3): (a) draft a template from a natural-language prompt + data schema; (b) **PDF-to-template conversion** — upload a legacy PDF/Word artifact, receive an editable template with detected regions, extracted content objects, and proposed data bindings; (c) readability improvement suggestions inline; (d) compliance flags citing the matched rule/clause; (e) alt-text generation for images/charts; (f) translation drafts (into FR-I18N workflow); (g) test-data generation. | P0 | MVP: a, b, c, e; ENT: d at depth, f/g integrated |
| FR-TPL-021 | Template lifecycle: draft → in-review → approved → published → retired; publication produces an immutable template version consumed by rendering; retirement blocks new compositions but preserves reproducibility (FR-ARC-004). | P0 | MVP |
| FR-TPL-022 | Template testing: regression rendering — render a candidate version against a pinned record corpus and produce a visual + data diff versus the published version before approval. | P1 | ENT |
| FR-TPL-023 | Interactive-action authoring: place and configure viewer actions (payment card, dispute entry points, forms, signature blocks, walkthrough steps, assistant scope) directly in the canvas with per-action visibility rules. | P0 | MVP |
| FR-TPL-024 | Template import/export as code: templates and components exportable as versioned, diff-able definitions for CI/CD promotion across environments (dev→staging→prod) with checksum verification. | P1 | MVP |
| FR-TPL-025 | Design-time governance hints: inline surfacing of CMS scores (reading level, brand, regulatory-risk) and accessibility issues while editing, so gate failures are fixed before review, not after. | P1 | MVP |

**AC-TPL (P0 gate):**
1. Attempting to publish a template without an intended outcome returns a blocking validation error in UI and API.
2. A designer builds a statement template once; interactive HTML5, PDF, and email projections render from the same content objects with channel-appropriate layout, verified by the preview matrix.
3. PDF-to-template conversion on the 20-document benchmark set yields an editable template in which ≥ 85% of text regions and ≥ 90% of static content are correctly extracted, with every AI-proposed binding flagged for human confirmation.
4. A business user cannot move, delete, or edit a locked disclosure component in any code path; the attempt is audit-logged.

---

## 5. Rendering & output management (FR-RND)

Design intent: one composition engine, deterministic and versioned, serving both a 2M-record overnight batch and a 200 ms API call — because outcome measurement and reproducibility both require that "the same communication" means the same bytes regardless of how it was produced.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-RND-001 | Composition engine: batch (millions of records per run) and on-demand (single-record API, p95 ≤ 2 s for a 10-page communication) from the same template version — bit-identical output for identical inputs. | P0 | MVP |
| FR-RND-002 | **Digital outputs**: interactive HTML5 communication package (viewer bundle, Section 8), PDF, PDF/A-1b/-2b/-3b, PDF/UA, interactive PDF (forms/actions), HTML email + MJML source, plain text, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), XML/JSON data renditions. | P0 | MVP: HTML5, PDF, PDF/A, PDF/UA, email, plain text, JSON/XML; ENT: Word, Excel, PPT, interactive PDF |
| FR-RND-003 | **Print outputs**: AFP (incl. index/TLEs), PDF/VT, PCL, PostScript, ZPL, TIFF, line data, Metacode; imposition-ready output with OMR/2D barcodes for inserter control. | P0 | ENT (MVP: print-ready PDF with barcodes) |
| FR-RND-004 | **Personalized media**: data-driven personalized video rendering (storyboard templates → per-recipient MP4/streaming manifest) and audio renditions (SSML → natural TTS audio) of any communication. | P1 | ENT |
| FR-RND-010 | **Packaging & bundling**: combine multiple communications per recipient/household into one package (statement + inserts + regulatory notices); bundling rules by data, weight, and page count; splitting of oversized packages per postal rules. | P0 | ENT (MVP: single-communication packaging) |
| FR-RND-011 | **Householding at output**: merge per-identity communications into household packages per FR-ING-031 groupings, with per-member privacy rules (e.g., health data never householded). | P0 | ENT |
| FR-RND-012 | Inserts & onserts: physical insert scheduling by inserter station, and digital onserts (targeted content pages) selected by the same rule engine. | P1 | ENT |
| FR-RND-013 | **Postal optimization**: presort (USPS Full-Service Intelligent Mail), commingling handoff files, address-quality-driven suppression, postage accounting reports; equivalent handoffs for PSP downstream sortation. | P0 | ENT |
| FR-RND-020 | Batch operations: job control (submit, pause, resume, cancel, restart from checkpoint), record-level error isolation (bad record quarantines without failing the run), reprocessing of quarantined subsets, dual-run reconciliation totals (records in = rendered + quarantined + suppressed, with reasons). | P0 | MVP |
| FR-RND-021 | Rendering audit: every artifact records template version, content object versions, data snapshot hash, engine version, and gate results — the reproducibility tuple consumed by FR-ARC-004. | P0 | MVP |
| FR-RND-022 | Proof and draft output: watermarked proof renditions for approval workflows and seed-list sends, excluded from archive-of-record and analytics by construction. | P0 | MVP |
| FR-RND-023 | Attachment handling: merge tenant-supplied PDFs (e.g., regulatory inserts produced elsewhere) into packages with validation (PDF version, tagging status) and inclusion recorded in the reproducibility tuple. | P1 | ENT |
| FR-RND-024 | Output optimization: PDF linearization, image downsampling profiles per channel, font subsetting; interactive bundle size budget enforced (NFR-006). | P1 | MVP |

**AC-RND (P0 gate):**
1. A 2M-record statement batch completes within the tenant SLA window; killing a worker node mid-run loses zero records (checkpoint restart); reconciliation totals balance exactly.
2. The same record + template version rendered on-demand and in batch produce byte-identical PDF output.
3. PDF/UA output from the accessibility-gated pipeline passes veraPDF and PAC checks with zero errors on the benchmark template set.

---

## 6. Omnichannel delivery & orchestration (FR-DLV)

Design intent: one orchestration brain owns the customer's communication relationship. Preferences, consent, caps, and quiet hours are enforced in one place for every channel — a send that violates them is structurally impossible, not procedurally discouraged. Failover ladders guarantee regulated communications always arrive somewhere provable.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-DLV-001 | **Channels**: email (native SMTP pool + ESP integrations), SMS, MMS, RCS, WhatsApp Business, mobile push, in-app inbox, secure web links, hosted portal, chat platforms, agent-desktop delivery (CRM embed), voice/IVR handoff and AI voice agent scripts, personalized video links, print (in-house handoff, PSP integration, USPS induction, certified mail with electronic return receipt), and raw API delivery (tenant systems pull artifacts + metadata). | P0 | MVP: email, SMS, secure links, portal, in-app, print handoff, API; ENT: RCS, WhatsApp, MMS, push vendors matrix, voice, video, certified mail, agent desktop |
| FR-DLV-010 | **Preference management**: per-identity channel preferences by communication category (regulatory, servicing, marketing-adjacent), paperless enrollment with e-consent capture, preference APIs + embeddable preference-center widget; preference changes are audit-logged and take effect for all not-yet-dispatched communications. | P0 | MVP |
| FR-DLV-011 | **Consent & do-not-contact**: consent records (channel, category, timestamp, source, proof); DNC lists (tenant + regulatory); orchestration hard-blocks sends violating consent/DNC — a block is recorded with reason and surfaced, never silently dropped. Regulatory communications may override marketing-style opt-outs per category rules, with the override recorded. | P0 | MVP |
| FR-DLV-012 | **Frequency caps & quiet hours**: per-channel and cross-channel caps per identity per window; quiet hours in the recipient's local time zone; regulatory communications configurably exempt; deferred sends queue and release automatically. | P0 | MVP: quiet hours + simple caps; ENT: cross-channel caps |
| FR-DLV-020 | **Journey orchestration**: visual journey builder — triggers (event, schedule, data condition), steps (send, wait, decision, A/B split, NBA call, human task, webhook), goals bound to intended outcomes; versioned journeys; in-flight migration policy (finish on old version / move to new). | P0 | MVP: linear + decision journeys; ENT: full builder incl. NBA + experiments |
| FR-DLV-021 | **Failover ladders**: per-communication-category channel ladders (e.g., email → SMS → print) with trigger conditions (hard bounce, not opened in N days, link expired unaccessed); digital-to-print failover generates the print rendition automatically from the same template version. | P0 | MVP: email→print; ENT: arbitrary ladders |
| FR-DLV-022 | Bounce/retry: channel-specific retry policies with exponential backoff; hard-bounce suppression feeding identity quality (FR-ING-041); complaint (FBL) processing; per-provider health monitoring with automatic traffic shifting across providers. | P0 | MVP: retry + suppression; ENT: multi-provider shifting |
| FR-DLV-023 | Escalation: undeliverable-on-all-channels communications create an operations case (queue + webhook) with the full attempt history. | P1 | MVP |
| FR-DLV-030 | **Secure access**: secure links with configurable expiry and one-time-use options; recipient authentication levels per communication sensitivity — none (public), knowledge check (DOB/ZIP), OTP via email/SMS, tenant-SSO, and passkeys/WebAuthn; MFA step-up required for high-sensitivity actions (payment account change, PII display) inside the viewer. | P0 | MVP: expiry links, OTP, knowledge check; ENT: passkeys, SSO federation, step-up policies |
| FR-DLV-031 | Expired-link behavior: expired or exhausted links render a safe re-request page (re-authenticate → fresh link), never the communication; all access attempts logged for proof-of-access (FR-ARC-003). | P0 | MVP |
| FR-DLV-040 | **Reconciliation**: end-to-end ledger per communication — composed → dispatched → provider-accepted → delivered/bounced → accessed; daily reconciliation reports; discrepancies (dispatched but no provider ack, printed but no induction scan) alarmed within a configurable window. | P0 | MVP: digital; ENT: print induction scans (IMb tracing) |
| FR-DLV-050 | **Cost optimization**: per-channel cost models; orchestration policies may optimize channel choice within preference/consent/regulatory constraints (never overriding them); paperless-conversion nudge campaigns as a built-in journey pattern; cost-per-outcome reporting to FR-ANL. | P1 | ENT |
| FR-DLV-051 | Blackout calendars: tenant-defined no-send dates (holidays, regulatory blackout periods, incident freezes) per channel and category, with deferral queues and regulatory-communication exemption rules. | P1 | MVP |
| FR-DLV-052 | Seed lists & proofing sends: watermarked proof deliveries (FR-RND-022) to internal seed addresses per channel before batch release, with hold-and-release job control. | P0 | MVP |
| FR-DLV-053 | Suppression list management: tenant-managed and regulatory suppression lists (litigation, deceased, fraud) checked at orchestration with the same hard-block semantics as FR-DLV-011. | P0 | MVP |

**AC-DLV (P0 gate):**
1. A send violating a DNC entry is blocked at orchestration with a recorded reason; the block appears in the reconciliation ledger and the journey run log; no provider API call is made.
2. An email that hard-bounces triggers the configured failover: the print rendition is composed from the same template version and appears in the next print handoff file, and the ledger shows the full chain.
3. A secure link opened after expiry shows the re-request page; the fresh OTP-authenticated link opens the communication; both events appear in proof-of-access.
4. Quiet hours: a journey step firing at 02:00 recipient-local queues and dispatches at the configured window start, verified across DST boundaries.

---

## 7. Interactive document experience (FR-IXD)

The interactive viewer is the IXM pillar's runtime and the platform's outcome engine: the place where "understood, paid, disputed, signed, self-served" actually happens. Design intent: the communication is a destination that explains itself, answers honestly, and closes the loop in place. **Acorn.Access (this repository) is embedded as the viewer's accessibility layer** — see FR-ACC-020.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-IXD-001 | Interactive viewer: responsive HTML5 rendition of any communication with personalized summary ("what this statement means for you"), expandable/collapsible sections, contextual tooltips on terms and line items, embedded FAQ panel, full-text in-document search, and guided walkthroughs (step-through highlighting) authored in the template designer. | P0 | MVP |
| FR-IXD-002 | Progressive fallback: every interactive communication has a static rendition (PDF) available for download and as the no-JS/unsupported-browser fallback; parity of regulated content between renditions is enforced at composition. | P0 | MVP |
| FR-IXD-010 | **Embedded AI assistant**: answers recipient questions **grounded only on (a) approved content objects and FAQ entries published for the template, (b) the recipient's own communication data, and (c) explicitly permitted tenant context** (e.g., approved product knowledge base). No open-web access, no cross-recipient data, ever. Every answer carries citations to its grounding sources. | P0 | MVP |
| FR-IXD-011 | **Assistant honesty on regulated content**: when confidence is below threshold or the question falls into a tenant-configured regulated category (legal effect, coverage determination, tax/medical advice), the assistant must state it cannot answer authoritatively and offer human escalation — it shall never guess. Hallucination detection (FR-AI-041) runs on every answer; failed answers are suppressed and replaced with the escalation response. All Q&A logged for analytics (FR-ANL-011) and audit. | P0 | MVP |
| FR-IXD-020 | **Payments**: pay-now inside the viewer via tenant payment-gateway integrations (hosted-fields tokenization; platform never touches PAN — SAQ-A posture); full/partial/scheduled payments and payment-plan enrollment per tenant configuration; instant confirmation written to the communication timeline and outcome events. | P0 | MVP: full/partial pay via one gateway family; ENT: plans, multi-gateway |
| FR-IXD-021 | **Disputes & claims**: structured dispute initiation on any line item (reason codes, evidence upload, free text) and claims intake (FNOL-style forms) routed to tenant systems via API/webhook with case-ID round-trip displayed to the recipient. | P0 | MVP: disputes; ENT: claims intake |
| FR-IXD-022 | **Forms & uploads**: embedded forms with validation and save/resume; secure document upload (typed checklist, virus scan, format validation) feeding tenant systems and the communication timeline. | P0 | MVP |
| FR-IXD-023 | **Secure messaging**: threaded secure messages in the communication context, routed to tenant service queues; attachments; retention per FR-ARC policy. | P1 | ENT |
| FR-IXD-024 | **Scheduling**: appointment booking (native slots or tenant scheduling-system integration) as an embedded action. | P1 | ENT |
| FR-IXD-025 | **Self-service updates**: address change (validated via FR-ING-040), channel/paperless preference change (writes to FR-DLV-010), contact-detail update — each with configurable verification step-up. | P0 | MVP |
| FR-IXD-026 | **ID verification**: pluggable IDV providers (document + selfie, KBA) invoked as a step-up before sensitive actions. | P1 | ENT |
| FR-IXD-027 | **E-signature**: embedded signing (native simple e-sign with intent capture + tamper-evident seal, and DocuSign/Adobe-class provider integration) with the signed artifact archived as a statement of record. | P0 | MVP: provider integration; ENT: native e-sign |
| FR-IXD-030 | **Escalation & handoff**: one-tap escalation to chat, callback scheduling, or voice — passing full context (communication ID, viewed sections, assistant transcript) to the agent desktop so the recipient never repeats themselves; deflection vs. escalation events feed outcome analytics. | P0 | MVP: context-carrying chat/phone handoff; ENT: agent-desktop embed |
| FR-IXD-031 | PDF download, print-friendly view, and share-to-authorized-party (POA/caregiver with consent record) from the viewer. | P1 | MVP: download/print; ENT: authorized sharing |
| FR-IXD-032 | Viewer theming: full brand-token theming (FR-TPL-007) including recipient dark-mode support and tenant CSP/domain configuration for embedded contexts (FR-WLB-003). | P0 | MVP |
| FR-IXD-033 | Viewer event API: every interaction emitted to the event fabric (FR-ANL-001) and, for embedded deployments, surfaced to the host page via postMessage with a documented contract. | P0 | MVP |
| FR-IXD-034 | Session security: viewer sessions time out per sensitivity tier; step-up policies per action (FR-DLV-030); all session and action events feed proof-of-access (FR-ARC-003). | P0 | MVP |

**AC-IXD (P0 gate):**
1. Red-team suite: the assistant, prompted with 500 adversarial questions (out-of-scope, cross-customer, jailbreak, regulated-advice), produces zero answers sourced outside its grounding set and zero uncited factual claims; 100% of regulated-category questions receive the cannot-answer + escalation response.
2. A payment completed in the viewer produces: gateway confirmation to the recipient, an outcome event attributed to the template's intended outcome, a timeline entry, and a webhook to the tenant — all within 5 seconds.
3. A dispute filed on a line item arrives at the tenant webhook with the structured payload and evidence files; the case ID returned is displayed in the viewer within the session.
4. With JavaScript disabled, the secure link serves the PDF rendition with identical regulated content.

---

## 8. AI everywhere & AI governance (FR-AI)

Design intent: AI is a governed subsystem, not a feature sprinkle. Every AI capability in the platform is an entry in one catalog with a declared grounding policy, gate class, and audit surface — so a compliance officer can answer "where does AI touch our communications, with which models, under whose approval" from one dashboard.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-AI-001 | **AI service catalog** exposed as governed internal services consumed by all pillars: authoring/drafting, design assistance, data mapping (FR-ING-010), migration conversion (FR-MIG), compliance review, accessibility remediation (FR-ACC-011), translation (FR-I18N), brand review, sentiment, readability, personalization, NBA support (FR-NBA), journey/delivery optimization, analytics narration, anomaly detection, test-case generation, synthetic-data generation, document comparison, knowledge-graph construction, compliance evidence generation. Each service declares inputs, grounding policy, output type, and review-gate class. | P0 | MVP: the services referenced by MVP FRs; ENT: full catalog |
| FR-AI-010 | **Prompt library**: versioned, tenant-scoped prompt/instruction sets per AI service; changes go through approval like content objects; per-prompt evaluation suites with regression scoring before promotion. | P0 | MVP |
| FR-AI-011 | **Model routing & BYO-model**: pluggable model providers per AI service per tenant (platform-hosted, tenant cloud account, on-prem endpoint); routing rules by task, data classification (e.g., PHI-touching tasks restricted to approved deployments), cost, and latency; automatic failover between approved models. | P0 | MVP: provider abstraction + per-tenant selection; ENT: full routing policy engine |
| FR-AI-020 | **Human review gates**: every AI service is classified — `advisory` (suggestions only), `gated` (output requires explicit human approval before taking effect; all content/template/compliance outputs are at minimum gated), `autonomous-bounded` (may act within pre-approved bounds, e.g., send-time selection, with audit). Customer-visible generated content in regulated categories is always gated. Gate class is tenant-configurable only toward stricter. | P0 | MVP |
| FR-AI-030 | **RAG with citations**: all retrieval-grounded services (assistant, compliance review, evidence generation) cite retrieved sources with version identifiers; uncited assertions are stripped or the response is rejected. | P0 | MVP |
| FR-AI-040 | **Confidence scoring**: every AI output carries a calibrated confidence score; per-service thresholds drive gating behavior (below threshold → mandatory human review or refusal). | P0 | MVP |
| FR-AI-041 | **Hallucination detection**: independent verification pass (claim extraction → grounding check) on customer-facing generations; detected failures are suppressed, logged as incidents, and surfaced on the AI governance dashboard. | P0 | MVP |
| FR-AI-050 | **Data protection**: no training or fine-tuning on tenant data by default; tenant opt-in required per use, revocable, and logged; per-tenant inference isolation; PII/PHI minimization before prompts where the task allows; full prompt/response logging with the same masking rules as FR-ING-021. | P0 | MVP |
| FR-AI-060 | **AI compliance review**: pre-approval scan of templates and content objects against tenant rulebooks + regulatory clause libraries — flags missing mandatory clauses, prohibited language, claim-substantiation risks, jurisdiction mismatches; every flag cites the rule; reviewer dispositions (accept/waive with justification) are recorded and reportable. | P0 | MVP: rulebook checks; ENT: regulatory library packs |
| FR-AI-070 | **Document comparison**: semantic diff of any two communications/templates/versions ("what changed and does it alter meaning or obligations"), used in approvals and migration validation. | P1 | ENT |
| FR-AI-080 | **Knowledge graph**: entity graph across content objects, templates, regulations, products, and outcomes powering impact analysis, semantic search, and assistant grounding scope resolution. | P2 | ENT |
| FR-AI-090 | **Test & synthetic data generation**: schema-aware synthetic record generation (edge cases, locale variants, boundary values) with a guarantee of no real-customer data leakage (generated from schema + distributions, never from raw records without differential safeguards). | P1 | MVP |
| FR-AI-100 | **AI governance dashboard**: per-tenant view of AI usage by service, model, gate outcomes, confidence distributions, hallucination incidents, override rates, and cost; exportable for model-risk-management (SR 11-7-style) documentation. | P0 | MVP: usage + incidents; ENT: full MRM pack |
| FR-AI-110 | **Evaluation harness**: per-service golden datasets and scoring pipelines; model or prompt changes require a passing eval run (quality + safety suites) before promotion to any tenant; eval results retained as release evidence. | P0 | MVP |
| FR-AI-111 | **Red-team suite as release gate**: adversarial test corpus (grounding escapes, cross-tenant probes, jailbreaks, regulated-advice traps) executed on every assistant-affecting release; any grounding escape blocks the release. | P0 | MVP |
| FR-AI-112 | AI incident management: hallucination or grounding incidents open cases with severity, affected communications, tenant notification rules, and post-incident eval additions — the corpus grows from every failure. | P0 | MVP |

**AC-AI (P0 gate):**
1. A tenant admin switches the assistant's model to their Azure-hosted deployment; subsequent inference calls route there exclusively (verified by egress logs); platform-hosted fallback occurs only if the tenant enabled it.
2. An AI compliance flag on a missing state-mandated clause cites the specific rulebook entry; the template cannot be published until the flag is dispositioned; a waiver requires justification text and appears in the evidence pack.
3. Governance dashboard shows zero training jobs referencing tenant data for a tenant that has not opted in (verified against training-pipeline audit logs).

---

## 9. Next best action engine (FR-NBA)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-NBA-001 | **Decision inputs**: identity profile, behavioral events (interactions, journey history), consent and preference state, regulatory constraints (hard filters, evaluated first), propensity model scores, and tenant business rules — combined by a policy engine where **rules and regulatory filters always dominate model scores**. | P0 | ENT |
| FR-NBA-002 | **Action catalog**: pay now, enroll in payment plan, renew, dispute, upload document, book appointment, switch channel, go paperless, update details, escalate to human, no-action. Tenant-extensible with custom actions bound to viewer capabilities (FR-IXD) or journey steps. | P0 | ENT |
| FR-NBA-003 | **Decision points**: NBA callable at composition (which onsert/module to include), in the viewer (which action card to feature), in journeys (which branch), and via API for external channels (agent desktop, IVR). Same decision service, same audit, everywhere. | P0 | ENT |
| FR-NBA-010 | **Explainability**: every decision returns the ranked candidate set with reason codes (which rules filtered, which features drove the score) in human-readable form; explanations stored with the decision and visible to agents and auditors. | P0 | ENT |
| FR-NBA-011 | **Auditability**: immutable decision log (inputs snapshot hash, model version, rule versions, output, explanation); point-in-time replay reproduces any historical decision. | P0 | ENT |
| FR-NBA-020 | Propensity models: tenant-trained models on tenant data only (opt-in per FR-AI-050), or tenant-supplied scores via API; model registry with versioning, performance monitoring, drift detection, and champion/challenger. | P1 | ENT |
| FR-NBA-021 | Experimentation: holdout groups and uplift measurement per action; NBA effectiveness reported in outcome terms (incremental outcome attainment vs. holdout). | P1 | ENT |

**AC-NBA:** A recipient with a paperless consent already granted is never offered "go paperless" (rule filter precedes scoring); the decision log for any decision shows filter → rank → selection with reason codes; replaying a 90-day-old decision reproduces the identical output.

---

## 10. Analytics (FR-ANL)

Design intent: analytics exists to answer one question — did the communication achieve its declared outcome, and if not, why — and to route the answer back into content, templates, journeys, and NBA. Volume and SLA metrics are operational context, never the headline.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-ANL-001 | **Event fabric**: every delivery event (dispatched, delivered, bounced, printed, inducted) and interaction (open, dwell, scroll depth, section expand, tooltip, search query, FAQ view, assistant Q&A, action start/complete/abandon, download, escalation) captured as first-class events with communication, template-version, journey, and identity keys; streaming to tenant destinations (webhook, Kafka, warehouse share). | P0 | MVP |
| FR-ANL-010 | Engagement analytics: per-template hotspot and heatmap visualizations (attention by section), scroll-depth distributions, search and FAQ query rankings, abandonment funnels for embedded forms/payments. | P0 | MVP: core engagement + funnels; ENT: heatmaps |
| FR-ANL-011 | **Assistant analytics**: question clustering, unanswered/low-confidence question rankings (direct input to content gaps), escalation reasons, self-serve resolution rate. | P0 | MVP |
| FR-ANL-020 | Journey analytics: funnel per journey version, step conversion, time-in-step, drop-off, cross-channel path analysis, cohort comparison. | P0 | MVP: funnels; ENT: paths/cohorts |
| FR-ANL-021 | **Experimentation**: A/B and multivariate tests on templates, subject lines, section order, action placement, journey branches; assignment integrity, sequential-testing guardrails, and results expressed in outcome terms with significance. | P0 | MVP: A/B; ENT: multivariate |
| FR-ANL-030 | **Outcome analytics**: outcome attainment rate per template/journey/segment/channel against the declared intended outcome and window (FR-TPL-001); call-deflection measurement via contact-center data integration (calls tagged to communications within the attribution window); cost-per-outcome. This is the default dashboard view. | P0 | MVP |
| FR-ANL-031 | **Customer timeline**: unified per-identity view of every communication, delivery event, interaction, assistant conversation, action, and outcome — permissioned for agent and audit use. | P0 | MVP |
| FR-ANL-040 | Anomaly detection: automatic alerting on deviations (bounce spikes, engagement collapse after a template change, assistant escalation surge) with AI-generated narrative diagnosis (advisory class). | P1 | ENT |
| FR-ANL-041 | Analytics narration: natural-language summaries of any dashboard ("what changed this week and why") with figures cited to the underlying queries. | P2 | ENT |
| FR-ANL-050 | Privacy: interaction analytics honor consent and regional rules (e.g., no open-tracking where prohibited); identity-level analytics permissioned; aggregate views k-anonymity-thresholded. | P0 | MVP |
| FR-ANL-051 | BI export: governed datasets shared to tenant warehouses (Snowflake/BigQuery/Databricks shares) and generic query API, honoring the same masking and permission model as the UI. | P1 | ENT |
| FR-ANL-052 | Executive scorecards: portfolio-level rollups (OAR by outcome class, digital adoption, deflection, cost per outcome) with period comparison and target tracking. | P1 | MVP |

**AC-ANL (P0 gate):** For a published template, the outcome dashboard shows attainment rate computed from real events within the declared window; a payment in the viewer appears in the funnel, the timeline, and OAR within 5 minutes; a tenant user without identity-level permission sees only aggregates.

---

## 11. Archive & statement of record (FR-ARC)

Design intent: the archive is not storage; it is the enterprise's ability to prove — content, delivery, access, approval, AI involvement, and version rationale — for every communication, for its full legal life, reproducibly. It is also a wedge: evidence packs in minutes are a capability incumbents structurally lack.

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-ARC-001 | **Immutable archive**: every delivered communication archived as the statement of record — rendered artifact(s), data snapshot, template/content versions, gate results, delivery ledger; WORM storage (object-lock compliance mode); cryptographic hash chain across records. | P0 | MVP |
| FR-ARC-002 | **Retention & legal hold**: retention schedules per communication category/jurisdiction with automatic disposition (certified destruction records); legal holds override disposition, are case-scoped, audited, and reportable. | P0 | MVP: retention + hold; ENT: disposition certification |
| FR-ARC-003 | **Proof set**: for any communication, produce on demand: proof of content (what exactly was sent, hash-verified), proof of delivery (ledger + provider evidence + certified-mail receipts), proof of access (authenticated views with timestamps), proof of approval (who approved which versions), proof of AI changes (every AI-originated modification and its human approver), and version proof (why this template/content version was selected). Assembled into an **evidence pack** (human-readable + machine-readable) in ≤ 15 minutes. | P0 | MVP |
| FR-ARC-004 | **Reproducibility**: re-materialize any archived communication from its reproducibility tuple (FR-RND-021) on demand, byte-comparable to the archived artifact; rendering-engine versions retained/containerized to guarantee this for the full retention period. | P0 | MVP |
| FR-ARC-005 | **eDiscovery**: search across the archive by identity, date, template, content text, and metadata; export with chain-of-custody manifest; reviewer workspaces with access logging. | P0 | MVP: search/export; ENT: reviewer workspaces |
| FR-ARC-006 | Archive access channels: recipient self-service history in the portal/viewer, agent lookup, bulk API, and batch export for downstream archival systems; all access logged. | P0 | MVP |
| FR-ARC-007 | Migration-in: bulk import of legacy archives (PDF/AFP + index files) with metadata mapping so tenants can decommission legacy repositories. | P1 | ENT |
| FR-ARC-008 | Key longevity: encryption keys and their custody records retained and rotatable for the full retention period without re-encrypting WORM content (envelope encryption); key destruction is itself an audited disposition event. | P0 | MVP |

**AC-ARC (P0 gate):** An evidence pack for a 13-month-old communication assembles in under 15 minutes and includes all six proofs; attempting to modify or delete a record under WORM/hold fails at the storage layer (not just the app layer); re-materialization of that communication hash-matches the archived artifact.

---

## 12. Accessibility (FR-ACC)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-ACC-001 | **Conformance baseline**: all customer-facing renditions conform to WCAG 2.2 AA; PDF output conforms to PDF/UA-1; platform commitments cover Section 508 and EN 301 549; platform authoring UIs themselves conform to WCAG 2.2 AA. | P0 | MVP |
| FR-ACC-002 | **Evidence packs**: auto-generated accessibility conformance reports per template version — WCAG 2.1 AA evidence packs (for procurement/regulatory regimes still citing 2.1) and WCAG 2.2 AA reports, plus PDF/UA validation results — attached to the template and exportable (ACR/VPAT-style). | P0 | MVP: 2.2 reports; ENT: full ACR generation |
| FR-ACC-010 | **Publication gates with block-on-fail**: automated accessibility checks (structure, contrast, alt text, reading order, tagging, form labels, focus order) run at template publication and at rendition build; failures **block publication/dispatch** — waivable only by a permissioned role with justification, recorded in the evidence pack. | P0 | MVP |
| FR-ACC-011 | **Auto-remediation**: AI-assisted fixes (alt-text generation, heading-structure repair, table tagging, contrast-safe token substitution, PDF tag-tree remediation) proposed at design time and applied at the gate — gated class per FR-AI-020 for content-bearing fixes. | P0 | MVP: alt text + tagging; ENT: full remediation suite |
| FR-ACC-020 | **Acorn.Access embedded**: the Acorn.Access widget (this repository) ships as the accessibility layer of every interactive viewer — user-controlled presentation adjustments (contrast, spacing, fonts, motion, reading aids), preferences persisted locally, zero data egress per its own PRD; enabled by default, tenant-configurable feature set; the viewer must remain fully conformant with the widget disabled (the widget augments, never substitutes for, conformant output). | P0 | MVP |
| FR-ACC-021 | Accessibility preview tooling in the designer: screen-reader announcement-order simulation, color-blindness filters, zoom-reflow check (FR-TPL-010). | P1 | ENT |
| FR-ACC-030 | Alternate formats: on-request large print, braille-ready (BRF) export handoff, and audio rendition (FR-RND-004) per recipient accessibility preference stored in the preference center. | P1 | ENT |

**AC-ACC (P0 gate):** A template with a contrast failure cannot be published until fixed or waived-with-justification; the waiver appears in the evidence pack; the interactive viewer with Acorn.Access active passes WCAG 2.2 AA audit on the benchmark suite; the viewer makes zero network calls attributable to the widget.

---

## 13. Security & compliance (FR-SEC)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-SEC-001 | Tenant isolation: logical isolation with per-tenant encryption keys (BYOK/HYOK options ENT); optional dedicated-cell deployment for regulated tenants. | P0 | MVP: logical + per-tenant keys; ENT: BYOK, dedicated cells |
| FR-SEC-002 | IAM: SSO (SAML/OIDC), SCIM provisioning, fine-grained RBAC (workspace-scoped roles), ABAC conditions (e.g., PII access), least-privilege defaults, session policies, admin action step-up MFA. | P0 | MVP |
| FR-SEC-003 | Encryption: TLS 1.2+ in transit, AES-256 at rest, field-level encryption for high-sensitivity attributes, key rotation, HSM-backed key management. | P0 | MVP |
| FR-SEC-004 | Audit: immutable platform audit log (INV-2) with export to tenant SIEM; tamper-evidence via hash chaining. | P0 | MVP |
| FR-SEC-005 | Compliance posture: SOC 2 Type II and PCI DSS SAQ-A scope at MVP; HIPAA (BAA-ready) at MVP for healthcare tenants; HITRUST, ISO 27001, FedRAMP-Moderate path in ENT. | P0 | Per row |
| FR-SEC-006 | Privacy operations: DSAR support (locate/export/delete per identity within legal constraints — archive records under retention are exempt-but-reported), data-residency controls per tenant region, processing records. | P0 | MVP: DSAR + residency selection; ENT: multi-region residency |
| FR-SEC-007 | Application security: secrets management, dependency and container scanning in CI, pen tests per release, vulnerability SLA (critical ≤ 7 days), signed artifacts, SBOM per release. | P0 | MVP |

**AC-SEC (P0 gate):**
1. A cross-tenant access attempt via any API (crafted IDs, shared-resource probing) returns not-found semantics and raises a security event; the isolation test suite runs in CI on every release.
2. A user granted a workspace role in workspace A has zero visibility into workspace B objects in UI, API, search, and analytics.
3. Every admin action requiring step-up MFA fails closed when the second factor is unavailable; the failure is audit-logged.

---

## 14. Multilingual (FR-I18N)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-I18N-001 | **Translation workflow**: AI machine translation drafts (gated class) → human review/post-edit (internal reviewers or LSP connector) → approval; per-language content object variants (FR-CMS-006); language coverage dashboard per template (which variants are missing/stale vs. source version). | P0 | MVP: AI + internal review; ENT: LSP connectors |
| FR-I18N-002 | **Translation memory & terminology**: tenant-scoped TM reused across jobs; terminology libraries (do-translate/don't-translate/regulated-term glossaries) enforced in AI drafts and flagged in human review. | P0 | MVP: glossaries; ENT: full TM |
| FR-I18N-003 | **RTL & script support**: full right-to-left rendering (Arabic, Hebrew) across interactive, PDF, print, and email projections; bidirectional text handling; CJK line-breaking and font strategy; template mirroring preview. | P0 | MVP: interactive/PDF; ENT: full matrix |
| FR-I18N-004 | Locale formatting: dates, numbers, currency, addresses, honorifics, collation per locale, applied by the data-binding layer automatically (FR-TPL-004). | P0 | MVP |
| FR-I18N-005 | **Multilingual accessibility**: accessibility gates (FR-ACC-010) run per language variant — lang attributes, correct screen-reader language switching, reading-order validation for RTL; evidence packs per language. | P0 | MVP: lang tagging; ENT: per-variant packs |
| FR-I18N-006 | Language selection: recipient language preference in the preference center; fallback chains (es-MX → es → source) with mandatory-content parity checks — a missing regulated clause in a variant blocks that variant, not silently falls back. | P0 | MVP |

**AC-I18N (P0 gate):**
1. A recipient with language preference `es` receives the approved Spanish variant across email, viewer, and PDF; a template whose Spanish variant lacks an approved mandatory clause fails composition for that recipient with a specific error, never falling back silently to English for the regulated clause.
2. An Arabic variant renders correct RTL layout in the viewer and PDF/UA output, with `lang`/`dir` attributes verified by the accessibility gate.
3. Updating a source clause marks all language variants stale on the coverage dashboard within one minute.

---

## 15. Migration (FR-MIG)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-MIG-001 | **Legacy template conversion**: AI-assisted conversion from incumbent formats (Quadient Inspire, OpenText Exstream, Smart Communications, EngageOne, Word/PDF masters) to Acorn templates + extracted content objects; conversion confidence report per template; human-in-the-loop fix-up workspace. | P0 | MVP: PDF/Word conversion (FR-TPL-020b); ENT: incumbent-format converters |
| FR-MIG-002 | **Print-stream re-engineering**: parse AFP/Metacode/PCL streams (FR-ING-004) into layout + data models to reconstruct templates where source templates are lost. | P1 | ENT |
| FR-MIG-003 | **Migration validation**: side-by-side visual and extracted-text comparison of legacy output vs. Acorn output over a pinned record corpus; semantic diff (FR-AI-070) for meaning-level changes; sign-off workflow per template with the comparison attached as evidence. | P0 | ENT (MVP: manual compare tooling) |
| FR-MIG-004 | Migration factory operations: portfolio inventory (dedup analysis across legacy templates — typically 40–70% consolidation), batch conversion queues, throughput dashboards, per-template status tracking. | P1 | ENT |
| FR-MIG-005 | Archive migration-in per FR-ARC-007. | P1 | ENT |

**AC-MIG (ENT gate):**
1. On the incumbent-converter benchmark portfolio (100 templates per source format), ≥ 70% of templates convert to approved state with ≤ 2 hours human fix-up each; every converted template carries a conversion confidence report.
2. Migration validation renders legacy and Acorn output over a 10k-record corpus and produces a per-template visual/text/semantic diff report; sign-off is blocked while unreviewed differences remain.

---

## 16. White-label / OEM (FR-WLB)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| FR-WLB-001 | **Tenant/reseller hierarchy**: partners operate sub-tenants with delegated administration, inherited-but-overridable configuration, and hard data isolation between sub-tenants. | P0 | ENT |
| FR-WLB-002 | **Multi-branding**: full white-labeling of recipient-facing surfaces (viewer, portal, preference center, notifications — domains, certificates, email sending identities) and of operator UIs (partner logo/theme). | P0 | ENT (MVP: recipient-surface branding for direct tenants) |
| FR-WLB-003 | **Embeddable widgets**: viewer, preference center, payment card, and assistant embeddable via web components/iframe with postMessage APIs and CSP-compatible packaging. | P0 | MVP: viewer embed; ENT: full set |
| FR-WLB-004 | **Headless APIs**: every capability (ingest, compose, render, deliver, archive query, analytics events) available API-first with OpenAPI specs, SDKs (TypeScript, Java, Python, C#), webhooks, and sandbox tenants. | P0 | MVP |
| FR-WLB-005 | **Usage & revenue reporting**: metered usage per sub-tenant (communications, renditions, channels, AI calls, storage), partner-facing billing exports, and revenue-share reporting. | P0 | ENT |

**AC-WLB:**
1. A partner-provisioned sub-tenant inherits the partner's default configuration, can override permitted settings only, and has zero data visibility into sibling sub-tenants (verified by the isolation suite of AC-SEC-1).
2. The embedded viewer runs inside a host page with a strict CSP (no unsafe-inline, allow-listed origins) with full functionality including Acorn.Access.
3. Monthly metering exports reconcile with the platform event ledger to ±1% (NFR-009).

---

## 17. Non-functional requirements (NFR)

| ID | Requirement | Priority | Release |
|---|---|---|---|
| NFR-001 | **Availability**: 99.9% (MVP) → 99.95% (ENT) monthly for interactive viewer, delivery orchestration, and on-demand rendering; batch pipeline 99.5% with SLA-scheduled windows. | P0 | Per row |
| NFR-002 | **Multi-region**: active-passive DR at MVP; ENT: multi-region active-active for viewer/delivery and per-tenant data-residency pinning (US, EU, UK, CA, APAC). | P0 | Per row |
| NFR-003 | **RPO/RTO**: RPO ≤ 5 min, RTO ≤ 1 h for transactional stores; archive RPO 0 (synchronous replication of WORM writes). DR tested per quarter with published results. | P0 | MVP |
| NFR-004 | **Zero-downtime deploys**: rolling/blue-green for all services; schema migrations backward-compatible N-1; template/content versioning guarantees in-flight batches complete on the version they started with. | P0 | MVP |
| NFR-005 | **Scale targets**: MVP — 50M communications/month/tenant batch, 200 renders/sec on-demand burst, 10k concurrent viewer sessions/tenant; ENT — 500M/month, 2k renders/sec, 100k concurrent sessions. | P0 | Per row |
| NFR-006 | **Performance**: interactive viewer TTFMP ≤ 2 s p95 on 4G mid-tier mobile; on-demand render p95 ≤ 2 s (10-page communication); assistant first token ≤ 1.5 s p95; event ingestion-to-dashboard ≤ 5 min. | P0 | MVP |
| NFR-007 | **Rate limits & quotas**: per-tenant, per-API-key limits with 429 + Retry-After semantics; tenant-visible quota dashboards; burst policies; noisy-neighbor isolation verified by load test. | P0 | MVP |
| NFR-008 | **Observability**: OpenTelemetry traces/metrics/logs across every service, propagated through batch jobs and AI calls; tenant-facing status page; per-tenant SLO dashboards; correlation ID from ingestion through delivery to interaction on every record. | P0 | MVP |
| NFR-009 | **Capacity & cost transparency**: per-tenant usage metering (NFR basis for FR-WLB-005) accurate to ±1%; forecasting alerts at 80% of quota. | P1 | MVP |
| NFR-010 | **Accessibility of the platform itself**: operator UIs WCAG 2.2 AA (see FR-ACC-001). | P0 | MVP |
| NFR-011 | **Browser/device support**: viewer — last 2 versions of evergreen browsers + iOS/Android WebView; no-JS fallback per FR-IXD-002. Operator UIs — evergreen desktop browsers. | P0 | MVP |
| NFR-012 | **Data durability**: 11-nines object durability for archive; integrity verification (hash re-check) on a rolling schedule with alerting. | P0 | MVP |
| NFR-013 | **Resilience testing**: fault-injection (worker kill, dependency loss, region failover) exercised in staging per release and in production game-days per quarter; batch checkpoint-restart validated under injected failure. | P0 | MVP |
| NFR-014 | **Batch SLA windows**: tenant-configurable production calendars with SLA countdown monitoring, predictive late-warning (projected completion vs. window), and prioritized preemption of lower-class jobs. | P0 | MVP |
| NFR-015 | **Environment parity**: sandbox and staging run the same engine versions as production (N or N+1 only) so template regression tests (FR-TPL-022) are predictive. | P0 | MVP |

**AC-NFR (P0 gate):**
1. Load test at 2× MVP scale targets sustains p95 latency budgets (NFR-006) with zero cross-tenant noisy-neighbor breach (NFR-007).
2. Simulated region loss meets RPO ≤ 5 min / RTO ≤ 1 h with a published test report; archive writes confirm synchronous replication (RPO 0).
3. A deploy during an active 1M-record batch completes with zero record loss and the batch finishing on its starting template versions (NFR-004).
4. Every customer-facing request carries an OpenTelemetry trace from edge to storage; a support engineer can retrieve the full trace for any communication ID within 5 minutes (NFR-008).

### 17.1 Cross-domain dependencies and sequencing constraints

| Dependency | Constraint |
|---|---|
| FR-TPL-001 → FR-ANL-030 | Outcome taxonomy and success-criteria schema must freeze before analytics GA; changes thereafter are versioned, not breaking. |
| FR-ING-020/023 → FR-AI-* | PII/PHI classification must precede any AI service touching tenant data (minimization depends on it). |
| FR-CMS-020 + FR-ACC-010 + FR-AI-060 → FR-RND-* | All three publication gates integrate in the pipeline before first production tenant; gates are designed as one pluggable gate framework. |
| FR-RND-021 → FR-ARC-004 | Reproducibility tuple schema is a day-one contract; retrofit is prohibitively expensive. |
| FR-DLV-011/016/053 → all channels | Consent/DNC/suppression enforcement is built into the orchestration core before any channel connector ships, including the first. |
| FR-IXD-009/010 → FR-AI-006/007/041/111 | The assistant ships only after gates, grounding, hallucination detection, and the red-team release gate are operational. |
| Acorn.Access (FR-ACC-020) → FR-IXD-001 | Widget integration and CSP compatibility are part of the viewer's definition of done, not an add-on. |

---

## 18. MVP definition — what ships first and why

**Thesis:** the MVP must prove the *outcome loop* end to end for a regulated tenant on real volume — not maximize format coverage. The wedge deals are interactive statements/bills/EOBs with measurable call deflection and payments, plus a compliance story incumbents cannot match (evidence pack + AI governance + accessibility gates).

**In the MVP (P0 rows marked MVP above), summarized:**

1. **Ingest** the formats that cover 80% of wedge deals: JSON, XML, CSV, fixed-width/copybook, Excel, Parquet/Avro, FHIR + X12 835/837 + ISO 20022 camt; REST/SFTP/object-storage intake; AI schema mapping; validation/quarantine; PII/PHI detection + masking; deterministic identity matching; USPS REST address validation.
2. **Govern** content: full CMS with versioning, compare, rollback, single/dual-step approvals, effective dating, direct-reference impact analysis, variants, AI tagging + reading level, semantic search.
3. **Design** once: designer with interactive/PDF/email/SMS projections, data binding, conditional logic, components, brand tokens, role-split editing, preview matrix core, intended-outcome declaration, AI assistant (draft-from-prompt, PDF-to-template, readability, alt text).
4. **Render**: batch + on-demand; interactive HTML5, PDF, PDF/A, PDF/UA, email, plain text, JSON/XML, print-ready PDF with inserter barcodes; checkpointed batch ops with reconciliation.
5. **Deliver & orchestrate**: email, SMS, secure links, portal, in-app, print handoff, API; preferences, consent/DNC hard-blocks, quiet hours, basic caps; linear/decision journeys; email→print failover; OTP/knowledge-check secure access; digital reconciliation ledger.
6. **Interact**: viewer with summary, expandable sections, tooltips, FAQs, search, walkthroughs; grounded assistant with citations, refusal-and-escalate on regulated content, hallucination detection; payments (one gateway family); disputes; forms/uploads; self-service address/preference updates; provider e-signature; context-carrying escalation; PDF fallback; **Acorn.Access embedded**.
7. **Measure outcomes**: event fabric, engagement + assistant analytics, journey funnels, A/B testing, outcome dashboards with call-deflection attribution, customer timeline.
8. **Prove it**: WORM archive, retention + legal hold, six-proof evidence pack ≤ 15 min, reproducibility, eDiscovery search/export.
9. **Trust**: accessibility block-on-fail gates + evidence reports; AI governance (prompt library, model abstraction + per-tenant selection, review gates, RAG citations, confidence, no-training default, governance dashboard); SOC 2 + HIPAA-ready + SAQ-A; SSO/SCIM/RBAC; DSAR; OpenTelemetry; zero-downtime deploys; headless APIs + SDKs + viewer embed.
10. **Language**: AI + internal-review translation workflow, glossaries, RTL for interactive/PDF, locale formatting, language fallback with parity checks.

**MVP exit criteria (definition of done for the release, beyond per-domain ACs):**

1. Two design-partner tenants run production volume (≥ 1M communications/month each) for 60 consecutive days within SLA.
2. One tenant demonstrates measured call deflection ≥ 20% for an interactive communication versus its static baseline, using the published attribution methodology.
3. A complete evidence pack for a randomly selected production communication assembles in ≤ 15 minutes in front of a tenant compliance officer.
4. Zero assistant hallucination incidents on regulated content across all production traffic in the final 30 days (FR-AI-112 register).
5. Accessibility: 100% of published production templates pass the WCAG 2.2 AA / PDF/UA gates or carry recorded waivers; the viewer + Acorn.Access passes an independent third-party audit.
6. SOC 2 Type II audit period underway with no open critical findings; BAA executed with at least one healthcare tenant.

**Explicitly not in MVP** (even though incumbents have some of it): AFP/PCL/Metacode native output (print-ready PDF bridges via PSPs), NBA engine, householding, postal presort, RCS/WhatsApp/voice/video channels, personalized video/audio rendering, reseller hierarchy, incumbent-format template converters, multi-region active-active. Rationale: none is required to close and prove the wedge use case, and each is a well-understood ENT build-out rather than a product-risk item.

---

## 19. Enterprise release definition

The ENT release makes Acorn OS a full incumbent replacement and PSP/OEM-grade platform. Everything marked ENT above, organized around five programs:

1. **Print & output parity**: AFP, PCL, PostScript, ZPL, Metacode, PDF/VT, line data; packaging/bundling/splitting; householding; inserts/onserts; postal presort + commingling + IMb tracing; certified mail with electronic return receipt.
2. **Migration factory**: incumbent-format converters, print-stream re-engineering, migration validation with semantic diff and sign-off evidence, portfolio dedup analytics, archive migration-in.
3. **Intelligence at depth**: NBA engine (full FR-NBA), full journey builder with experiments and cost optimization, propensity model registry, anomaly detection + narration, heatmaps, multivariate testing, knowledge graph.
4. **Channel completion**: RCS, WhatsApp, MMS, push-provider matrix, voice/IVR + AI voice agent scripts, personalized video/audio, agent-desktop embed, claims intake, scheduling, secure messaging, native e-sign, IDV, passkeys/SSO federation for recipients.
5. **Enterprise trust & scale**: multi-region active-active + residency pinning, BYOK/dedicated cells, HITRUST/ISO 27001/FedRAMP path, full ACR/VPAT generation + alternate formats (braille/large print/audio), per-language evidence packs, reseller hierarchy + white-label depth + usage/revenue reporting, 99.95% SLA and ENT scale targets.

---

## 20. Out of scope (explicit)

The platform will **not** build:

1. **Marketing automation / campaign management for promotional acquisition** (ESP-style newsletter tooling, ad audience management, CDP replacement). We orchestrate regulated, transactional, and servicing communications and integrate with marketing clouds and CDPs via events and APIs.
2. **Core-system functionality**: policy administration, core banking, claims adjudication, billing calculation. We consume their data and render/deliver/measure their communications; we never compute the bill.
3. **A general-purpose CRM or case-management suite.** Escalations, disputes, and messages route into tenant systems; we provide the queues and webhooks, not the case lifecycle.
4. **Payment processing / merchant-of-record services.** Payments are executed by tenant gateways via tokenized embeds; the platform never stores PAN and never moves money.
5. **A general web CMS / DXP** (marketing websites, blogs). The CMS governs communication content objects only.
6. **Physical print manufacturing.** We produce print-ready output, inserter controls, and postal artifacts; presses and inserters belong to tenants/PSPs.
7. **Foundation-model development.** We route to and govern models (including BYO); we do not train foundation models, and never on tenant data by default.
8. **General-purpose e-signature CLM** (contract lifecycle management, negotiation redlining). Embedded signing of communications only.
9. **Standalone accessibility overlay claims.** Acorn.Access augments user control in the viewer; conformance is achieved in the rendered output itself (FR-ACC-001), never claimed via the widget alone.
10. **Anonymous cross-tenant data products.** No benchmark or model product uses tenant data without explicit, revocable, per-tenant opt-in.

---

## Appendix A — Platform event catalog (normative names)

Events are versioned (`.v1`), tenant-scoped, carry `communication_id`, `template_version_id`, `identity_id` (where consented), `journey_id`/`step_id` (where applicable), and a correlation ID from ingestion (NFR-008). Consumed by FR-ANL-001/002, webhooks (INT-002), and the archive ledger.

| Family | Events |
|---|---|
| Ingestion | `feed.received`, `record.accepted`, `record.quarantined`, `record.rejected`, `identity.matched`, `identity.review_required` |
| Composition | `composition.started`, `communication.composed`, `communication.gate_failed`, `batch.completed`, `batch.reconciled` |
| Delivery | `communication.dispatched`, `communication.delivered`, `communication.bounced`, `communication.blocked` (consent/DNC/suppression, with reason), `communication.deferred` (quiet hours/blackout), `failover.triggered`, `print.handoff`, `print.inducted` |
| Access & interaction | `communication.accessed` (auth level attached), `section.expanded`, `document.searched`, `faq.viewed`, `walkthrough.step`, `assistant.question`, `assistant.answered` (citations attached), `assistant.refused`, `assistant.escalated` |
| Actions | `payment.started`, `payment.completed`, `payment.failed`, `dispute.submitted`, `form.submitted`, `upload.completed`, `signature.completed`, `preference.updated`, `address.updated`, `escalation.requested` |
| Outcomes | `outcome.achieved` (outcome class + attribution basis), `outcome.window_expired`, `call.attributed` (from contact-center integration) |
| Governance | `content.published`, `template.published`, `approval.granted`, `waiver.recorded`, `ai.generation_gated`, `ai.incident_opened`, `hold.applied`, `record.disposed` |

## Appendix B — Core API surface (headless contract, FR-WLB-004)

All APIs: OAuth2 client-credentials + tenant scoping, versioned paths, idempotency keys on mutations, cursor pagination, 429 + `Retry-After` (NFR-007), OpenAPI-published.

| API | Purpose | Representative operations |
|---|---|---|
| Ingestion API | Submit data, manage feeds and mappings | `POST /v1/feeds/{feed}/records`, `POST /v1/batches`, `GET /v1/batches/{id}/reconciliation` |
| Content API | CRUD + lifecycle on content objects | `POST /v1/content-objects`, `POST /v1/content-objects/{id}/versions/{v}/approve`, `GET /v1/content-objects/{id}/impact` |
| Template API | Template lifecycle, import/export as code | `GET /v1/templates/{id}/export`, `POST /v1/templates/import`, `POST /v1/templates/{id}/publish` |
| Composition API | On-demand render, batch submit, proofs | `POST /v1/compositions` (sync/async), `POST /v1/compositions/proof`, `GET /v1/communications/{id}/renditions/{format}` |
| Delivery API | Orchestrated send, journey control | `POST /v1/deliveries`, `POST /v1/journeys/{id}/enroll`, `GET /v1/deliveries/{id}/ledger` |
| Preference API | Preferences, consent, suppression | `GET/PUT /v1/identities/{id}/preferences`, `POST /v1/consents`, `POST /v1/suppressions` |
| Viewer API | Secure link issuance, embed tokens, session events | `POST /v1/viewer/links`, `POST /v1/viewer/embed-tokens` |
| Archive API | Search, retrieve, evidence packs, holds | `POST /v1/archive/search`, `POST /v1/archive/{id}/evidence-pack`, `POST /v1/legal-holds` |
| Analytics API | Events out, aggregates, experiment results | `GET /v1/events` (stream/cursor), `GET /v1/metrics/outcomes`, `GET /v1/experiments/{id}/results` |
| Decision API (ENT) | NBA decisions with explanations | `POST /v1/decisions`, `GET /v1/decisions/{id}/explanation` |
| Admin API | Tenants, workspaces, users, quotas, AI governance | `POST /v1/workspaces`, `GET /v1/usage`, `GET /v1/ai/governance/report` |

Webhook subscriptions cover every Appendix A event family; payloads are signed (HMAC + key rotation) with replay endpoints for recovery.
