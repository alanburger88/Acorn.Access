# Acorn.Access Developer Guide

## Overview

Acorn.Access is a client-side accessibility widget that adds user-controllable accessibility features to any website. It runs entirely in the browser with zero backend dependencies and makes no network requests after the initial script load.

---

## Quick Start

Add a single script tag before the closing `</body>` tag:

```html
<script
  async
  src="/path/to/acorn-access.min.js"
  data-acorn-access='{}'>
</script>
```

That's it. The widget will appear as a green floating button on the right side of the page.

---

## Installation Options

### Option 1: Script Tag (Recommended)

The simplest integration. Configuration is passed inline via the `data-acorn-access` attribute as JSON.

```html
<script
  async
  src="/assets/acorn-access.min.js"
  data-acorn-access='{
    "position": "right",
    "language": "auto",
    "features": {
      "profiles": true,
      "readAloud": true,
      "smartContrast": true,
      "semanticAssist": false
    }
  }'
  integrity="sha384-..."
  crossorigin="anonymous">
</script>
```

### Option 2: Programmatic Initialization

For applications that prefer explicit control over when the widget initializes.

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

### Option 3: ES Module Import

For projects using a JavaScript bundler (Vite, Webpack, Rollup, etc.):

```js
import { init } from 'acorn-access';

init({
  position: 'left',
  size: 'oversized'
});
```

---

## Configuration Reference

All configuration properties are optional. Defaults are applied for anything not specified.

```ts
{
  // Master switch — set to false to prevent the widget from loading
  enabled: true,

  // Auto-initialize when the script loads (script-tag integration)
  autoInit: true,

  // Launcher button position
  position: 'right',       // 'left' | 'right'

  // Vertical offset of the launcher button
  offsetY: '50%',          // Any valid CSS value

  // CSS z-index for the widget
  zIndex: 999999,

  // Launcher button size
  size: 'regular',         // 'regular' | 'oversized'

  // Language for widget UI labels
  language: 'auto',        // 'auto' | ISO language code (e.g. 'en', 'fr')

  // Where to persist user preferences
  storage: 'local',        // 'local' | 'session' | 'memory' | 'none'

  // Whether to persist preferences between visits
  persist: true,

  // Safe mode — limits aggressive features like Smart Contrast
  safeMode: true,

  // CSP nonce for injected <style> elements
  cspNonce: null,          // string | null

  // Launcher icon style
  launcherIcon: 'default', // 'default' | 'minimal' | 'text'

  // Widget panel theme
  theme: 'system',         // 'system' | 'light' | 'dark'

  // Enable or disable individual features (see Feature Flags below)
  features: { ... },

  // Default values for feature controls on first load
  defaults: { ... },

  // Profile definitions (see Profiles below)
  profiles: { ... },

  // CSS selectors to scope or exclude from feature effects
  selectors: {
    scope: [],             // Only apply features within these selectors
    exclude: []            // Never apply features to these selectors
  }
}
```

---

## Feature Flags

Each feature can be individually enabled or disabled. Disabled features are hidden from the UI and cannot be activated through the API.

```js
{
  features: {
    profiles:        true,   // Quick profile presets
    biggerText:      true,   // Text size scaling (up to 200%)
    textSpacing:     true,   // Letter and word spacing
    lineHeight:      true,   // Line height adjustment
    contrast:        true,   // Contrast modes (dark, light, invert, high)
    smartContrast:   true,   // Automatic low-contrast text fixing
    highlightLinks:  true,   // Underline and highlight all links
    pauseAnimations: true,   // Stop CSS animations and transitions
    hideImages:      true,   // Hide decorative images
    dyslexiaFont:    true,   // Dyslexia-friendly font
    legibleFont:     true,   // High-legibility sans-serif font
    bigCursor:       true,   // Enlarged mouse cursor
    readingGuide:    true,   // Horizontal line following the cursor
    readingMask:     true,   // Viewport overlay with reading band
    tooltips:        true,   // Show alt text tooltips on images
    pageStructure:   true,   // Navigable page outline (headings, landmarks)
    textAlign:       true,   // Force text alignment
    saturation:      true,   // Color saturation control
    readAloud:       true,   // Text-to-speech using browser speechSynthesis
    semanticAssist:  false   // Narrow accessibility patches (off by default)
  }
}
```

---

## Profiles

Profiles are presets that activate multiple features at once. Six default profiles are included:

