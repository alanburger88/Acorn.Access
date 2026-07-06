# Acorn.Signal — Engineering Product Requirements Document

**Document type:** Technical PRD
**Delivery model:** Core platform first (v1), channel connectors and jurisdiction packs as follow-on releases
**Primary constraint:** Every regulated customer communication must yield a tamper-evident, independently verifiable Outcome Packet that both humans and approved AI agents can consume and act on

## 1. Purpose

Acorn.Signal is Agent-Ready Customer Communication Infrastructure. Regulated businesses (financial services, insurance, utilities, telecoms, health) exchange millions of customer communications — complaints, disputes, cancellations, consent changes, data subject requests, hardship notices, fraud reports, disclosures — and must be able to prove, sometimes years later, what was received, how it was classified, what obligations it triggered, and how it was resolved.

Today that proof is scattered across mailboxes, CRMs, ticketing systems, and call recordings. It is neither machine-actionable nor tamper-evident. As AI agents begin to handle customer operations, the gap widens: agents act on communications, but nothing durable proves what they saw or what they did.

Acorn.Signal closes that gap by turning every regulated customer communication into a **trusted Outcome Packet**: a signed, hash-chained, replayable record that binds the communication, its regulatory classification, the obligations it created, the outcome, and the full provenance of how each conclusion was reached.

## 2. Product Definition

Acorn.Signal is a platform service that:

- ingests customer communications from any channel (email, SMS, chat, voice transcript, letter, portal) through a normalizing adapter layer,
- runs each communication through a deterministic, versioned pipeline: normalize → classify → derive obligations → determine outcome,
- seals the result as an **Outcome Packet**: a canonically serialized (RFC 8785), SHA-256-hashed, Ed25519-signed payload appended to a per-tenant hash chain,
- treats packets as immutable — outcome changes append **amendment packets** that reference what they supersede, so the full history stays on the chain,
- mediates all access through scoped grants for registered actors — human operators, service integrations, and **approved AI agents** with per-category confinement and mandatory human ownership,
- supports independent verification: any holder of a packet, its predecessor, and the tenant's public key can re-derive every hash and signature without access to Acorn.Signal.

## 3. The Outcome Packet

The Outcome Packet is the product. Everything else exists to produce, protect, and serve it.

```
OutcomePacket
├── payload                        (signed region)
│   ├── schema                     "acorn.signal/outcome-packet@1"
│   ├── id / tenantId / createdAt
│   ├── amends?                    id of the packet this one supersedes
│   ├── communication              normalized record + SHA-256 of raw content
│   ├── classification             category, regulated domains, deciding rules
│   ├── obligations[]              type, description, regulatory deadline, source rule
│   ├── outcome                    status, summary, actions[], determinedBy, determinedAt
│   └── provenance                 pipeline version + per-stage input/output hashes
└── integrity
    ├── canonicalization           "JCS" (RFC 8785)
    ├── payloadHash                SHA-256 of canonical payload
    ├── sequence                   position in the tenant chain (0-based)
    ├── previousPacketHash         payloadHash of the predecessor (null at genesis)
    └── signature                  Ed25519 over {payloadHash, sequence, previousPacketHash}
```

Design rules:

1. **The payload is the unit of truth.** Nothing outside `payload` is signed content; everything inside it is.
2. **Determinism before hashing.** All hashes and signatures are computed over RFC 8785 canonical JSON so independent implementations produce identical bytes.
3. **Append-only.** There is no update or delete anywhere in the storage contract. Corrections are amendment packets (`payload.amends`), and reads by the original id resolve to the latest amendment.
4. **Provenance is mandatory.** Each pipeline stage records its version and the hashes of its input and output. A packet is not just a conclusion; it is a replayable trace of how the conclusion was reached.
5. **Attribution is explicit.** Every outcome and completed action names its actor as `pipeline:<version>`, `human:<id>`, or `agent:<id>`.

## 4. Goals

