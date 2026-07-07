# Acorn OS — AI-Native Customer Communication Platform

**Design & Build Documentation Suite**

Acorn OS is an AI-native customer communication operating system that unifies
**CCM** (customer communication management), **CXM** (customer experience management),
**IXM** (interactive experience management), and **AIXM** (AI experience management)
into a single platform.

> **Compose once. Personalize intelligently. Deliver everywhere.
> Make every communication interactive, compliant, accessible, measurable and outcome-driven.**

It is not a document factory with AI sprinkled on top. Every customer communication —
statement, bill, policy, claim, notice, contract, welcome pack, disclosure — becomes a
secure, intelligent, accessible, interactive, compliant and measurable experience, with a
complete chain of custody from data ingestion to archive.

The existing **Acorn.Access** widget in this repository (client-side accessibility layer:
contrast, text scaling, dyslexia fonts, read-aloud, reading mask, keyboard support) is a
core ingredient: it ships inside the platform's interactive document viewer as the
end-customer accessibility layer.

## Document suite

| # | Document | Covers (Section 25 deliverables) |
|---|----------|----------------------------------|
| 00 | [Product Vision](./00-product-vision.md) | Complete product vision, personas, outcome-based product philosophy, north-star metrics |
| 01 | [PRD](./01-prd.md) | Detailed PRD, acceptance criteria, MVP definition, enterprise release definition |
| 02 | [Feature Inventory](./02-feature-inventory.md) | Full feature inventory across all domains and pillars |
| 03 | [Competitor Matrix](./03-competitor-matrix.md) | Competitor parity and differentiation matrix (Quadient, OpenText, Smart Communications, Messagepoint, Precisely, Adobe, Doxim, Broadridge, Fiserv, CSG, MHC) |
| 04 | [Target Architecture](./04-architecture.md) | Target architecture, tenant model, delivery model, channel orchestration model, event taxonomy, deployment topologies |
| 05 | [Data Models](./05-data-models.md) | Logical data model, content model, template model, communication lifecycle (event-sourced), analytics model, archive model |
| 06 | [Security, Compliance, AI Governance & Accessibility](./06-security-compliance-governance.md) | Security model, compliance model, AI governance model, accessibility model |
| 07 | [API & Integration Strategy](./07-api-integration-strategy.md) | Public API strategy, GraphQL schema strategy, MCP strategy, webhook and event strategy, developer experience |
| 08 | [UI/UX Blueprint](./08-ux-blueprint.md) | UI/UX blueprint, design system, component library plan |
| 09 | [Migration Strategy](./09-migration-strategy.md) | Migration & modernization strategy (Migration Studio), parallel-run verification |
| 10 | [Roadmap & Cost Model](./10-roadmap-cost-model.md) | Phased roadmap, cost model, unit economics, FinOps |
| 11 | [Test Strategy & Operations](./11-test-and-operations.md) | Test strategy, performance benchmarks, operational runbooks, developer documentation outline |
| 12 | [Capability Coverage Matrix](./12-capability-coverage.md) | PRD requirement → implementation status across every domain; output-format and channel coverage; simulated-vs-production seams |

## Working implementation

A tested, runnable implementation of this design lives in [`../acorn-os/`](../acorn-os/README.md) — a modular monolith across the bounded contexts in doc 04, with three operator web apps, the interactive customer viewer, REST/GraphQL/MCP/webhook surfaces, and swappable storage. See doc 12 for exactly what is implemented, simulated, or designed-only.

## The four pillars

| Pillar | What it means in Acorn OS |
|--------|-------------------------------------|
| **CCM** | Composition, template management, content management, approvals, batch + on-demand production, output management (interactive HTML5, PDF/A/UA/VT, AFP, PCL, PostScript, email, and more), delivery tracking, archive & retrieval |
| **CXM** | Personalized journeys, channel preference and consent management, omnichannel orchestration with failover, engagement analytics, next best action, outcome tracking |
| **IXM** | Interactive documents as the center of the experience: embedded payments, disputes, claims, forms, e-signature, uploads, scheduling, secure messaging, guided walkthroughs, and an embedded grounded AI assistant |
| **AIXM** | AI across the full lifecycle — authoring, design, data mapping, migration, compliance review, accessibility remediation, translation, personalization, analytics narration, optimization — with prompt governance, model routing, citations, human review gates, and complete audit trails |

## Non-negotiables

- **Accessible by design** — WCAG 2.2 AA baseline, PDF/UA, block-on-fail publication gates.
- **Compliant by design** — chain of custody for every communication; proof of delivery, access, content, approval, version, AI changes, and customer action.
- **AI with receipts** — every AI action is grounded, cited, governed, and audited; no tenant data used for model training by default; the customer-facing assistant never guesses on regulated content.
- **Any-premise** — SaaS, public cloud, private cloud, hybrid, or customer-VPC.
- **Integrate with anything** — REST (OpenAPI), GraphQL, MCP (server and client), webhooks, AsyncAPI/CloudEvents, Kafka, SFTP, CDC, and a deep connector catalog.
- **Outcomes, not documents** — every template declares an intended outcome; every journey and dashboard measures it.
