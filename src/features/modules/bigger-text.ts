import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';

const SCALE_MAP: Record<number, string> = {
  0: '1',
  1: '1.15',
  2: '1.30',
  3: '1.50',
  4: '1.75',
  5: '2.00',
};

export function createBiggerTextModule(): FeatureModule {
  return {
    key: 'biggerText',
    order: 30,

    getCss(state: FeatureState): string {
      const level = state.biggerText;
      if (level === 0) return '';
      const scale = SCALE_MAP[level] ?? '1';
      return `
        html:not([data-aa-skip~="biggerText"]) {
          font-size: calc(1em * ${scale}) !important;
        }
        [data-aa-skip~="biggerText"] {
          font-size: initial;
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
