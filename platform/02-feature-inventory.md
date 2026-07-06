# Acorn Communicate — Feature Inventory

**Document type:** Feature Catalog
**Owner:** Product Management
**Status:** Approved for planning
**Related documents:** `00-product-vision.md`, `01-prd.md` (requirement IDs referenced by features), `../PRD/Acorn.Access-PRD.md`

Conventions: Pillar = CCM / CXM / IXM / AIXM (primary pillar; many features serve several). Priority = P0/P1/P2. Release = MVP / GA (fast-follow within the MVP generation) / ENT (Enterprise release). Feature IDs are stable; they map to PRD requirement IDs where noted.

---

## 1. Ingestion (ING)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| ING-001 | JSON/XML intake | Ingest JSON and XSD-validated XML communication data | CCM | P0 | MVP |
| ING-002 | CSV/Excel intake | Delimited and .xlsx ingestion with header/type inference | CCM | P0 | MVP |
| ING-003 | Fixed-width/copybook intake | COBOL copybook-driven fixed-width parsing | CCM | P0 | MVP |
| ING-004 | Parquet/Avro intake | Columnar and Avro-schema ingestion for lake-sourced data | CCM | P0 | MVP |
| ING-005 | EDI/X12 intake | X12 transaction sets incl. 834/835/837 | CCM | P0 | ENT |
| ING-006 | HL7 v2 intake | HL7 v2.x message parsing for provider data | CCM | P1 | ENT |
| ING-007 | FHIR intake | FHIR R4/R5 resource ingestion (EOB, Claim, Patient) | CCM | P0 | MVP |
| ING-008 | ACORD intake | ACORD AL3 and XML insurance formats | CCM | P1 | ENT |
| ING-009 | ISO 20022 intake | pain/pacs/camt message ingestion for banking | CCM | P0 | MVP |
| ING-010 | PDF/Word extraction | Text, table, key-value extraction from documents as data sources | AIXM | P1 | MVP |
| ING-011 | Print-stream intake | AFP/Metacode/PCL/PostScript/line-data parsing to data + layout models | CCM | P0 | ENT |
| ING-012 | REST intake API | Sync and async ingestion endpoints with idempotency keys | CCM | P0 | MVP |
| ING-013 | SFTP watch folders | Scheduled and event-driven file pickup with PGP support | CCM | P0 | MVP |
| ING-014 | Object-storage pickup | S3/Azure Blob/GCS event-driven ingestion | CCM | P0 | MVP |
| ING-015 | Event-stream consumers | Kafka/event-hub topic consumption with offset management | CCM | P1 | ENT |
| ING-016 | JDBC scheduled pull | Direct database extraction on schedule | CCM | P2 | ENT |
| ING-017 | AI schema detection | Model-inferred schema from sample files with confidence scores | AIXM | P0 | MVP |
| ING-018 | Visual mapping studio | Drag-map source fields to the canonical data model; versioned mappings | CCM | P0 | MVP |
| ING-019 | Validation rule engine | Type/range/cross-field/referential rules with per-record disposition | CCM | P0 | MVP |
| ING-020 | Quarantine & reprocess | Review UI and APIs for rejected/quarantined records | CCM | P0 | MVP |
| ING-021 | Transformation functions | Computed fields, lookups, sandboxed expressions | CCM | P0 | MVP |
| ING-022 | PII/PHI auto-classification | Pattern + model detection of sensitive fields and free text | AIXM | P0 | MVP |
| ING-023 | Field masking & tokenization | Role-based masking in UI/API/logs; tokenized downstream values | CCM | P0 | MVP |
| ING-024 | Raw-payload retention control | Configurable purge of raw inputs post-composition | CCM | P0 | MVP |
| ING-025 | Deterministic identity matching | Key-based match of records to identities | CXM | P0 | MVP |
| ING-026 | Probabilistic matching + stewardship | Fuzzy match tiers with steward review queue and survivorship | CXM | P0 | ENT |
| ING-027 | Householding engine | Address + relationship grouping for bundling and delivery | CCM | P0 | ENT |
| ING-028 | USPS REST address validation | CASS standardization + DPV via modern USPS OAuth2 APIs | CCM | P0 | MVP |
| ING-029 | NCOA move update | Change-of-address processing integration | CCM | P1 | ENT |
| ING-030 | International address validation | Pluggable global providers behind one abstraction | CCM | P1 | ENT |
| ING-031 | Address-quality signals | Deliverability outcomes feeding channel failover decisions | CXM | P1 | ENT |

