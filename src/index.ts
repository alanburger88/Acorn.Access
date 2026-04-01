import type { AcornAccessConfig, FeatureState } from './config/types';
import { parseConfigFromScript, resolveConfig } from './config/parser';
import { DEFAULT_PROFILES } from './config/profiles';
import { createStore, type Store } from './state/store';
import { createWidgetMount, type WidgetMount } from './ui/mount';
import { createLauncher, type Launcher } from './ui/launcher';
import { createPanel, type Panel } from './ui/panel';
import { createCompositor, type Compositor } from './features/compositor';
import { createPatchRegistry, type PatchRegistry } from './features/patch-registry';
import { createOverlayManager, type OverlayManager } from './features/overlay-manager';
import { createFeatureEngine, type FeatureEngine } from './features/registry';
import { createDOMObserver, type DOMObserver } from './observers/mutation-observer';
import { createNavigationObserver, type NavigationObserver } from './observers/navigation-observer';
import { createPublicAPI, exposeAPI } from './api/public-api';
import { dispatchEvent } from './api/events';
import { waitForBody } from './utils/dom';
import { resolveStorageType } from './utils/platform';

let initialized = false;
let mount: WidgetMount | null = null;
let store: Store | null = null;
let launcher: Launcher | null = null;
let panel: Panel | null = null;
let compositor: Compositor | null = null;
let patchRegistry: PatchRegistry | null = null;
let overlayManager: OverlayManager | null = null;
let featureEngine: FeatureEngine | null = null;
let domObserver: DOMObserver | null = null;
let navObserver: NavigationObserver | null = null;

function init(userConfig?: AcornAccessConfig): void {
  if (initialized) return;

  const scriptConfig = parseConfigFromScript();
  const merged = { ...scriptConfig, ...userConfig };

  // Merge profiles from defaults
  if (!merged.profiles || Object.keys(merged.profiles).length === 0) {
    merged.profiles = { ...DEFAULT_PROFILES };
  }

  const config = resolveConfig(merged);
  if (!config.enabled) return;

  // Resolve actual storage type (with fallback)
  config.storage = resolveStorageType(config.storage);

  waitForBody().then(() => {
    // Create state store
    store = createStore(config);

    // Create UI mount
    mount = createWidgetMount(config);

    // Create feature infrastructure
    patchRegistry = createPatchRegistry();
    overlayManager = createOverlayManager(config.zIndex);
    compositor = createCompositor(config);

    // Create panel (needs store for reactivity)
    panel = createPanel(config, store, closePanel);

    // Create launcher
    launcher = createLauncher(config, togglePanel);

    // Append UI to shadow DOM
    mount.shadow.appendChild(launcher.element);
    mount.shadow.appendChild(panel.element);

    // Create feature engine with panel callbacks
    featureEngine = createFeatureEngine(
      config,
      compositor,
      patchRegistry,
      overlayManager,
      (html) => panel?.setPageStructureContent(html),
      (html) => panel?.setReadAloudControls(html)
    );

    // Apply persisted state
    const state = store.getState();
    featureEngine.applyState(state);

    // Subscribe to state changes
    store.subscribe((newState: FeatureState) => {
      featureEngine?.applyState(newState);

      // Dispatch feature change events
      dispatchEvent('acorn.access:feature-change', {
        state: { ...newState },
      });
    });

    // Set up DOM observer
    domObserver = createDOMObserver((nodes) => {
      if (featureEngine && store) {
        featureEngine.reapply(store.getState(), nodes);
      }
    });
    domObserver.start();

    // Set up navigation observer
    navObserver = createNavigationObserver(() => {
      if (featureEngine && store) {
        featureEngine.reapply(store.getState());
      }
    });
    navObserver.start();

    // Expose public API
    const api = createPublicAPI({
      init,
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      destroy,
      reset: resetAll,
      setFeature(name: string, value: unknown) {
        if (!store) return;
        if (!config.features[name as keyof typeof config.features]) return;
        store.setState({ [name]: value } as Partial<FeatureState>);
      },
      setProfile(name: string | null) {
        if (!store) return;
        if (name === null) {
          store.reset();
          return;
        }
        const profileDef = config.profiles[name];
        if (profileDef) {
          // Reset to defaults first to prevent features from previous profile leaking
          store.reset();
          store.setState({ ...profileDef.settings, profile: name });
          dispatchEvent('acorn.access:profile-change', { profile: name });
        }
      },
      getState() {
        return store?.getState() ?? ({} as FeatureState);
      },
    });

    exposeAPI(api);
    initialized = true;

    dispatchEvent('acorn.access:ready');
  });
}

function openPanel(): void {
  panel?.open();
  launcher?.setExpanded(true);
  dispatchEvent('acorn.access:open');
}

function closePanel(): void {
  panel?.close();
  launcher?.setExpanded(false);
  // Return focus to launcher
  requestAnimationFrame(() => {
    launcher?.element.focus();
  });
  dispatchEvent('acorn.access:close');
}

function togglePanel(): void {
  if (panel?.isOpen()) {
    closePanel();
  } else {
    openPanel();
  }
}

function resetAll(): void {
  store?.reset();
  dispatchEvent('acorn.access:reset');
}

function destroy(): void {
  domObserver?.destroy();
  navObserver?.destroy();
  featureEngine?.destroy();
  overlayManager?.destroy();
  patchRegistry?.destroy();
  panel?.destroy();
  launcher?.destroy();
  mount?.destroy();
  store?.destroy();

  domObserver = null;
  navObserver = null;
  featureEngine = null;
  overlayManager = null;
  patchRegistry = null;
  compositor = null;
  panel = null;
  launcher = null;
  mount = null;
  store = null;
  initialized = false;

  // Remove public API
  const win = window as unknown as Record<string, unknown>;
  if (win.Acorn) {
    delete (win.Acorn as Record<string, unknown>).Access;
  }
}

// Auto-init if script has data-acorn-access attribute
const scriptEl = document.querySelector('script[data-acorn-access]');
if (scriptEl) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
}

// Also expose init for programmatic use before auto-init
const win = window as unknown as Record<string, unknown>;
if (!win.Acorn) win.Acorn = {};
(win.Acorn as Record<string, unknown>).Access = { init };

export type { AcornAccessConfig, FeatureState };
export { init };
