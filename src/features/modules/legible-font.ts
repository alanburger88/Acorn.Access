import type { FeatureModule } from '../types';

export function createLegibleFontModule(): FeatureModule {
  return {
    key: 'legibleFont',
    order: 21,

    getCss(): string {
      return `
        body:not([data-aa-skip~="legibleFont"]) *:not([data-aa-skip~="legibleFont"]):not(code):not(pre):not(kbd):not(samp):not(.fa):not(.fas):not(.far):not(.fab):not(.material-icons):not([class*="icon"]) {
          font-family: 'Atkinson Hyperlegible', 'Calibri', 'Verdana', system-ui, -apple-system, sans-serif !important;
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
