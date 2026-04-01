import type { FeatureState, ResolvedConfig } from '../config/types';
import type { FeatureModule } from './types';
import { isFeatureActive } from './types';
import { createStyleElement } from '../utils/dom';

const STYLE_ID = 'acorn-access-styles';

export interface Compositor {
  setModules(modules: FeatureModule[]): void;
  update(state: FeatureState): void;
  destroy(): void;
}

export function createCompositor(
  config: ResolvedConfig
): Compositor {
  let sorted: FeatureModule[] = [];
  let styleEl: HTMLStyleElement | null = null;

  function getStyleElement(): HTMLStyleElement {
    if (!styleEl) {
      styleEl = createStyleElement('', config.cspNonce, STYLE_ID);
      document.head.appendChild(styleEl);
    }
    return styleEl;
  }

  return {
    setModules(modules: FeatureModule[]): void {
      sorted = [...modules].sort((a, b) => a.order - b.order);
    },

    update(state: FeatureState): void {
      const css = sorted
        .filter((m) => isFeatureActive(state, m.key))
        .map((m) => m.getCss(state, config))
        .filter(Boolean)
        .join('\n');

      getStyleElement().textContent = css;
    },

    destroy(): void {
      if (styleEl) {
        styleEl.remove();
        styleEl = null;
      }
    },
  };
}
