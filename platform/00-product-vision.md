# Acorn Communicate — Product Vision

**Document type:** Product Vision
**Owner:** Product Management
**Status:** Approved for planning
**Related documents:** `01-prd.md` (requirements), `02-feature-inventory.md` (feature catalog), `../PRD/Acorn.Access-PRD.md` (Acorn.Access accessibility widget — the accessibility layer of the interactive document viewer)

---

## 1. One-sentence definition

Acorn Communicate is an AI-native customer communication operating system that unifies communication composition (CCM), experience orchestration (CXM), interactive documents (IXM), and lifecycle-embedded AI (AIXM) on a single tenant-aware platform, governed end to end by a simple rule:

> **Compose once. Personalize intelligently. Deliver everywhere. Make every communication interactive, compliant, accessible, measurable and outcome-driven.**

---

## 2. The problem: legacy CCM is a document factory with AI parsley

Enterprises in regulated industries — banks, insurers, healthcare payers and providers, utilities, telecoms, governments, mortgage and loan servicers — run their customer communications on platforms designed twenty years ago to feed laser printers. Those platforms have been re-skinned, cloud-hosted, and sprinkled with AI features, but the architecture and the operating assumptions are unchanged. The result is a **document factory with AI parsley**: a garnish of machine learning on top of a system whose fundamental unit of work is still "produce a PDF and get it out the door."

The concrete failures:

