# Acorn.Access — Engineering Product Requirements Document

**Document type:** Technical PRD  
**Delivery model:** Single release, no phased rollout  
**Primary constraint:** Browser-only runtime with zero runtime transmission of page content, user data, or browsing context

## 1. Purpose

Acorn.Access is a client-side accessibility widget that can be added to an existing website with a single script include and minimal or no host-page code changes. The widget must operate primarily at the presentation layer, persist preferences locally, and provide user-controlled accessibility adjustments without requiring a backend service for runtime operation.

The widget shall not require redesign of the host application, HTML rewrites, template changes, or server-rendered feature flags. The default integration path shall be a single line added to the page.

## 2. Product Definition

Acorn.Access is a JavaScript runtime that:

- mounts an accessibility launcher and settings panel on top of an existing page,
- applies reversible DOM, CSS, and overlay-based accessibility adjustments,
- stores preferences locally in the browser,
- performs no runtime network calls after initial asset load,
- exposes configuration parameters to enable or disable features at build time and runtime,
- remains functional on static pages, multi-page sites, and SPAs.

## 3. Goals

1. **One-line inclusion.** A developer can add Acorn.Access by inserting a single `<script>` tag.
2. **No backend dependency for runtime features.** No config API, no telemetry pipeline, no server-driven personalization.
3. **Zero sensitive data egress.** No personal data, page content, DOM snapshots, input values, URLs, query strings, cookies, session identifiers, or browsing context may be transmitted from the client to any server by the widget runtime.
4. **Low-friction adoption.** The widget must work without requiring host HTML changes.
5. **Feature modularity.** Every user-visible function must be individually switchable on or off through configuration.
6. **Reversible changes.** All visual and DOM-level changes must be removable without page reload when a feature is disabled or the widget is destroyed.
7. **Framework tolerance.** The widget must tolerate React, Vue, Angular, server-rendered sites, and client-routed SPAs.
8. **Widget self-accessibility.** The launcher and panel must be keyboard operable, screen-reader understandable, and not introduce new accessibility barriers.

## 4. Non-Goals

1. Acorn.Access is **not** a replacement for native assistive technologies or for fixing source-code accessibility defects in the host application.
2. Acorn.Access does **not** guarantee WCAG conformance for arbitrary host content.
3. Acorn.Access does **not** perform cloud-based remediation, OCR, image recognition, speech recognition, or remote scanning.
4. Acorn.Access does **not** modify cross-origin iframes, browser chrome, OS settings, PDFs embedded as plugins, canvas-only applications, or closed third-party shadow roots that are not observable by the runtime.
5. Acorn.Access does **not** collect analytics or crash telemetry in v1.

## 5. Delivery Scope

This PRD defines a **single-release implementation**. All in-scope functionality below is part of the initial release. No phased delivery plan is assumed.

## 6. Technical Constraints

### 6.1 Runtime Constraints

- Must run entirely in the browser.
- Must not require any backend service for normal operation.
- Must not require a per-customer account lookup.
- Must not require cookies.
- Must work when third-party cookies are blocked.
- Must support operation when `localStorage` is unavailable by falling back to session memory.

### 6.2 Network Constraints

After initial script download, the runtime shall make **zero outbound requests**.

The following browser APIs are prohibited in production runtime code:

- `fetch`
- `XMLHttpRequest`
- `navigator.sendBeacon`
- `WebSocket`
- `EventSource`
- `RTCPeerConnection`
- remote font loaders
- remote icon loaders
- remote config loaders
- remote dictionary or language services

Optional static assets such as fonts shall be bundled into the build by default. A split-asset build may exist for first-party hosting only, but the default distribution must be a single-bundle privacy-hard build.

### 6.3 Security Constraints

- No `eval`, `new Function`, or dynamic code execution.
- CSP-compatible by default.
- Support SRI on the script include.
- Avoid requiring `unsafe-inline` for scripts.
- If a `<style>` tag is injected, support passing a CSP nonce.

