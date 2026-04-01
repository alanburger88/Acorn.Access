import type { ResolvedConfig } from '../config/types';
import { getWidgetStyles } from './styles';
import { aaId } from '../utils/dom';

export interface WidgetMount {
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy(): void;
}

export function createWidgetMount(config: ResolvedConfig): WidgetMount {
  const host = document.createElement('div');
  host.id = aaId('host');
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Accessibility Settings');
  // Minimal inline styles — no position/filter/transform to avoid
  // creating a containing block that breaks fixed positioning in shadow DOM
  host.style.cssText = 'display:contents; pointer-events:none;';
  host.setAttribute('data-aa-skip', 'all');

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject widget styles
  const style = document.createElement('style');
  style.textContent = getWidgetStyles(config.position, config.offsetY, config.zIndex);
  shadow.appendChild(style);

  // Apply theme
  const theme = resolveTheme(config.theme);
  if (theme === 'dark') {
    host.setAttribute('data-aa-theme', 'dark');
  }

  // Mount on <html> (not <body>) so page-level CSS filters on body
  // don't break the widget's fixed positioning
  document.documentElement.appendChild(host);

  return {
    host,
    shadow,
    destroy() {
      host.remove();
    },
  };
}

function resolveTheme(theme: 'system' | 'light' | 'dark'): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