| Profile | Features Applied |
|---|---|
| **Vision Impaired** | Bigger Text (130%), High Contrast, Highlight Links, Big Cursor |
| **Reading Friendly** | Bigger Text (115%), Text Spacing (medium), Line Height (medium), Legible Font, Reading Guide |
| **Motor Impaired** | Bigger Text (130%), Big Cursor, Highlight Links, Text Spacing (low) |
| **ADHD Friendly** | Pause Animations, Reading Mask, Low Saturation, Hide Images |
| **Seizure Safe** | Pause Animations, Low Saturation, Dark Contrast |
| **Cognitive Support** | Bigger Text (115%), Text Spacing (low), Line Height (low), Legible Font, Highlight Links, Reading Guide |

### Custom Profiles

You can define your own profiles or override the defaults:

```js
{
  profiles: {
    myCustomProfile: {
      label: 'Custom',
      icon: 'target',       // Icon name (see built-in icon set)
      description: 'My custom accessibility preset',
      settings: {
        biggerText: 2,
        contrast: 'dark',
        highlightLinks: true,
        readingGuide: true
      }
    }
  }
}
```

---

## Public API

Once initialized, the widget exposes a JavaScript API at `window.Acorn.Access`:

```js
// Initialize (if not auto-initialized via script tag)
window.Acorn.Access.init(config?)

// Open the settings panel
window.Acorn.Access.open()

// Close the settings panel
window.Acorn.Access.close()

// Toggle the settings panel
window.Acorn.Access.toggle()

// Remove the widget completely (reversible by calling init again)
window.Acorn.Access.destroy()

// Reset all settings to defaults
window.Acorn.Access.reset()

// Set a single feature value
window.Acorn.Access.setFeature('biggerText', 3)
window.Acorn.Access.setFeature('contrast', 'dark')
window.Acorn.Access.setFeature('highlightLinks', true)

// Activate or deactivate a profile
window.Acorn.Access.setProfile('vision')    // activate
window.Acorn.Access.setProfile(null)        // deactivate

// Get the current state of all features
const state = window.Acorn.Access.getState()
```

### Feature Values

| Feature | Type | Values |
|---|---|---|
| `biggerText` | number | `0` (off), `1` (115%), `2` (130%), `3` (150%), `4` (175%), `5` (200%) |
| `textSpacing` | number | `0` (off), `1` (low), `2` (medium), `3` (high) |
| `lineHeight` | number | `0` (off), `1` (low), `2` (medium), `3` (high) |
| `contrast` | string | `'off'`, `'dark'`, `'light'`, `'invert'`, `'high'` |
| `textAlign` | string | `'off'`, `'left'`, `'center'`, `'right'`, `'justify'` |
| `saturation` | string | `'off'`, `'low'`, `'high'`, `'desaturate'` |
| All others | boolean | `true` / `false` |

---

## DOM Events

The widget dispatches custom events on `document` that you can listen to:

```js
document.addEventListener('acorn.access:ready', () => {
  console.log('Widget is ready');
});

document.addEventListener('acorn.access:open', () => {
  console.log('Panel opened');
});

document.addEventListener('acorn.access:close', () => {
  console.log('Panel closed');
});

document.addEventListener('acorn.access:feature-change', (e) => {
  console.log('Features changed:', e.detail.state);
});

document.addEventListener('acorn.access:profile-change', (e) => {
  console.log('Profile activated:', e.detail.profile);
});

document.addEventListener('acorn.access:reset', () => {
  console.log('Settings reset');
});
```

Event payloads contain only internal feature names and values. They never contain page content, URLs, or user data.

---

## Excluding Elements

You can exclude specific elements or subtrees from Acorn.Access modifications using the `data-aa-skip` attribute:

```html
<!-- Exclude from all features -->
<div data-aa-skip="all">
  This content will not be modified by any Acorn.Access feature.
</div>

<!-- Exclude from specific features -->
<div data-aa-skip="contrast biggerText">
  This content is excluded from contrast and text scaling only.
</div>

<!-- Exclude from spacing adjustments -->
<nav data-aa-skip="textSpacing lineHeight">
  Navigation layout preserved.
</nav>
```

### Available skip values

Use the feature key names: `biggerText`, `textSpacing`, `lineHeight`, `textAlign`, `contrast`, `smartContrast`, `saturation`, `highlightLinks`, `images`, `animations`, `bigCursor`, `dyslexiaFont`, `legibleFont`, `tooltips`, `semanticAssist`, or `all` to skip everything.

---

## Content Security Policy (CSP)

Acorn.Access injects `<style>` elements to apply accessibility features. If your site uses a Content Security Policy, pass a nonce:

```html
<script
  nonce="abc123"
  src="/assets/acorn-access.min.js"
  data-acorn-access='{"cspNonce": "abc123"}'>
</script>
```

The widget is designed to work without:
- `unsafe-inline` for scripts
- `unsafe-eval`
- Any external resource loading (fonts, icons, and cursors are bundled)

---

## Subresource Integrity (SRI)