## 2. CMS (CMS)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| CMS-001 | Typed content objects | Blocks, clauses, disclosures, images, charts, FAQs, tooltips, knowledge snippets | CCM | P0 | MVP |
| CMS-002 | Immutable versioning | Every save is a version; full history retained | CCM | P0 | MVP |
| CMS-003 | Side-by-side compare | Visual + text diff of any two versions | CCM | P0 | MVP |
| CMS-004 | One-click rollback | Restore any prior version as a new version | CCM | P0 | MVP |
| CMS-005 | Approval workflows | Multi-step review chains with delegation and SLA escalation | CCM | P0 | MVP |
| CMS-006 | Approval workflow designer | Arbitrary sequential/parallel approval graphs | CCM | P1 | ENT |
| CMS-007 | Effective/expiry dating | Time- and jurisdiction-bound version selection at composition | CCM | P0 | MVP |
| CMS-008 | Reuse tracking | Every reference from templates/journeys listed per object | CCM | P0 | MVP |
| CMS-009 | Impact analysis | "What breaks if I change this" report incl. transitive refs | CCM | P0 | MVP |
| CMS-010 | Bulk update & re-approval | Staged propagation of object changes across templates | CCM | P1 | ENT |
| CMS-011 | Variant management | Language/brand/jurisdiction/channel/reading-level variants | CCM | P0 | MVP |
| CMS-012 | Semantic search | Meaning-based search across all content | AIXM | P1 | MVP |
| CMS-013 | Duplicate detection | Near-duplicate identification for content consolidation | AIXM | P1 | ENT |
| CMS-014 | AI auto-tagging | Topic/product/regulation tags on save | AIXM | P0 | MVP |
| CMS-015 | Reading-level scoring | Flesch-Kincaid + model-based readability annotation | AIXM | P0 | MVP |
| CMS-016 | Brand-compliance scoring | Score against tenant brand guide with flagged deviations | AIXM | P1 | ENT |
| CMS-017 | Sentiment scoring | Tone analysis per content object | AIXM | P1 | ENT |
| CMS-018 | Regulatory-risk scoring | Risk flags with cited rationale, wireable into approval gates | AIXM | P0 | ENT |
| CMS-019 | Clause libraries | Jurisdiction-aware mandatory-content sets validated at publication | CCM | P0 | ENT |
| CMS-020 | Lifecycle enforcement | Draft/approved/published/retired states enforced at API level | CCM | P0 | MVP |
| CMS-021 | Content calendars | Upcoming effective/expiry events dashboard with alerts | CCM | P2 | GA |
| CMS-022 | Asset management | Images/fonts/logos with usage rights metadata and expiry | CCM | P1 | MVP |

## 3. Designer (TPL)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| TPL-001 | Intended-outcome declaration | Mandatory outcome + success criteria per template; blocks publication | CXM | P0 | MVP |
| TPL-002 | Drag-and-drop canvas | Grid/flow layout, sections, repeats, tables, charts, undo/redo | CCM | P0 | MVP |
| TPL-003 | Multi-user co-editing | Presence and section-level edit locking | CCM | P1 | GA |
| TPL-004 | Interactive projection | Responsive HTML5 design surface | IXM | P0 | MVP |
| TPL-005 | Print/PDF projection | Pixel-precise pagination, master pages, duplex/window awareness | CCM | P0 | MVP |
| TPL-006 | Email projection | Email-safe layout with MJML source output | CCM | P0 | MVP |
| TPL-007 | SMS/RCS projection | Short-form message design with length/segment preview | CXM | P0 | MVP |
| TPL-008 | Chat/agent script projection | Structured agent and chat scripts from shared content | CXM | P1 | ENT |
| TPL-009 | Voice-script projection | SSML-annotated voice/IVR scripts | CXM | P1 | ENT |
| TPL-010 | Video-storyboard projection | Scene lists with data-driven text/media slots | IXM | P1 | ENT |
| TPL-011 | Data binding | Type-aware bindings with locale formatting and null policies | CCM | P0 | MVP |
| TPL-012 | Conditional content rules | Data/segment/consent/jurisdiction/channel visibility logic | CCM | P0 | MVP |
| TPL-013 | Plain-language logic view | Human-readable rendering of conditional rules | CCM | P1 | MVP |
| TPL-014 | Component libraries | Shared versioned components with push updates | CCM | P0 | MVP |
| TPL-015 | Locked components | Regulated regions immutable to business users | CCM | P0 | MVP |
| TPL-016 | Multi-brand design tokens | Color/type/logo tokens; one template, many brands | CCM | P0 | MVP |
| TPL-017 | Role-split editing | Business users edit only designated regions with light approval | CCM | P0 | MVP |
| TPL-018 | Device preview | Mobile/tablet/desktop instant preview | IXM | P0 | MVP |
| TPL-019 | Dark-mode preview | Dark-scheme rendering check per channel | IXM | P0 | MVP |
| TPL-020 | Print preview | Pagination, duplex, envelope window position | CCM | P0 | MVP |
| TPL-021 | Screen-reader preview | Announcement-order simulation | IXM | P1 | ENT |
| TPL-022 | Color-vision & zoom preview | Color-blindness filters and 200% reflow check | IXM | P1 | ENT |
| TPL-023 | Translation preview | Side-by-side language variant rendering incl. RTL mirroring | CCM | P1 | ENT |
| TPL-024 | Sample-data preview | Live preview from attached sample records | CCM | P0 | MVP |
| TPL-025 | Branch-coverage indicator | Shows which conditional branches sample data exercises | CCM | P1 | MVP |
| TPL-026 | AI draft-from-prompt | Generate template drafts from NL prompt + schema | AIXM | P0 | MVP |
| TPL-027 | PDF-to-template conversion | Legacy PDF/Word to editable template with proposed bindings | AIXM | P0 | MVP |
| TPL-028 | AI readability suggestions | Inline plain-language rewrites (gated) | AIXM | P0 | MVP |
| TPL-029 | AI compliance flags in-canvas | Rule-cited compliance issues while designing | AIXM | P0 | ENT |
| TPL-030 | AI alt-text generation | Draft alt text for images/charts | AIXM | P0 | MVP |
| TPL-031 | AI translation drafts | In-designer translation into the I18N workflow | AIXM | P1 | ENT |
| TPL-032 | AI test-data generation | Synthetic edge-case records per template | AIXM | P1 | MVP |
| TPL-033 | Template lifecycle & publishing | Draft→review→approved→published→retired with immutable versions | CCM | P0 | MVP |
| TPL-034 | Regression render testing | Candidate vs. published diff over pinned record corpus | CCM | P1 | ENT |
| TPL-035 | Chart & table components | Data-driven charts and dynamic tables across projections | CCM | P0 | MVP |
| TPL-036 | Interactive-action placement | Author payment/dispute/form/signature action slots in-canvas | IXM | P0 | MVP |
| TPL-037 | Walkthrough authoring | Design guided step-through tours of a communication | IXM | P1 | MVP |

