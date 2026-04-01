import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';

export function createTextAlignModule(): FeatureModule {
  return {
    key: 'textAlign',
    order: 50,

    getCss(state: FeatureState): string {
      if (state.textAlign === 'off') return '';
      return `
        body:not([data-aa-skip~="textAlign"]) p:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) li:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) td:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) th:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h1:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h2:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h3:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h4:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h5:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) h6:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) blockquote:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) article:not([data-aa-skip~="textAlign"]),
        body:not([data-aa-skip~="textAlign"]) section:not([data-aa-skip~="textAlign"]) {
          text-align: ${state.textAlign} !important;
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
