const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTrap {
  activate(): void;
  deactivate(): void;
  destroy(): void;
}

export function createFocusTrap(container: HTMLElement, onEscape?: () => void): FocusTrap {
  let active = false;
  let previousFocus: HTMLElement | null = null;

  function handleKeyDown(e: KeyboardEvent): void {
    if (!active) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape?.();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Get active element within shadow DOM
      const activeEl = container.getRootNode() instanceof ShadowRoot
        ? (container.getRootNode() as ShadowRoot).activeElement
        : document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl as Node)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl as Node)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  return {
    activate() {
      active = true;
      previousFocus = (document.activeElement as HTMLElement) || null;
      container.addEventListener('keydown', handleKeyDown);

      // Focus first focusable element
      requestAnimationFrame(() => {
        const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (first) first.focus();
      });
    },

    deactivate() {
      active = false;
      container.removeEventListener('keydown', handleKeyDown);

      // Return focus to previous element
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
      previousFocus = null;
    },

    destroy() {
      active = false;
      container.removeEventListener('keydown', handleKeyDown);
      previousFocus = null;
    },
  };
}
