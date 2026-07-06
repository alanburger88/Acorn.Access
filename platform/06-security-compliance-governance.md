# Acorn Communicate — Security, Compliance, AI Governance & Accessibility Model

| Field | Value |
|---|---|
| Document | 06-security-compliance-governance.md |
| Status | Build-ready baseline (v1.0) |
| Owner | Principal Security Architecture |
| Applies to | All deployment models: SaaS (multi-tenant), private cloud, hybrid, customer VPC |
| Control ID scheme | `SEC-*` security, `CMP-*` compliance, `AIG-*` AI governance, `ACC-*` accessibility |
| Enforcement | Every control below carries an ID, an enforcement point, and an evidence artifact. Controls marked **[GATE]** block publication, deployment, or execution on failure. |

Acorn Communicate composes, renders, delivers, and archives customer communications for regulated industries (banking, credit unions, insurance, healthcare, utilities, telecom, government, mortgage/loan servicing). It ships interactive documents with embedded actions (payments, disputes, e-signature), an embedded customer-facing AI assistant, and REST/GraphQL/MCP/webhook APIs. This document is the normative control catalog for the platform.

---

# PART 1 — SECURITY MODEL

## 1.1 Identity & Authentication (SEC-IAM)

Workforce identities (tenant staff, partner staff, Acorn operators) always federate to an external IdP. Customer/recipient identities are verified per-document (see SEC-DOC). Local passwords exist only as a break-glass path for Tenant Admins in air-gapped VPC deployments.

| ID | Control | Requirement | Evidence |
|---|---|---|---|
| SEC-IAM-001 | SAML 2.0 federation | SP-initiated and IdP-initiated SSO; signed assertions required; encrypted assertions supported; audience restriction and 5-minute assertion clock skew enforced. | IdP metadata, SSO test report |
| SEC-IAM-002 | OIDC federation | Authorization Code + PKCE only; implicit and ROPC flows disabled; `nonce` and `state` mandatory; JWKS rotation honored ≤ 24 h. | OIDC config export |
| SEC-IAM-003 | SCIM 2.0 provisioning | Automated create/update/deactivate of users and groups; deactivation propagates to session revocation ≤ 60 s; orphan-account report weekly. | SCIM sync logs, orphan report |
| SEC-IAM-004 | MFA enforcement | MFA mandatory for all workforce roles; phishing-resistant factor (FIDO2/WebAuthn passkey or smartcard) mandatory for Tenant Admin, Operator, Compliance Approver, Legal Approver, Auditor. SMS OTP not accepted for privileged roles. | IdP policy export, access review |
| SEC-IAM-005 | Passkeys | Native WebAuthn passkey support (platform + roaming authenticators) for workforce and for recipient document verification; attestation policy configurable per tenant. | WebAuthn config, test vectors |
| SEC-IAM-006 | Step-up authentication | Sensitive operations (key management, retention changes, prompt approval, legal hold release, production data export) require fresh authentication ≤ 5 min old at the required factor level. | AuthN context claims in audit log |
| SEC-IAM-007 | Session policy | Idle timeout: 15 min privileged / 30 min standard (tenant-tunable downward only). Absolute lifetime 12 h. Tokens are sender-constrained (DPoP or mTLS-bound) for APIs; cookies are `Secure; HttpOnly; SameSite=Lax`, rotated on privilege change. | Session config, token samples |
| SEC-IAM-008 | Service identities | Workload identity via SPIFFE/SVID or cloud IAM roles; no long-lived static API keys between internal services; external API keys expire ≤ 90 days and are scope-bound. | Identity inventory |
| SEC-IAM-009 | Joiner/mover/leaver | Access recertification quarterly for privileged roles, semi-annually for all; mover events trigger automatic entitlement diff review. | Recertification records |
| SEC-IAM-010 | Break-glass | Sealed break-glass accounts per environment; use triggers real-time SIEM alert, mandatory post-incident review ≤ 24 h, credential rotation on close. | Break-glass log |

## 1.2 Authorization (SEC-AZN)

### 1.2.1 RBAC role catalog

| Role | Scope | Core permissions | Explicitly denied |
|---|---|---|---|
| Business Author | Brand/LOB within tenant | Create/edit content blocks, variable text, message variants; submit for approval; run previews with masked data | Approve own content; publish; touch templates' logic layer; view production PII |
| Designer | Brand/LOB within tenant | Create/edit templates, layouts, data bindings, interactive actions; configure accessibility tags; submit for approval | Approve own designs; publish; modify delivery/routing config |
| Compliance Approver | Tenant or LOB | Review/approve/reject content and templates against compliance packs; attach disposition rationale; release compliance holds | Author or edit the artifacts they approve; modify compliance pack rules |
| Legal Approver | Tenant or LOB | Review/approve regulated language, disclosures, consent text; manage legal hold | Author content; delete anything under legal hold |
| Operator | Tenant environment(s) | Run/monitor batch jobs, delivery queues, reprocessing; manage connectors; view redacted logs | Edit content/templates; approve; access decrypted document payloads without JIT grant |
| Developer | Tenant sandbox + API | Manage API credentials, webhooks, MCP tool configs in non-prod; promote via pipeline | Direct production writes; production PII access |
| Tenant Admin | Whole tenant | Manage users/roles/SSO/SCIM, tenant policies, keys (per key policy), compliance pack selection, data residency config | Author/approve content (unless dual-hatted with SoD exception workflow); read message bodies by default |
| Partner Admin | Delegated sub-tenants | Manage sub-tenant provisioning, branding, entitlements within partner boundary | Cross-sub-tenant data read; key material access; compliance pack weakening below partner floor |
| Auditor | Tenant (read-only) | Read audit logs, evidence packs, approval chains, configuration history, proof artifacts | Any write operation; any content mutation; log deletion |
| Recipient (customer) | Single document/session | View own communications, execute embedded actions permitted by document policy, converse with assistant about own document | Everything else; enumeration of other documents |
| Platform Operator (Acorn SRE) | Infrastructure only | Operate infrastructure via JIT, ticketed, time-boxed access; no standing tenant-data read | Standing access to tenant content or keys (SEC-INS-001) |

### 1.2.2 ABAC attributes and policy-based access

| ID | Control | Requirement |
|---|---|---|
| SEC-AZN-001 | RBAC baseline | All access decisions start from the role catalog above; custom roles are compositions of predefined permissions, never new raw permissions. |
| SEC-AZN-002 | ABAC overlay | Every permission grant is filtered by attributes: `tenant`, `sub_tenant`, `brand`, `region/residency_zone`, `line_of_business`, `environment`, `data_classification` (Public / Internal / Confidential / Restricted-PII / Restricted-PHI / Restricted-PCI), `channel`, `template_state`. Example: a Business Author with `brand=RetailBank, region=EU` cannot open `brand=Insurance` content or US-resident data. |
| SEC-AZN-003 | Policy-based access (PDP/PEP) | Central policy decision point (OPA/Rego or Cedar); every service enforces via local PEP sidecar/library; decisions cached ≤ 60 s; policy bundles versioned, signed, and change-controlled. Deny by default. |
| SEC-AZN-004 | Data-classification gating | `Restricted-*` classifications require purpose-of-use assertion in the access request; assertion is logged and included in evidence packs. |
| SEC-AZN-005 | JIT elevation | Production data access for Operators/SREs is just-in-time: ticket reference, approver, TTL ≤ 4 h, auto-revoke, session recording for console access. |

### 1.2.3 Data classification scheme (referenced by ABAC, encryption, AI routing, redaction)

| Class | Examples | Handling floor |
|---|---|---|
| Public | Published marketing templates, brand assets | Integrity controls only |
| Internal | Draft content, operational metrics | AuthN + role scoping |
| Confidential | Tenant configuration, connector topology | ABAC scoping, encrypted, no external egress |
| Restricted-PII | Names, addresses, account relationships | Field-level controls, purpose-of-use, redaction before AI (AIG-RED) |
| Restricted-PHI | Diagnosis, treatment, claims detail | HIPAA pack mandatory, minimum-necessary gating, private-model routing only |
| Restricted-PCI | PAN, card verification data | Never stored/processed outside CDE path (CMP-PCI); token references only |

Classification is assigned at ingestion (data-dictionary mapping + classifiers), inherited through composition, and travels with the data as a label the PDP evaluates on every access.

### 1.2.4 Segregation-of-duties (SoD) matrix **[GATE]**

Enforced by the PDP at transaction time — not by convention. A single identity may hold conflicting roles only via a Tenant-Admin-approved SoD exception, which is itself an audited, expiring artifact.

| Action A | Action B | Rule |
|---|---|---|
| Author content/template | Approve that content/template | **Hard block** — author ≠ approver, evaluated per artifact version |
| Author AI prompt | Approve AI prompt | **Hard block** — prompt author ≠ prompt approver (see AIG-PRM-003) |
| Configure compliance pack | Approve compliance disposition | Hard block within same artifact |
| Request production data access | Approve that access | Hard block |
| Create key / rotate key | Approve key destruction | Hard block; destruction is dual-control (SEC-ENC-009) |
| Deploy code | Approve own change | Hard block in CI/CD |
| Place legal hold | Release legal hold | Second Legal Approver required |
| Create Routine/automation acting on prod | Approve its policy scope | Hard block |