## 4. Rendering & Output (RND)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| RND-001 | Batch composition | Checkpointed multi-million-record runs | CCM | P0 | MVP |
| RND-002 | On-demand composition | Single-record API rendering, p95 ≤ 2 s | CCM | P0 | MVP |
| RND-003 | Deterministic output | Bit-identical output for identical inputs across batch/on-demand | CCM | P0 | MVP |
| RND-004 | Interactive HTML5 package | Viewer bundle output for IXM delivery | IXM | P0 | MVP |
| RND-005 | PDF output | Standard PDF rendition | CCM | P0 | MVP |
| RND-006 | PDF/A output | Archival PDF/A-1b/-2b/-3b | CCM | P0 | MVP |
| RND-007 | PDF/UA output | Tagged accessible PDF passing veraPDF/PAC | CCM | P0 | MVP |
| RND-008 | Interactive PDF | Form-fillable/actionable PDF | CCM | P1 | ENT |
| RND-009 | Word/Excel/PowerPoint output | Editable Office renditions | CCM | P1 | ENT |
| RND-010 | HTML email + MJML output | Email-safe HTML with MJML source | CCM | P0 | MVP |
| RND-011 | Plain-text output | Text renditions for SMS/fallback | CCM | P0 | MVP |
| RND-012 | XML/JSON renditions | Structured data renditions of any communication | CCM | P0 | MVP |
| RND-013 | AFP output | AFP with TLE indexing for production print | CCM | P0 | ENT |
| RND-014 | PDF/VT output | Variable-transactional print PDF | CCM | P0 | ENT |
| RND-015 | PCL/PostScript output | Legacy printer stream generation | CCM | P1 | ENT |
| RND-016 | ZPL/TIFF output | Label and image renditions | CCM | P2 | ENT |
| RND-017 | Line data & Metacode output | Legacy host print formats | CCM | P2 | ENT |
| RND-018 | Personalized video rendering | Storyboard → per-recipient MP4/stream | IXM | P1 | ENT |
| RND-019 | Audio renditions | SSML → natural TTS audio of communications | IXM | P1 | ENT |
| RND-020 | Packaging & bundling | Multi-communication packages per recipient/household | CCM | P0 | ENT |
| RND-021 | Package splitting | Oversize splitting per postal rules | CCM | P1 | ENT |
| RND-022 | Output householding | Household merge with per-member privacy rules | CCM | P0 | ENT |
| RND-023 | Inserts & onserts | Physical insert scheduling and digital onsert selection | CCM | P1 | ENT |
| RND-024 | Inserter barcodes | OMR/2D marks for inserter control | CCM | P0 | MVP |
| RND-025 | Postal presort | USPS Full-Service IMb presort and documentation | CCM | P0 | ENT |
| RND-026 | Commingling handoff | Files for downstream commingle/sortation partners | CCM | P1 | ENT |
| RND-027 | Job control | Pause/resume/cancel/checkpoint-restart of batches | CCM | P0 | MVP |
| RND-028 | Record-level error isolation | Bad records quarantine without failing runs | CCM | P0 | MVP |
| RND-029 | Batch reconciliation totals | In = rendered + quarantined + suppressed, with reasons | CCM | P0 | MVP |
| RND-030 | Reproducibility tuple stamping | Template/content/data/engine versions on every artifact | CCM | P0 | MVP |

