import type { FeatureModule } from '../types';
import type { FeatureState } from '../../config/types';

const SPACING: Record<number, { letter: string; word: string; paragraph: string }> = {
  0: { letter: '0', word: '0', paragraph: '0' },
  1: { letter: '0.05em', word: '0.1em', paragraph: '0.5em' },
  2: { letter: '0.1em', word: '0.2em', paragraph: '1em' },
  3: { letter: '0.15em', word: '0.3em', paragraph: '1.5em' },
};

export function createTextSpacingModule(): FeatureModule {
  return {
    key: 'textSpacing',
    order: 40,

    getCss(state: FeatureState): string {
      const level = state.textSpacing;
      if (level === 0) return '';
      const s = SPACING[level] ?? SPACING[1];
      return `
        body:not([data-aa-skip~="textSpacing"]) *:not([data-aa-skip~="textSpacing"]):not(input):not(select):not(textarea):not(button) {
          letter-spacing: ${s.letter} !important;
          word-spacing: ${s.word} !important;
        }
        body:not([data-aa-skip~="textSpacing"]) p:not([data-aa-skip~="textSpacing"]) {
          margin-bottom: ${s.paragraph} !important;
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
