export interface NavigationObserver {
  start(): void;
  stop(): void;
  destroy(): void;
}

export function createNavigationObserver(
  onNavigate: () => void
): NavigationObserver {
  let origPushState: typeof history.pushState | null = null;
  let origReplaceState: typeof history.replaceState | null = null;
  let popstateHandler: (() => void) | null = null;
  let hashchangeHandler: (() => void) | null = null;

  return {
    start(): void {
      // Wrap pushState
      origPushState = history.pushState.bind(history);
      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        origPushState!(...args);
        onNavigate();
      };

      // Wrap replaceState
      origReplaceState = history.replaceState.bind(history);
      history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
        origReplaceState!(...args);
        onNavigate();
      };

      // Listen for popstate (back/forward)
      popstateHandler = () => onNavigate();
      window.addEventListener('popstate', popstateHandler);

      // Listen for hashchange
      hashchangeHandler = () => onNavigate();
      window.addEventListener('hashchange', hashchangeHandler);
    },

    stop(): void {
      // Restore originals
      if (origPushState) {
        history.pushState = origPushState;
        origPushState = null;
      }
      if (origReplaceState) {
        history.replaceState = origReplaceState;
        origReplaceState = null;
      }

      if (popstateHandler) {
        window.removeEventListener('popstate', popstateHandler);
        popstateHandler = null;
      }
      if (hashchangeHandler) {
        window.removeEventListener('hashchange', hashchangeHandler);
        hashchangeHandler = null;
      }
    },

    destroy(): void {
      this.stop();
    },
  };
}
