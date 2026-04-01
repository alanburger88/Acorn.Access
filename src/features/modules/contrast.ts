import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';
import { setDataAttr, removeDataAttr } from '../../utils/css';

const SKIP = ':not([data-aa-skip~="contrast"]):not([data-aa-skip="all"])';
const SKIP_MEDIA = `${SKIP}:not(img):not(video):not(canvas):not(svg):not(picture)`;

export function createContrastModule(): FeatureModule {
  return {
    key: 'contrast',
    order: 60,

    getCss(state: FeatureState): string {
      switch (state.contrast) {
        case 'dark':
          return `
            html[data-aa-contrast="dark"] body {
              background-color: #1a1a2e !important;
              color: #e0e0e0 !important;
            }
            html[data-aa-contrast="dark"] body *${SKIP_MEDIA} {
              background-color: inherit !important;
              color: inherit !important;
              border-color: #444 !important;
            }
            html[data-aa-contrast="dark"] body a${SKIP} {
              color: #6eb5ff !important;
            }
            html[data-aa-contrast="dark"] body a:visited${SKIP} {
              color: #c9a0ff !important;
            }
            html[data-aa-contrast="dark"] body input${SKIP},
            html[data-aa-contrast="dark"] body textarea${SKIP},
            html[data-aa-contrast="dark"] body select${SKIP} {
              background-color: #2a2a3e !important;
              color: #e0e0e0 !important;
              border-color: #555 !important;
            }
          `;
        case 'light':
          return `
            html[data-aa-contrast="light"] body {
              background-color: #ffffff !important;
              color: #111111 !important;
            }
            html[data-aa-contrast="light"] body *${SKIP_MEDIA} {
              background-color: inherit !important;
              color: inherit !important;
            }
            html[data-aa-contrast="light"] body a${SKIP} {
              color: #0000cc !important;
            }
          `;
        case 'invert':
          return `
            html[data-aa-contrast="invert"] body {
              filter: invert(1) hue-rotate(180deg) !important;
            }
            html[data-aa-contrast="invert"] body img${SKIP},
            html[data-aa-contrast="invert"] body video${SKIP},
            html[data-aa-contrast="invert"] body canvas${SKIP},
            html[data-aa-contrast="invert"] body picture${SKIP},
            html[data-aa-contrast="invert"] body svg${SKIP},
            html[data-aa-contrast="invert"] body [style*="background-image"]${SKIP} {
              filter: invert(1) hue-rotate(180deg) !important;
            }
          `;
        case 'high':
          return `
            html[data-aa-contrast="high"] body {
              background-color: #000000 !important;
              color: #ffffff !important;
            }
            html[data-aa-contrast="high"] body *${SKIP_MEDIA} {
              background-color: inherit !important;
              color: inherit !important;
              border-color: #ffffff !important;
            }
            html[data-aa-contrast="high"] body a${SKIP} {
              color: #ffff00 !important;
              text-decoration: underline !important;
            }
            html[data-aa-contrast="high"] body a:visited${SKIP} {
              color: #ff80ff !important;
            }
            html[data-aa-contrast="high"] body button${SKIP},
            html[data-aa-contrast="high"] body [role="button"]${SKIP} {
              border: 2px solid #ffffff !important;
            }
            html[data-aa-contrast="high"] body input${SKIP},
            html[data-aa-contrast="high"] body textarea${SKIP},
            html[data-aa-contrast="high"] body select${SKIP} {
              background-color: #1a1a1a !important;
              color: #ffffff !important;
              border: 2px solid #ffffff !important;
            }
            html[data-aa-contrast="high"] body *:focus-visible {
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
