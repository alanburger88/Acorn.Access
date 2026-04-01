import { aaId } from '../utils/dom';

export interface OverlayManager {
  getContainer(): HTMLElement;
  addOverlay(id: string, element: HTMLElement): void;
  removeOverlay(id: string): void;
  hasOverlay(id: string): boolean;
  destroy(): void;
}

export function createOverlayManager(zIndex: number): OverlayManager {
  const overlays = new Map<string, HTMLElement>();
  let container: HTMLElement | null = null;

  function getOrCreateContainer(): HTMLElement {
    if (!container) {
      container = document.createElement('div');
      container.id = aaId('overlays');
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: ${zIndex - 1};
        overflow: hidden;
      `;
      // Mount on <html> so body-level CSS filters don't break overlays
      document.documentElement.appendChild(container);
    }
    return container;
  }

  return {
    getContainer(): HTMLElement {
      return getOrCreateContainer();
    },

    addOverlay(id: string, element: HTMLElement): void {
      this.removeOverlay(id);
      element.style.pointerEvents = element.style.pointerEvents || 'none';
      overlays.set(id, element);
      getOrCreateContainer().appendChild(element);
    },

    removeOverlay(id: string): void {
      const existing = overlays.get(id);
      if (existing) {
        existing.remove();
        overlays.delete(id);
      }
    },

    hasOverlay(id: string): boolean {
      return overlays.has(id);
    },

    destroy(): void {
      for (const [, el] of overlays) {
        el.remove();
      }
      overlays.clear();
      if (container) {
        container.remove();
        container = null;
      }
    },
  };
}