## 7. Integration Requirements

### 7.1 Primary Integration Path

The preferred install method is a single script tag.

```html
<script
  async
  src="/assets/acorn-access.min.js"
  data-acorn-access='{"position":"right","language":"auto","features":{"profiles":true,"readAloud":true,"smartContrast":true,"semanticAssist":false}}'
  integrity="sha384-..."
  crossorigin="anonymous">
</script>
```

### 7.2 Secondary Integration Path

Programmatic initialization shall also be supported for applications that prefer explicit bootstrapping.

```html
<script async src="/assets/acorn-access.min.js"></script>
<script>
  window.Acorn.Access.init({
    position: 'right',
    language: 'auto',
    features: {
      profiles: true,
      readAloud: true,
      smartContrast: true,
      semanticAssist: false
    }
  });
</script>
```

### 7.3 Host Page Requirements

No HTML redesign is required.

Optional host annotations are allowed but not required:

- `data-aa-skip="contrast spacing images"` to exclude an element subtree from specific feature modules.
- `data-aa-skip="all"` to exclude a subtree from all Acorn.Access modifications.

## 8. High-Level Architecture

Acorn.Access shall be composed of the following modules.

### 8.1 Bootstrap Loader

Responsibilities:

- parse inline configuration from `data-acorn-access`,
- merge config with defaults,
- wait for `document.body` if necessary,
- create the widget container,
- initialize state store,
- initialize UI,
- initialize feature engine,
- attach observers,
- replay persisted preferences.

Properties:

- async, non-blocking,
- idempotent,
- safe to execute once per page,
- no dependency on DOM readiness beyond `document.body`.

### 8.2 UI Layer

Responsibilities:

- render launcher,
- render settings panel,
- render profile selector,
- render feature controls,
- render page structure panel,
- render tooltips and overlays,
- expose keyboard navigation and focus management.

Implementation:

- mounted in a shadow root attached to a fixed-position host element,
- uses namespaced CSS variables,
- uses `all: initial` at the shadow root boundary,
- uses logical properties for RTL/LTR support.

### 8.3 State Store

Responsibilities:

- hold current feature state,
- persist settings locally,
- restore settings on load,
- support reset to defaults,
- support session-only or memory-only fallback.

Storage keys:

- `acorn.access.v1.state`
- `acorn.access.v1.dismissedUntil`

No unique user identifier shall be created or stored.

### 8.4 Feature Engine

Responsibilities:

- apply user-selected features,
- revert features cleanly,
- compose multiple features without corrupting page state,
- prefer CSS-based changes over DOM mutation,
- record original values only when DOM mutation is unavoidable.

Implementation model:

- a central state object,
- feature modules implementing `enable`, `disable`, and `reapply`,
- a style compositor generating a deterministic stylesheet,
- an overlay manager for pointer-tracking and mask features,
- a patch registry for reversible DOM changes.

### 8.5 DOM Observation Layer

Responsibilities:

- detect added or changed nodes,
- reapply only affected features,
- handle SPA hydration and lazy-loaded content.

Implementation:

- `MutationObserver` on `document.body`,
- debounced batch processing,
- changed-subtree reprocessing only,
- guard against feedback loops from Acorn.Access-owned mutations.

### 8.6 Navigation Observation Layer

Responsibilities:

- detect client-side route changes,
- refresh page-structure model,
- re-evaluate scoped feature application.

Implementation:

- listeners for `popstate` and `hashchange`,
- wrappers around `history.pushState` and `history.replaceState`,
- internal route-change event emission.

### 8.7 Public API

Acorn.Access shall expose:

- `window.Acorn.Access.init(config?)`
- `window.Acorn.Access.open()`
- `window.Acorn.Access.close()`
- `window.Acorn.Access.toggle()`
- `window.Acorn.Access.destroy()`
- `window.Acorn.Access.reset()`
- `window.Acorn.Access.setFeature(name, value)`
- `window.Acorn.Access.setProfile(name | null)`
- `window.Acorn.Access.getState()`