1. **Compose many times, not once.** The same disclosure exists in the print template, the email template, the portal PDF, the agent script, and the mobile app — each maintained by a different team in a different tool. A regulatory change becomes a multi-month, multi-vendor project with no reliable proof that every copy was updated.
2. **Documents are dead ends.** A statement, an EOB, a renewal notice, a delinquency letter — each is a static artifact. The customer reads it (or doesn't), gets confused, and calls. The communication that *caused* the call cannot answer a question, take a payment, accept a dispute, or capture a signature. Every unresolved communication becomes a contact-center cost.
3. **Success is measured in output, not outcomes.** Legacy CCM dashboards count documents composed, batches completed, pieces mailed, emails sent. Nobody can answer: did the customer *understand* it, *pay* it, *renew* because of it, or *avoid a call* thanks to it? Production volume is treated as the product. It isn't. The outcome is.
4. **AI is bolted on, not built in.** Vendors ship "AI assistants" that draft copy in a side panel, disconnected from the content model, the approval workflow, the compliance record, and the delivery pipeline. There is no grounding, no citation, no audit trail of what AI touched, no governance over which model saw which data. In regulated industries this is not a feature gap — it is a deployment blocker.
5. **Accessibility and language are afterthoughts.** Remediation happens after composition, per document, often via manual services billed per page. Translation is a separate project per channel. Both should be properties of the content model, enforced at publication, with evidence generated automatically.
6. **Channel silos with rented orchestration.** Print lives in CCM, email in a marketing cloud, SMS in a CPaaS console, the portal in a digital team's backlog. Preferences, consent, frequency caps and quiet hours are enforced inconsistently — or not at all — because no single system owns the customer's communication relationship.
7. **The archive is a landfill.** Statements of record are stored as rendered blobs with no link to the template version, the data snapshot, the approval chain, or the delivery proof. When a regulator or court asks "prove exactly what this customer saw, why, and who approved it," the answer is an expensive forensic project.

Incumbents — Quadient, OpenText, Smart Communications, Messagepoint, Precisely EngageOne, Adobe AEM Forms, Doxim, Broadridge, Fiserv, CSG, MHC — each solve a slice. None owns the full loop from data ingestion through composition, orchestration, interaction, and outcome measurement, with AI as the substrate rather than the garnish. That is the category Acorn Communicate defines.

---

## 3. The category shift: from document factory to AI-native communication OS

Acorn Communicate is not a better document factory. It is a **communication operating system**: the layer through which every regulated, transactional, and servicing communication in the enterprise is composed, governed, delivered, experienced, and measured.

The defining shifts:

| Dimension | Legacy CCM | Acorn Communicate |
|---|---|---|
| Unit of work | Document / print job | **Communication** with a declared intended outcome |
| Composition | Per-channel templates, duplicated content | Compose once from governed **content objects**; render to every channel and format |
| Personalization | Merge fields | AI-driven personalization within compliance guardrails, explainable per interaction |
| Delivery | Batch to print/email | Orchestrated omnichannel with preferences, consent, failover, and cost optimization |
| The artifact | Static PDF | **Interactive communication**: summaries, embedded actions, payments, disputes, forms, e-signature, grounded AI assistant |
| AI | Side-panel copywriting | Embedded across ingestion, authoring, design, compliance, translation, accessibility, delivery, analytics — governed, cited, audited |
| Success metric | Documents produced | **Outcomes achieved**: understood, paid, renewed, disputed, signed, self-served, call avoided |
| Archive | Blob storage | Statement of record with full chain of custody: data + template version + approvals + AI changes + delivery + access proof, reproducible on demand |
| Accessibility | Post-hoc remediation service | WCAG 2.2 AA / PDF/UA enforced at the publication gate; Acorn.Access embedded in every interactive viewer |

**Why AI-native matters (and what it means here).** AI-native does not mean "AI features." It means the platform's core loops assume a model in the loop with a human gate on top: schema mapping proposed by AI and confirmed by a data analyst; template drafts generated from a prompt or a legacy PDF and refined by a designer; compliance flags raised before approval, not after mailing; the customer-facing assistant grounded **only** on approved content, the communication itself, and permitted context — and engineered to refuse to guess on regulated content and route to a human instead. Every AI action is logged, attributable, reversible, and excluded from model training by default.

---

## 4. The four pillars, unified

The industry treats CCM, CXM, IXM and AI as separate product categories. Acorn Communicate treats them as four pillars of one system sharing one content model, one data spine, one governance layer, and one analytics fabric.

### 4.1 CCM — Communication Composition & Management
The system of record for what the enterprise says. Data ingestion from any enterprise format (JSON, XML, CSV, fixed-width, Excel, Parquet, Avro, EDI/X12, HL7, FHIR, ACORD, ISO 20022, PDF, Word, legacy print streams). An enterprise CMS of reusable content objects — blocks, clauses, disclosures — with versioning, approvals, effective dating, impact analysis, and reuse tracking. A world-class drag-and-drop template designer covering responsive digital, interactive, PDF, print, email, SMS, chat, voice-script and video-storyboard design. High-volume batch and on-demand rendering to every required output, from interactive HTML5 to PDF/UA to AFP and Metacode. Output management: packaging, bundling, splitting, householding, inserts, postal optimization. Immutable archive.

### 4.2 CXM — Customer Experience Orchestration
The system of record for how and when the enterprise communicates. Journeys spanning channels and time. Preference and consent management as first-class, enforced infrastructure — not a checkbox table. Channel orchestration with failover (digital-to-print), frequency caps, quiet hours, bounce handling, escalation, and cost optimization. Engagement analytics down to the section-level hotspot. Next best action, explainable and auditable, at every interaction point.

### 4.3 IXM — Interactive Experience Management
The communication as a destination, not a dead end. Every communication can render as an interactive HTML5 experience: personalized summary, expandable sections, tooltips, contextual FAQs, in-document search, guided walkthroughs. Embedded actions close the loop where the customer already is: pay, dispute, file a claim, upload documents, sign, message securely, book an appointment, update address and preferences, verify identity, go paperless. An embedded AI assistant answers questions grounded exclusively on approved content and the communication itself — and hands off to a human rather than guess. **Acorn.Access, the platform's client-side accessibility widget (this repository), is the accessibility layer of the interactive document viewer**: user-controlled adjustments, zero data egress, embedded in every viewer by default.

### 4.4 AIXM — AI Experience Management
AI embedded across the full lifecycle, governed as a first-class subsystem: authoring and design assistance, data mapping, legacy migration, compliance review, accessibility remediation, translation, brand and sentiment scoring, readability, personalization, NBA, journey and delivery optimization, analytics narration, anomaly detection, test-case and synthetic-data generation, document comparison, knowledge graph, compliance evidence generation. Governance is the product: prompt libraries, model routing, BYO-model, RAG with citations, confidence scoring, hallucination detection, human review gates, and no training on tenant data by default.

**The unification thesis:** each pillar is commoditizing alone. The moat is the shared spine — one content object powering print, portal, assistant answers, and agent desktop; one consent record enforced across every channel; one outcome definition measured from template to journey to dashboard; one audit trail from ingested datum to archived proof.

---

## 5. Target segments

| Segment | Anchor use cases | What they buy first |
|---|---|---|
| Banks & credit unions | Statements, notices, disclosures, onboarding, collections | Interactive statements + archive + compliance evidence |
| Insurers (P&C, life, health) | Policies, renewals, claims correspondence, EOBs | Template consolidation + AI compliance review + renewals journeys |
| Healthcare (payers/providers) | EOBs, billing, care communications (HIPAA) | Interactive EOB with grounded assistant + payment + call deflection |
| Utilities | Bills, outage and usage communications | Interactive bill + payment + paperless conversion journeys |
| Telecom | Bills, plan changes, service notices | Bill explanation assistant + NBA (plan, autopay, paperless) |
| Government | Notices, benefits, tax, licensing (508 / EN 301 549) | Accessibility-first delivery + multilingual + auditability |
| Mortgage & loan servicers | Escrow analyses, ARM notices, delinquency, loss mitigation | Regulatory template packs + certified mail + proof of delivery |
| Fintechs | Statements, disclosures, lifecycle messaging | Headless API + white-label interactive documents |
| Print service providers | Outsourced production for the above | Multi-tenant production, postal optimization, reseller hierarchy |
| White-label / OEM partners | Embedding communication capabilities in their platforms | Headless APIs, embeddable widgets, revenue reporting |

---

## 6. Personas and value propositions

| Persona | Today's pain | Acorn Communicate value proposition |
|---|---|---|
| **Business user** (line-of-business owner of a communication) | Every change is an IT ticket; weeks of lead time; no visibility into results | Self-service edits to governed content with AI drafting, guardrailed approvals, and an outcome dashboard for every communication they own |
| **Template designer** | Five tools for five channels; brittle legacy composition tools; manual accessibility fixes | One designer for every channel and format; AI converts legacy PDFs to templates; accessibility, readability and compliance checked while designing, not after |
| **Developer** | Closed platforms, batch-file integration, screen-scraping the archive | API-first and headless everything: ingestion, rendering, delivery, events, embeds; webhooks and OpenTelemetry; SDKs and sandbox tenants |
| **Compliance officer** | Cannot prove what was sent, why, or who approved it; AI is an ungovernable black box | Every clause versioned, effective-dated, approved, and traced to every communication that used it; AI actions logged with citations and human gates; evidence packs generated on demand |
| **Operations** (production, contact center ops) | Batch failures at 2 a.m.; no reconciliation; call volume driven by confusing documents | Observable pipelines with SLAs, automatic failover and retry, delivery reconciliation, and measurable call deflection per communication |
| **Executive** | Communication cost is visible; communication value is not | One dashboard: outcomes per communication, cost per outcome, digital adoption, call deflection, revenue influenced (payments, renewals) |
| **End customer** | Confusing documents, dead-end PDFs, hold music | Communications that explain themselves, answer questions honestly, take action in place, respect preferences and language, and are accessible by default |

---

## 7. The outcome-based product philosophy

### Every template declares an intended outcome

This is the platform's central design commitment, enforced in the product, not the marketing:

- **Declared at design time.** Every template carries a mandatory `intended_outcome` from a governed taxonomy — `understood`, `paid`, `renewed`, `disputed`, `signed`, `self_served`, `call_avoided`, `converted`, `informed_no_action` — plus measurable success criteria (e.g., "payment completed within 7 days of first open," "zero inbound calls tagged to this communication within 14 days"). A template cannot be published without one.
- **Measured in journeys.** Journey analytics attribute outcome events (payment, dispute filed, signature completed, assistant self-serve resolution, call within N days) back to the communication and template version that drove them.
- **Shown on dashboards.** The default unit on every dashboard is outcome attainment rate per communication — not volume produced. Volume, cost and SLA remain visible as operational metrics, subordinate to outcomes.
- **Fed back into the system.** Underperforming templates are flagged with AI-generated diagnostics (readability, hotspot abandonment, top assistant questions, FAQ misses) and suggested revisions routed through normal approval. NBA and journey optimization consume outcome data as their objective function.

**Success = outcomes achieved, not documents produced.** A tenant that sends fewer communications and achieves more outcomes is a healthier tenant, and the platform's metrics, pricing philosophy, and roadmap prioritization all reflect that.

### Corollary commitments

1. **Compliant by construction.** Approval, effective dating, accessibility, and archival are pipeline gates, not optional steps. Non-conformant communications do not ship.
2. **Grounded AI or no AI.** The customer-facing assistant answers only from approved content, the communication, and permitted context — with citations. On regulated content where confidence is insufficient, it says so and routes to a human. Never guess.
3. **Accessible by default.** WCAG 2.2 AA and PDF/UA are publication gates with auto-remediation and block-on-fail. Acorn.Access ships in every interactive viewer.
4. **Everything reproducible.** Any archived communication can be re-materialized: data snapshot + template version + content object versions + rendering engine version → the exact artifact, with the full chain of custody.

---

## 8. North-star metrics

**North star: Outcome Attainment Rate (OAR)** — the percentage of delivered communications that achieve their declared intended outcome within the template-defined window, aggregated per tenant and platform-wide.

Supporting metric tree:

| Metric | Definition | Why it matters |
|---|---|---|
| Outcome Attainment Rate | Outcomes achieved ÷ communications delivered (per intended-outcome class) | The product's reason to exist |
| Call deflection rate | Contact-center contacts avoided per 1,000 interactive communications vs. static baseline | The clearest ROI in regulated servicing |
| Interaction rate | % of delivered communications opened as interactive experiences (vs. static fallback) | IXM adoption; leading indicator of OAR |
| Assistant self-serve resolution | % of assistant sessions resolved without human handoff, with zero hallucination incidents | AI value with a hard safety constraint |
| Time-to-communication | Business-user request → approved, published template change | The self-service promise, quantified |
| Digital adoption / paperless conversion | % of volume shifted from print to digital per tenant | Cost and sustainability outcome for buyers |
| Cost per outcome | Fully loaded delivery cost ÷ outcomes achieved | The executive's number |
| Compliance evidence SLA | Time to produce a complete evidence pack for any communication | The compliance officer's number; target: minutes, not weeks |
| Migration velocity | Legacy templates converted and approved per month via AI migration | The land-and-expand engine against incumbents |

Guardrail metrics (must not degrade while north star climbs): rendering SLA attainment, delivery success rate, accessibility gate pass rate, assistant hallucination incident count (target: zero), consent violation count (target: zero).

---

## 9. Three-year ambition

**Year 1 — Prove the loop (MVP → first regulated production tenants).**
Ship the MVP defined in `01-prd.md`: ingestion for core formats, CMS with approvals, designer for interactive/PDF/email/print, rendering pipeline, delivery via email/SMS/secure links/print handoff, interactive viewer with grounded assistant and payments, outcome declaration and measurement, archive with chain of custody, accessibility gates with Acorn.Access embedded. Land 8–12 production tenants across banking, insurance, healthcare and utilities; at least 3 replacing an incumbent CCM. Prove: ≥20% call deflection on interactive vs. static for at least two tenants; evidence pack in under 15 minutes; zero hallucination incidents on regulated content.

**Year 2 — Win the migration war (Enterprise release).**
The wedge against incumbents is migration cost. Ship the AI migration factory (print-stream and legacy-template conversion at scale), full output-format matrix (AFP/PCL/Metacode/PDF/VT), PSP multi-tenancy and postal optimization, NBA engine, journey orchestration at depth, white-label/OEM program, multi-region residency, FedRAMP-path and HITRUST posture. Target: 50+ tenants, 2+ OEM partners embedding the platform, migration velocity of 500+ legacy templates/month across the installed base, recognized by analysts as the defining vendor of the "AI-native CCM/CXM convergence" category.

**Year 3 — Become the communication OS.**
The platform is where regulated enterprises *operate* their customer communication function: outcome benchmarks across anonymized industry cohorts (opt-in), an ecosystem of certified integrations and content packs (regulatory clause libraries per jurisdiction), voice and video as first-class interactive channels, closed-loop optimization where journeys tune themselves within human-approved guardrails. Target: 150+ tenants, >1B communications/year, OAR as an industry-standard KPI that competitors are forced to report against — on a playing field we defined.

---

## 10. What we will not do

- We will not build a marketing automation suite. We orchestrate regulated, transactional and servicing communications; we integrate with marketing clouds rather than replace them.
- We will not ship ungoverned AI. No customer-facing generation without grounding, citation, confidence scoring, and human gates on regulated content.
- We will not train foundation models on tenant data by default, ever, in any tier.
- We will not treat print as legacy. Print is a first-class orchestrated channel with failover to and from digital — many of our buyers' most regulated communications are paper by law.
- We will not measure ourselves by documents produced.