## 1.3 Encryption & Key Management (SEC-ENC)

| ID | Control | Requirement |
|---|---|---|
| SEC-ENC-001 | Transport | TLS 1.3 required externally and preferred internally; TLS 1.2 permitted only for legacy tenant connectors with compensating allowlist; no renegotiation, no compression; HSTS with preload on all web surfaces. |
| SEC-ENC-002 | At rest | AES-256-GCM for all data stores, object storage, queues, search indexes, and backups. No plaintext spill paths (temp files, crash dumps, render scratch space are encrypted volumes). |
| SEC-ENC-003 | Envelope encryption | Data encrypted with per-object DEKs; DEKs wrapped by per-tenant KEKs; KEKs wrapped by HSM-resident root keys (FIPS 140-3 Level 3). DEKs never persisted unwrapped. |
| SEC-ENC-004 | Per-tenant keys | Each tenant has a distinct KEK hierarchy per residency zone and per data class (content, PII index, archive, audit). Cross-tenant key reuse prohibited. |
| SEC-ENC-005 | Customer-managed keys (CMK) | Tenant KEK hosted in the platform KMS but under a customer-controlled key policy; customer can audit usage and revoke grants. |
| SEC-ENC-006 | BYOK | Customer generates key material in their own HSM/KMS and imports the wrapped key; platform stores only the wrapped form; re-import/rotation self-service; key-usage logs streamed to tenant SIEM. |
| SEC-ENC-007 | HYOK / external key store | KEK never leaves the customer's KMS (AWS XKS, GCP EKM, on-prem HSM). Every decrypt is a remote unwrap call the customer can deny in real time — customer revocation renders tenant data cryptographically inert ("kill switch"). Documented latency/availability SLO trade-off signed by tenant. |
| SEC-ENC-008 | Rotation | Root keys 24 mo, KEKs 12 mo, DEKs per object or 90 days for streams; rotation is re-wrap only (no bulk re-encryption required); emergency rotation runbook ≤ 4 h. |
| SEC-ENC-009 | Crypto-shredding | Erasure (GDPR/CCPA, retention expiry) implemented by destroying the per-subject or per-object DEK/KEK under dual control; destruction certificate (key ID, scope, approvers, timestamp, hash-chain anchor) generated as a proof artifact (CMP-PRF-008). Enables erasure in append-only/event-sourced and WORM stores. |
| SEC-ENC-010 | Field-level encryption | High-sensitivity fields (SSN/TIN, account numbers, PHI identifiers) additionally encrypted at field level with searchable-encryption or blind-index tokens; raw values never appear in logs, search indexes, or AI prompts (AIG-RED). |
| SEC-ENC-011 | Signing | All proof artifacts, audit anchors, SBOMs, container images, and C2PA manifests signed with keys segregated from data-encryption hierarchy. |

## 1.4 Tenant Isolation (SEC-ISO)

### 1.4.1 Isolation tiers

| Tier | Model | Compute | Data | Keys | Typical buyer |
|---|---|---|---|---|---|
| T1 Pooled | Shared services, row-level security | Shared, tenant-context propagated via signed claims | Shared stores; RLS + tenant_id in every table/index/queue; per-tenant encryption still applies | Per-tenant KEKs in shared KMS | Mid-market, non-PHI |
| T2 Namespace-siloed | Dedicated Kubernetes namespaces / schemas | Dedicated pods, shared cluster; NetworkPolicy default-deny between namespaces | Dedicated schemas/buckets/queues per tenant | Per-tenant KEKs; CMK optional | Regulated, moderate scale |
| T3 Dedicated | Single-tenant cluster + data plane | Dedicated cluster, shared control plane | Fully dedicated | CMK/BYOK standard | Large banks, insurers, healthcare |
| T4 Customer VPC / hybrid | Data plane in customer VPC; control plane SaaS or on-prem | Customer-operated | Never leaves customer network; delivery egress via customer gateways | HYOK standard | Government, top-tier FIs |

### 1.4.2 Isolation controls

| ID | Control | Requirement |
|---|---|---|
| SEC-ISO-001 | Tenant context integrity | Tenant ID derived only from the authenticated token, signed at the edge, propagated as a verified claim; request bodies/headers can never override it. |
| SEC-ISO-002 | Row-level security (T1) | Database-enforced RLS policies on every multi-tenant table; application accounts have no RLS-bypass grants; RLS coverage verified in CI by schema linter **[GATE]**. |
| SEC-ISO-003 | Cross-tenant test harness | Continuous synthetic canary tenants attempt cross-tenant reads across API, search, cache, queue, and AI-retrieval paths; any hit is a Sev-1. |
| SEC-ISO-004 | Cache/queue partitioning | Cache keys and queue routing keys are tenant-prefixed and validated at consume time; renderer scratch space is per-job, wiped after use. |
| SEC-ISO-005 | Noisy-neighbor limits | Per-tenant quotas and rate limits on render, delivery, AI tokens, API calls; one tenant's saturation cannot degrade another below SLO. |

### 1.4.3 Blast-radius analysis

| Compromise scenario | T1 pooled | T2 namespace | T3 dedicated | T4 VPC |
|---|---|---|---|---|
| App-layer authz bug | Bounded by RLS + per-tenant crypto; worst case: tenants sharing the vulnerable service path | Bounded to namespace | Single tenant | Single tenant |
| Database credential theft | RLS + KEK separation → ciphertext only for other tenants; CMK tenants unaffected without KMS grant | Single tenant schema | Single tenant | Single tenant |
| KMS compromise (platform) | All non-BYOK/HYOK tenants at risk → mitigated by HSM root, dual control, key-usage anomaly detection | Same | Same | Not applicable (HYOK) |
| Container escape | Node-level: mitigated by node pools per sensitivity class, gVisor/Kata for parsers (SEC-APP-004) | Namespace node pool | Cluster (one tenant) | Customer VPC only |
| Control-plane compromise | Config/metadata for all tenants; data plane still requires per-tenant keys; HYOK tenants can sever unwrap | Same | Same | Config only; data unreachable |

Target: no single component compromise yields plaintext for more than one tenant's data without also compromising that tenant's key hierarchy.

## 1.5 Secrets Management (SEC-SCR)

| ID | Control | Requirement |
|---|---|---|
| SEC-SCR-001 | Central vault | All platform and connector secrets in a secrets manager (Vault/cloud-native); no secrets in code, images, env files, or CI variables; repository and image scanning for secret patterns **[GATE]** in CI. |
| SEC-SCR-002 | Dynamic credentials | Database and connector credentials issued dynamically with TTL ≤ 24 h where the backend supports it; static secrets rotated ≤ 90 days automatically. |
| SEC-SCR-003 | Tenant connector secrets | SMTP, SMS, print-vendor, core-banking connector credentials stored per tenant, encrypted under that tenant's KEK, retrievable only by the connector runtime identity. |
| SEC-SCR-004 | Access audit | Every secret read is logged with workload identity, purpose, and request ID; anomalous read patterns alert to SIEM. |
| SEC-SCR-005 | Webhook signing secrets | Per-endpoint HMAC secrets, rotated on demand with dual-secret overlap window; replay protection via timestamp + nonce. |

## 1.6 Secure Document Access (SEC-DOC)

Recipient-facing access to communications and interactive documents.

| ID | Control | Requirement |
|---|---|---|
| SEC-DOC-001 | No naked links | Delivered links are single-purpose, unguessable (≥128-bit entropy), expiring (tenant-configurable, default 30 days, ≤ 24 h for Restricted classes), and bound to one communication. Link possession alone never reveals content beyond a branded verification page. |
| SEC-DOC-002 | Verification before viewing | Before rendering, recipient must verify by tenant-selected method: portal SSO, OTP to a pre-registered channel, knowledge factor from the source system (never printed in the message), or passkey. `Restricted-PHI/PCI` documents require OTP or stronger; passkey enrollment offered post-verification for returning recipients. |
| SEC-DOC-003 | Token-bound sessions | Post-verification, the viewer session token is bound to the device (DPoP/cookie binding), scoped to the single document set, idle-timeout 15 min, absolute 60 min; embedded actions re-validate the binding per action. |
| SEC-DOC-004 | Action step-up | Payments, disputes, and e-signature inside the document require action-level re-verification if the session factor is weaker than the action's policy requires. |
| SEC-DOC-005 | Watermarking | Viewer renders dynamic forensic watermarks (recipient ID hash, timestamp, session ID) on-screen and in downloaded PDFs for classifications that require it; watermark parameters logged for leak tracing. |
| SEC-DOC-006 | Access telemetry | Every open, page view, action attempt, and download is recorded as a proof-of-access artifact (CMP-PRF-004) with IP, user agent, verification method, and outcome. |
| SEC-DOC-007 | Revocation | Tenant can revoke a link, a document version, or a recipient's access instantly; revocation is checked server-side per request, not baked into the token. |

## 1.7 Application Security (SEC-APP)

