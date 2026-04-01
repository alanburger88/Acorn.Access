import type { FeatureModule } from '../types';

// OpenDyslexic font - using system fallback approach for v1
// In production, woff2 files would be embedded via Vite ?inline imports
// For now, use the widely-available OpenDyslexic from local install or fallback

export function createDyslexiaFontModule(): FeatureModule {
  return {
    key: 'dyslexiaFont',
    order: 20,

    getCss(): string {
      return `
        @font-face {
          font-family: 'AA-OpenDyslexic';
          src: local('OpenDyslexic'), local('OpenDyslexic-Regular');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }
        @font-face {
          font-family: 'AA-OpenDyslexic';
          src: local('OpenDyslexic Bold'), local('OpenDyslexic-Bold');
          font-weight: bold;
          font-style: normal;
          font-display: swap;
        }
        body:not([data-aa-skip~="dyslexiaFont"]) *:not([data-aa-skip~="dyslexiaFont"]):not(code):not(pre):not(kbd):not(samp):not(.fa):not(.fas):not(.far):not(.fab):not(.material-icons):not([class*="icon"]) {
          font-family: 'AA-OpenDyslexic', 'Comic Sans MS', 'Trebuchet MS', sans-serif !important;
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