## 5. Delivery & Orchestration (DLV)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| DLV-001 | Email delivery | Native SMTP pools + ESP integrations with warmup management | CXM | P0 | MVP |
| DLV-002 | SMS delivery | SMS via aggregator integrations | CXM | P0 | MVP |
| DLV-003 | MMS/RCS delivery | Rich mobile messaging channels | CXM | P1 | ENT |
| DLV-004 | WhatsApp delivery | WhatsApp Business template messaging | CXM | P1 | ENT |
| DLV-005 | Push notifications | Mobile push via tenant app credentials | CXM | P1 | ENT |
| DLV-006 | In-app inbox | Embedded communication inbox SDK | CXM | P0 | MVP |
| DLV-007 | Secure web links | Expiring, optionally one-time links to the viewer | IXM | P0 | MVP |
| DLV-008 | Hosted portal | Branded recipient portal with communication history | IXM | P0 | MVP |
| DLV-009 | Agent-desktop delivery | Communication + context surfaced in CRM/agent tools | CXM | P1 | ENT |
| DLV-010 | Voice/IVR handoff | Voice scripts and AI voice-agent delivery integration | CXM | P1 | ENT |
| DLV-011 | Print handoff | Production-ready files + manifests to in-house/PSP print | CCM | P0 | MVP |
| DLV-012 | Certified mail | Certified delivery with electronic return receipt | CCM | P1 | ENT |
| DLV-013 | API delivery | Tenant systems pull artifacts + metadata programmatically | CCM | P0 | MVP |
| DLV-014 | Preference center | Per-category channel preferences, paperless enrollment, embeddable widget | CXM | P0 | MVP |
| DLV-015 | Consent management | Consent records with proof; enforced at orchestration | CXM | P0 | MVP |
| DLV-016 | Do-not-contact enforcement | Hard blocks with recorded reasons, never silent drops | CXM | P0 | MVP |
| DLV-017 | Frequency caps | Per-channel and cross-channel caps per identity | CXM | P0 | MVP/ENT |
| DLV-018 | Quiet hours | Recipient-local-time send windows with deferral queues | CXM | P0 | MVP |
| DLV-019 | Journey builder | Visual trigger/step/decision/goal orchestration, versioned | CXM | P0 | MVP |
| DLV-020 | Journey experiments | A/B splits and NBA steps inside journeys | CXM | P0 | ENT |
| DLV-021 | Failover ladders | Digital-to-print and arbitrary channel escalation chains | CXM | P0 | MVP |
| DLV-022 | Bounce & retry policies | Channel-specific backoff, suppression, FBL processing | CXM | P0 | MVP |
| DLV-023 | Provider health shifting | Automatic traffic moves across channel providers | CXM | P1 | ENT |
| DLV-024 | Undeliverable escalation | Ops cases for all-channel delivery failure | CXM | P1 | MVP |
| DLV-025 | Recipient OTP auth | Email/SMS one-time-passcode access control | IXM | P0 | MVP |
| DLV-026 | Knowledge-check auth | DOB/ZIP-style challenge for low-sensitivity access | IXM | P0 | MVP |
| DLV-027 | Passkey/WebAuthn auth | Phishing-resistant recipient authentication | IXM | P1 | ENT |
| DLV-028 | Recipient SSO federation | Tenant IdP login to portal/viewer | IXM | P1 | ENT |
| DLV-029 | Step-up MFA in viewer | Re-auth before sensitive in-document actions | IXM | P0 | ENT |
| DLV-030 | Link expiry & re-request | Safe expired-link flow with fresh authentication | IXM | P0 | MVP |
| DLV-031 | Delivery reconciliation ledger | Composed→dispatched→delivered→accessed chain per communication | CXM | P0 | MVP |
| DLV-032 | Print induction tracking | IMb scan tracing into the ledger | CCM | P1 | ENT |
| DLV-033 | Cost-optimized channel choice | Cheapest compliant channel within constraint envelope | CXM | P1 | ENT |
| DLV-034 | Paperless conversion journeys | Built-in digital-adoption campaign patterns | CXM | P1 | ENT |
| DLV-035 | Send-time optimization | Per-recipient dispatch timing within quiet-hour rules | AIXM | P2 | ENT |

## 6. Interactive Experience (IXD)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| IXD-001 | Interactive viewer | Responsive HTML5 communication experience | IXM | P0 | MVP |
| IXD-002 | Personalized summary | "What this means for you" header per recipient | IXM | P0 | MVP |
| IXD-003 | Expandable sections | Progressive disclosure of detail | IXM | P0 | MVP |
| IXD-004 | Contextual tooltips | Term and line-item explanations | IXM | P0 | MVP |
| IXD-005 | Embedded FAQs | Template-scoped FAQ panel from approved content | IXM | P0 | MVP |
| IXD-006 | In-document search | Full-text search within the communication | IXM | P0 | MVP |
| IXD-007 | Guided walkthroughs | Step-through highlighting tours | IXM | P1 | MVP |
| IXD-008 | Static fallback | PDF rendition for no-JS/unsupported contexts with content parity | IXM | P0 | MVP |
| IXD-009 | Grounded AI assistant | Q&A grounded only on approved content + document + permitted context, with citations | AIXM | P0 | MVP |
| IXD-010 | Regulated-content refusal | Never-guess policy: state uncertainty and route to human | AIXM | P0 | MVP |
| IXD-011 | Assistant multilinguality | Assistant answers in recipient's language within grounding rules | AIXM | P1 | ENT |
| IXD-012 | Pay now | Full/partial payment via tokenized gateway embed | IXM | P0 | MVP |
| IXD-013 | Payment plans | Scheduled payments and plan enrollment | IXM | P1 | ENT |
| IXD-014 | Dispute initiation | Line-item disputes with reason codes and evidence upload | IXM | P0 | MVP |
| IXD-015 | Claims intake | FNOL-style embedded claim forms | IXM | P1 | ENT |
| IXD-016 | Embedded forms | Validated forms with save/resume | IXM | P0 | MVP |
| IXD-017 | Secure document upload | Typed checklists, virus scan, tenant routing | IXM | P0 | MVP |
| IXD-018 | Secure messaging | Threaded messages in communication context | IXM | P1 | ENT |
| IXD-019 | Appointment scheduling | Embedded booking with tenant scheduling systems | IXM | P1 | ENT |
| IXD-020 | Address update | Validated in-viewer address change | IXM | P0 | MVP |
| IXD-021 | Preference/paperless update | In-viewer channel and paperless changes | CXM | P0 | MVP |
| IXD-022 | ID verification step-up | Pluggable IDV before sensitive actions | IXM | P1 | ENT |
| IXD-023 | E-signature (provider) | DocuSign/Adobe-class embedded signing | IXM | P0 | MVP |
| IXD-024 | E-signature (native) | Built-in simple e-sign with intent capture and seal | IXM | P1 | ENT |
| IXD-025 | Context-carrying escalation | Chat/callback/voice handoff with full session context | IXM | P0 | MVP |
| IXD-026 | PDF download & print view | Recipient-controlled static copies | IXM | P0 | MVP |
| IXD-027 | Authorized sharing | POA/caregiver access with consent records | IXM | P1 | ENT |
| IXD-028 | Communication timeline (recipient) | Recipient-visible history of related communications and actions | IXM | P1 | GA |
| IXD-029 | Action confirmation receipts | Instant receipts written to timeline and outcome events | CXM | P0 | MVP |
| IXD-030 | Offline-tolerant viewing | Resilient loading and resume on poor connections | IXM | P2 | GA |