The platform's most hostile input surface is ingestion: it parses attacker-influencible PDF, XML (incl. XSLT/XSD), EDI, CSV, JSON, images, fonts, and legacy print streams (AFP, Metacode, PCL, PostScript).

| ID | Control | Requirement |
|---|---|---|
| SEC-APP-001 | Input validation | Schema-first validation at every trust boundary; canonicalize-then-validate; size, depth, and count limits on all composite inputs; reject-by-default content types. |
| SEC-APP-002 | XXE / XML hardening | All XML parsers configured with DTD processing disabled, external entities disabled, XInclude disabled, entity-expansion limits (billion-laughs), XSLT extension functions disabled. Verified by unit tests pinned to parser config **[GATE]**. |
| SEC-APP-003 | SSRF defenses | Any URL fetched on behalf of tenant config (webhooks, image URLs, data connectors, font sources) passes an egress broker: allowlist per tenant, DNS-rebinding protection (resolve-then-connect pinning), RFC1918/link-local/metadata-IP blocklist, redirect chain re-validation, protocol allowlist (https only). |
| SEC-APP-004 | Sandboxed parsers & renderers | Every format parser and every render engine (PDF, HTML, print-stream) runs in a sandbox: gVisor/Kata or Firecracker micro-VM, non-root, read-only FS, no network egress, seccomp/AppArmor profiles, per-job scratch volume destroyed after use, CPU/memory/time limits. Parser crash = quarantine input + alert, never retry on a shared host. |
| SEC-APP-005 | Malware scanning | All ingested files and all recipient uploads (dispute attachments) scanned pre-processing; detonation sandbox optional per tenant; active content (JS in PDF, macros) stripped or blocked by policy. |
| SEC-APP-006 | Viewer CSP | Interactive viewer ships strict Content-Security-Policy: `default-src 'none'`, nonce-based scripts, no inline event handlers, `frame-ancestors` limited to tenant-registered origins, Trusted Types enforced, sandboxed iframes for embedded actions with `postMessage` origin checks. |
| SEC-APP-007 | Output encoding & template safety | Template expression language is logic-limited (no arbitrary code eval); contextual auto-escaping in HTML output; server-side template injection test suite in CI **[GATE]**. |
| SEC-APP-008 | API hardening | REST/GraphQL: authn on every route, object-level authorization tests (BOLA), GraphQL depth/complexity/alias limits, persisted queries for production clients, per-token rate limits, uniform error surface (no stack traces). |
| SEC-APP-009 | Secure SDLC | Threat modeling for each new surface; SAST, DAST, IaC scanning in CI **[GATE]**; annual external penetration test per deployment model plus targeted tests on ingestion and viewer; public VDP with safe-harbor. |
| SEC-APP-010 | File type verification | Magic-byte + structural validation (not extension); polyglot detection; format-specific structural fuzzing corpus maintained per parser and run in nightly CI. |

## 1.8 Supply Chain Security (SEC-SCM)

| ID | Control | Requirement |
|---|---|---|
| SEC-SCM-001 | Dependency scanning | SCA on every build; critical/high vulns block release **[GATE]**; exploited-in-the-wild (KEV) patched ≤ 48 h. |
| SEC-SCM-002 | SBOM | CycloneDX SBOM generated per release for platform and per shipped container; delivered to private-cloud/VPC customers with each release. |
| SEC-SCM-003 | Signed images | All containers signed (Sigstore/cosign); admission controller rejects unsigned or policy-violating images **[GATE]**; base images minimal (distroless) and rebuilt weekly. |
| SEC-SCM-004 | Build integrity | SLSA Level 3 target: hermetic builds, provenance attestation, two-person review on protected branches, no direct pushes to release branches. |
| SEC-SCM-005 | Third-party model & data supply | AI models, embeddings, and fonts treated as supply-chain artifacts: pinned versions, checksums, provenance records (ties to AIG-MDL). |

## 1.9 Network Security (SEC-NET)

| ID | Control | Requirement |
|---|---|---|
| SEC-NET-001 | Private networking | Tenant connectivity via PrivateLink/private service connect/VPN options; public endpoints WAF-fronted with managed DDoS protection. |
| SEC-NET-002 | Service mesh mTLS | All service-to-service traffic mTLS via mesh (SPIFFE identities); mesh authz policies mirror PDP decisions; plaintext east-west traffic prohibited. |
| SEC-NET-003 | Egress control | Default-deny egress; delivery gateways, webhook dispatchers, and model gateways are the only egress paths, each with per-tenant destination allowlists and full flow logging. Render/parse sandboxes have zero egress (SEC-APP-004). |
| SEC-NET-004 | Segmentation | Environments (prod/stage/dev) in separate accounts/subscriptions; data-plane vs control-plane network separation; per-tier NetworkPolicies default-deny. |
| SEC-NET-005 | Customer VPC pattern | T4 deployments: outbound-only control channel (no inbound from Acorn), customer-controlled egress proxies, offline update bundles supported for air-gapped government sites. |

## 1.10 Insider Risk (SEC-INS)

| ID | Control | Requirement |
|---|---|---|
| SEC-INS-001 | No standing access | Zero standing platform-operator access to tenant content or keys; all production access JIT (SEC-AZN-005) and visible to the tenant in their audit feed. |
| SEC-INS-002 | Dual control | Key destruction, retention shortening, legal-hold release, audit-pipeline changes, and compliance-pack weakening require two distinct authorized identities. |
| SEC-INS-003 | Behavioral analytics | UEBA on privileged actions: bulk export, off-hours access, unusual tenant span, mass link generation; automated session suspension on high-severity anomalies. |
| SEC-INS-004 | Data egress guards | Bulk export APIs are separately permissioned, size-alarmed, watermark-stamped, and require purpose assertion; screenshots of Restricted data in support tooling masked by default. |
| SEC-INS-005 | Personnel controls | Background checks per role sensitivity where lawful; security training on hire + annually; offboarding revokes all access ≤ 1 h. |

## 1.11 Audit Logging & SIEM (SEC-AUD)

| ID | Control | Requirement |
|---|---|---|
| SEC-AUD-001 | Coverage | Every authn event, authz decision (incl. denies), CRUD on content/templates/prompts/policies, key operation, approval, delivery event, document access, AI action, MCP tool call, and admin change is logged with actor, tenant, artifact version, before/after hash, request ID, and timestamp (RFC 3339, NTP-synced). |
| SEC-AUD-002 | Immutability | Audit events written once to an append-only store; WORM object lock for the retention period; no delete/update API exists on the audit path. |
| SEC-AUD-003 | Tamper evidence | Events hash-chained (each record carries previous-record hash); Merkle roots sealed every 5 min and anchored to an independent notarization service; verification tool ships with the platform so auditors can independently validate chain integrity. |
| SEC-AUD-004 | SIEM integration | Native streaming to tenant SIEM (Splunk HEC, Sentinel, Chronicle, generic syslog/CEF/OCSF and Kafka); delivery is at-least-once with sequence numbers so gaps are detectable. |
| SEC-AUD-005 | Log hygiene | No secrets, tokens, or Restricted field values in logs; structured redaction at the logging library level, verified by CI log-scan tests. |
| SEC-AUD-006 | Retention | Audit logs retained ≥ 400 days hot, ≥ 7 years archived (tenant-configurable upward; regulatory pack may force longer, e.g., CMP-GLB). |
| SEC-AUD-007 | Clock & ordering | Hybrid logical clocks for cross-service ordering; audit consumers can reconstruct causal order of author → approve → render → deliver. |

## 1.12 Vulnerability & Incident Management (SEC-VUL / SEC-IRP)

| ID | Control | Requirement |
|---|---|---|
| SEC-VUL-001 | Vulnerability management | Continuous scanning of hosts, containers, and dependencies; remediation SLAs: Critical 7 days (KEV 48 h), High 30 days, Medium 90 days; exceptions are risk-accepted artifacts with expiry and compensating controls. |
| SEC-VUL-002 | Patch cadence | Base images rebuilt weekly (SEC-SCM-003); managed-service patching tracked in the control inventory; private-cloud/VPC customers receive the same patched releases with signed release notes. |
| SEC-IRP-001 | Incident response plan | Documented IR plan with severity matrix, on-call rotation, and tenant-communication runbooks; tabletop exercises twice yearly incl. one AI-specific scenario (prompt-injection-driven data exposure) and one cross-tenant scenario. |
| SEC-IRP-002 | Tenant notification | Confirmed incidents affecting a tenant's data notified per contract (default ≤ 24 h for confirmed breach, ≤ 72 h status cadence); notification content supports the tenant's own regulatory clocks (HIPAA 60-day, GDPR 72-hour, state banking regulators). |
| SEC-IRP-003 | Forensics readiness | Hash-chained audit logs (SEC-AUD), flow logs, and per-tenant access telemetry retained to support forensic reconstruction; forensic copies preserved under legal-hold machinery (CMP-RET-003). |
| SEC-IRP-004 | AI incident class | Model misbehavior with customer impact (hallucinated regulated content delivered, leakage, gate bypass) is a first-class incident type with its own runbook: feature kill switch (AIG-PRM-005), affected-communication identification via AI audit trail (AIG-AUD-001), and regulator-ready impact report. |

