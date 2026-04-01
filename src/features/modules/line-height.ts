import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';

const LINE_HEIGHTS: Record<number, string> = {
  0: 'inherit',
  1: '1.8',
  2: '2.2',
  3: '2.6',
};

export function createLineHeightModule(): FeatureModule {
  return {
    key: 'lineHeight',
    order: 41,

    getCss(state: FeatureState): string {
      const level = state.lineHeight;
      if (level === 0) return '';
      const lh = LINE_HEIGHTS[level] ?? '1.8';
      return `
        body:not([data-aa-skip~="lineHeight"]) p:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) li:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) td:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) th:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) dd:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) dt:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) span:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) div:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) blockquote:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) article:not([data-aa-skip~="lineHeight"]),
        body:not([data-aa-skip~="lineHeight"]) section:not([data-aa-skip~="lineHeight"]) {
          line-height: ${lh} !important;
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
