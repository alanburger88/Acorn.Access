import type { ResolvedConfig } from '../config/types';
import { getIcon } from './icons';

export interface Launcher {
  element: HTMLButtonElement;
  setExpanded(expanded: boolean): void;
  destroy(): void;
}

export function createLauncher(
  config: ResolvedConfig,
  onToggle: () => void
): Launcher {
  const btn = document.createElement('button');
  btn.className = `aa-launcher${config.size === 'oversized' ? ' aa-oversized' : ''}`;
  btn.setAttribute('aria-label', 'Accessibility Settings');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = getIcon('accessibility', config.size === 'oversized' ? 36 : 28);

  btn.addEventListener('click', onToggle);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  });

  return {
    element: btn,
    setExpanded(expanded: boolean) {
      btn.setAttribute('aria-expanded', String(expanded));
    },
    destroy() {
      btn.remove();
    },
  };
}