## 1.13 Threat Model Summary (STRIDE per major surface)

| Surface | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation of privilege |
|---|---|---|---|---|---|---|
| **Ingestion** (files, feeds, print streams) | Forged sender/feed → mutual-auth connectors, signed drops (SEC-SCR-003) | Malicious PDF/XML/EDI payloads → sandboxed parsers, XXE/zip-bomb limits (SEC-APP-002/004) | Disputed submissions → ingest receipts with content hash (CMP-PRF) | Parser exfil → zero-egress sandboxes (SEC-NET-003) | Decompression/entity bombs → resource limits (SEC-APP-001) | Parser escape → micro-VM isolation, seccomp (SEC-APP-004) |
| **Designer/authoring** | Stolen author session → MFA, session binding (SEC-IAM) | Unauthorized template logic changes → versioning, SoD, signed artifacts | "I never approved that" → hash-chained approval records (SEC-AUD-003) | Cross-brand content access → ABAC brand scoping (SEC-AZN-002) | Preview-render abuse → per-tenant quotas (SEC-ISO-005) | Template injection to server code → logic-limited expression language (SEC-APP-007) |
| **Interactive viewer** | Link forwarding/replay → verification + token binding (SEC-DOC-002/003) | DOM/content manipulation → CSP, Trusted Types, SRI (SEC-APP-006) | Disputed customer actions → signed action receipts (CMP-PRF-007) | Cross-document access → single-document token scope (SEC-DOC-003) | Link-hammering → rate limits, WAF | Action abuse (payment redirect) → allow-listed action targets, step-up (SEC-DOC-004) |
| **AI assistant** | Impersonating the assistant or the customer → session binding, output signing (AIG-PRV) | Prompt injection via document data → instruction/data separation (AIG-INJ) | "The AI told me X" → full conversation + retrieval audit (AIG-AUD) | Cross-tenant/cross-customer leakage → per-tenant knowledge isolation (AIG-AST-005) | Token-budget exhaustion → per-tenant AI quotas | Tool misuse → allow-listed actions, human gates (AIG-MCP) |
| **Delivery** (email/SMS/print/portal) | Sender spoofing → DKIM/SPF/DMARC enforcement, sender domain isolation per tenant | Content swap post-approval → render hash locked to approval (CMP-COC) | "Never received" → proof of delivery (CMP-PRF-001) | Misdelivery → recipient-resolution validation, address hygiene checks | Queue flooding → per-tenant throttles | Channel-connector credential theft → vaulted per-tenant secrets (SEC-SCR-003) |
| **REST/GraphQL/webhook APIs** | Token theft → sender-constrained tokens (SEC-IAM-007) | Payload manipulation → schema validation, webhook HMAC (SEC-SCR-005) | Disputed API changes → full request audit (SEC-AUD-001) | BOLA/over-fetch → object-level authz tests, field-level ABAC (SEC-APP-008) | Query complexity abuse → GraphQL limits (SEC-APP-008) | Scope escalation → least-privilege scoped tokens |
| **MCP surface** | Rogue MCP client/server → mutual auth, tenant-pinned servers (AIG-MCP-001) | Tool-result poisoning → output validation (AIG-MCP-006) | Disputed agent actions → per-call audit (AIG-MCP-005) | Tool over-exposure → allow-listed tools, least privilege (AIG-MCP-002) | Agent loops → call budgets, circuit breakers | Sensitive action without human → human-approval gates (AIG-MCP-004) |

---

# PART 2 — COMPLIANCE MODEL

## 2.1 Compliance Packs (CMP-PCK)

A compliance pack is a versioned, signed bundle of policy-as-code rules, required approval chains, retention schedules, evidence templates, and regression tests that a Tenant Admin activates per tenant / LOB / brand. Packs compose; on conflict the strictest rule wins. Packs can only be weakened through a dual-control exception with documented rationale (SEC-INS-002).

| ID | Control | Requirement |
|---|---|---|
| CMP-PCK-001 | Pack activation | Activating a pack immediately enforces its gates on new artifacts and flags non-conforming existing artifacts for remediation with a report. |
| CMP-PCK-002 | Pack versioning | Packs are versioned; every communication records which pack versions were in force at approval and at delivery (chain of custody, CMP-COC). |
| CMP-PCK-003 | Strictest-wins composition | Multi-pack tenants (e.g., HIPAA + PCI + GDPR) get the union of controls; the effective policy set is computable and exportable for auditors. |

## 2.2 Framework-Specific Controls

### SOC 2 / ISO 27001 (CMP-SOC / CMP-ISO)

| ID | Requirement |
|---|---|
| CMP-SOC-001 | Platform maintains SOC 2 Type II across Security, Availability, Confidentiality (Processing Integrity and Privacy where contracted); report available under NDA; bridge letters between periods. |
| CMP-SOC-002 | Control-to-evidence mapping is machine-readable; tenant-facing trust portal shows control status and sub-processor list with change notifications. |
| CMP-ISO-001 | ISO/IEC 27001 certified ISMS covering the platform; Statement of Applicability shared; ISO 27017/27018/27701 alignment documented; risk register reviewed quarterly. |

### HIPAA (CMP-HIP)

| ID | Requirement |
|---|---|
| CMP-HIP-001 | BAA executed before any PHI processing; PHI processing technically disabled per tenant until BAA flag set by contract system. |
| CMP-HIP-002 | PHI data classification (`Restricted-PHI`) auto-applied by ingestion classifiers and data-dictionary mapping; PHI fields get field-level encryption (SEC-ENC-010) and minimum-necessary ABAC gating (SEC-AZN-004). |
| CMP-HIP-003 | PHI access logging satisfies accounting-of-disclosures: per-record access reports exportable per patient. |
| CMP-HIP-004 | PHI never sent to AI models without redaction policy evaluation (AIG-RED); tenant may hard-disable AI over PHI corpora. |
| CMP-HIP-005 | Breach-notification support: impacted-record identification queries answerable ≤ 24 h from detection using access telemetry. |

### GLBA (CMP-GLB)

| ID | Requirement |
|---|---|
| CMP-GLB-001 | Safeguards Rule mapping: designated-qualified-individual reporting pack, risk assessment artifacts, access reviews, encryption, MFA evidence bundled per FTC Safeguards elements. |
| CMP-GLB-002 | NPI (nonpublic personal information) classification and sharing controls; privacy-notice and opt-out records stored as consent evidence (CMP-CNS). |

### PCI DSS (CMP-PCI) — payments inside interactive documents

Design principle: **the platform stays out of the CDE wherever possible.**

| ID | Requirement |
|---|---|
| CMP-PCI-001 | Payment actions use tokenization and PCI-validated hosted fields/iframes from the tenant's PSP: PAN is entered into the PSP's origin, never transits or rests in Acorn. Target scope: SAQ-A-equivalent posture for the embedded flow. |
| CMP-PCI-002 | The viewer's payment component enforces: PSP iframe origin allowlist in CSP, no PAN-capable inputs in Acorn-controlled DOM, script integrity (SRI) on payment bootstrap, and PCI DSS 4.0 Req 6.4.3/11.6.1 script-inventory + change-detection on payment pages. |
| CMP-PCI-003 | Where a tenant mandates direct card handling (rare, T3/T4 only), that path is a segmented CDE micro-service with its own assessment scope, P2PE-style key handling, and quarterly ASV scanning; the rest of the platform remains out of scope. |
| CMP-PCI-004 | Only truncated PAN (first6/last4 max) and PSP tokens may appear in documents, receipts, logs, and archives; DLP rule blocks full PAN patterns at render and archive time **[GATE]**. |

### GDPR (CMP-GDP)

| ID | Requirement |
|---|---|
| CMP-GDP-001 | Lawful-basis registry per communication type (contract, legal obligation, legitimate interest, consent); each rendered communication records its lawful basis in metadata; marketing channels require consent evidence at send time **[GATE]**. |
| CMP-GDP-002 | DSR workbench: identity-verified access/portability/rectification/objection/erasure requests; discovery spans content stores, archives, indexes, AI retrieval corpora, and logs; SLA tracking to statutory deadlines. |
| CMP-GDP-003 | Erasure in event-sourced/WORM systems: personal data in immutable streams is encrypted per data subject; erasure = crypto-shredding of the subject key (SEC-ENC-009) + tombstone event; replays and projections yield redacted records. Legal-hold and retention-obligation conflicts surfaced to the DPO for documented resolution before shred. |
| CMP-GDP-004 | Cross-border transfer controls: residency pinning (CMP-RES), SCC/adequacy metadata per data flow, transfer-impact-assessment artifacts maintained per region pair. |
| CMP-GDP-005 | DPIA template auto-populated from platform data-flow inventory for tenant DPOs; records of processing (Art. 30) exportable. |

### CCPA/CPRA & POPIA (CMP-CPR / CMP-POP)

| ID | Requirement |
|---|---|
| CMP-CPR-001 | Consumer rights (know/delete/correct/opt-out of sale-share/limit SPI) mapped onto the same DSR workbench; "Do Not Sell/Share" signals (incl. GPC) recorded as preference evidence and enforced in delivery decisions. |
| CMP-CPR-002 | Service-provider contract terms reflected in processing flags: no secondary use of tenant personal information, verified by policy-as-code on data-flow configs. |
| CMP-POP-001 | POPIA pack: information-officer artifacts, cross-border transfer conditions (s72), operator agreements, and South Africa residency zone support. |

