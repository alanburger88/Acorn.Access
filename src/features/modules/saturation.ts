import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';

const SATURATION_VALUES: Record<string, string> = {
  off: '',
  low: '0.5',
  high: '1.5',
  desaturate: '0',
};

export function createSaturationModule(): FeatureModule {
  return {
    key: 'saturation',
    order: 61,

    getCss(state: FeatureState): string {
      if (state.saturation === 'off') return '';
      const val = SATURATION_VALUES[state.saturation] ?? '';
      if (!val) return '';
      return `
        body:not([data-aa-skip~="saturation"]) {
          filter: saturate(${val}) !important;
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