## 7. AI Services & Governance (AI)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| AI-001 | AI service catalog | Governed internal AI services with declared grounding and gate class | AIXM | P0 | MVP |
| AI-002 | Prompt library | Versioned, approved, tenant-scoped prompts with eval suites | AIXM | P0 | MVP |
| AI-003 | Prompt regression evals | Scored eval runs required before prompt promotion | AIXM | P0 | MVP |
| AI-004 | Model routing | Task/data-classification/cost-based routing across approved models | AIXM | P0 | ENT |
| AI-005 | BYO-model endpoints | Tenant-cloud or on-prem model deployment support | AIXM | P0 | MVP |
| AI-006 | Human review gates | Advisory/gated/autonomous-bounded classes, stricter-only tenant config | AIXM | P0 | MVP |
| AI-007 | RAG with citations | All grounded services cite versioned sources; uncited claims stripped | AIXM | P0 | MVP |
| AI-008 | Confidence scoring | Calibrated confidence on every output driving gate behavior | AIXM | P0 | MVP |
| AI-009 | Hallucination detection | Independent claim-verification pass on customer-facing generations | AIXM | P0 | MVP |
| AI-010 | No-training default | Tenant data excluded from model training absent explicit opt-in | AIXM | P0 | MVP |
| AI-011 | Prompt/response audit logs | Masked, retained logs of all AI calls | AIXM | P0 | MVP |
| AI-012 | AI compliance review | Rulebook-cited pre-approval scan of templates/content | AIXM | P0 | MVP |
| AI-013 | Regulatory library packs | Jurisdictional rule/clause packs for compliance review | AIXM | P0 | ENT |
| AI-014 | Compliance evidence generation | Auto-assembled compliance narratives with citations | AIXM | P1 | ENT |
| AI-015 | Semantic document comparison | Meaning-level diff of communications/templates | AIXM | P1 | ENT |
| AI-016 | Brand review service | Automated brand-guide conformance checks | AIXM | P1 | ENT |
| AI-017 | Sentiment & tone service | Tone scoring across content and generated drafts | AIXM | P1 | ENT |
| AI-018 | Personalization service | Guardrailed content selection/adaptation per recipient | AIXM | P1 | ENT |
| AI-019 | Journey optimization | Suggested journey improvements from outcome data (advisory) | AIXM | P2 | ENT |
| AI-020 | Delivery optimization | Channel/timing suggestions within constraints | AIXM | P2 | ENT |
| AI-021 | Analytics narration | NL summaries of dashboards with query citations | AIXM | P2 | ENT |
| AI-022 | Anomaly detection service | Statistical + model-based deviation alerts | AIXM | P1 | ENT |
| AI-023 | Synthetic data generation | Schema-aware test records with leakage safeguards | AIXM | P1 | MVP |
| AI-024 | Test-case generation | Scenario and assertion generation for templates/journeys | AIXM | P2 | ENT |
| AI-025 | Knowledge graph | Entity graph across content, templates, regulations, outcomes | AIXM | P2 | ENT |
| AI-026 | AI governance dashboard | Usage, gates, confidence, incidents, override rates, cost per tenant | AIXM | P0 | MVP |
| AI-027 | Model-risk documentation pack | SR 11-7-style exportable MRM evidence | AIXM | P1 | ENT |

## 8. Next Best Action (NBA)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| NBA-001 | Decision service | Rules-dominant policy engine over profile/behavior/consent/propensity | CXM | P0 | ENT |
| NBA-002 | Regulatory hard filters | Constraint filters evaluated before any scoring | CXM | P0 | ENT |
| NBA-003 | Action catalog | Pay/renew/dispute/upload/book/switch-channel/paperless/escalate + custom | CXM | P0 | ENT |
| NBA-004 | Composition-time decisions | Onsert/module selection at render | CCM | P0 | ENT |
| NBA-005 | In-viewer decisions | Featured action cards in the interactive experience | IXM | P0 | ENT |
| NBA-006 | Journey-step decisions | NBA-driven branching in journeys | CXM | P0 | ENT |
| NBA-007 | External decision API | NBA for agent desktop, IVR, tenant channels | CXM | P1 | ENT |
| NBA-008 | Reason-code explainability | Human-readable filter/score rationale per decision | AIXM | P0 | ENT |
| NBA-009 | Decision audit & replay | Immutable logs; point-in-time reproduction of decisions | AIXM | P0 | ENT |
| NBA-010 | Propensity model registry | Versioned tenant models with drift monitoring | AIXM | P1 | ENT |
| NBA-011 | Champion/challenger | Parallel model evaluation on live traffic | AIXM | P1 | ENT |
| NBA-012 | Uplift measurement | Holdout-based incremental outcome attribution | CXM | P1 | ENT |

