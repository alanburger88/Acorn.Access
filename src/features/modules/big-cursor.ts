import type { FeatureModule } from '../types';
import { isTouchOnly } from '../../utils/platform';

// Big cursor as inline SVG data URI — all quotes must be %27 to avoid breaking CSS url()
const BIG_CURSOR_DEFAULT = `data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27 viewBox=%270 0 48 48%27%3E%3Cpath d=%27M8 4l28 16-12 4-8 12z%27 fill=%27%23000%27 stroke=%27%23fff%27 stroke-width=%272%27/%3E%3C/svg%3E`;
const BIG_CURSOR_POINTER = `data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27 viewBox=%270 0 48 48%27%3E%3Cpath d=%27M20 4v20l6-6 8 16 4-2-8-16h8z%27 fill=%27%23000%27 stroke=%27%23fff%27 stroke-width=%272%27/%3E%3C/svg%3E`;

export function createBigCursorModule(): FeatureModule {
  return {
    key: 'bigCursor',
    order: 75,

    getCss(): string {
      return `
        html:not([data-aa-skip~="bigCursor"]),
        html:not([data-aa-skip~="bigCursor"]) * {
          cursor: url('${BIG_CURSOR_DEFAULT}') 4 4, auto !important;
        }
        html:not([data-aa-skip~="bigCursor"]) a,
        html:not([data-aa-skip~="bigCursor"]) button,
        html:not([data-aa-skip~="bigCursor"]) [role="button"],
        html:not([data-aa-skip~="bigCursor"]) [role="link"],
        html:not([data-aa-skip~="bigCursor"]) label,
        html:not([data-aa-skip~="bigCursor"]) select,
        html:not([data-aa-skip~="bigCursor"]) summary {
          cursor: url('${BIG_CURSOR_POINTER}') 14 4, pointer !important;
        }
        html:not([data-aa-skip~="bigCursor"]) input[type="text"],
        html:not([data-aa-skip~="bigCursor"]) input[type="email"],
        html:not([data-aa-skip~="bigCursor"]) input[type="password"],
        html:not([data-aa-skip~="bigCursor"]) input[type="search"],
        html:not([data-aa-skip~="bigCursor"]) input[type="url"],
        html:not([data-aa-skip~="bigCursor"]) input[type="tel"],
        html:not([data-aa-skip~="bigCursor"]) input[type="number"],
        html:not([data-aa-skip~="bigCursor"]) textarea,
        html:not([data-aa-skip~="bigCursor"]) [contenteditable="true"] {
          cursor: text !important;
        }
      `;
    },

    enable(): void {},
    disable(): void {},
    reapply(): void {},
    isSupported(): boolean {
      return !isTouchOnly();
    },
    destroy(): void {},
  };
}
