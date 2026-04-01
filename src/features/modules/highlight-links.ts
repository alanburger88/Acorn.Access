import type { FeatureModule } from '../types';

export function createHighlightLinksModule(): FeatureModule {
  return {
    key: 'highlightLinks',
    order: 70,

    getCss(): string {
      return `
        body:not([data-aa-skip~="highlightLinks"]) a:not([data-aa-skip~="highlightLinks"]),
        body:not([data-aa-skip~="highlightLinks"]) [role="link"]:not([data-aa-skip~="highlightLinks"]) {
          text-decoration: underline !important;
          text-decoration-thickness: 2px !important;
          text-underline-offset: 3px !important;
          outline: 2px solid transparent !important;
          outline-offset: 2px !important;
        }
        body:not([data-aa-skip~="highlightLinks"]) a:hover:not([data-aa-skip~="highlightLinks"]),
        body:not([data-aa-skip~="highlightLinks"]) a:focus-visible:not([data-aa-skip~="highlightLinks"]),
        body:not([data-aa-skip~="highlightLinks"]) [role="link"]:hover:not([data-aa-skip~="highlightLinks"]),
        body:not([data-aa-skip~="highlightLinks"]) [role="link"]:focus-visible:not([data-aa-skip~="highlightLinks"]) {
          outline-color: currentColor !important;
          background-color: rgba(128, 209, 0, 0.15) !important;
        }
      `;
    },

    enable(): void {},
    disable(): void {},
    reapply(): void {},
    isSupported(): boolean { return true; },
    destroy(): void {},
  };
}
