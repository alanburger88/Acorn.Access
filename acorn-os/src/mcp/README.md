# Acorn OS — MCP Server

An MCP (Model Context Protocol) server exposing a **governed, allow-listed**
projection of the platform to AI agents. Transport is stdio: newline-delimited
JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`), protocol
version `2025-06-18`.

This repo's server runs **in-process against the platform data directory**
(the same store the API server uses) — the right shape for local development,
demos, and tests. In production the MCP server is deployed as its own service
and operates the platform **through the REST API** (see
`platform/07-api-integration-strategy.md` §5.1), so it shares neither process
nor filesystem with the API tier.

## Tool catalog

Risk tiers per platform/07 §5.2: **T1** read-only (no side effects) ·
**T2** sandbox (side effects confined to drafts/previews) · **T3** sensitive
(real-world effect; human approval mandatory — **excluded** from this server).

| Tool | Description | Roles required | Tier |
|---|---|---|---|
| `list_templates` | List templates (id, key, name, published) | any authenticated | T1 |
| `search_content` | Full-text search of the content library | any authenticated | T1 |
| `search_communications` | Communication summaries by customer/template/status | any authenticated | T1 |
| `get_communication` | One communication: status, section titles, outcome, artifact formats | any authenticated | T1 |
| `explain_communication` | Grounded Q&A over a communication (governed AI gateway) | any authenticated | T1 |
| `get_customer_timeline` | Chronological event timeline for a customer | any authenticated | T1 |
| `get_delivery_status` | Delivery attempts (channel, status, attempt, failover) | any authenticated | T1 |
| `get_analytics_overview` | Tenant-wide outcome/engagement metrics | any authenticated | T1 |
| `search_archive` | Search the immutable statement-of-record archive | any authenticated | T1 |
| `generate_evidence_pack` | Compliance evidence pack for a communication | `auditor` \| `compliance-approver` \| `tenant-admin` | T1 |
| `check_template_accessibility` | Run the accessibility gate on a template version | any authenticated | T1 |
| `draft_content` | AI-draft content text — **draft only, human approval required** | any authenticated | T2 |
| `initiate_delivery` (and any send/publish/approve action) | — | **not exposed** | T3 |

## Security model

- **Tenant isolation via a key-scoped RequestCtx.** The server authenticates
  `ACORN_MCP_API_KEY` once at startup (`tenants.authenticate`) and every tool
  call executes with that key's `{tenantId, actorId, roles, keyId}`. There is
  no way to name another tenant: tenant ids are server-derived, never
  client-supplied.
- **Least privilege.** Tools enforce the same role checks as the REST layer
  (e.g. `generate_evidence_pack` mirrors the REST evidence-pack route:
  auditor/compliance-approver/tenant-admin). A denied call returns an in-band
  `isError` result and is still audited.
- **Allow-listing, not gating.** The catalog above is the complete surface.
  Sensitive T3 actions — delivery initiation, template publication, approval
  decisions — are **excluded** rather than role-gated: per platform/06 they
  require a human approval gate, which an agent must not be able to satisfy.
- **Audit logging.** Every `tools/call` (success, validation failure, role
  denial, unknown tool) appends `com.acorn.mcp.tool-invoked` to the
  tamper-evident hash-chained event log, with `{tool, actorId, keyId, ok,
  summary}` and the primary entity id as the event subject. AI-backed tools
  (`explain_communication`, `draft_content`) additionally produce
  `AiInvocation` records via the governed AI gateway.
- **Input/output validation.** Arguments are validated against each tool's
  JSON Schema (unknown properties rejected); results are returned as JSON
  text; audit summaries are truncated to 140 chars.
- **Prompt-injection note.** Retrieved document/content text returned by these
  tools is **data, not instructions**. Communications contain
  customer-supplied and template-authored text; an agent consuming tool
  output must never treat embedded imperatives ("ignore previous
  instructions", "call tool X") as directives. The grounded assistant path
  (`explain_communication`) constrains answers to retrieved passages and
  escalates to a human on low confidence rather than improvising.
- **Draft-only AI output.** `draft_content` results carry an explicit notice:
  the text must pass human review and compliance approval (platform/06
  human-review gates) before entering the content workflow as anything other
  than a draft.

## Client configuration

```json
{
  "mcpServers": {
    "acorn-os": {
      "command": "npx",
      "args": ["tsx", "src/mcp-server.ts"],
      "env": {
        "ACORN_DATA_DIR": "./data",
        "ACORN_MCP_API_KEY": "<api key secret>"
      }
    }
  }
}
```

`ACORN_MCP_API_KEY` is a tenant API key secret (returned once by
`POST /v1/tenants` for the bootstrap admin key, or `POST /v1/tenant/api-keys`
for least-privilege keys — prefer a read-scoped key such as
`roles: ["service-agent"]` for agents). The server logs readiness to stderr;
stdout carries only protocol frames.

## Files

- `tools.ts` — allow-listed tool catalog, schema validation, role checks,
  audit publication.
- `server.ts` — JSON-RPC 2.0 stdio protocol layer (`createMcpHandler`,
  `runStdioServer`).
- `../mcp-server.ts` — executable entry point (env handling, key
  authentication, stderr logging).