1. **Provable outcomes.** Any packet can be verified — payload hash, signature, chain link — by an external auditor holding only the public key.
2. **Tamper evidence, not tamper prevention.** Editing any historical packet breaks its own signature or the chain link asserted by every later packet, and a chain audit reports exactly where.
3. **Agent-ready by construction.** Approved AI agents are first-class principals with scoped tokens, per-category confinement, PII redaction by default, and a mandatory accountable human owner.
4. **Deterministic v1 pipeline.** Classification and obligation derivation are rule-based and reproducible. Model-backed classifiers plug in behind the same interface and must declare themselves in packet provenance.
5. **Channel neutrality.** One normalized communication model across email, SMS, chat, voice transcripts, letters, and portal messages.
6. **Tenant isolation.** Chains, packets, actors, and tokens are tenant-scoped; a token for one tenant is inert in another.
7. **Zero runtime dependencies for the core.** The v1 engine uses only the Node.js standard library (`node:crypto`, `node:http`).

## 5. Non-Goals (v1)

1. Acorn.Signal does **not** send or deliver communications; it records and proves them.
2. It does **not** replace case-management or CRM systems; it is the evidentiary layer beneath them.
3. It does **not** ship jurisdiction-specific regulatory clocks as legal advice; v1 provides one conservative default set, overridable per tenant in later versions.
4. It does **not** perform speech-to-text, OCR, or translation; channel connectors deliver extracted text.
5. It does **not** include model-based classification in the default build; the `Classifier` interface exists for it, but v1 ships the deterministic rule classifier.
6. It does **not** implement key rotation ceremonies or HSM integration in v1 (interfaces accept externally supplied keys).

## 6. Architecture

```
channels ─▶ Ingest (normalize, validate, hash raw content)
                 │
                 ▼
          Pipeline (versioned stages, hashed in/out)
            normalize → classify → obligations → outcome
                 │
                 ▼
          Ledger (per-tenant hash chain, Ed25519 seal)
                 │
        ┌────────┴─────────┐
        ▼                  ▼
   Access layer        Verification
   (scopes, grants,    (stateless verifier,
    redaction,          chain audit)
    category walls)
        │
        ▼
   HTTP API  ←  humans, services, approved AI agents
```

### 6.1 Module map (v1 implementation, `signal/`)

| Module | Responsibility |
| --- | --- |
| `canonical/jcs.ts` | RFC 8785 canonical JSON serialization |
| `crypto/hash.ts`, `crypto/signer.ts` | SHA-256 over canonical form; Ed25519 keygen/sign/verify; key fingerprints |
| `ingest/normalize.ts` | Channel-neutral validation and normalization; raw-content hashing |
| `pipeline/classify.ts` | `Classifier` interface + deterministic `RuleClassifier` (8 regulated categories) |
| `pipeline/obligations.ts` | Category → obligations with regulatory-clock deadlines |
| `pipeline/outcome.ts` | Initial outcome determination (acknowledged / action_required / escalated) |
| `pipeline/pipeline.ts` | Stage orchestration with per-stage provenance hashes |
| `ledger/store.ts` | Append-only `PacketStore` contract + in-memory implementation |
| `ledger/ledger.ts` | Chain sealing, amendment resolution, stateless `verifyPacket`, chain audit |
| `agents/grants.ts` | Actor registry, scopes, HMAC token issuance/verification, revocation |
| `agents/access.ts` | Scope/tenant/category enforcement, PII-redacted packet views |
| `service.ts` | `SignalService`: ingest → seal, reads, verification, outcome amendments |
| `api/server.ts` | Dependency-free HTTP API |

### 6.2 Scopes

| Scope | Grants |
| --- | --- |
| `communications:ingest` | Submit communications for packet production |
| `packets:read` | Read packet payloads (PII redacted unless `pii:read`) |
| `packets:verify` | Run packet verification and chain audits |
| `outcomes:act` | Complete outcome actions (appends amendment packets) |
| `pii:read` | See party names and addresses |
| `agents:admin` | Register actors and issue tokens (never grantable to AI agents) |

AI-agent constraints enforced by the registry: a mandatory accountable `ownerId`, no `agents:admin`, optional `allowedCategories` confinement (an agent approved for complaints cannot read or act on cancellations), and immediate revocation — token verification re-checks live registration, so revoking an agent kills all outstanding tokens.

### 6.3 Regulated categories and default obligations

