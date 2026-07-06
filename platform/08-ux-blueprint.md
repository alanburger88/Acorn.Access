# Acorn Communicate — UI/UX Blueprint & Design System Plan

> **Document 08 · Platform Series** · Owner: Product Design · Status: Build-ready
> North star: *"A premium design tool and an enterprise control tower had a very responsible child."*
> Fast, beautiful, WCAG 2.2 AA, keyboard-first, multi-tenant, AI-native — human always in control.

---

## 1. Experience Principles

These six principles are decision-making tools, not posters. Every design review scores against them.

| # | Principle | What it means in practice | Test we apply |
|---|-----------|---------------------------|---------------|
| P1 | **Speed is a feature** | Optimistic UI, skeletons never spinners, sub-100ms input response, prefetch on hover/focus, canvas at 60fps. Perceived speed budgets are in CI (§8). | "Did the user ever wait without knowing why?" |
| P2 | **Progressive disclosure by persona** | Everyone sees a simple surface first; power reveals itself. A business author sees "Insert personalization"; a developer sees the same field's Liquid expression one toggle away. Role shapes defaults, never walls off learning. | "Can a novice complete the task without reading docs? Can an expert do it in half the clicks?" |
| P3 | **AI copilot everywhere, human always in control** | AI proposes, humans dispose. Every AI action is a reviewable diff with accept/reject/edit. No silent mutation, ever. Provenance and confidence always visible (§5). | "Can I point at any pixel and say who/what put it there?" |
| P4 | **Governance visible, not obstructive** | Compliance state is ambient (badges, chips, gutters) rather than modal. Approval requirements appear as a progress rail, not a surprise rejection at publish time. Policy checks run continuously while editing. | "Did governance interrupt flow, or ride alongside it?" |
| P5 | **Accessibility-first** | WCAG 2.2 AA is the floor for the platform *and* a product feature for our customers' documents (Accessibility Checker + Acorn.Access widget). Accessibility findings are shown with the same prominence as compliance findings. | "Does it work with keyboard only, screen reader, 200% zoom, and forced-colors mode?" |
| P6 | **Keyboard-first, command palette at the center** | ⌘K reaches every noun and verb in the product. Every mouse action has a keyboard path; shortcuts are discoverable inline (tooltips show keys) and in a `?` overlay. | "Unplug the mouse. Ship the same demo." |

**Tone of voice:** confident, plain, never cute during high-stakes moments (approvals, sends, deletions). Microcopy states consequences: "Send to 128,442 customers" — never "Blast it! 🚀".

---

## 2. Information Architecture

### 2.1 Global shell

Every workspace lives inside one persistent shell. The shell is the contract of familiarity across personas.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◧ Acorn  [Tenant ▾ / Workspace ▾ / Brand ▾]   ⌕ Search…   ⌘K   ✦AI   ⚑3   👤  │  Top bar (56px)
├──────────┬─────────────────────────────────────────────────────┬───────────────┤
│          │                                                     │               │
│  Left    │              Surface (routed content)               │  AI Copilot   │
│  nav     │                                                     │  panel        │
│  (per    │                                                     │  (⌘.)         │
│  work-   │                                                     │  collapsible  │
│  space,  │                                                     │  360px        │
│  240px,  │                                                     │               │
│  ⌘\ to   │                                                     │               │
│  rail)   │                                                     │               │
├──────────┴─────────────────────────────────────────────────────┴───────────────┤
│ Status strip: environment (Prod/Sandbox) · tenant health · background jobs      │
└────────────────────────────────────────────────────────────────────────────────┘
```

Top-bar elements, left to right:

1. **Tenant / Workspace / Brand switcher** — cascading combobox. Tenant is the isolation boundary; workspace is the persona-shaped view; brand scopes theming and assets. Switch is instant (route-preserving where the target has an equivalent surface). Sandbox tenants get a persistent amber environment ribbon.
2. **Global search (`/`)** — federated across content, templates, journeys, customers, docs. Results grouped by object type with keyboard navigation; recent + pinned items first.
3. **Command palette (`⌘K`)** — verbs and nouns: "Create template", "Compare v12↔v14", "Open customer 88291", "Toggle dark preview", "Assign approval to Legal". Context-aware: inside Template Designer it surfaces canvas commands first. Fuzzy match, sub-50ms.
4. **AI copilot toggle (`⌘.`)** — opens/closes right panel; badge shows pending AI proposals awaiting review.
5. **Notifications & Approval Inbox flag** — one combined tray; approvals are first-class with SLA countdown chips ("2 approvals due in 4h").
6. **Avatar menu** — profile, theme (light/dark/system), density (comfortable/compact), accessibility preferences, keyboard shortcuts (`?`), sign out.

### 2.2 Full sitemap of surfaces

```
Acorn Communicate
├── Home Dashboard                      (persona-adaptive, /home)
├── Create
│   ├── Content Library                 (/content — blocks, snippets, assets, translations)
│   ├── Template Designer               (/templates/:id/design — flagship §4a)
│   ├── Template Marketplace            (/marketplace/templates)
│   └── Prompt Management               (/ai/prompts — versioned prompt registry)
├── Orchestrate
│   ├── Journey Canvas                  (/journeys/:id — flagship §4b)
│   ├── Rules Builder                   (/rules — decisioning, NBA policies, eligibility)
│   └── Data Mapper                     (/data/contracts — schemas, mappings, sample payloads)
├── Govern
│   ├── Approval Inbox                  (/approvals — flagship §4c)
│   ├── Version Comparison              (/compare/:a/:b — flagship §4c)
│   ├── Accessibility Checker           (/govern/a11y — per-template & fleet-wide)
│   ├── Compliance Evidence Center      (/govern/evidence — proofs, attestations, exports)
│   └── AI Governance Center            (/govern/ai — model registry, guardrails, eval runs)
├── Operate
│   ├── Delivery Monitor                (/operate/delivery — real-time pipeline)
│   ├── SLA Dashboard                   (/operate/sla)
│   ├── Cost Dashboard                  (/operate/cost — channel + AI token spend)
│   └── Archive Search                  (/archive — WORM store query)
├── Understand
│   ├── Analytics Workbench             (/analytics — flagship §4d)
│   └── Customer Timeline               (/customers/:id — flagship §4e)
├── Extend
│   ├── Developer Portal                (/dev — APIs, keys, webhooks, SDKs, event explorer)
│   └── Integration Marketplace         (/marketplace/integrations)
└── Administer
    └── Admin / Tenant Settings         (/admin — users, roles, brands, domains, retention,
                                          security, billing, feature flags)
