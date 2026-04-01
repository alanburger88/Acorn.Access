import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';
import { setDataAttr, removeDataAttr } from '../../utils/css';

export function createContrastModule(): FeatureModule {
  return {
    key: 'contrast',
    order: 60,

    getCss(state: FeatureState): string {
      switch (state.contrast) {
        case 'dark':
          return `
            html[data-aa-contrast="dark"] {
              background-color: #1a1a2e !important;
              color: #e0e0e0 !important;
            }
            html[data-aa-contrast="dark"] body {
              background-color: #1a1a2e !important;
              color: #e0e0e0 !important;
            }
            html[data-aa-contrast="dark"] *:not([data-aa-skip~="contrast"]):not(img):not(video):not(canvas):not(svg):not(picture) {
              background-color: inherit !important;
              color: inherit !important;
              border-color: #444 !important;
            }
            html[data-aa-contrast="dark"] a:not([data-aa-skip~="contrast"]) {
              color: #6eb5ff !important;
            }
            html[data-aa-contrast="dark"] a:visited:not([data-aa-skip~="contrast"]) {
              color: #c9a0ff !important;
            }
            html[data-aa-contrast="dark"] input:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="dark"] textarea:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="dark"] select:not([data-aa-skip~="contrast"]) {
              background-color: #2a2a3e !important;
              color: #e0e0e0 !important;
              border-color: #555 !important;
            }
          `;
        case 'light':
          return `
            html[data-aa-contrast="light"] {
              background-color: #ffffff !important;
              color: #111111 !important;
            }
            html[data-aa-contrast="light"] body {
              background-color: #ffffff !important;
              color: #111111 !important;
            }
            html[data-aa-contrast="light"] *:not([data-aa-skip~="contrast"]):not(img):not(video):not(canvas):not(svg):not(picture) {
              background-color: inherit !important;
              color: inherit !important;
            }
            html[data-aa-contrast="light"] a:not([data-aa-skip~="contrast"]) {
              color: #0000cc !important;
            }
          `;
        case 'invert':
          return `
            html[data-aa-contrast="invert"] body {
              filter: invert(1) hue-rotate(180deg) !important;
            }
            html[data-aa-contrast="invert"] body img:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="invert"] body video:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="invert"] body canvas:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="invert"] body picture:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="invert"] body svg:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="invert"] body [style*="background-image"]:not([data-aa-skip~="contrast"]) {
              filter: invert(1) hue-rotate(180deg) !important;
            }
          `;
        case 'high':
          return `
            html[data-aa-contrast="high"] {
              background-color: #000000 !important;
              color: #ffffff !important;
            }
            html[data-aa-contrast="high"] body {
              background-color: #000000 !important;
              color: #ffffff !important;
            }
            html[data-aa-contrast="high"] *:not([data-aa-skip~="contrast"]):not(img):not(video):not(canvas):not(svg):not(picture) {
              background-color: inherit !important;
              color: inherit !important;
              border-color: #ffffff !important;
            }
            html[data-aa-contrast="high"] a:not([data-aa-skip~="contrast"]) {
              color: #ffff00 !important;
              text-decoration: underline !important;
            }
            html[data-aa-contrast="high"] a:visited:not([data-aa-skip~="contrast"]) {
              color: #ff80ff !important;
            }
            html[data-aa-contrast="high"] button:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="high"] [role="button"]:not([data-aa-skip~="contrast"]) {
              border: 2px solid #ffffff !important;
            }
            html[data-aa-contrast="high"] input:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="high"] textarea:not([data-aa-skip~="contrast"]),
            html[data-aa-contrast="high"] select:not([data-aa-skip~="contrast"]) {
              background-color: #1a1a1a !important;
              color: #ffffff !important;
              border: 2px solid #ffffff !important;
            }
            html[data-aa-contrast="high"] *:focus-visible {
              outline: 3px solid #ffff00 !important;
              outline-offset: 2px !important;
            }
          `;
        default:
          return '';
      }
    },

    enable(state: FeatureState): void {
      if (state.contrast !== 'off') {
        setDataAttr('contrast', state.contrast);
      }
    },

    disable(): void {
      removeDataAttr('contrast');
    },

    reapply(state: FeatureState): void {
      if (state.contrast !== 'off') {
        setDataAttr('contrast', state.contrast);
      } else {
        removeDataAttr('contrast');
      }
    },

    isSupported(): boolean { return true; },
    destroy(): void {
      removeDataAttr('contrast');
    },
  };
}