The runtime shall dispatch custom DOM events:

- `acorn.access:ready`
- `acorn.access:open`
- `acorn.access:close`
- `acorn.access:feature-change`
- `acorn.access:profile-change`
- `acorn.access:reset`

Event payloads must contain only internal feature names and values. They must not contain page URLs, selected text, DOM snippets, or input values.

## 9. Functional Requirements

### 9.1 Launcher and Panel

Requirements:

- Floating launcher visible on initial page load unless disabled.
- Configurable position: `left` or `right`.
- Configurable vertical offset.
- Configurable launcher size: `regular` or `oversized`.
- Panel opens on click, `Enter`, or `Space`.
- Panel closes on `Escape`, outside click, or launcher toggle.
- Focus must move into the panel when opened and return to the launcher when closed.

### 9.2 Profiles

Profiles are presets that apply multiple features at once. Profiles must be defined locally in config and can be enabled or disabled independently.

Default profiles in v1:

- `vision`
- `reading`
- `motor`
- `focus`
- `seizureSafe`
- `cognitive`

Profiles are configuration objects, not hard-coded logic branches. Integrators may override labels and mappings.

### 9.3 Feature Set

Each feature below must be independently configurable. Disabled features shall not appear in the UI and shall reject activation through the public API.

#### 9.3.1 Bigger Text

Config key: `features.biggerText`

Behavior:

- 4 user-selectable steps.
- Implement using root font scaling and CSS variables.
- Do not rely on CSS `zoom` as the primary implementation.
- Recompute spacing-dependent features after scale changes.

Default stages:

- `0 = off`
- `1 = 1.10x`
- `2 = 1.20x`
- `3 = 1.30x`
- `4 = 1.40x`

#### 9.3.2 Text Spacing

Config key: `features.textSpacing`

Behavior:

- 3 steps.
- Adjust `letter-spacing`, `word-spacing`, and paragraph spacing.
- Apply to text-bearing elements only.
- Preserve form control usability.

#### 9.3.3 Line Height

Config key: `features.lineHeight`

Behavior:

- 3 steps.
- Adjust `line-height` on readable text containers.
- Exclude icon fonts and controls where line-height changes break interaction.

#### 9.3.4 Contrast Modes

Config key: `features.contrast`

Modes:

- `off`
- `dark`
- `light`
- `invert`
- `high`

Behavior:

- implemented through CSS variables and root data attributes,
- exclude media elements by default from destructive inversion,
- preserve visible focus indicators.

#### 9.3.5 Smart Contrast

Config key: `features.smartContrast`

Behavior:

- inspect computed foreground/background contrast for visible text nodes,
- adjust only when below configured threshold,
- use deterministic color correction,
- store reversible patches,
- scope reprocessing to changed subtrees.

Guardrails:

- off by default in safe mode,
- do not patch gradients, canvas, video, SVG filters, or cross-origin content,
- do not write inline styles unless no stylesheet-based fix is possible.

#### 9.3.6 Highlight Links

Config key: `features.highlightLinks`

Behavior:

- add high-contrast underline, outline, or background emphasis to anchors and link-like controls,
- preserve site hover/focus states,
- include keyboard-focused elements.

#### 9.3.7 Pause Animations

Config key: `features.pauseAnimations`

Behavior:

- disable CSS animations and transitions,
- pause same-origin `HTMLMediaElement` instances when possible,
- honor `prefers-reduced-motion`,
- do not attempt unsupported cross-origin iframe media control.

#### 9.3.8 Hide Images

Config key: `features.hideImages`

Behavior:

- hide `img`, `picture`, decorative `svg`, and background images,
- optionally replace hidden images with a non-interactive placeholder when alt text is present,
- do not hide functional controls without preserving operability.

#### 9.3.9 Dyslexia-Friendly Font