```

Routing rules: object URLs are stable and shareable across workspaces (deep link to a template opens it in the viewer's own workspace chrome with permissions applied). Every list surface supports saved views (filter+sort+columns persisted, shareable per team).

### 2.2.1 Surface ownership map

| Surface | Primary personas | Core objects | Notable cross-links |
|---|---|---|---|
| Home Dashboard | all | persona widgets | everything (drill-through) |
| Content Library | author, designer | blocks, snippets, assets, translations | Template Designer (insert), Approvals |
| Template Designer | designer, author | templates, versions, data contracts | Data Mapper, Accessibility Checker, Compare |
| Journey Canvas | designer, operator | journeys, nodes, runs | Templates, Rules Builder, Analytics |
| Rules Builder | designer, developer | decision tables, NBA policies | Journey NBA nodes, Data Mapper |
| Data Mapper | developer, designer | contracts, schemas, mappings | Designer bindings, Developer Portal |
| Approval Inbox / Compare | compliance | approval items, versions, decisions | Evidence Center, AI Governance |
| Accessibility Checker | designer, compliance | findings, WCAG criteria | Designer (jump-to-element) |
| Compliance Evidence Center | compliance, admin | proofs, attestations, exports | Archive, Approvals, Timeline |
| AI Governance Center | compliance, admin | models, guardrails, eval runs | Prompt Management, audit log |
| Prompt Management | developer, compliance | prompts, versions, evals | Copilot provenance cards |
| Delivery Monitor | operator | deliveries, queues, incidents | Timeline, SLA Dashboard |
| SLA / Cost Dashboards | operator, executive | SLOs, spend | Delivery Monitor, AI Governance |
| Archive Search | compliance, agent | immutable records | Timeline reproduce view |
| Analytics Workbench | all analytical roles | funnels, heatmaps, cohorts, experiments | Templates, Journeys, Timeline |
| Customer Timeline | agent, operator | customers, events, cases | Archive, Journeys, Delivery Monitor |
| Marketplaces (Template / Integration) | designer / developer, admin | listings, installs | Designer, Developer Portal |
| Developer Portal | developer | keys, webhooks, event explorer | Data Mapper, Delivery Monitor |
| Admin / Tenant Settings | admin | users, roles, brands, domains, retention | Theme builder (§7.3), AI kill-switch |

### 2.3 Left nav model

The left nav renders a **persona-shaped subset** of the sitemap (see §3). It is configurable per role by admins but ships with strong defaults. Sections collapse; nav collapses to a 56px icon rail (`⌘\`). Current object context (e.g., the open template) pins a contextual sub-nav: Design · Data · Logic · Previews · Versions · Approvals · Analytics.

---

## 3. Persona-Based Workspaces

Feature visibility is **role-based and layered**: (1) license/entitlement → (2) tenant policy → (3) role → (4) user preference. Hidden ≠ forbidden alone — the API enforces; the UI removes noise. Users with multiple roles switch workspaces via the top-bar switcher; "All surfaces" mode exists for admins.

| Persona | Home view (what loads at /home) | Primary tasks | Left nav (default order) |
|---|---|---|---|
| **Business author** | "My work" — drafts, awaiting-my-changes, recently returned from approval; "Start from" gallery of approved templates; AI prompt bar: "Describe the communication you need…" | Author content in approved templates, request approvals, localize, schedule sends | Home · Content Library · Templates (locked regions greyed) · Approval status · Analytics (own content) |
| **Template designer** | Design pipeline board (draft → review → approved), component library health, brand-consistency alerts, marketplace picks | Build templates, define data bindings & conditional logic, maintain shared components, multi-brand variants | Home · Template Designer · Content Library · Data Mapper · Accessibility Checker · Marketplace |
| **Compliance approver** | Approval Inbox front and center with SLA countdowns; "what AI touched this week" digest; policy-violation trends | Review diffs, approve/reject with reasons, manage policies, export evidence | Approval Inbox · Version Comparison · Compliance Evidence Center · AI Governance · Archive Search |
| **Operator (ops)** | Wallboard: delivery throughput, error rates, queue depth, channel health, active incidents; SLA burn-down | Monitor deliveries, triage failures, retry/reroute, manage suppression lists, capacity | Delivery Monitor · SLA Dashboard · Cost Dashboard · Journey Canvas (run view) · Archive Search |
| **Developer** | API traffic sparklines, webhook failure feed, sandbox status, changelog; "Try it" console | Integrate APIs/SDKs, manage keys & webhooks, test data contracts, debug event streams | Developer Portal · Data Mapper · Integration Marketplace · Delivery Monitor (technical view) · Prompt Management |
| **Executive** | KPI canvas: engagement, outcome attainment vs. declared intents, cost per communication, compliance posture score, AI adoption; drill-through everywhere | Consume rollups, drill into anomalies, export board decks | Home (KPIs) · Analytics Workbench (read) · Cost Dashboard · SLA Dashboard · Compliance posture |
| **Customer-service agent** | Customer lookup omnibox as hero; "recent customers I viewed"; open escalations from document assistants | Find a customer, see exactly what they received, re-send/regenerate, resolve disputes, take actions on their behalf (audited) | Customer Timeline · Archive Search · Delivery Monitor (per-customer) · Knowledge/FAQ |
| **Administrator** | Tenant health, user/role changes feed, security posture, pending access requests | Manage users/roles/brands/domains, retention, SSO, feature flags | Admin Settings · all Govern surfaces · Cost Dashboard |

Progressive disclosure examples (P2):

- **Business author in Template Designer** opens templates in *content mode*: only editable regions are active; structure is locked and visually quieted. A "designer mode" toggle appears only with the designer role.
- **Data Mapper** shows business users friendly field names and sample values; developers flip to schema/JSONPath view with the same toggle position every time.
- **Executive analytics** default to curated boards; the full Workbench query builder is one "Open in Workbench" away, permission permitting.

### 3.1 Role-based feature visibility matrix (shipping defaults)

`E` = edit/full · `R` = read · `A` = act (operate without structural edit) · `–` = hidden. Admins can tune per tenant; the matrix is stored as policy, and the UI renders from it (no hardcoded role checks in components).

| Surface | Author | Designer | Compliance | Operator | Developer | Executive | CS Agent | Admin |
|---|---|---|---|---|---|---|---|---|
| Content Library | E | E | R | – | R | – | R | E |
| Template Designer | E (content mode) | E (full) | R + annotate | R | R (bindings) | – | – | R |
| Journey Canvas | R | E | R + annotate | A (pause/retry) | R | R (overlay) | – | R |
| Rules Builder / Data Mapper | R (friendly view) | E | R | R | E | – | – | R |
| Approval Inbox / Compare | R (own items) | R (own items) | E | – | – | – | – | R |
| Accessibility Checker | R | E | E | – | – | R (score) | – | R |
| Evidence / AI Governance | – | – | E | R | R | R (posture) | – | E |
| Delivery Monitor / SLA / Cost | – | – | R | E | R | R | R (per-customer) | R |
| Archive Search | – | – | E | R | – | – | R (scoped) | E |
| Analytics Workbench | R (own) | R (own) | R | R | R | R (boards) | – | R |
| Customer Timeline | – | – | R | R | R (debug view) | – | E (agent tools) | R |
| Developer Portal / Integrations | – | – | R | R | E | – | – | E |
| Prompt Management | – | R | E (approve) | – | E | – | – | E |
| Admin Settings | – | – | – | – | – | – | – | E |

Two UX rules keep this honest: (1) **no dead ends** — if a cross-link points to a hidden surface, the user sees a scoped read-only peek or an "request access" card, never a 403 wall; (2) **same gesture, different depth** — a toggle that reveals advanced view sits in the same position on every surface, so growing into a bigger role never means relearning the product.

---

## 4. Flagship Surface Deep-Dives

### 4a. Template Designer

The crown jewel. Figma-grade feel, enterprise-grade guardrails.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ Templates / Q3 Statement  [v14 · Draft]  ●Autosaved  [Preview ▾][Share][✓Submit]│
├───────────┬──────────────────────────────────────────────┬───────────────────┤
│ LEFT RAIL │                 CANVAS                       │   RIGHT PANEL     │
│ ◫ Insert  │  ┌───── channel frame: Email 600px ─────┐    │ ▸ Inspector       │
│ ≡ Layers  │  │  [Header block]                      │    │   (props of sel.) │
│ ⛁ Data    │  │  [Hero: {{customer.firstName}}…]     │    │ ▸ Data binding    │
│ ⑂ Logic   │  │  [Conditional: if balance > 0]  ⚠    │    │ ▸ Conditional     │
│ ✓ Checks  │  │  [Action row: Pay | Dispute]         │    │   logic builder   │
│           │  └──────────────────────────────────────┘    │ ▸ Accessibility   │
│           │  Preview bar: [Email|SMS|Web|PDF|Push]       │ ✦ AI assistant    │
│           │  [Desktop|Mobile] [Light|Dark] [EN|ES|DE ▾]  │   (dockable)      │
│           │  [A11y sim: contrast/zoom/screen-reader]     │                   │
└───────────┴──────────────────────────────────────────────┴───────────────────┘
```

