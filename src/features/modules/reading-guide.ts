import type { FeatureModule } from '../types';
import type { OverlayManager } from '../overlay-manager';
import { throttleRAF } from '../../utils/debounce';

const OVERLAY_ID = 'reading-guide';
const GUIDE_HEIGHT = 3;
const GUIDE_COLOR = 'rgba(128, 209, 0, 0.7)';

export function createReadingGuideModule(overlayManager: OverlayManager): FeatureModule {
  let guideEl: HTMLElement | null = null;
  let moveHandler: ((e: MouseEvent) => void) & { cancel(): void } | null = null;
  let focusHandler: ((e: FocusEvent) => void) | null = null;

  function createGuide(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      left: 0;
      width: 100%;
      height: ${GUIDE_HEIGHT}px;
      background: ${GUIDE_COLOR};
      pointer-events: none;
      z-index: 999998;
      transition: top 0.05s linear;
      top: -10px;
    `;
    return el;
  }

  return {
    key: 'readingGuide',
    order: 100,

    getCss(): string { return ''; },

    enable(): void {
      guideEl = createGuide();
      overlayManager.addOverlay(OVERLAY_ID, guideEl);

      moveHandler = throttleRAF((e: MouseEvent) => {
        if (guideEl) {
          guideEl.style.top = `${e.clientY}px`;
        }
      }) as ((e: MouseEvent) => void) & { cancel(): void };

      focusHandler = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        if (target && guideEl) {
          const rect = target.getBoundingClientRect();
          guideEl.style.top = `${rect.top + rect.height / 2}px`;
        }
      };

      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('focusin', focusHandler);
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
      guideEl = null;
    },

    reapply(): void {},
    isSupported(): boolean { return true; },
    destroy(): void { this.disable(); },
  };
}