Config key: `features.dyslexiaFont`

Behavior:

- apply configured dyslexia-friendly font stack,
- bundle default font resource in the primary build,
- fall back to a local system stack if the bundled font cannot load,
- avoid altering code blocks, icon fonts, and branded logotypes when excluded.

#### 9.3.10 Legible Font

Config key: `features.legibleFont`

Behavior:

- swap text to a high-legibility sans-serif stack,
- keep numeric tabular data aligned where feasible.

#### 9.3.11 Big Cursor

Config key: `features.bigCursor`

Behavior:

- apply a larger high-contrast cursor using CSS cursor assets,
- degrade gracefully on browsers or devices that restrict custom cursor size,
- disable automatically on touch-only devices unless forced by config.

#### 9.3.12 Reading Guide

Config key: `features.readingGuide`

Behavior:

- render a horizontal guide line following pointer or keyboard focus,
- do not intercept pointer events,
- throttle movement updates with `requestAnimationFrame`.

#### 9.3.13 Reading Mask

Config key: `features.readingMask`

Behavior:

- render a viewport overlay with a transparent reading band,
- follow pointer movement or currently focused element,
- support opacity and band-height configuration.

#### 9.3.14 Tooltips for Alt Text

Config key: `features.tooltips`

Behavior:

- show accessible tooltip text for images on hover and focus,
- source content from local DOM only,
- never log tooltip text,
- suppress empty or redundant tooltip content.

#### 9.3.15 Page Structure Panel

Config key: `features.pageStructure`

Behavior:

- generate a navigable outline of headings, landmarks, forms, buttons, and links,
- update on route or DOM change,
- allow keyboard navigation to selected targets,
- use scrolling plus focus transfer where appropriate.

#### 9.3.16 Text Alignment

Config key: `features.textAlign`

Modes:

- `off`
- `left`
- `center`
- `right`
- `justify`

Behavior:

- apply to readable content containers only,
- avoid re-aligning controls, navigation bars, and data tables by default.

#### 9.3.17 Saturation

Config key: `features.saturation`

Modes:

- `off`
- `low`
- `high`
- `desaturate`

Behavior:

- apply CSS filter-based or variable-based color intensity adjustment,
- exclude video and protected media by default,
- compose correctly with contrast modes.

#### 9.3.18 Read Aloud

Config key: `features.readAloud`

Behavior:

- provide local page read-aloud using `speechSynthesis`,
- read only visible page content or selected content blocks,
- support pause, resume, stop, speed, and voice selection,
- respect document `lang` where available,
- never transmit text to a remote service.

Constraint:

- this is a read-aloud utility, not a screen reader replacement.

#### 9.3.19 Semantic Assist

Config key: `features.semanticAssist`

Default: `false`

Behavior:

- apply only narrow, reversible, low-risk patches,
- patch obvious icon-only links or buttons by deriving a local label from existing attributes,
- optionally add keyboard support for non-semantic clickable elements only when an `onclick` handler exists and no native semantics are present,
- hide clearly decorative SVG or icon nodes from assistive tech when no interactive role is present.

Guardrails:

- no broad ARIA rewriting,
- no auto-generated alt text from remote services,
- no mutation of form values,
- no modification of host validation logic,
- every patch must be tracked and reversible.

### 9.4 Feature Composition Rules

The style compositor must apply features in deterministic order:

1. base reset
2. font swaps
3. text scale
4. spacing and line height
5. alignment
6. contrast and saturation
7. link highlighting
8. image visibility
9. motion reduction
10. overlays

Conflicts must resolve predictably. Example: `invert` plus `hideImages` must not re-show media via an inverse filter exemption path.

## 10. Configuration Model

### 10.1 Top-Level Config