## 2.3 Data Residency (CMP-RES)

| ID | Requirement |
|---|---|
| CMP-RES-001 | Residency zones (e.g., US, EU, UK, CA, AU, ZA, in-country VPC) selectable per tenant and per brand/LOB; content, PII, archives, keys, backups, search indexes, and AI retrieval stores are pinned to the zone. |
| CMP-RES-002 | Processing residency: rendering and AI inference occur in-zone; model routing (AIG-MDL) refuses out-of-zone endpoints unless tenant explicitly whitelists with logged rationale. |
| CMP-RES-003 | Metadata minimization for global control plane: only pseudonymous operational metadata leaves the zone; documented field list published. |
| CMP-RES-004 | Residency attestations: per-tenant report proving storage/processing locations from infrastructure inventory, regenerated monthly. |

## 2.4 Retention, Legal Hold, WORM (CMP-RET)

| ID | Requirement |
|---|---|
| CMP-RET-001 | Retention schedules per communication class, jurisdiction, and pack (e.g., 7y GLBA, 6y HIPAA, 10y insurance-life); clock starts at delivery or account-closure per rule; schedules are versioned artifacts. |
| CMP-RET-002 | WORM archive: object-lock compliance mode for regulated archives (SEC 17a-4/FINRA-style option incl. designated-third-party access); deletion before expiry is technically impossible, not just forbidden. |
| CMP-RET-003 | Legal hold: hold placement freezes deletion and crypto-shred for matching scope across all stores incl. AI corpora; placement/release dual-control (SEC-AZN SoD); hold report lists every artifact under hold. |
| CMP-RET-004 | Defensible deletion: at expiry, deletion job produces a destruction certificate (scope, method — physical delete or crypto-shred, approver, hash-chain anchor). |
| CMP-RET-005 | Retention change control: shortening any schedule requires dual control + 7-day cooling period + tenant notification. |

## 2.5 Consent & Preference Evidence (CMP-CNS)

| ID | Requirement |
|---|---|
| CMP-CNS-001 | Consent/preference records are first-class evidence objects: who, what (channel, purpose, language shown, document version of the consent text), when, how captured, and revocation history — hash-chained like audit events. |
| CMP-CNS-002 | Delivery decisions record which consent version authorized the send; e-delivery consent (ESIGN/UETA) captured with the required disclosures and hardware/software capability confirmation. |
| CMP-CNS-003 | Preference changes propagate to in-flight batches before send where technically possible; otherwise the miss is logged with timing proof. |

## 2.6 Chain of Custody (CMP-COC)

Every communication is provably reconstructable end-to-end. The custody chain is a signed, hash-linked graph:

```
data snapshot ──► template version ──► content versions ──► AI involvement record
      │                                                            │
      ▼                                                            ▼
approval chain ──► render (engine ver + output hash) ──► delivery events
      ▼                                                            ▼
access events ──► interaction/action events ──► archive object ──► deletion certificate
```

| ID | Requirement |
|---|---|
| CMP-COC-001 | Data snapshot: the exact input record set (or its hash + retrievable snapshot) used for composition is preserved for the retention period. |
| CMP-COC-002 | Version pinning: template ID+version, every content-block version, compliance-pack versions, and rendering-engine version recorded per communication. |
| CMP-COC-003 | AI involvement: every AI-generated or AI-modified span is recorded with prompt version, model ID/version, input/output hashes, and reviewing human (links AIG-AUD). |
| CMP-COC-004 | Approval binding: the render hash is cryptographically bound to the approval records; any post-approval change invalidates the approval and blocks delivery **[GATE]**. |
| CMP-COC-005 | Continuity verification: nightly job re-validates hash links across a random sample + all new chains; breaks are Sev-1 compliance incidents. |

## 2.7 Proof Artifacts (CMP-PRF)

| ID | Artifact | Contents |
|---|---|---|
| CMP-PRF-001 | Proof of delivery | Channel, endpoint (masked), gateway/carrier receipts, timestamps, bounce/retry history, signed digest |
| CMP-PRF-002 | Proof of content | Byte-exact rendered artifact (or its hash + WORM copy), template/content/data versions |
| CMP-PRF-003 | Proof of approval | Approver identities, roles, SoD verification result, timestamps, disposition rationale, pack versions applied |
| CMP-PRF-004 | Proof of access | Verification method and result, session details, pages viewed, duration, downloads |
| CMP-PRF-005 | Proof of AI changes | Diff of AI-modified content, prompt/model versions, human reviewer, evaluation scores |
| CMP-PRF-006 | Proof of version | Full version lineage of every constituent artifact |
| CMP-PRF-007 | Proof of customer action | Payment/dispute/e-sign action payload hash, step-up verification, PSP/e-sign transaction references, timestamps |
| CMP-PRF-008 | Proof of deletion | Destruction certificate incl. crypto-shred key IDs and approvers |

All proofs are signed (SEC-ENC-011), hash-chain anchored (SEC-AUD-003), exportable individually or as packs, and verifiable offline with the shipped validator.

## 2.8 Regulator-Ready Evidence Packs (CMP-EVD)

| ID | Requirement |
|---|---|
| CMP-EVD-001 | One-click evidence pack per communication, per customer, per template, or per date range: assembles the full custody chain and relevant proofs into a signed, human-readable bundle (PDF index + machine-readable JSON) suitable for examiners (OCC/CFPB/state DOI/HHS OCR/DPAs). |
| CMP-EVD-002 | Audit-scope packs: control-level evidence (access reviews, key rotations, SoD reports, pack configuration history) generated for SOC 2/ISO/regulatory exams without engineering involvement. |
| CMP-EVD-003 | Auditor role access (read-only, time-boxed) to a dedicated evidence workspace; every auditor view is itself audited. |

## 2.9 Deployment-Model Responsibility Matrix (CMP-DEP)

Compliance obligations shift by deployment model; the matrix below is contract-referenced and shipped with each tenant's evidence workspace.

| Control domain | SaaS (T1/T2) | Dedicated (T3) | Customer VPC / hybrid (T4) |
|---|---|---|---|
| Physical/infra security | Acorn + cloud provider | Acorn + cloud provider | Customer |
| Platform patching | Acorn | Acorn | Shared: Acorn supplies signed releases, customer applies (or grants managed access) |
| Key custody | Acorn KMS / CMK / BYOK | CMK / BYOK standard | HYOK — customer exclusive |
| Network perimeter | Acorn | Acorn | Customer |
| IdP & user lifecycle | Customer (federated) | Customer | Customer |
| Compliance pack configuration | Customer (Tenant Admin) | Customer | Customer |
| Audit log custody | Acorn (streamed to customer SIEM) | Acorn + customer | Customer-resident |
| Breach notification to regulators | Customer (Acorn notifies customer) | Customer | Customer |

| ID | Requirement |
|---|---|
| CMP-DEP-001 | The responsibility matrix is a versioned contractual artifact; deviations are documented per tenant and reflected in that tenant's evidence packs. |
| CMP-DEP-002 | T4 deployments receive a self-assessment toolkit (control tests, audit-chain validator, residency attestation generator) so customer-side controls produce the same evidence formats. |

## 2.10 Compliance Regression Testing (CMP-TST)

| ID | Requirement |
|---|---|
| CMP-TST-001 | Every compliance pack ships executable tests (policy-as-code assertions + golden communications); tests run on pack upgrade, template change, and platform release **[GATE]** for affected tenants. |
| CMP-TST-002 | Synthetic regulated scenarios (e.g., adverse-action notice content rules, EOB fields, escrow statement timing) validated pre-release in a compliance staging tenant per industry. |
| CMP-TST-003 | Control drift detection: infrastructure and configuration continuously compared to declared control state; drift alerts to compliance dashboard with auto-ticket. |

---

# PART 3 — AI GOVERNANCE MODEL

## 3.1 Principles (AIG-PRN)

| ID | Principle |
|---|---|
| AIG-PRN-001 | **AI leaves fingerprints, receipts, and an audit trail.** No AI action is unattributable: every inference records prompt version, model, inputs/outputs (hashed, with retrievable copies per retention policy), and the human accountable. |
| AIG-PRN-002 | **No tenant data is used for model training by default.** Zero-retention/zero-training terms with model providers; any tuning on tenant data requires explicit tenant opt-in, scoped datasets, and a tenant-owned resulting adapter. |
| AIG-PRN-003 | **Humans own regulated outcomes.** AI proposes; accountable humans approve anything with regulatory or customer-impact weight (AIG-REV). |
| AIG-PRN-004 | **Untrusted by construction.** Document content, customer input, and retrieved data are data, never instructions (AIG-INJ). |
| AIG-PRN-005 | **Tenant isolation extends to AI.** Prompts, retrieval corpora, embeddings, fine-tunes, caches, and eval sets are tenant-partitioned with the same rigor as SEC-ISO. |