The build outputs a hash for SRI. Add it to your script tag:

```html
<script
  src="/assets/acorn-access.min.js"
  integrity="sha384-..."
  crossorigin="anonymous"
  data-acorn-access='{}'>
</script>
```

---

## Framework Compatibility

Acorn.Access works with any framework or static site:

| Framework | Notes |
|---|---|
| **Static HTML** | Works out of the box |
| **React** | Add the script tag in `index.html` or use programmatic init in a `useEffect` |
| **Next.js** | Add via `<Script>` component in `_document` or `layout` |
| **Vue** | Add the script tag in `index.html` or call `init()` in `onMounted` |
| **Angular** | Add the script tag in `index.html` or call `init()` in `ngOnInit` |
| **WordPress** | Enqueue the script in your theme's `functions.php` |
| **Shopify** | Add the script tag in `theme.liquid` before `</body>` |

### React Example

```jsx
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/assets/acorn-access.min.js';
    script.async = true;
    script.onload = () => {
      window.Acorn.Access.init({ position: 'right' });
    };
    document.body.appendChild(script);

    return () => {
      window.Acorn.Access?.destroy();
    };
  }, []);

  return <div>Your app content</div>;
}
```

### SPA Route Changes

Acorn.Access automatically detects client-side navigation (`pushState`, `replaceState`, `popstate`, `hashchange`) and re-evaluates features like Page Structure. No additional configuration is needed.

---

## Storage and Privacy

### What is stored

User preferences are saved to `localStorage` under the key `acorn.access.v1.state`. The stored data contains only feature setting values (numbers, booleans, strings). Example:

```json
{
  "biggerText": 2,
  "contrast": "dark",
  "highlightLinks": true,
  "readingGuide": false
}
```

### What is never stored or transmitted

- No user identifiers
- No cookies
- No page URLs, content, or DOM data
- No analytics or telemetry
- No network requests after initial script load
- No cross-origin communication

### Storage fallbacks

If `localStorage` is unavailable (e.g., private browsing with storage blocked), the widget falls back to `sessionStorage`, then to in-memory storage. Configure this explicitly:

```js
{ storage: 'session' }  // Session only — cleared when browser closes
{ storage: 'memory' }   // In-memory only — cleared on page reload
{ storage: 'none' }     // No persistence at all
```

---

## Performance

- The script loads asynchronously and does not block page rendering
- Idle CPU usage is effectively zero when no dynamic features are active
- Pointer-tracking features (Reading Guide, Reading Mask) use `requestAnimationFrame`
- DOM mutation reprocessing is debounced to ~130ms
- The widget UI is fully contained in a Shadow DOM and does not affect page styles

---

## Browser Support

| Browser | Versions |
|---|---|
| Chrome / Edge | Latest 2 major versions |
| Firefox | Latest 2 major versions |
| Safari | Latest 2 major versions |
| iOS Safari | Latest 2 major versions |
| Android Chrome | Latest 2 major versions |

### Graceful degradation

- If `speechSynthesis` is unavailable, the Read Aloud control is hidden
- If custom cursors are unsupported or touch-only, Big Cursor is hidden
- If `localStorage` is unavailable, the widget falls back to session or memory storage
- If `MutationObserver` is unavailable, features initialize once without dynamic reapply

---

## Troubleshooting

### Widget doesn't appear

1. Check the browser console for errors
2. Ensure the script path is correct and the file loads (Network tab)
3. Verify `enabled` is not set to `false` in the config
4. Check that `document.body` exists when the script runs (use `async` attribute)

### Widget appears but features don't work

1. Check if the feature is enabled in the `features` config
2. Check if the target elements have `data-aa-skip` attributes
3. Look for CSS `!important` rules in your site's styles that may override feature styles

### Widget launcher disappears

1. Clear the persisted state: `localStorage.removeItem('acorn.access.v1.state')`
2. Reload the page
3. If this resolves it, the issue was a previously persisted feature state

### Styles conflict with my site

- The widget UI lives inside a Shadow DOM and cannot affect your styles
- Feature styles use `!important` to override site CSS. Use `data-aa-skip` to exclude specific elements
- If your site uses extreme CSS specificity, some visual overrides may be less effective

### CSP errors in console

- Pass the `cspNonce` config option matching your CSP nonce
- Ensure your CSP allows `style-src` with the nonce value

---

## Bundle Details

| File | Description |
|---|---|
| `dist/acorn-access.min.js` | Production IIFE bundle (single file, everything embedded) |
| `dist/acorn-access.es.js` | ES module build (for bundler consumers) |

The production bundle is approximately **79 KB** (19 KB gzipped) and includes all fonts, icons, and cursor assets inline. No additional files need to be hosted.