```ts
interface AcornAccessConfig {
  enabled?: boolean;
  autoInit?: boolean;
  position?: 'left' | 'right';
  offsetY?: string;
  zIndex?: number;
  size?: 'regular' | 'oversized';
  language?: 'auto' | string;
  storage?: 'local' | 'session' | 'memory' | 'none';
  persist?: boolean;
  safeMode?: boolean;
  cspNonce?: string;
  launcherIcon?: 'default' | 'minimal' | 'text';
  theme?: 'system' | 'light' | 'dark';
  features?: Partial<FeatureFlags>;
  defaults?: Partial<FeatureState>;
  profiles?: Record<string, ProfileDefinition>;
  selectors?: {
    scope?: string[];
    exclude?: string[];
  };
}
```

### 10.2 Feature Flags

```ts
interface FeatureFlags {
  profiles: boolean;
  biggerText: boolean;
  textSpacing: boolean;
  lineHeight: boolean;
  contrast: boolean;
  smartContrast: boolean;
  highlightLinks: boolean;
  pauseAnimations: boolean;
  hideImages: boolean;
  dyslexiaFont: boolean;
  legibleFont: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
  readingMask: boolean;
  tooltips: boolean;
  pageStructure: boolean;
  textAlign: boolean;
  saturation: boolean;
  readAloud: boolean;
  semanticAssist: boolean;
}
```

### 10.3 Default State Shape

```ts
interface FeatureState {
  profile: string | null;
  biggerText: 0 | 1 | 2 | 3 | 4;
  textSpacing: 0 | 1 | 2 | 3;
  lineHeight: 0 | 1 | 2 | 3;
  contrast: 'off' | 'dark' | 'light' | 'invert' | 'high';
  smartContrast: boolean;
  highlightLinks: boolean;
  pauseAnimations: boolean;
  hideImages: boolean;
  dyslexiaFont: boolean;
  legibleFont: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
  readingMask: boolean;
  tooltips: boolean;
  pageStructure: boolean;
  textAlign: 'off' | 'left' | 'center' | 'right' | 'justify';
  saturation: 'off' | 'low' | 'high' | 'desaturate';
  readAloud: boolean;
  semanticAssist: boolean;
}
```

## 11. Privacy Requirements

1. The widget shall not create or transmit a user identifier.
2. The widget shall not read or transmit cookies.
3. The widget shall not transmit the current URL, referrer, pathname, query string, fragment, title, or selected text.
4. The widget shall not transmit DOM content, form input values, alt text, headings, labels, or accessibility-tree-derived data.
5. The widget shall not collect analytics, usage beacons, crash reports, or remote logs in v1.
6. All state must remain local to the browser.
7. The build pipeline shall include a static audit that fails if prohibited network APIs are referenced in production bundles.

## 12. Accessibility Requirements for the Widget Itself

1. Launcher must have an accessible name.
2. Panel must expose dialog semantics.
3. All controls must be keyboard operable.
4. Focus order must be logical and trapped within the open panel.
5. Visible focus indication must meet contrast requirements.
6. Controls must have clear on/off state communication.
7. The widget UI shall respect `prefers-reduced-motion`.
8. The widget UI shall support RTL and LTR languages.
9. The widget shall not block access to underlying page controls when overlays are disabled.
10. Overlay elements must use `pointer-events: none` unless intentionally interactive.

## 13. Performance Requirements

1. Bootstrap must not block first paint.
2. Core initialization target: under 100 ms scripting time on a modern desktop for a median content page.
3. Idle CPU usage target: effectively zero when no dynamic feature is active.
4. Pointer-follow features must render via `requestAnimationFrame` and avoid layout thrash.
5. Mutation reprocessing shall be debounced to 120–150 ms.
6. Reprocessing shall be scoped to changed nodes whenever possible.
7. Destroying the widget shall remove observers, event listeners, overlays, and style tags.

## 14. Browser and Platform Support

Supported targets:

- Chrome, Edge, Firefox, Safari: latest two major versions
- iOS Safari: latest two major versions
- Android Chrome: latest two major versions

Fallback rules:

- if `speechSynthesis` is unavailable, hide the read-aloud control,
- if custom cursors are unsupported or touch-only, hide big cursor unless forced,
- if `localStorage` is unavailable, fall back to memory mode,
- if `MutationObserver` is unavailable, initialize once and disable dynamic reapply.

## 15. Known Limitations

1. Cross-origin iframes cannot be remediated or restyled by the runtime.
2. Closed third-party shadow roots cannot be reliably traversed.
3. Canvas-only content cannot be semantically repaired by the widget.
4. Host CSS using extreme specificity or `!important` may reduce the effectiveness of some visual overrides.
5. Read-aloud quality depends on browser and OS voice availability.
6. Semantic Assist is intentionally narrow and will not repair arbitrary accessibility defects.

## 16. Acceptance Criteria

### 16.1 Integration

- A developer can install the widget with one script tag.
- The widget renders without requiring host HTML edits.
- Disabling a feature in config removes it from the UI and blocks programmatic activation.

### 16.2 Privacy

- Automated test verifies zero runtime network calls after initial asset load.
- Bundle audit verifies prohibited network APIs are absent.
- No cookies or unique IDs are created.

### 16.3 Runtime Behavior

- Feature toggles apply and revert without page reload.
- SPA navigation preserves enabled features and refreshes page-structure data.
- Mutation-driven reapply does not produce infinite loops.

### 16.4 Widget Accessibility

- Keyboard-only users can open, use, and close the widget.
- Screen readers announce launcher, panel, controls, and control state correctly.
- Focus returns to the launcher after panel close.

### 16.5 Performance

- On representative pages, enabling common features does not produce persistent main-thread thrash.
- Pointer-tracking overlays remain visually smooth.
- Destroy removes all Acorn.Access-owned DOM nodes and listeners.

## 17. QA and Test Strategy

### 17.1 Unit Tests

- config parsing
- state serialization and hydration
- feature enable/disable transitions
- patch registry reversibility
- prohibited-network static checks

### 17.2 Integration Tests

- script-tag auto-init
- SPA route changes
- mutation-driven reapply
- localStorage/session/memory fallbacks
- config-driven feature removal

### 17.3 Accessibility Tests

- automated audits of widget UI,
- keyboard navigation tests,
- screen-reader smoke tests on launcher and panel,
- focus-trap validation,
- reduced-motion behavior.

### 17.4 Browser Matrix

Run automated E2E coverage against:

- Chromium desktop
- Firefox desktop
- Safari desktop
- iOS Safari
- Android Chrome

## 18. Implementation Notes

1. Prefer stylesheet composition over inline mutation.
2. Restrict DOM patching to reversible, narrowly scoped modules.
3. Maintain a single source of truth for active feature state.
4. Namespaces for classes, attributes, events, and storage keys must be `acorn-access` prefixed.
5. The runtime must be safe to initialize only once. Subsequent `init()` calls shall no-op or merge config deterministically.

## 19. Recommended Initial Defaults

```json
{
  "position": "right",
  "size": "regular",
  "language": "auto",
  "storage": "local",
  "persist": true,
  "safeMode": true,
  "features": {
    "profiles": true,
    "biggerText": true,
    "textSpacing": true,
    "lineHeight": true,
    "contrast": true,
    "smartContrast": true,
    "highlightLinks": true,
    "pauseAnimations": true,
    "hideImages": true,
    "dyslexiaFont": true,
    "legibleFont": true,
    "bigCursor": true,
    "readingGuide": true,
    "readingMask": true,
    "tooltips": true,
    "pageStructure": true,
    "textAlign": true,
    "saturation": true,
    "readAloud": true,
    "semanticAssist": false
  }
}
```

## 20. Release Definition

The single release is complete when:

- all in-scope features above are implemented,
- privacy constraints are enforced in code and tests,
- one-line installation works on static and SPA sites,
- widget UI passes internal accessibility acceptance checks,
- all changes remain reversible at runtime,
- no backend dependency exists for normal operation.
