import type { FeatureModule } from '../types';
import type { OverlayManager } from '../overlay-manager';
import { throttleRAF } from '../../utils/debounce';

const OVERLAY_ID = 'reading-mask';
const BAND_HEIGHT = 120;
const MASK_OPACITY = 0.75;

export function createReadingMaskModule(overlayManager: OverlayManager): FeatureModule {
  let container: HTMLElement | null = null;
  let topMask: HTMLElement | null = null;
  let bottomMask: HTMLElement | null = null;
  let moveHandler: ((e: MouseEvent) => void) & { cancel(): void } | null = null;
  let focusHandler: ((e: FocusEvent) => void) | null = null;

  function createMaskUI(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999998;
    `;

    topMask = document.createElement('div');
    topMask.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 0;
      background: rgba(0, 0, 0, ${MASK_OPACITY});
      pointer-events: none;
      transition: height 0.05s linear;
    `;

    bottomMask = document.createElement('div');
    bottomMask.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, ${MASK_OPACITY});
      pointer-events: none;
      transition: top 0.05s linear;
    `;

    wrapper.appendChild(topMask);
    wrapper.appendChild(bottomMask);
    return wrapper;
  }

  function updatePosition(y: number): void {
    const bandTop = Math.max(0, y - BAND_HEIGHT / 2);
    const bandBottom = y + BAND_HEIGHT / 2;

    if (topMask) topMask.style.height = `${bandTop}px`;
    if (bottomMask) {
      bottomMask.style.top = `${bandBottom}px`;
      bottomMask.style.height = `calc(100% - ${bandBottom}px)`;
    }
  }

  return {
    key: 'readingMask',
    order: 101,

    getCss(): string { return ''; },

    enable(): void {
      container = createMaskUI();
      overlayManager.addOverlay(OVERLAY_ID, container);

      moveHandler = throttleRAF((e: MouseEvent) => {
        updatePosition(e.clientY);
      }) as ((e: MouseEvent) => void) & { cancel(): void };

      focusHandler = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target) {
          const rect = target.getBoundingClientRect();
          updatePosition(rect.top + rect.height / 2);
        }
      };

      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('focusin', focusHandler);

      // Initial position: center of viewport
      updatePosition(window.innerHeight / 2);
    },

    disable(): void {
      if (moveHandler) {
        document.removeEventListener('mousemove', moveHandler);
        moveHandler.cancel();
        moveHandler = null;
      }
      if (focusHandler) {
        document.removeEventListener('focusin', focusHandler);
        focusHandler = null;
      }
      overlayManager.removeOverlay(OVERLAY_ID);
      container = null;
      topMask = null;
      bottomMask = null;
    },

    reapply(): void {},
    isSupported(): boolean { return true; },
    destroy(): void { this.disable(); },
  };
}