## 3.2 Prompt Governance (AIG-PRM)

| ID | Requirement |
|---|---|
| AIG-PRM-001 | Approved prompt library: production AI features execute only prompts from the tenant's approved library; ad-hoc prompts run only in sandbox against masked data. |
| AIG-PRM-002 | Prompt versioning: prompts are immutable versioned artifacts (semver), with diffable history, linked eval results, and rollback. |
| AIG-PRM-003 | Prompt approval workflow: draft → eval run (AIG-EVL) → security review (injection-resistance checks) → approver sign-off. **Prompt author ≠ prompt approver** (SoD, hard block). Approval records are proof artifacts. |
| AIG-PRM-004 | Prompt-to-feature binding: each prompt version is bound to specific features, models, and tenant scopes; using an approved prompt outside its binding is denied by policy **[GATE]**. |
| AIG-PRM-005 | Emergency prompt kill switch: any prompt version can be disabled tenant-wide or platform-wide in ≤ 5 min; dependent features degrade to non-AI fallbacks. |

## 3.3 Model Routing & Tenant Model Configuration (AIG-MDL)

| ID | Requirement |
|---|---|
| AIG-MDL-001 | Model gateway: all inference passes one gateway enforcing routing policy, redaction (AIG-RED), quotas, logging, and residency (CMP-RES-002). Direct model calls from services are blocked at the network layer. |
| AIG-MDL-002 | Tenant model registry: per tenant/LOB/feature, admins select from: platform-hosted private models, tenant BYO-model endpoints (their Azure OpenAI/Bedrock/Vertex/self-hosted), or approved public LLM APIs. Each entry carries data-handling terms, residency, and allowed data classifications. |
| AIG-MDL-003 | Classification-aware routing: `Restricted-PHI/PCI` content may only route to models whose registry entry permits it (typically tenant-private endpoints); violations blocked **[GATE]** and alerted. |
| AIG-MDL-004 | Model version pinning: production features pin model versions; provider silent upgrades detected via canary evals; version changes go through change control with regression evals (AIG-EVL-002). |
| AIG-MDL-005 | Model provenance: model artifacts (self-hosted weights, adapters) are checksummed and signed in the registry (SEC-SCM-005). |

## 3.4 Grounding & RAG (AIG-RAG)