## 9. Analytics (ANL)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| ANL-001 | Event fabric | First-class delivery + interaction events keyed to template/journey/identity | CXM | P0 | MVP |
| ANL-002 | Event streaming out | Webhook/Kafka/warehouse-share event export | CXM | P0 | MVP |
| ANL-003 | Delivery dashboards | Dispatch/delivery/bounce/print metrics per channel | CXM | P0 | MVP |
| ANL-004 | Engagement dashboards | Opens, dwell, scroll depth, section expansion | CXM | P0 | MVP |
| ANL-005 | Hotspot heatmaps | Visual attention maps per template | CXM | P1 | ENT |
| ANL-006 | Search & FAQ analytics | In-document query and FAQ view rankings | IXM | P0 | MVP |
| ANL-007 | Assistant analytics | Question clustering, unanswered rankings, resolution rates | AIXM | P0 | MVP |
| ANL-008 | Abandonment funnels | Form/payment start-to-complete analysis | IXM | P0 | MVP |
| ANL-009 | Journey funnels | Step conversion and drop-off per journey version | CXM | P0 | MVP |
| ANL-010 | Path & cohort analysis | Cross-channel paths and cohort comparisons | CXM | P1 | ENT |
| ANL-011 | A/B testing | Controlled experiments with significance reporting | CXM | P0 | MVP |
| ANL-012 | Multivariate testing | Multi-factor experiments with guardrails | CXM | P1 | ENT |
| ANL-013 | Outcome dashboards | Outcome attainment rate as the default view | CXM | P0 | MVP |
| ANL-014 | Call-deflection attribution | Contact-center integration tagging calls to communications | CXM | P0 | MVP |
| ANL-015 | Cost-per-outcome reporting | Delivery cost divided by outcomes achieved | CXM | P1 | ENT |
| ANL-016 | Customer timeline (operator) | Unified per-identity history for agents and audit | CXM | P0 | MVP |
| ANL-017 | Anomaly alerts | Automatic deviation detection with narrative diagnosis | AIXM | P1 | ENT |
| ANL-018 | Privacy-aware analytics | Consent-honoring tracking; k-anonymity aggregate thresholds | CXM | P0 | MVP |
| ANL-019 | Template performance diagnostics | AI-flagged underperformers with suggested revisions | AIXM | P1 | ENT |
| ANL-020 | Exec scorecards | Cross-portfolio OAR, adoption, deflection, cost rollups | CXM | P1 | GA |

## 10. Archive & Statement of Record (ARC)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| ARC-001 | WORM archive | Object-lock immutable storage with hash chaining | CCM | P0 | MVP |
| ARC-002 | Retention schedules | Category/jurisdiction rules with automatic disposition | CCM | P0 | MVP |
| ARC-003 | Certified destruction records | Auditable disposition certificates | CCM | P1 | ENT |
| ARC-004 | Legal hold | Case-scoped holds overriding disposition | CCM | P0 | MVP |
| ARC-005 | Proof of content | Hash-verified record of exactly what was sent | CCM | P0 | MVP |
| ARC-006 | Proof of delivery | Ledger + provider evidence + certified-mail receipts | CCM | P0 | MVP |
| ARC-007 | Proof of access | Authenticated view log with timestamps | IXM | P0 | MVP |
| ARC-008 | Proof of approval | Approval chain per version in the record | CCM | P0 | MVP |
| ARC-009 | Proof of AI changes | Every AI modification and its human approver | AIXM | P0 | MVP |
| ARC-010 | Version proof | Why each template/content version was selected | CCM | P0 | MVP |
| ARC-011 | Evidence pack assembly | Six-proof pack, human + machine readable, ≤ 15 min | CCM | P0 | MVP |
| ARC-012 | Reproducibility | Re-materialize any communication byte-comparably | CCM | P0 | MVP |
| ARC-013 | eDiscovery search & export | Cross-archive search with chain-of-custody manifests | CCM | P0 | MVP |
| ARC-014 | Reviewer workspaces | Access-logged eDiscovery review environments | CCM | P1 | ENT |
| ARC-015 | Recipient archive access | Self-service history in portal/viewer | IXM | P0 | MVP |
| ARC-016 | Agent & bulk archive APIs | Lookup and batch export, fully access-logged | CCM | P0 | MVP |
| ARC-017 | Legacy archive migration-in | Bulk import of PDF/AFP + index legacy archives | CCM | P1 | ENT |
| ARC-018 | Integrity verification | Rolling hash re-checks with alerting | CCM | P0 | MVP |

## 11. Accessibility (ACC)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| ACC-001 | WCAG 2.2 AA output baseline | All customer-facing renditions conformant | IXM | P0 | MVP |
| ACC-002 | PDF/UA generation | Tagged, validated accessible PDFs | CCM | P0 | MVP |
| ACC-003 | Section 508 / EN 301 549 posture | Platform and output commitments for public-sector regimes | CCM | P0 | MVP |
| ACC-004 | WCAG 2.1 AA evidence packs | Procurement-grade 2.1 evidence alongside 2.2 reports | CCM | P0 | MVP |
| ACC-005 | ACR/VPAT generation | Exportable conformance reports per template version | CCM | P1 | ENT |
| ACC-006 | Block-on-fail publication gates | Automated a11y checks blocking publish/dispatch | CCM | P0 | MVP |
| ACC-007 | Waiver workflow | Permissioned, justified waivers recorded in evidence | CCM | P0 | MVP |
| ACC-008 | AI alt-text remediation | Gated auto-generation of image/chart alt text | AIXM | P0 | MVP |
| ACC-009 | Structure auto-remediation | Heading/reading-order/table-tag/PDF tag-tree repair | AIXM | P0 | MVP/ENT |
| ACC-010 | Contrast-safe token substitution | Automatic accessible color resolution within brand tokens | AIXM | P1 | ENT |
| ACC-011 | Acorn.Access embedded widget | This repo's zero-egress accessibility layer in every interactive viewer | IXM | P0 | MVP |
| ACC-012 | Widget tenant configuration | Per-tenant Acorn.Access feature enablement | IXM | P0 | MVP |
| ACC-013 | Designer a11y previews | Screen-reader order, color-vision, zoom-reflow simulation | CCM | P1 | ENT |
| ACC-014 | Alternate formats | Large print, braille-ready (BRF) handoff, audio renditions on request | CCM | P1 | ENT |
| ACC-015 | Accessibility preferences | Recipient a11y format preferences in the preference center | CXM | P1 | ENT |
| ACC-016 | Multilingual a11y checks | Per-language-variant gates incl. lang tagging and RTL order | CCM | P0 | MVP/ENT |