v1 recognizes: `complaint`, `billing_dispute`, `consent_change`, `cancellation`, `data_subject_request`, `hardship`, `fraud_report`, `disclosure`, plus `general`. When multiple rules match, priority encodes regulatory severity (fraud > DSR > complaint > hardship > billing > cancellation > consent > disclosure).

Each category carries conservative default obligations with deadlines computed from the communication's `occurredAt` (e.g. complaint: acknowledge in 3 days, final response in 30; fraud: escalate in 1 day; DSR: fulfil in 30). These defaults become tenant/jurisdiction configuration in a later release; the packet always records which rule sourced each obligation.

## 7. Security Requirements

1. Ed25519 signatures over canonical bytes; SHA-256 payload hashes; key id = SHA-256 fingerprint of the SPKI DER public key.
2. Access tokens are HMAC-SHA256-signed claims with expiry; signature comparison and admin-key comparison use constant-time equality.
3. Redaction happens at the view layer only and the response is flagged `redacted: true`, so consumers know a redacted view will not byte-verify against the integrity block; the stored packet is untouched.
4. The API never leaks stack traces; errors map to 400/401/403/404 with typed causes.
5. Request bodies are size-capped (default 2 MiB); communication content is capped at 1 MiB of text.

## 8. Verification Requirements

1. `verifyPacket(packet, publicKeyPem, predecessor)` must be pure and stateless — usable by an external auditor from an exported JSON packet.
2. Verification must independently check: payload hash recomputation, signature over `{payloadHash, sequence, previousPacketHash}`, and the chain link to the predecessor (null only at sequence 0).
3. A chain audit walks the full tenant ledger and reports every broken packet id; tampering with packet *n* must surface in packet *n*'s own checks **and** packet *n+1*'s chain link.

## 9. API Surface (v1)

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/health` | none | Liveness + pipeline version |
| `POST /v1/agents` | admin key | Register actor |
| `POST /v1/agents/{id}/tokens` | admin key | Issue scoped token |
| `POST /v1/communications` | `communications:ingest` | Ingest; returns sealed packet |
| `GET /v1/tenants/{t}/packets/{id}` | `packets:read` | Latest packet version (redacted per scope) |
| `GET /v1/tenants/{t}/packets/{id}/verify` | `packets:verify` | Single-packet verification |
| `GET /v1/tenants/{t}/audit` | `packets:verify` | Full chain audit |
| `POST /v1/tenants/{t}/packets/{id}/actions/{i}/complete` | `outcomes:act` | Complete an action (amendment packet) |

## 10. Scale Path

v1 ships an in-memory store behind the `PacketStore` contract. The contract is deliberately minimal (append / get / list / head, per-tenant ordering) so production deployments swap in a durable append-only backend (Postgres, DynamoDB, object-store segments) without touching sealing or verification logic. Chain state per tenant is one head pointer, so sealing is O(1) per packet; tenants shard naturally because chains never cross tenants.

## 11. Acceptance Criteria

1. Ingesting a communication yields a packet whose category, obligations, deadlines, and initial outcome match the deterministic rules, with four provenance stages carrying 64-hex-char input/output hashes.
2. Identical input produces an identical payload (pipeline determinism).
3. Payload edits, re-hashed forgeries, and historical rewrites are all detected, the latter by downstream chain links.
4. An exported packet verifies with only the public key and its predecessor.
5. Completing all actions on a packet appends amendment packets, resolves the outcome, attributes each completion to `human:<id>` or `agent:<id>`, and leaves the full chain valid.
6. An AI agent without `pii:read` receives `[redacted]` party names/addresses and a `redacted: true` flag; category-confined agents are denied outside their categories; cross-tenant tokens are denied; revocation invalidates live tokens.
7. The full suite (`npm test` in `signal/`) passes; the package typechecks under `strict`.

## 12. Delivery Status

All of sections 3–9 are implemented in `signal/` and covered by 49 tests across canonicalization, crypto, ledger/tamper-evidence, pipeline, access control, and HTTP end-to-end flows. Section 10's durable store and section 5's follow-ons (connectors, jurisdiction packs, model-backed classification, key rotation) are the roadmap.