**Layout regions**

- **Left rail (tabbed):** *Insert* (component palette, searchable, drag or `⌘I`-to-insert-at-selection), *Layers* (tree of the document; drag to reorder, `⌥`-drag duplicates; lock/hide per layer; locked regions shown with a shield for content-mode users), *Data* (the template's **data contract**: required/optional fields, types, sample payload switcher), *Logic* (all conditional rules in one list, click to focus the bound block), *Checks* (live accessibility + compliance findings with jump-to-element).
- **Canvas:** channel-true frames (email 600px, SMS bubble, web responsive, PDF page, push card). Smart guides, snap-to-grid (4px), rulers, marquee select, multi-select alignment tools. Zoom 25–400% (`⌘+/-/0`), pan with space-drag. Rendering is the *actual production renderer* in draft mode — WYSIWYG is honest.
- **Right panel:** context-sensitive Inspector (typography, spacing, color from brand tokens only — raw hex requires "detach from brand" with a warning chip), Data binding, Conditional logic, per-element Accessibility (alt text, heading level, reading order), and the AI assistant dock.

**Data binding panel** — bound to the template's data contract:

- Drag a field from the Data tab onto text → inserts a personalization token rendered as a pill (`{{customer.firstName}}` shows as `⛁ First name`). Pills are atomic: selectable, deletable, but not corruptible by typing.
- Every pill shows resolved sample value inline when a sample payload is selected; missing/undeclared fields flag the pill red and add a Checks finding ("Field not in contract — add to contract or remove").
- Fallback editor per binding: default value, format mask (currency, date, locale-aware), transform (title case, truncate).
- Contract changes (from Data Mapper) surface as a non-blocking banner: "Contract v7 renames `acct_bal` → `balance`. Review 3 affected bindings."

**Conditional logic builder**

- Visual rule rows: `WHEN [field] [operator] [value] → SHOW/HIDE/SWAP [block]` with AND/OR grouping; advanced users flip to expression view (same toggle position as everywhere, P2).
- Canvas indicates conditional blocks with a dashed left border + branch chip ("shown when balance > 0"). Preview bar gains a **scenario switcher**: pick sample payloads ("High balance", "Delinquent", "New customer") and watch the canvas re-resolve live.
- Unreachable/contradictory rules produce Checks findings with a one-click "Explain" (AI-generated plain-language description of the rule's effective behavior, cited to the rule ids).

**Preview switcher** (persistent bar under canvas): channel × device × light/dark × locale × accessibility simulation (grayscale, low-vision blur, screen-reader outline view showing landmarks/heading order/tab sequence). Any combination is one keystroke cycle: `1–5` channels, `D` device, `⇧D` dark mode, `L` locale, `⇧A` a11y sim. Side-by-side compare: pin up to 2 previews (`⇧P`).

**Embedded AI design assistant** (dock in right panel, also inline via `⌘.` or selecting content and pressing `✦`):

| Capability | Interaction |
|---|---|
| Draft from prompt | "Create a payment reminder for the Retail brand, friendly tone, ES + EN" → generates into a **staging layer** overlaying the canvas at 60% opacity with a diff drawer listing every proposed block. Accept all / per-block / reject. Nothing touches the document until accepted. |
| Convert PDF → template | Drop a PDF; AI proposes structure (blocks, detected data fields with contract-mapping suggestions, extracted styles mapped to nearest brand tokens). Review screen is a side-by-side: source page ↔ proposed blocks, with confidence per region; low-confidence regions default to *unchecked*. |
| Improve readability | Selected text or whole doc → tracked-changes view (insertions green underline, deletions red strikethrough) with reading-grade-level before/after meter. Accept per sentence. |
| Flag compliance risks | Continuous background scan → findings in Checks tab with policy citation ("Policy FIN-12: APR must accompany rate mentions") and a proposed fix as a diff. |
| Generate alt text | Per image or bulk; proposals appear in the Accessibility panel with the image thumbnail; marked "AI-suggested" until a human confirms (confirmation is required to clear the a11y finding). |

All assistant output follows the global **suggestion → diff → accept** pattern (§5) and stamps the audit note automatically.

**States:**

| State | Behavior |
|---|---|
| Saving | Autosave every 2s, debounced; visible "Saved · just now" in title bar; never blocks input. |
| Offline | Banner + local mutation queue; canvas stays editable; queue replays on reconnect with conflict summary if needed. |
| Multiplayer | Live cursors + selection halos per collaborator; content-mode editors lock at region granularity; designer-mode structural edits use last-writer-wins with change toasts. |
| Versioning | Checkpoints on submit and every 30 min; named checkpoints via `⌘⇧S`; restore opens Compare first, never silently reverts. |
| Locked / regulated | Regulated templates show a lock rail: which regions are frozen by policy and who can unlock (deep-links to the policy). |
| Failing checks | Submit button becomes "Submit with 2 open findings…" — allowed only if policy classifies findings as warnings; blockers list inline with jump-to-element. |

**Keyboard shortcuts (excerpt):** `V` select, `T` text, `R` rectangle/container, `⌘D` duplicate, `⌘G`/`⌘⇧G` group/ungroup, `⌘⌥K` create component, `⌥←→↑↓` nudge spacing, `⌘Z/⇧⌘Z` undo/redo (AI accepts are undoable as single steps), `⌘↵` submit for approval, `?` shortcut overlay.

---

### 4b. Journey Canvas

Node-based orchestration editor for multi-step, multichannel journeys.

```
        ┌────────┐     ┌──────────┐  yes  ┌──────────┐
  ●────▶│Trigger │────▶│ Decision │──────▶│ Email:   │──▶ …
 start  │invoice │     │ balance  │       │ Statement│
        │created │     │  > 0 ?   │  no   └──────────┘
        └────────┘     └────┬─────┘       ┌──────────┐
                            └────────────▶│ NBA node │──▶ [Wait 3d] ─▶ [SMS fallback]
                                          └──────────┘
```

**Layout:** full-bleed canvas; left palette of node types (Triggers, Decisions, Channel sends, Waits, Fallbacks, **NBA nodes**, Goals/Exits, Webhooks); right inspector for the selected node; top bar with journey status (Draft / Simulating / Live / Paused), version, and mode switch **Design ↔ Simulate ↔ Live analytics**.

**Node types & anatomy:** every node = icon + name + one-line config summary + status lamp + port handles. Channel nodes embed a live mini-thumbnail of the bound template (click-through opens Template Designer in a peek drawer). NBA nodes show the decisioning policy name and arbitration strategy; edges from NBA nodes are labeled with action candidates and eligibility notes.

**Key interactions**

- Drag from palette or press `N` for quick-add menu at cursor; drag between ports to connect (invalid connections rejected with reason tooltip: "Wait cannot follow Exit").
- Auto-layout (`⌘⇧L`) tidies the graph; manual positions preserved otherwise. Minimap bottom-right; zoom/pan identical to Template Designer (muscle-memory parity).
- Edge conditions edited inline on the edge label; fallback edges rendered dashed amber.
- Validation rail (left gutter): unconnected ports, missing templates, channels without consent basis, infinite loops — each finding jumps to the node.

**Simulation mode** (`⌘⇧S`): pick or synthesize a customer profile; a token animates along the path; each visited node expands a step card (input payload → decision evaluation with rule trace → rendered message preview → next hop). Time controls: step, run, fast-forward waits. Batch simulation: run 1,000 synthetic profiles and see % flow per edge as edge-thickness heat. Simulation never sends; the mode is unmistakable (violet canvas tint + "SIMULATION" watermark).

**Per-node analytics overlay** (Live mode, `⌘⇧A`): each node gains an in-place stat chip (entered / completed / error %, conversion toward journey goal); edges thicken proportionally to traffic; underperforming nodes (vs. baseline or A/B sibling) get an amber halo with "Investigate" → opens Analytics Workbench pre-filtered. Time-range scrubber at bottom replays flow evolution.

**States:** Live journeys are read-only on canvas; edits fork a new draft version with an explicit "customers currently in-flight follow v(n) until migration rule chosen" dialog. Errors on live nodes stream into the node lamp in real time.

**Shortcuts:** `N` add node, `⌫` delete (with reconnect suggestion), `⌘E` edit selected node, `⌘⇧S` simulate, `⌘⇧A` analytics overlay, `[`/`]` cycle versions, `⌘↵` submit journey for approval.

---

### 4c. Approval Inbox & Version Comparison

**Approval Inbox** (queue mastery for compliance approvers):

- Three-pane: queue list (left, grouped by SLA urgency; overdue pinned red) → preview (center) → decision panel (right).
- Each queue item: object type icon, title, requester, brands/channels affected, **AI-involvement badge** (✦ "AI-assisted: 3 changes"), SLA countdown chip, risk score from policy engine.
- Bulk actions only for low-risk classes (policy-configurable); high-risk always individual.
- `J/K` next/previous item, `A` approve, `R` reject (both open the reason step — no one-key irreversible decisions), `D` open full diff, `⇧S` request changes.

**Version Comparison** (opened from inbox `D`, or standalone at /compare):

```
┌ v12 (Approved · live) ────────────┬ v14 (Submitted) ──────────────────┐
│  [rendered document]              │  [rendered document]              │
│   ▒ removed block (red wash)      │   ▒ added block (green wash)      │
│                                   │   ✦ AI-touched region (violet dot)│
├───────────────────────────────────┴───────────────────────────────────┤
│ Semantic changes (12)  [All | Content | Logic | Data | Style | ✦AI]    │
│  1. ✦ Rewrote late-fee paragraph (readability)      [view diff]        │
│  2.   Condition changed: balance > 0 → balance ≥ 25 [view diff]        │
│  3.   Binding added: customer.dueDate               [view diff]        │
├────────────────────────────────────────────────────────────────────────┤
│ [Reject…]  [Request changes…]                    [Approve ⌘↵]          │
└────────────────────────────────────────────────────────────────────────┘
```

- **Visual diff:** synchronized-scroll side-by-side renders (per channel/locale — the preview switcher persists here); added/removed/moved blocks color-washed; onion-skin slider (`O`) for pixel-level overlay.
- **Semantic diff:** structured change list — content edits, logic changes (shown as before/after rule sentences), data-binding changes, style/token changes. Filter chips include **"What AI touched"**: isolates AI-originated changes, each linking to its copilot session, prompt, model, and the human who accepted it.
- **Decisioning:** Approve requires typed or picked reason category when policy demands; Reject requires reason + optionally pinned annotations on the render (click a region → comment anchored to the block, flows back to the author's Checks tab).
- **Segregation of duties, enforced in UI:** if the viewer authored or accepted-AI-changes on this version, the Approve button is replaced by an inert explainer: "You contributed to v14 — SoD policy requires an independent approver. Reassign →". Dual-approval flows show a two-slot progress rail ("Legal ✓ · Brand pending"). All decisions write to the evidence ledger with hash-chained proof (ProofChip component links to Evidence Center).

---

### 4d. Analytics Workbench

Answers "did this communication do its job?" — not just "was it opened?".

```
┌ Filters: [Last 90d ▾][Brand: Retail ▾][Channel: All ▾][Segment: + ]  [Save view]┐
├──────────┬──────────────────────────────────────────────────────────────────────┤
│ Funnels  │  ┌ Funnel: Q3 Statement journey ────────┐ ┌ Outcome scorecard ─────┐ │
│ Heatmaps │  │ Sent ████████████ 128k               │ │ Intent: "pay in 7d"    │ │
│ Cohorts  │  │ Open ████████ 84k (-34%)             │ │ Target 62% · Actual 58%│ │
│ A/B      │  │ View ██████ 61k                      │ │ ▂▃▅▆▅▇ trend ▲         │ │
│ Outcomes │  │ Pay  ███ 39k  ← click = cohort       │ └────────────────────────┘ │
│ Explore  │  └──────────────────────────────────────┘ ┌ Heatmap: v14 (doc) ────┐ │
│          │                                           │ [rendered doc + heat]  │ │
└──────────┴───────────────────────────────────────────┴────────────────────────┴─┘
```

**Layout:** left rail of analysis types (Funnels, Heatmaps, Cohorts, A/B, Outcomes, Explore); canvas of cards; global filter bar (date, brand, channel, segment, journey/template) that persists across analysis types; every card exports (PNG/CSV) and pins to shareable boards.

**Key capabilities**

- **Journey funnels:** pick a journey → auto-built funnel of its stages; click any bar segment to see the cohort and jump to Customer Timelines; side-by-side funnel comparison across versions or segments; drop-off annotations ("SMS fallback recovered 8.2%").
- **Hotspot/heatmap overlays ON the actual document:** select a template version → the real rendered document appears with translucent heat (view dwell, hover, expand-section, action-click) painted on the actual blocks. Toggle metrics; scrub by segment or device. Clicking a hot block shows its stats and a "compare across versions" strip. This uses the same production renderer, so heat maps stay honest as templates change; each analytics snapshot binds to a specific version.
- **Cohorting:** visual cohort builder (attributes, behaviors, journey membership); cohorts are saved objects reusable in Journeys (audience) and A/B analysis.
- **A/B results:** experiment cards show variants as thumbnails, lift with confidence intervals, sequential-test status ("significant at 95%, safe to conclude"), and a one-click "Promote winner" that routes through approval (P4 — governance rides along).
- **Outcome tracking vs. declared intent:** every template declares an intended outcome at creation (e.g., "customer pays within 7 days", "reduce call volume about topic X"). The Workbench renders an **Outcome scorecard** per template: intent statement · outcome metric · attainment vs. target · trend. Fleet view ranks templates by outcome attainment; executives' home KPIs draw from here.

**States & speed:** all queries stream partial results (<1s to first data); long queries show a cost/row estimate up front; sampled previews labeled clearly ("10% sample — run full"). Empty states teach: "No outcome declared for this template — declare one to unlock outcome tracking →".

**Shortcuts:** `F` new funnel, `H` heatmap, `⌘F` filter bar, `⇧⌘E` export card, `B` pin to board.

---

### 4e. Customer Timeline

The single source of truth for "what did we send this person, what did they see, what did they do."

**Layout:** customer header (identity, consent/preference summary as ConsentBadges, risk/VIP flags) → vertical timeline (center) → context panel (right).

**Timeline events** (filterable chips: Delivery · Access · Interaction · Action · Service · System):

```
● 2026-07-01 09:12  Email "Q3 Statement v14" delivered        [✉ view]
├─ 09:47  Opened (iPhone · Mail)                
├─ 09:48  Viewed interactive doc · 2m40s · expanded "Fees"    [heat ▸]
├─ 09:51  Action: Dispute started (item #4411)                [case ▸]
● 2026-07-03 14:02  SMS reminder suppressed — quiet hours     [policy ▸]
● 2026-07-04 10:15  Agent K. Okafor re-sent secure link       [audit ▸]
```

- Each delivery event expands to full channel detail: provider receipts, retries, rendered size, link map. Interaction events include per-section dwell (the same instrumentation feeding Workbench heatmaps).
- **Reproduce-exact-communication view:** one click renders the *exact* communication as delivered — template version + data payload + locale + brand at that timestamp, pulled from the archive's immutable render or re-rendered deterministically from pinned inputs, with a proof panel (content hash, render engine version, ProofChip → Evidence Center). This is legally faithful, watermark-labeled "Archived reproduction", printable.
- **Service-agent tools** (right panel, permission-gated, every action audited and consent-checked): Resend via same/alternate channel · Generate fresh secure link (with expiry picker) · Regenerate with corrected data (routes through a lightweight approval if the template is regulated) · Start dispute/case · Add note · Escalate. The copilot answers agent questions grounded in this customer's timeline ("Why didn't she get the July reminder?" → cites the suppression event and quiet-hours policy).
- Cross-links everywhere: event → journey run (opens Journey Canvas live view centered on the node this customer hit) → template version → archive record.

**Shortcuts:** `/` filter events, `E` expand/collapse event, `⇧R` reproduce view, `⌘⇧N` new note.

---

## 5. The AI Copilot Pattern

One pattern, everywhere. Users learn it once.

**Invocation — two consistent modes**

1. **Panel** (`⌘.`): right-side dock, persistent per-surface conversation, aware of the current object (open template, selected journey node, filtered analytics view). Chips above the input suggest context-relevant actions ("Summarize v12→v14 changes", "Why is this node underperforming?").
2. **Inline** (`✦` affordance on selection, or `⌘J`): lightweight popover at the selection for point edits ("shorten this", "translate to Spanish"). Inline results still render as diffs; accepting merges and closes.

**Grounded responses with citations:** every factual claim cites a platform object as an inline chip — `[Template: Q3 Statement v12]`, `[Policy: FIN-12]`, `[Journey run #88231]`, `[Analytics: funnel 2026-06]`. Chips are live links (peek on hover, open on click). Answers without sufficient grounding say so explicitly ("I can't verify this from tenant data") rather than hedging prose.

**Action proposals = reviewable diffs.** The copilot never mutates directly. Proposals render in the surface's native diff idiom: canvas staging layer (Designer), tracked changes (text), before/after rule sentences (logic), node ghosting (Journey Canvas). Controls are always **Accept · Edit · Reject**, per-item and bulk; accept is a single undoable step. Destructive or wide-blast proposals (>N blocks, any live object) require typed confirmation.

Anatomy of a proposal card (AIProposalCard, §7.2):

```
┌ ✦ Proposal · Rewrite late-fee paragraph ────────────────────────────┐
│ "Simplified to grade-7 reading level; kept legal phrasing intact."  │
│ ┌ before ───────────────┐  ┌ after ────────────────┐               │
│ │ …fee of $12.00 shall… │  │ …we'll add a $12 late…│               │
│ └───────────────────────┘  └───────────────────────┘               │
│ Confidence: ●●○ Medium · Model: acorn-writer-2 · Prompt: RW-late v3 │
│ Grounded in: [Policy FIN-12] [Template v12 §Fees] [Style guide]     │
│           [ Reject ]   [ Edit… ]              [ Accept ⌘↵ ]         │
└─────────────────────────────────────────────────────────────────────┘
```

**Confidence & provenance display:** each proposal card carries — confidence band (High/Medium/Low with tooltip explaining basis; Low defaults to unchecked in bulk accepts) · model + prompt version (from Prompt Management registry) · grounding sources · timestamp. Provenance persists after acceptance: AI-touched regions keep a subtle violet corner dot; hover reveals the full card. Fleet-level rollups live in the AI Governance Center.

**Automatic audit note:** accepting any AI proposal writes an immutable audit entry — *"Change set #931 was AI-assisted (model M, prompt P v3), proposed 2026-07-06 14:02, accepted by A. Burger"* — attached to the version, surfaced in Version Comparison's "What AI touched" filter and in Compliance Evidence exports. Users cannot opt out; the note is presented as protection, not surveillance ("Your reviewers see exactly what to double-check").

**Guardrails in UX:** copilot respects role permissions (it cannot propose what the user cannot do); tenant AI policies (blocked topics, mandatory human review classes) surface as inline explanations, not silent failures; a kill-switch state ("AI features paused by your administrator") degrades every ✦ affordance gracefully.

---

## 6. End-Customer Interactive Document Experience

The document a customer opens is itself a product. Mobile-first, brand-themed, fast, accessible.

### 6.1 Viewer anatomy

```
┌─────────────────────────────────────┐
│ [Brand logo]           [♿][Aa][⇩]  │  utility strip: a11y widget, lang, download
│ Hi Maria — your July statement      │  personalized summary header
│ You owe **$142.10** by **Jul 25**.  │  (the 10-second takeaway, plain language)
│ [▶ Walk me through it]              │  guided walkthrough entry
├─────────────────────────────────────┤
│ ▸ Charges this month        $158.10 │  expandable sections
│ ▾ Fees                       $12.00 │  (deep-linkable, remember state)
│    Late fee ⓘ …                     │  tooltips on terms
│ ▸ Payments & credits        -$28.00 │
├─────────────────────────────────────┤
│ ⌕ Ask a question / search this doc  │  FAQ + semantic search
├─────────────────────────────────────┤
│ [Pay $142.10] [Dispute] [Upload doc]│  sticky action bar
│ [Sign] [Schedule a call]            │  (only actions relevant to this doc/state)
├─────────────────────────────────────┤
│ 💬 Assistant  ·  "Talk to a person" │  embedded chat + human escalation
└─────────────────────────────────────┘
```

- **Personalized summary header:** name, the single most important fact, and primary deadline — generated from the template's declared intent, rendered server-side (no layout shift). Reading grade ≤ 8 enforced by the Accessibility Checker.
- **Expandable sections:** progressive disclosure of detail; each section is a URL fragment (shareable/deep-linkable from service agents: "see the Fees section"); expand state announced to screen readers.
- **Tooltips/definitions:** dotted-underline terms open plain-language definitions (touch: tap-toggle; keyboard: focus + Enter; never hover-only).
- **FAQ & in-document search:** semantic search over this document + template's FAQ corpus; answers cite the section and scroll-highlight it.
- **Guided walkthrough:** optional step-by-step spotlight tour of the document (authored per template, AI-draftable); pausable, skippable, keyboard-driven.
- **Action bar:** sticky (bottom on mobile, right on wide screens); each action opens an in-context flow — Pay (PSP sheet), Dispute (item picker → reason → evidence upload), Upload, Sign (e-sign ceremony with signature audit), Schedule (slot picker). Every action returns an inline receipt and writes to the Customer Timeline in real time.
- **Embedded assistant chat:** grounded *only* in this document + published FAQ + customer's own data shown in the doc; cites sections; clearly labeled AI; one-tap **escalation to human** (handoff carries full context: doc, section, chat transcript) with channel choice (call-back, chat, branch appointment) and honest wait estimates.

### 6.2 Authentication states

| State | Experience |
|---|---|
| **Expiring link, first visit** | Soft landing: brand + "Your document from Acme" + verify step. Link TTL shown ("available until Aug 4"). |
| **OTP** | 6-digit code to registered channel; auto-advance inputs, paste-friendly, `autocomplete="one-time-code"`; resend with cooldown; error states never reveal whether the contact is registered. |
| **Passkey** | Offered after first OTP success ("Skip codes next time"); WebAuthn ceremony; fallback to OTP always visible. |
| **Expired link** | Never a dead end: "This link expired for your security" + self-service re-issue (re-verified via OTP) + support handoff. |
| **Step-up** | Viewing = base auth; high-risk actions (pay full balance change, sign) trigger step-up inline without losing scroll position. |

Session badge (identity + sign-out) persistent; idle timeout warns at T-2min with a one-click extend.

Viewer resilience states: **slow network** — server-rendered summary + skeleton sections, actions enabled as hydration completes; **payload mismatch** (data changed since send) — banner "Figures updated since this was sent" with toggle between as-sent and current, defaulting to as-sent for regulated docs; **action failure** — inline retry with reference ID and assistant offer; **document superseded** — interstitial linking to the newest version while keeping the original reachable (audit parity).

### 6.3 Built-in accessibility widget layer (Acorn.Access)

The existing Acorn.Access widget ships in every viewer, top-right `♿` (also `⌥A`):

- **Contrast themes** (high-contrast light/dark, respecting `prefers-contrast` and forced-colors) · **Text scaling** 100–200% with reflow (no horizontal scroll, WCAG 1.4.10) · **Dyslexia-friendly font** toggle · **Read-aloud** (per-section play, synchronized word highlight, speed control) · **Reading mask** (dimming band following focus/pointer) · reduced-motion toggle.
- Preferences persist per customer across documents (stored with consent); the widget itself is fully keyboard/screen-reader operable and never traps focus.
- Author-side mirror: the Template Designer's a11y simulation previews the document *through* these widget states, so designers see what customers will.

### 6.4 Mobile-first & print/PDF parity

- Designed at 360px first; thumb-reach action bar; sections default collapsed on mobile, key facts always above the fold; tap targets ≥ 44px; LCP < 1.5s on 3G-class (§8) via server rendering + inlined critical CSS + zero blocking scripts before content.
- **Print/PDF-download parity:** `⇩` produces a deterministic PDF from the same template version and payload — expanded sections, tooltip definitions rendered as footnotes, action bar replaced by printed instructions + QR link back to the live doc, tagged-PDF (PDF/UA) output, identical numbers guaranteed (same render pipeline as archive).

---

## 7. Design System Plan — "Acorn DS"

### 7.1 Design tokens

Three-layer token architecture (W3C DTCG format, built with Style Dictionary):

```
primitive tokens  →  semantic tokens        →  component tokens
color.oak.500        color.bg.surface           button.primary.bg
space.4 (16px)       color.text.danger          card.padding
type.scale.md        space.inset.card           journeynode.border
```

| Token family | Plan |
|---|---|
| **Color** | Primitive ramps (11 steps × 8 hues + neutrals); semantic slots: `bg.{canvas,surface,raised,sunken}`, `text.{primary,secondary,muted,inverse}`, `border.{default,strong,focus}`, status (`success/warning/danger/info`), AI-provenance violet (`ai.accent`), data-viz categorical set (validated for contrast + CVD). All semantic pairs meet 4.5:1 (text) / 3:1 (UI) in both themes. |
| **Type** | 2 stacks (UI: Inter-class variable font; docs: brand-injected); modular scale 12–32 UI, fluid clamp() for viewer headings; tabular numerals token for all metrics/money. |
| **Space** | 4px base grid: 2,4,8,12,16,24,32,48,64; semantic insets/stacks/inlines. |
| **Radius** | 4 steps (2,6,10,16) + full; brandable at the semantic layer. |
| **Elevation** | 5 levels as shadow+border recipes; dark theme swaps shadow for surface-tint elevation. |
| **Motion** | Duration tokens (75/150/250/400ms), easing (standard/decelerate/spring); every animation gated by `prefers-reduced-motion`; canvas interactions bypass CSS transitions (rAF-driven). |
| **Themes** | Light + dark are first-class siblings (semantic layer swap, tested in CI); high-contrast variant generated from the same slots. |

### 7.2 Component library (~60 components, three tiers)

**Tier 1 — Primitives (24):** Button, IconButton, SplitButton, Link, Input, Textarea, NumberInput, Select, Combobox, DatePicker/RangePicker, Checkbox, Radio, Switch, Slider, Tag/Chip, Badge, Avatar, Tooltip, Popover, Modal/Sheet, Toast, Tabs, Accordion, Skeleton.

**Tier 2 — Patterns (18):** DataTable (virtualized, saved views), FilterBar, CommandPalette, SearchOmnibox, EmptyState, ErrorState, PageHeader, SidePanel/Drawer, WizardStepper, KPICard/StatTile, ChartFrame (dataviz-token-bound), Timeline, KanbanBoard, FileDropzone, RichTextEditor, CodeEditor, ShortcutOverlay, ConfirmDialog (typed-confirmation variant).

**Tier 3 — Domain components (~18):**

| Component | Purpose & notes |
|---|---|
| **DocumentPreview** | Channel-true render frame (email/SMS/web/PDF/push) with device, theme, locale props; used by Designer, Compare, Workbench, Timeline — one component, honest everywhere. |
| **DiffViewer** | Visual (side-by-side, onion-skin) + semantic change list; AI-touch filter built in. |
| **JourneyNode** | Node shell with ports, status lamp, stat-chip slot, template thumbnail slot. |
| **ConsentBadge** | Consent/preference state per channel with basis on hover ("Marketing email: opted in 2025-11-02"). |
| **ProofChip** | Hash-chained evidence link: hover shows hash + timestamp + signer; click opens Evidence Center. |
| **HotspotOverlay** | Heat/click overlay bound to DocumentPreview block geometry. |
| **AIProposalCard** | Confidence band, provenance, Accept/Edit/Reject — the §5 pattern reified. |
| **CitationChip** | Live link to a platform object with peek preview. |
| **PersonalizationPill** | Atomic data-binding token in text editors. |
| **RuleRow** | WHEN/THEN visual logic row with expression-view toggle. |
| **SLAChip** | Countdown with urgency color ramp. |
| **VersionBadge / VersionPicker** | Status-aware (draft/submitted/approved/live/retired). |
| **ApprovalRail** | Multi-slot approval progress with SoD state. |
| **ChannelIcon set** | Consistent channel iconography + delivery-state variants. |
| **A11yFindingRow** | Severity, WCAG criterion link, jump-to-element, fix-proposal slot. |
| **AudiencePicker** | Cohort/segment selector with live count estimate. |
| **PromptVersionCard** | Prompt registry entry with eval-score sparkline. |
| **AcornAccessWidget** | The §6.3 customer widget, packaged for embed. |

**Accessibility requirements per component (definition of done):** documented keyboard map · ARIA pattern per APG · visible focus (2px offset ring token, WCAG 2.4.13-ready) · 24×24 min target (2.5.8) · no drag-only interactions (2.5.7 — every drag has button/menu alternative) · forced-colors + 200% zoom verified · axe-core clean in Storybook CI · screen-reader smoke script (NVDA + VoiceOver) recorded per component before "stable" status.

### 7.3 Theming & white-label architecture

- **Override chain:** platform defaults → tenant theme → brand theme → (viewer only) document theme. Overrides target *semantic* tokens only; primitives are immutable, guaranteeing contrast math survives rebranding. A theme builder in Admin validates every override against WCAG pairs live and blocks failing combinations with suggested nearest-passing values.
- **Runtime:** tokens ship as CSS custom properties; brand switch = swap one `data-brand` scope, no rebuild, <16ms.
- **Custom domains** per tenant/brand for the viewer (docs.acmebank.com) with automated cert provisioning; email/from-domain settings colocated.
- **Logo/typography injection:** brand kit upload (SVG logo variants light/dark, font files or licensed Google/Adobe refs) → self-hosted with `font-display: swap` and subsetting; fallback stacks enforced.
- Studio chrome stays Acorn-branded (with tenant accent) — the *documents* are fully white-label; this line is explicit in the theme builder.

### 7.4 Storybook-driven development & visual regression

- Every component built in Storybook first: stories for all states × light/dark × RTL × density; MDX docs with do/don't and keyboard map; a11y addon + axe in CI (zero violations to merge).
- **Visual regression:** Chromatic (or Playwright-based equivalent) snapshots every story across themes/RTL/2 viewports on every PR; diffs require explicit design approval. Flagship-surface E2E visual tests cover composed pages (Designer canvas, Compare view, viewer at 360px).
- Interaction tests (Storybook play functions) encode keyboard paths so shortcut regressions fail CI, not usability reviews.
- Tokens, components, and icons version together; changelog with codemods for breaking changes; design ↔ code parity checked by token-sync from the Figma library.

---

## 8. Quality Bars

### 8.1 Performance budgets (enforced in CI + RUM dashboards)

| Surface | Budget |
|---|---|
| Dashboards / list surfaces | TTI < 2s (p75, mid-tier laptop), first data < 1s, route transitions < 300ms |
| Template Designer canvas | 60fps during drag/zoom/typing (p95 frame < 16.6ms); open-to-editable < 3s for 100-block template; autosave never blocks input |
| Journey Canvas | 60fps pan/zoom at 200 nodes; simulation step < 100ms |
| End-customer viewer | LCP < 1.5s on 3G-class mobile (p75), CLS < 0.1, INP < 200ms; JS budget < 90KB gz before interaction; summary header server-rendered |
| Command palette / search | results < 50ms local, < 250ms federated |
| Bundle | per-route code-splitting; no route > 250KB gz; DocumentPreview renderer shared, cached |

Budgets live in CI (Lighthouse CI + custom frame-timing harness); a red budget blocks merge like a failing test.

### 8.2 Keyboard coverage

- **Every action reachable by keyboard** — audited per surface via the interaction-test suite; command palette is the universal fallback for anything un-shortcut.
- Global map: `⌘K` palette · `/` search · `⌘.` copilot · `⌘\` nav rail · `?` shortcut overlay · `g` then `h/t/j/a/…` go-to navigation · `J/K` list traversal everywhere.
- Focus management rules: modals trap and restore; drawers restore to invoker; canvas has a roving tabindex + "list view" alternative for every canvas (Layers tree = Designer; node list = Journeys) so spatial UIs remain non-visual-accessible.
- No shortcut uses a single printable key inside text contexts; all remappable per user (stored in preferences); conflicts detected.

### 8.3 WCAG 2.2 AA conformance process

1. **Design gate:** annotated a11y specs (roles, names, states, reading order) required in every Figma handoff.
2. **Build gate:** axe CI per story + composed pages; manual keyboard + SR script per component before stable.
3. **Release gate:** quarterly third-party audit of flagship surfaces + viewer; VPAT/ACR published and updated per release.
4. **New 2.2 criteria tracked explicitly:** 2.4.11/2.4.13 focus appearance & not obscured, 2.5.7 dragging alternatives, 2.5.8 target size, 3.2.6 consistent help (persistent help affordance in shell + viewer), 3.3.7 redundant entry (auth + action flows never re-ask), 3.3.8 accessible authentication (OTP paste, passkeys, no cognitive tests).
5. Defect policy: a11y bugs triaged at same severity scale as functional bugs; AA blockers stop release.

### 8.4 i18n / RTL readiness

- All strings externalized (ICU MessageFormat, plural/gender-safe); no concatenation; pseudo-locale build (ẞ 40% expansion) in CI screenshots.
- Logical CSS properties throughout; RTL mirrored automatically and snapshot-tested; charts/canvas surfaces define explicit RTL behavior (timeline direction, node flow annotation).
- Locale-aware dates/numbers/currency via Intl; document viewer supports per-document locale independent of UI locale; translation workflows in Content Library carry state (machine-drafted ✦ → human-reviewed ✓).

### 8.5 Empty / loading / error state standards

Every surface ships all five states before it ships at all: **empty (first-run)** — teach + one primary action + optional AI kickstart ("Draft your first template ✦"); **empty (filtered)** — "No results for these filters" + one-click clear; **loading** — content-shaped skeletons (never spinners for >300ms waits), streamed partials where possible; **error** — plain-language cause, retry, reference ID, and a path to a human; **degraded** — partial-service banners (e.g., "Analytics delayed ~10 min") rather than silent staleness. All five are Storybook stories and are reviewed in design crit like any other screen.

---

*End of blueprint. Companion documents: 09-design-tokens-spec (full token tables), 10-component-api-contracts (props/ARIA per component).*