## 12. Localization (I18N)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| I18N-001 | AI translation drafts | Gated machine translation into variant workflow | AIXM | P0 | MVP |
| I18N-002 | Human review workflow | Post-edit and approval per language variant | CCM | P0 | MVP |
| I18N-003 | LSP connectors | Round-trip integration with translation vendors | CCM | P1 | ENT |
| I18N-004 | Translation memory | Tenant-scoped TM reuse across jobs | CCM | P0 | ENT |
| I18N-005 | Terminology libraries | Glossaries and regulated-term enforcement | CCM | P0 | MVP |
| I18N-006 | Language coverage dashboard | Missing/stale variants vs. source version per template | CCM | P1 | MVP |
| I18N-007 | RTL rendering | Arabic/Hebrew across interactive, PDF, print, email | CCM | P0 | MVP/ENT |
| I18N-008 | CJK typography | Line breaking and font strategy for CJK scripts | CCM | P1 | ENT |
| I18N-009 | Locale formatting | Automatic dates/numbers/currency/address formats | CCM | P0 | MVP |
| I18N-010 | Language fallback chains | es-MX → es → source with mandatory-content parity blocks | CCM | P0 | MVP |
| I18N-011 | Recipient language preference | Language selection in preference center honored everywhere | CXM | P0 | MVP |

## 13. Compliance & Security (SEC)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| SEC-001 | Tenant isolation | Logical isolation with per-tenant keys | CCM | P0 | MVP |
| SEC-002 | BYOK/HYOK | Tenant-managed encryption keys | CCM | P1 | ENT |
| SEC-003 | Dedicated cells | Single-tenant deployment option | CCM | P1 | ENT |
| SEC-004 | SSO/SAML/OIDC | Operator single sign-on | CCM | P0 | MVP |
| SEC-005 | SCIM provisioning | Automated user lifecycle | CCM | P0 | MVP |
| SEC-006 | RBAC/ABAC | Workspace-scoped roles with attribute conditions (e.g., PII access) | CCM | P0 | MVP |
| SEC-007 | Admin step-up MFA | Re-auth for sensitive admin actions | CCM | P0 | MVP |
| SEC-008 | Encryption suite | TLS 1.2+, AES-256, field-level encryption, HSM keys, rotation | CCM | P0 | MVP |
| SEC-009 | Immutable audit log | Hash-chained platform audit with SIEM export | CCM | P0 | MVP |
| SEC-010 | SOC 2 Type II | Audited controls at MVP | CCM | P0 | MVP |
| SEC-011 | HIPAA/BAA readiness | PHI handling controls and BAA support | CCM | P0 | MVP |
| SEC-012 | PCI SAQ-A posture | Tokenized payments; platform never touches PAN | IXM | P0 | MVP |
| SEC-013 | HITRUST / ISO 27001 | Extended certifications | CCM | P1 | ENT |
| SEC-014 | FedRAMP path | Moderate-baseline authorization program | CCM | P1 | ENT |
| SEC-015 | DSAR operations | Locate/export/delete with retention-exempt reporting | CCM | P0 | MVP |
| SEC-016 | Data residency controls | Tenant region pinning | CCM | P0 | MVP/ENT |
| SEC-017 | Vulnerability management | Scanning, pen tests, SLA-bound remediation, SBOM, signed artifacts | CCM | P0 | MVP |

## 14. Integration (INT)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| INT-001 | OpenAPI-specified REST APIs | Every capability API-first with published specs | CCM | P0 | MVP |
| INT-002 | Webhooks | Signed event callbacks with retries and replay | CCM | P0 | MVP |
| INT-003 | Payment gateway connectors | Tokenized-embed integrations (Stripe/Adyen/ACI-class, ACH) | IXM | P0 | MVP |
| INT-004 | E-signature connectors | DocuSign/Adobe Sign-class embedded signing | IXM | P0 | MVP |
| INT-005 | CRM connectors | Salesforce/Dynamics-class context and case round-trips | CXM | P1 | ENT |
| INT-006 | Contact-center connectors | Genesys/NICE/Five9-class deflection attribution and handoff | CXM | P0 | MVP |
| INT-007 | Core-system adapters | Banking/insurance/healthcare core data adapter framework | CCM | P1 | ENT |
| INT-008 | ESP/CPaaS connectors | SendGrid/SES-class email; Twilio/Sinch-class messaging | CXM | P0 | MVP |
| INT-009 | PSP integration kit | Print manifests, inserter files, induction-scan intake | CCM | P0 | MVP |
| INT-010 | IDV provider connectors | Document/selfie/KBA verification services | IXM | P1 | ENT |
| INT-011 | Scheduling connectors | Appointment-system integrations | IXM | P1 | ENT |
| INT-012 | Warehouse shares | Snowflake/BigQuery/Databricks analytics sharing | CXM | P1 | GA |
| INT-013 | iPaaS compatibility | Certified recipes for MuleSoft/Boomi/Workato-class platforms | CCM | P2 | ENT |
| INT-014 | CDP/marketing-cloud sync | Segment/consent/event exchange with marketing stacks | CXM | P2 | ENT |