| ID | Requirement |
|---|---|
| AIG-RAG-001 | Approved-content-only retrieval: RAG indexes contain only tenant-approved, in-effect content (published templates, approved knowledge articles, the specific communication's data). Draft, expired, or rejected content is excluded by index-build policy. |
| AIG-RAG-002 | Source citations: every generated answer carries citations to the specific retrieved chunks (document, version, section); the viewer renders citations to the customer; uncited assertions in regulated contexts are suppressed. |
| AIG-RAG-003 | Confidence scoring: retrieval and generation confidence computed per response; below-threshold responses trigger the uncertainty path (AIG-AST-003) instead of an answer. |
| AIG-RAG-004 | Index hygiene: corpus changes are versioned and audited; content un-approval propagates to index removal ≤ 15 min; per-tenant, per-classification index partitions with ABAC-filtered retrieval (a retrieval query can never return chunks the requesting principal couldn't read directly). |

## 3.5 Hallucination Detection & Human Review Gates (AIG-REV)

| ID | Requirement |
|---|---|
| AIG-REV-001 | Hallucination screens: groundedness checking (claim-to-source entailment), numeric/entity consistency checks against the data snapshot, and self-consistency sampling for high-stakes outputs; failures block auto-apply. |
| AIG-REV-002 | Review-tier policy is policy-as-code per tenant, with the following platform floor (tenants may tighten, never loosen): |

| AI output class | Examples | Gate |
|---|---|---|
| **Requires human approval — always** | Regulated content changes (disclosures, terms, rate/fee language); compliance dispositions ("this letter satisfies Reg E"); customer-facing generated text entering a communication; NBA/next-best-action recommendations affecting offers or adverse outcomes; any AI-suggested change to templates, prompts, or policies | Named approver per SoD; approval recorded as CMP-PRF-005 **[GATE]** |
| **Requires human approval — first N then sampled** | Summarizations inserted into agent-assist tools; translation of approved content (full approval until language-pair eval passes, then 10% sampling + full approval for regulated spans) | Sampling plan is a governed artifact |
| **May auto-apply** | Alt-text suggestions (still surfaced for author confirmation at publish), content tagging/metadata, search-index enrichment, reading-order hints, layout accessibility suggestions, internal draft assistance never shown to customers | Logged with AIG-AUD fingerprints; reversible; excluded from customer-facing render until a human-approved publish occurs |

| ID | Requirement |
|---|---|
| AIG-REV-003 | Reviewer competence binding: regulated-content approvals require the approver to hold the matching Compliance/Legal Approver role for that LOB, not merely any approver role. |
| AIG-REV-004 | Review queue SLAs and aging alerts prevent "auto-approve by fatigue"; bulk-approve is disabled for regulated classes. |

## 3.6 Customer-Facing Document Assistant — Hard Rules (AIG-AST)

These are non-configurable platform invariants for the embedded assistant.

| ID | Hard rule |
|---|---|
| AIG-AST-001 | **Answers only from**: (a) the specific document in session, (b) tenant-approved knowledge content, (c) customer-permitted context (their consented profile/preferences), (d) connected systems the tenant explicitly wired and the customer is authorized on. No open-world knowledge for factual claims about the customer's account, product terms, or regulated topics. |
| AIG-AST-002 | Session scope = document scope: the assistant's retrieval context is constructed from the verified viewer session (SEC-DOC-003); it cannot query beyond that customer's authorized records. |
| AIG-AST-003 | **Never guesses on regulated content**: when confidence is below threshold, the source is ambiguous, or the topic is on the tenant's regulated-topic list (fees, rates, coverage decisions, medical or legal interpretation, dispute rights), the assistant states its uncertainty in plain language and routes to a human channel (configured per tenant: secure message, phone, callback) — with conversation context handed off only with customer consent. |
| AIG-AST-004 | No advice boundaries: the assistant explains the document; it does not provide financial, legal, or medical advice; boundary phrasing is tenant-approved content, not model-generated. |
| AIG-AST-005 | **No cross-customer leakage, ever**: retrieval is filtered by the session principal before ranking; conversation memory is per-customer, per-tenant, encrypted under the tenant KEK, and excluded from any shared cache; prompts never contain another customer's data. Canary tests (SEC-ISO-003) cover the assistant path. |
| AIG-AST-006 | Per-tenant knowledge isolation: indexes, embeddings, fine-tunes, few-shot examples, and caches are tenant-partitioned; no global model memory of tenant conversations (AIG-PRN-002). |
| AIG-AST-007 | Identity honesty: the assistant always discloses it is AI, on first turn and on request; it never claims to be a human agent. |
| AIG-AST-008 | Action mediation: the assistant can only invoke the document's allow-listed embedded actions, each requiring the same step-up verification as clicking the action directly (SEC-DOC-004); it cannot synthesize new actions. |

## 3.7 Prompt-Injection Defenses (AIG-INJ)

| ID | Requirement |
|---|---|
| AIG-INJ-001 | Instruction/data separation: system and developer instructions travel in privileged message roles; document text, retrieved chunks, and user input are wrapped in typed data envelopes with integrity markers; templates never interpolate untrusted text into instruction roles. |
| AIG-INJ-002 | Input screening: injection classifiers and pattern screens run on document-derived text and user input before inclusion; flagged content is neutralized (quoted/summarized) or the turn is refused with logging. |
| AIG-INJ-003 | Output filtering: model outputs pass policy filters before display or action: allow-listed action schema validation, URL allowlisting (no model-authored links outside tenant domains), PII/PHI leak screens, and regulated-topic guards. |
| AIG-INJ-004 | Allow-listed actions only: the assistant/agent can only emit tool calls from the session's allow-list with schema-validated arguments; free-text-to-action is prohibited; high-impact arguments (amounts, payees) echoed to the customer for confirmation. |
| AIG-INJ-005 | Privilege inversion ban: content originating from a document can never raise the session's privileges, change routing/model selection, or alter system instructions; tested continuously by the injection red-team suite (AIG-EVL-003). |

## 3.8 MCP Security (AIG-MCP)

Applies to both platform-hosted MCP servers exposing Acorn capabilities and tenant-connected external MCP servers.

| ID | Requirement |
|---|---|
| AIG-MCP-001 | Tenant-isolated MCP servers: MCP endpoints are per-tenant instances (or hard tenant-scoped), mutually authenticated (OAuth 2.1 / mTLS), residency-pinned; no shared server holds multi-tenant credentials. |
| AIG-MCP-002 | Least privilege & allow-listed tools: each MCP client identity gets an explicit tool allow-list with scoped permissions (e.g., `communications.read` but not `send`); default tool set is empty; tool grants are change-controlled artifacts. |
| AIG-MCP-003 | Tool registry vetting: external MCP servers connect only after registry review (auth model, data handling, version pinning); tool descriptions are treated as untrusted input and diff-monitored for rug-pull changes. |
| AIG-MCP-004 | Human approval for sensitive actions: tool calls that send communications, execute payments/refunds, modify templates/prompts/policies, export bulk data, or touch retention/holds require an explicit human approval step with the exact call arguments displayed **[GATE]**. |
| AIG-MCP-005 | Full audit logging: every MCP call logs caller identity, tenant, tool, argument hash (full arguments per retention policy), result hash, policy decision, latency, and any human approval — into the hash-chained audit stream (SEC-AUD). |
| AIG-MCP-006 | Input/output validation: JSON-schema validation on all tool arguments and results; results sanitized before entering model context (injection screening per AIG-INJ-002); oversized/anomalous results truncated and flagged. |
| AIG-MCP-007 | Policy enforcement & budgets: the PDP (SEC-AZN-003) authorizes every call against tenant policy; per-session call budgets, rate limits, and circuit breakers stop runaway agent loops. |

## 3.9 AI Action Audit Trails & Content Provenance (AIG-AUD / AIG-PRV)

| ID | Requirement |
|---|---|
| AIG-AUD-001 | Every inference event records: tenant, feature, prompt version, model ID/version, redaction actions taken, input hash, output hash, retrieval citations, confidence scores, policy decisions, human reviewer (if gated), latency, and cost — appended to the tamper-evident audit chain. |
| AIG-AUD-002 | Conversation records for the customer assistant retained per tenant retention policy, retrievable in DSRs and evidence packs, and redacted consistently with the source-data redaction state. |
| AIG-PRV-001 | C2PA-style content credentials: AI-assisted artifacts (generated text spans, images, alt text, translations) carry signed provenance manifests — creator (model+version+prompt version), edits, reviewing human, timestamps — embedded where format allows (PDF/images) and stored alongside otherwise. |
| AIG-PRV-002 | Provenance survives the pipeline: render preserves provenance manifests into the archive object; evidence packs include the AI-provenance graph for any communication (feeds CMP-PRF-005). |
| AIG-PRV-003 | Fingerprinting: AI-generated spans are marked in the content model (not just metadata) so authors, approvers, and auditors see exactly which words are machine-produced. |

## 3.10 AI Evaluation Program (AIG-EVL)

| ID | Requirement |
|---|---|
| AIG-EVL-001 | Golden sets: per feature and per tenant vertical, curated input/expected-output sets incl. regulated edge cases; golden sets are versioned, access-controlled artifacts. |
| AIG-EVL-002 | Regression evals: run on every prompt version change, model version change, retrieval-corpus structural change, and platform release; scorecards (groundedness, accuracy, refusal-correctness, tone, citation fidelity) must meet thresholds to promote **[GATE]**. |
| AIG-EVL-003 | Red-teaming: scheduled adversarial testing — prompt injection (direct, indirect via documents, via MCP results), jailbreaks, data-exfiltration probes, cross-tenant probes; automated attack suite in CI plus human red team quarterly. |
| AIG-EVL-004 | Bias & fairness testing for NBA: next-best-action and content-variant models tested for disparate outcomes across protected classes using tenant-appropriate fairness metrics (e.g., adverse-impact ratio); results reviewed by the tenant's model-risk function; supports SR 11-7 style model-risk-management documentation. |
| AIG-EVL-005 | Production monitoring: drift detection on confidence distributions, refusal rates, citation coverage, and complaint signals; threshold breaches auto-open review tickets and can auto-downgrade features to human-only mode. |

## 3.11 Policy-as-Code for AI (AIG-POL)

| ID | Requirement |
|---|---|
| AIG-POL-001 | Every AI decision point (route model, include context, apply output, invoke tool, auto-apply vs review) queries the PDP with an OPA/Rego (or Cedar) policy bundle; policies are versioned, signed, tested (unit tests per rule), and deployed via change control. |
| AIG-POL-002 | Policy coverage test: CI verifies that no AI code path bypasses the PDP (static analysis + runtime assertion that every gateway call carries a policy-decision ID) **[GATE]**. |
| AIG-POL-003 | Tenant policy overlays: tenants author overlay policies (stricter only) in a validated DSL; effective-policy simulator lets Tenant Admins test before activation. |
| AIG-POL-004 | Decision logging: every policy decision (allow/deny/route/gate) is logged with policy version, feeding the same audit chain — an AI action is explainable as "this policy version made this decision on these attributes." |

## 3.12 Redaction & PII/PHI Protection in Prompts (AIG-RED)

| ID | Requirement |
|---|---|
| AIG-RED-001 | Pre-inference redaction pipeline at the model gateway: deterministic detectors (data-dictionary mapping, checksummed identifiers like PAN/SSN/IBAN/MRN) + statistical NER for free text; detected spans masked with format-preserving, referentially consistent tokens (`{{PERSON_1}}`, `{{ACCT_1}}`) before any model call. |
| AIG-RED-002 | Rehydration only client-side of the trust boundary: token-to-value maps never leave the platform; model outputs are rehydrated after output filtering (AIG-INJ-003). |
| AIG-RED-003 | Classification-driven strictness: `Restricted-PHI/PCI` contexts use deny-by-default field allowlists (only fields explicitly needed for the feature enter the prompt, post-mask); PAN is never present even masked (token reference only, CMP-PCI-004). |
| AIG-RED-004 | Redaction efficacy testing: seeded-leak test corpus run nightly; recall threshold ≥ 99.5% on structured identifiers; misses are Sev-2 with detector retraining loop. |
| AIG-RED-005 | Redaction events logged (what classes masked, counts, detector versions) into AIG-AUD-001 records — provable "what the model saw." |

---

# PART 4 — ACCESSIBILITY MODEL

## 4.1 Standards Baseline (ACC-STD)

| ID | Requirement |
|---|---|
| ACC-STD-001 | **WCAG 2.2 Level AA is the product baseline** for all authoring UIs, the interactive viewer, HTML communications, and the assistant UI. WCAG 2.1 AA evidence packs are generated where a regulation cites 2.1 specifically (e.g., DOJ ADA Title II web rule for state/local government tenants) — 2.2 AA conformance strictly contains 2.1 AA, so evidence is a filtered view. |
| ACC-STD-002 | PDF/UA-1 (ISO 14289-1) conformance for archival and delivered PDFs where the tenant enables tagged output; PDF/UA + PDF/A-2a combined profile for accessible archives. |
| ACC-STD-003 | Section 508 (which incorporates WCAG 2.0 AA) and EN 301 549 mappings maintained; ACR/VPAT (ITI 2.5 format) published per release for the platform UIs and for generated-output capabilities. |
| ACC-STD-004 | ADA alignment: accessibility conformance treated as a compliance pack (`ACC` pack) so gates, evidence, and regression testing reuse the CMP machinery. |
| ACC-STD-005 | Accessibility is a shared deliverable: platform guarantees capability + enforcement; tenant templates carry per-template conformance status visible in the catalog. |

## 4.2 Authoring-Time Checks in the Designer (ACC-AUTH)

Checks run continuously in the designer (inline linting) and as a full audit at submit-for-approval.

| ID | Check | Behavior |
|---|---|---|
| ACC-AUTH-001 | Semantic headings | Heading levels present, hierarchical (no skips), map to document outline | Error |
| ACC-AUTH-002 | Reading order | Logical order matches visual order across layout regions incl. multi-column and floated elements; drag-reorder tool provided | Error |
| ACC-AUTH-003 | Color contrast | Text ≥ 4.5:1 (3:1 large), non-text UI ≥ 3:1; checked against brand palette + data-driven backgrounds; simulated for common CVD types | Error |
| ACC-AUTH-004 | Alt text | Required for informative images/charts; decorative images must be explicitly marked artifact; AI-suggested alt text available but author-confirmed (AIG-REV auto-apply class) | Error if missing |
| ACC-AUTH-005 | Table headers | Data tables require header cells with scope/IDs; complex tables require explicit header association; layout tables prohibited (use layout regions) | Error |
| ACC-AUTH-006 | Language tags | Document language required; inline language changes tagged (drives multilingual, ACC-ML) | Error |
| ACC-AUTH-007 | Focus order | Interactive elements' tab order matches reading order; focus visible styles enforced by the component library (WCAG 2.4.11/2.4.13-aware) | Error |
| ACC-AUTH-008 | Touch targets | Interactive targets ≥ 24×24 CSS px (WCAG 2.5.8) with spacing exception logic | Error |
| ACC-AUTH-009 | Accessible forms | Programmatic labels, instructions, required-field indication not by color alone, error identification + suggestion text (3.3.1/3.3.3), no timing-only validation, redundant-entry avoidance (3.3.7) | Error |
| ACC-AUTH-010 | Accessible authentication | Document verification flows (SEC-DOC-002) must offer a method without cognitive function tests (WCAG 3.3.8): OTP paste allowed, passkeys offered; CAPTCHA alternatives required | Error (platform-level) |
| ACC-AUTH-011 | Link purpose & names | Descriptive link/button text; embedded-action names unique in context | Warning→Error at publish |
| ACC-AUTH-012 | Sensory & motion | No color/shape-only meaning; no auto-playing motion > 5 s without pause; flashing content blocked outright | Error |
| ACC-AUTH-013 | Text spacing & reflow tolerance | Templates validated to survive 200% text spacing and 320 px reflow without loss (1.4.10/1.4.12) | Error for HTML outputs |

## 4.3 Render-Time Enforcement (ACC-RND)

| ID | Requirement |
|---|---|
| ACC-RND-001 | Tagged PDF generation: renderer emits fully tagged PDFs (structure tree, role map, artifacts, alt text, table structure, Unicode mappings, tab order = structure order) from the designer's semantic model — accessibility is generated, not retrofitted. Output validated against PDF/UA machine-checkable rules (veraPDF-class validator) per render batch (sampled) and per template version (exhaustive). |
| ACC-RND-002 | ARIA in HTML5 documents: interactive documents render with native-semantics-first markup, correct ARIA only where required, landmark regions, live regions for dynamic updates (payment status, assistant responses), and accessible names for all embedded actions. |
| ACC-RND-003 | Channel-appropriate degradation: email HTML uses table-linearization-safe structure with role hints; SMS/voice channels get purpose-built accessible variants, never lossy auto-conversions. |
| ACC-RND-004 | Data-driven content safety: variable data injected at render is re-checked for contrast (dynamic backgrounds), overflow/clipping at 200% zoom, and generated-table header integrity — per-render sampled, per-template exhaustive on version change. |

## 4.4 Remediation: Automated + Guided (ACC-REM)

| ID | Requirement |
|---|---|
| ACC-REM-001 | Auto-remediation where safe (mechanical, meaning-preserving): tagging artifacts as decorative when policy-matched, fixing heading-level skips by outline recomputation, adding language tags from detected locale, normalizing focus order to reading order, generating table header scope from structure. All auto-fixes are logged, diffable, and reversible. |
| ACC-REM-002 | Guided manual remediation where judgment is required: alt-text meaning, reading order across ambiguous layouts, complex-table restructuring, color choices vs brand — the designer presents the failing element, the rule, examples, and (where enabled) an AI suggestion routed through the AIG-REV auto-apply-with-confirmation class. |
| ACC-REM-003 | Ingested-document remediation: legacy PDFs/print streams entering the archive can pass a remediation pipeline (auto-tagging + human review queue); remediation status tracked per artifact; unremediated legacy artifacts are labeled and reportable. |

## 4.5 Publication Gates (ACC-GTE) **[GATE]**

| ID | Requirement |
|---|---|
| ACC-GTE-001 | **Block-on-fail**: templates cannot be published, and communications cannot be approved for delivery, while any *required* rule (Error class above, per the tenant's ACC pack) fails. The gate result (rules run, versions, pass/fail per rule) is recorded in the approval chain (CMP-COC-004). |
| ACC-GTE-002 | Rule tiers are pack-governed: the platform floor makes WCAG 2.2 AA-mapped rules required for customer-facing outputs; tenants may add AAA-mapped rules; weakening below floor requires the dual-control exception path with logged business justification and expiry. |
| ACC-GTE-003 | Emergency-send exception: operational emergencies (outage notices) may bypass non-safety gates via dual-control override; the debt is auto-ticketed with a remediation SLA. |

## 4.6 Interactive Viewer Accessibility Layer (ACC-VWR)

The viewer embeds the **Acorn.Access widget** (this repository's component) as its user-facing accessibility layer, on top of — never instead of — semantically correct rendering.

| ID | Capability | Requirement |
|---|---|---|
| ACC-VWR-001 | Contrast modes | User-selectable high-contrast and inverted themes recomputed from the semantic model (not CSS-filter hacks); document brand colors remapped within contrast-safe ranges; persists per recipient. |
| ACC-VWR-002 | Text scaling | 100–400% text scaling with reflow (no horizontal scroll, no clipped content), independent of browser zoom. |
| ACC-VWR-003 | Dyslexia-friendly fonts | Font substitution (incl. spacing/line-height adjustments) without breaking layout or pagination integrity of the underlying legal document (the archived original is unchanged; the adaptation is a view). |
| ACC-VWR-004 | Read-aloud | Server- or client-TTS reading with sentence highlighting, speed control, and correct pronunciation from language tags (ACC-AUTH-006); numbers/amounts read in locale-correct form. |
| ACC-VWR-005 | Reading mask & focus aids | Reading ruler/mask, paragraph focus mode, reduced-motion mode honoring `prefers-reduced-motion`. |
| ACC-VWR-006 | Keyboard navigation | Full functionality keyboard-only: skip links, landmark navigation, roving focus in complex widgets, no keyboard traps, visible focus (2.4.11), dragging alternatives (2.5.7). |
| ACC-VWR-007 | Screen-reader compatibility | Tested matrix: JAWS+Chrome/Edge, NVDA+Firefox/Chrome, VoiceOver+Safari (macOS/iOS), TalkBack+Chrome (Android); assistant chat announces turns via live regions; embedded actions fully operable. |
| ACC-VWR-008 | Widget settings portability | Accessibility preferences stored (with consent) against the recipient profile and applied across that tenant's communications; exposed to tenant portals via API. |
| ACC-VWR-009 | Assistant as accessibility feature | The document assistant supports plain-language explanation ("explain this section simply") governed by AIG-AST rules — outputs are marked as AI explanations, not document content. |

## 4.7 Accessible Media (ACC-MED)

| ID | Requirement |
|---|---|
| ACC-MED-001 | Captions required for all video in communications (accuracy-reviewed, not raw ASR, for regulated content); caption files versioned with the media asset. |
| ACC-MED-002 | Transcripts required for audio and video; transcripts are indexed content (searchable, assistant-retrievable under AIG-RAG rules). |
| ACC-MED-003 | Audio description tracks (or described versions) required where video conveys visual-only information; publication gate checks media accessibility metadata **[GATE]** when media is present. |
| ACC-MED-004 | Media player in viewer meets keyboard/screen-reader requirements; no auto-play with sound. |

## 4.8 Audit Reports & Regression Testing (ACC-AUD)

| ID | Requirement |
|---|---|
| ACC-AUD-001 | Per-template-version accessibility audit report: rules executed, results, remediation history, standard mappings (WCAG 2.2/2.1, PDF/UA, EN 301 549), stored as a signed evidence artifact and included in evidence packs (CMP-EVD). |
| ACC-AUD-002 | Regression testing per template version: publishing a new version re-runs the full audit and diffs conformance vs the prior version; regressions block publish (ACC-GTE-001) and notify the template owner. |
| ACC-AUD-003 | Platform regression: automated accessibility tests (axe-core-class + custom PDF/UA checks) in CI for viewer/designer/widget on every build **[GATE]**; manual assistive-technology test cycle each minor release; annual third-party accessibility audit with published summary. |
| ACC-AUD-004 | Live monitoring: sampled production renders re-audited continuously; recipient-reported accessibility issues get a tracked SLA and feed rule improvements. |
| ACC-AUD-005 | 2.1-AA evidence packs on demand: filtered conformance reports for regulations citing WCAG 2.1 (DOJ Title II, current Section 508/EN baselines) generated from the same audit data (ACC-STD-001). |

## 4.9 Multilingual Accessibility (ACC-ML)

| ID | Requirement |
|---|---|
| ACC-ML-001 | Per-language audits: every language variant of a template is audited independently — text expansion can break contrast/overflow/touch targets; the gate applies per language **[GATE]**. |
| ACC-ML-002 | Language tagging correctness: primary and inline language tags validated against the actual content language (detector cross-check) so screen readers switch voices correctly. |
| ACC-ML-003 | RTL and complex scripts: bidirectional layout correctness (logical order preserved), CJK line-breaking, and font fallback with glyph-coverage validation per script. |
| ACC-ML-004 | Localized accessibility assets: alt text, captions, transcripts, error messages, and the Acorn.Access widget UI itself localized per supported language; machine-translated accessibility text follows the AIG-REV translation gate. |
| ACC-ML-005 | Locale-aware read-aloud and formatting: dates, currency, and numbers rendered and voiced per locale conventions. |

---

## Appendix A — Gate Summary (controls that block)

| Gate | Blocks | Control(s) |
|---|---|---|
| SoD hard blocks | Approval/publication by conflicted identity | SEC-AZN SoD matrix, AIG-PRM-003 |
| RLS coverage linter | Schema deploy | SEC-ISO-002 |
| Parser-config tests, SAST/DAST/IaC, secret scan, SCA, image signing | Build/release | SEC-APP-002/007/009, SEC-SCR-001, SEC-SCM-001/003 |
| Approval–render hash binding | Delivery of altered content | CMP-COC-004 |
| Consent-at-send, PAN DLP | Delivery | CMP-GDP-001, CMP-PCI-004 |
| Compliance pack regression tests | Pack/template/platform promotion | CMP-TST-001 |
| Prompt binding, classification routing, eval thresholds, PDP coverage | AI feature promotion/execution | AIG-PRM-004, AIG-MDL-003, AIG-EVL-002, AIG-POL-002 |
| MCP human-approval gate | Sensitive agent actions | AIG-MCP-004 |
| Accessibility block-on-fail | Template publish / communication approval, per language, incl. media | ACC-GTE-001, ACC-MED-003, ACC-ML-001, ACC-AUD-003 |

*End of document.*
