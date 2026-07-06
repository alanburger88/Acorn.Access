# Acorn.Signal

Agent-Ready Customer Communication Infrastructure. Acorn.Signal turns every regulated customer communication — complaints, disputes, cancellations, consent changes, data subject requests, hardship notices, fraud reports, disclosures — into a trusted **Outcome Packet**: a signed, hash-chained, independently verifiable record of what was received, how it was classified, what obligations it created, and how it was resolved, by whom.

Full requirements and architecture: [`PRD/Acorn.Signal-PRD.md`](../PRD/Acorn.Signal-PRD.md).

## Quick start

```bash
cd signal
npm install
npm test          # 49 tests: canonicalization, crypto, ledger, pipeline, access, HTTP e2e
npm run build     # emits dist/
```

Run the API:

```bash
ACORN_SIGNAL_ADMIN_KEY=dev-admin npm start   # listens on :8787
```

## Embedding the service

```ts
import { SignalService, generateSignerKeys } from 'acorn-signal';

const service = new SignalService({ keys: generateSignerKeys() });

const packet = await service.ingest({
  tenantId: 'acme-bank',
  channel: 'email',
  direction: 'inbound',
  parties: [
    { id: 'cust-42', role: 'customer', name: 'Jamie Doe', address: 'jamie@example.com' },
    { id: 'acme', role: 'institution' },
  ],
  subject: 'Formal complaint',
  content: 'I wish to complain about the advice I was given…',
  metadata: {},
});

packet.payload.classification.category;   // 'complaint'
packet.payload.obligations;               // acknowledge in 3d, final response in 30d
packet.payload.outcome.status;            // 'action_required'
packet.integrity.signature.alg;           // 'Ed25519'
```

## The trust model in one paragraph

Every packet payload is canonicalized with RFC 8785 (JCS), hashed with SHA-256, and the triple `{payloadHash, sequence, previousPacketHash}` is Ed25519-signed onto a per-tenant append-only chain. Packets are never updated: outcome changes append **amendment packets** (`payload.amends`) and reads by the original id resolve to the latest amendment. Editing any historical packet breaks its own signature or the chain link asserted by every later packet, and `audit()` reports exactly which packets broke.

## Independent verification

An external auditor needs only the exported packet JSON, its predecessor, and the tenant's public key — no access to Acorn.Signal:

```ts
import { verifyPacket } from 'acorn-signal';

const result = verifyPacket(exportedPacket, publicKeyPem, predecessorPacket /* null at genesis */);
// { valid, checks: { payloadHash, signature, chainLink }, errors }
```

## Humans and approved AI agents

All access goes through the actor registry. AI agents are first-class but constrained:

- must name an accountable human `ownerId`,
- can never hold `agents:admin`,
- can be confined to specific categories (`allowedCategories: ['complaint']`),
- see `[redacted]` party PII unless granted `pii:read` (the response carries `redacted: true`),
- lose all outstanding tokens the moment they are revoked.

```ts
service.registry.register({
  id: 'triage-bot', tenantId: 'acme-bank', name: 'Complaint triage agent',
  kind: 'ai_agent', ownerId: 'ops-lead-7',
  scopes: ['packets:read', 'packets:verify', 'outcomes:act'],
  allowedCategories: ['complaint'],
}, new Date().toISOString());

const token = service.registry.issueToken('triage-bot', ['packets:read', 'outcomes:act'], 3600);
```

Completed actions are attributed on-chain as `agent:triage-bot` or `human:<id>`, so the packet proves not just the outcome but which kind of actor produced it.

## HTTP API

| Method & path | Auth |
| --- | --- |
| `GET /v1/health` | none |
| `POST /v1/agents` | `x-admin-key` |
| `POST /v1/agents/{id}/tokens` | `x-admin-key` |
| `POST /v1/communications` | Bearer, `communications:ingest` |
| `GET /v1/tenants/{t}/packets/{id}` | Bearer, `packets:read` |
| `GET /v1/tenants/{t}/packets/{id}/verify` | Bearer, `packets:verify` |
| `GET /v1/tenants/{t}/audit` | Bearer, `packets:verify` |
| `POST /v1/tenants/{t}/packets/{id}/actions/{i}/complete` | Bearer, `outcomes:act` |

## Layout

```
signal/
  src/
    canonical/   RFC 8785 canonical JSON
    crypto/      SHA-256 + Ed25519 signing
    ingest/      channel-neutral normalization
    pipeline/    classify → obligations → outcome, with provenance
    ledger/      append-only store contract + hash-chain sealing/audit
    agents/      registry, scopes, tokens, redaction
    api/         dependency-free HTTP server
    service.ts   SignalService orchestration
    cli.ts       `serve` entry point
  test/          vitest suite
```

The core has **zero runtime dependencies** — only `node:crypto` and `node:http`. The storage contract (`PacketStore`) is append-only by design; swap the in-memory store for a durable backend without touching sealing or verification.
