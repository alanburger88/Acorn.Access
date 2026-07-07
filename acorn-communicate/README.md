# Acorn Communicate — working platform implementation

A working, tested implementation of the platform designed in [`../platform/`](../platform/README.md):
an AI-native customer communication platform unifying **CCM** (compose, manage, render, archive),
**CXM** (delivery orchestration, preferences, analytics, next best action), **IXM** (interactive
documents with embedded actions and a grounded assistant), and **AIXM** (governed AI across the
lifecycle) — implemented as a modular monolith with the bounded contexts from
`platform/04-architecture.md`, ready to be split into services.

## Quick start

```bash
npm install
npm run seed     # creates the First Acorn Bank demo tenant, prints API key + viewer URLs
npm start        # http://localhost:4000
```

Then:

- **Operator console** — `http://localhost:4000/console` (paste the API key printed by the seed)
- **Interactive documents** — open the two `…/view/<token>` URLs printed by the seed:
  a live statement with expandable sections, in-document explanations, an embedded grounded
  assistant, pay/dispute/update/contact actions, PDF download, and the Acorn.Access
  accessibility widget.
- **Outbox** — simulated email (`.eml`) and SMS (`.json`) providers write to `data/outbox/`.

```bash
npm test         # 60+ unit + integration tests, plus the full-lifecycle e2e suite
npm run build    # strict typecheck
```

## What's implemented

| Bounded context | Capabilities |
|---|---|
| `kernel` | Prefixed ULIDs, CloudEvents bus, **hash-chained tamper-evident event log**, atomic file collections, content-addressed object store, API-key auth (roles + RBAC), problem+json errors |
| `tenants` | Tenant bootstrap, API keys (sha256-hashed secrets), brands, customers, **consent records (explicit-deny)**, channel preferences |
| `content` | Content objects + immutable versions, approval workflow with **segregation of duties** (author ≠ approver), reading-level/sentiment scoring, search |
| `templates` | Template versions with data contracts, block AST (sections, conditions, tables, content-refs, actions), **accessibility gate that blocks publication**, data validation |
| `composition` | Compose once → `ComposedDocument`; data snapshots (hashed), pinned content versions, condition evaluation, interpolation, intended-outcome tracking |
| `rendering` | Interactive HTML, **PDF (pdfkit)**, email HTML (subject convention + `{{link}}`), SMS, plain text; render preview API |
| `delivery` | Channel plan from preferences, **consent enforcement, retries, bounce failover** (email→SMS→…), secure links (expiring, optional OTP), simulated providers, provider callbacks |
| `viewer` | Public token-authenticated viewer shell: section instrumentation, action dialogs (pay/dispute/update/contact), **embedded grounded assistant**, PDF download, Acorn.Access widget |
| `ai` | Model gateway: deterministic grounded retrieval provider + optional Anthropic provider (`ANTHROPIC_API_KEY`), **PII redaction pre-inference, escalation on low confidence, full invocation audit** |
| `nba` | Explainable rule-based next-best-action engine (pay-due, view-nudge, paperless, dispute follow-up, bounce → update details) |
| `analytics` | Overview metrics, journey funnels, section hotspots, communication + customer timelines, **audit chain verification endpoint** |
| `archive` | Auto-archived statement of record with reproduction manifest, legal hold, **regulator evidence packs** (proof of delivery/access/content/version/AI/actions), reproducibility verification |
| `ingestion` | JSON/CSV batch ingestion (quoted CSV, dot-path columns), customer matching, per-record errors, **PII/PHI scanning (email/phone/SSN/Luhn-checked PANs)** |
| `webhooks` | Subscriptions with pattern filters, **HMAC-signed deliveries**, retries, delivery log, replay |
| `journeys` | State-machine journey orchestration (send → wait-for-outcome → remind → end), **event-driven advancement** + deadline scheduler, instance history |
| `print` | Print batch spooling with **householding, postal presort, IMB codes, suppression**, spool manifests, mail piece events, return-mail → NBA, reconciliation |
| `api/graphql` | Read-only **GraphQL endpoint** (`POST /graphql`) for composite reads (communication + timeline + recommendations + deliveries), depth/size guards |
| `api/openapi` | **OpenAPI 3.1 spec** at `/v1/openapi.json` covering the full REST surface |
| `mcp` | **MCP stdio server** (`npm run mcp`) exposing allow-listed, role-checked, audited tools (explain_communication, evidence packs, drafts requiring human approval — no delivery initiation) |
| `translations` | Multilingual content: machine-translated locale drafts with **human approval (SoD)**, translation memory, locale-aware resolution at composition (exact → language prefix → source fallback) |
| `experiments` | A/B testing: weighted variants with **deterministic customer assignment**, accessibility-gated variants, per-variant outcome results, conclude-with-winner |
| `usage` | FinOps: event-driven usage metering with reference unit rates and estimated cost, per-key **API rate limiting** (429 + RateLimit headers), console Usage tab |
| `designer` | **Visual template designer** at `/designer`: drag-and-drop block canvas, property forms, data-contract editor, AI assist (drafts only — human applies), accessibility check, live preview, publish with gate errors surfaced |

## API

All `/v1` endpoints use `Authorization: Bearer <api-key>`; errors are RFC 9457 problem+json.
Key flows:

```bash
# Bootstrap a tenant
curl -sX POST :4000/v1/tenants -H 'content-type: application/json' -d '{"name":"Acme"}'

# Compose → deliver → track
curl -sX POST :4000/v1/communications      -H "$AUTH" -d '{"templateId":"...","customerId":"...","data":{...}}'
curl -sX POST :4000/v1/communications/$ID/deliver -H "$AUTH" -d '{}'
curl -s     :4000/v1/communications/$ID/timeline  -H "$AUTH"
curl -s     :4000/v1/archive/$ID/evidence-pack    -H "$AUTH"
```

The public viewer (`/view/:token`, `/api/view/:token/*`) is authenticated by the secure-link
token, not API keys.

## Deployment

- `Dockerfile` + `docker-compose.yml` — single-node reference deployment (volume-backed).
- `helm/acorn-communicate` — Kubernetes chart (PVC, probes, optional ingress + Anthropic secret).
- Storage is a file-backed reference implementation behind the same interfaces the architecture
  doc maps to Postgres/object storage/search — swap `kernel/storage.ts` implementations without
  touching domains.

## Design lineage

Every mechanism traces to the design suite: chain of custody & proofs → `platform/06`,
event taxonomy → `platform/04`, data model → `platform/05`, assistant hard rules → `platform/06`
(AIG controls), accessibility gates → `platform/06` Part 4, runbook semantics for delivery
retries/failover → `platform/11` RB-02.