## 15. Migration (MIG)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| MIG-001 | PDF/Word-to-template conversion | AI conversion of document masters to editable templates | AIXM | P0 | MVP |
| MIG-002 | Incumbent-format converters | Quadient/Exstream/Smart/EngageOne template conversion | AIXM | P0 | ENT |
| MIG-003 | Print-stream re-engineering | Rebuild templates from AFP/Metacode/PCL where sources are lost | AIXM | P1 | ENT |
| MIG-004 | Conversion confidence reports | Per-template accuracy scoring and issue lists | AIXM | P0 | ENT |
| MIG-005 | Fix-up workspace | Human-in-the-loop correction environment for conversions | CCM | P0 | ENT |
| MIG-006 | Migration validation compare | Visual + text + semantic diff of legacy vs. Acorn output over a corpus | AIXM | P0 | ENT |
| MIG-007 | Migration sign-off workflow | Per-template approval with comparison evidence attached | CCM | P0 | ENT |
| MIG-008 | Portfolio inventory & dedup | Legacy template analysis and consolidation recommendations | AIXM | P1 | ENT |
| MIG-009 | Migration factory dashboard | Queues, throughput, per-template status at program scale | CCM | P1 | ENT |
| MIG-010 | Data-mapping migration | AI-assisted remap of legacy data feeds to the canonical model | AIXM | P1 | MVP |

## 16. White-label / OEM (WLB)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| WLB-001 | Reseller tenant hierarchy | Partner-managed sub-tenants with delegated admin and hard isolation | CCM | P0 | ENT |
| WLB-002 | Recipient-surface white-labeling | Domains, certificates, sending identities, viewer/portal branding | IXM | P0 | MVP |
| WLB-003 | Operator-UI white-labeling | Partner-branded authoring and ops consoles | CCM | P1 | ENT |
| WLB-004 | Embeddable viewer | Web-component/iframe viewer embed with postMessage API | IXM | P0 | MVP |
| WLB-005 | Embeddable preference center | Drop-in preference widget | CXM | P1 | ENT |
| WLB-006 | Embeddable payment card | Drop-in pay-now module | IXM | P1 | ENT |
| WLB-007 | Embeddable assistant | Drop-in grounded assistant component | AIXM | P1 | ENT |
| WLB-008 | Headless everything | Full capability coverage via API without Acorn UIs | CCM | P0 | MVP |
| WLB-009 | Usage metering per sub-tenant | Communications/renditions/AI-calls/storage metering | CCM | P0 | ENT |
| WLB-010 | Revenue-share reporting | Partner billing exports and revenue reports | CCM | P0 | ENT |
| WLB-011 | Partner sandbox provisioning | Self-service demo/dev sub-tenants for partners | CCM | P1 | ENT |

## 17. Operations (OPS)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| OPS-001 | Production console | Batch job monitoring, SLA countdowns, intervention controls | CCM | P0 | MVP |
| OPS-002 | Pipeline observability | OpenTelemetry traces/metrics/logs end to end, correlation IDs per record | CCM | P0 | MVP |
| OPS-003 | Tenant status page | Public per-tenant service health and incident history | CCM | P0 | MVP |
| OPS-004 | SLO dashboards | Per-tenant SLA/SLO attainment views | CCM | P0 | MVP |
| OPS-005 | Quota & rate-limit dashboard | Tenant-visible limits, usage, 429 policies, forecasts | CCM | P0 | MVP |
| OPS-006 | Zero-downtime deploys | Blue-green/rolling releases, N-1 compatible migrations | CCM | P0 | MVP |
| OPS-007 | Multi-region DR | Active-passive failover, quarterly tested, published RPO/RTO | CCM | P0 | MVP |
| OPS-008 | Active-active regions | Multi-region serving with residency pinning | CCM | P1 | ENT |
| OPS-009 | Environment management | Dev/test/staging/prod workspaces with promotion pipelines | CCM | P0 | MVP |
| OPS-010 | Configuration as code | Export/import of templates, journeys, rules for CI/CD promotion | CCM | P1 | GA |
| OPS-011 | Incident escalation cases | Delivery-failure and reconciliation-discrepancy case queues | CCM | P0 | MVP |
| OPS-012 | Capacity forecasting | Usage trend alerts at quota thresholds | CCM | P1 | GA |
| OPS-013 | Data lifecycle jobs | Purge, retention, and integrity-verification schedulers | CCM | P0 | MVP |

## 18. Developer Experience (DEV)

| ID | Feature | Description | Pillar | Priority | Release |
|---|---|---|---|---|---|
| DEV-001 | SDKs | TypeScript, Java, Python, C# client libraries | CCM | P0 | MVP |
| DEV-002 | Sandbox tenants | Free, resettable development tenants with sample data | CCM | P0 | MVP |
| DEV-003 | API reference portal | OpenAPI docs, guides, runnable examples | CCM | P0 | MVP |
| DEV-004 | Webhook testing tools | Event replay, signature verification helpers, local tunnels | CCM | P1 | MVP |
| DEV-005 | Template CLI | Lint, render, and diff templates from the command line/CI | CCM | P1 | GA |
| DEV-006 | Mock rendering service | Deterministic local render for integration tests | CCM | P2 | GA |
| DEV-007 | Event schema registry | Versioned event contracts with compatibility checks | CCM | P1 | GA |
| DEV-008 | Postman/Bruno collections | Maintained request collections per API version | CCM | P2 | MVP |
| DEV-009 | Embed starter kits | Sample apps for viewer/preference/payment embeds | IXM | P1 | GA |
| DEV-010 | API versioning & deprecation policy | Dated versions, 12-month deprecation windows | CCM | P0 | MVP |

---

**Inventory totals:** 18 domains, 364 features (P0: 236, P1: 113, P2: 15; MVP: 217, GA: 12, ENT: 135 — features marked "MVP/ENT" ship a defined MVP slice, deepen in ENT, and are counted once, under MVP).
