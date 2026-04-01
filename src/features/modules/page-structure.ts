import type { FeatureModule } from '../types';

interface StructureItem {
  tag: string;
  text: string;
  level: number;
  element: Element;
}

export function createPageStructureModule(
  onUpdate?: (html: string) => void
): FeatureModule {
  let items: StructureItem[] = [];
  let clickHandlers: (() => void)[] = [];

  function scan(): StructureItem[] {
    const result: StructureItem[] = [];

    // Headings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((h) => {
      if (h.closest('#acorn-access-host')) return;
      const level = parseInt(h.tagName.charAt(1));
      const text = h.textContent?.trim().slice(0, 80) || '';
      if (text) {
        result.push({ tag: h.tagName, text, level, element: h });
      }
    });

    // Landmarks
    const landmarks = document.querySelectorAll(
      'main, nav, aside, header, footer, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="search"], [role="form"]'
    );
    landmarks.forEach((el) => {
      if (el.closest('#acorn-access-host')) return;
      const label = el.getAttribute('aria-label') || el.tagName.toLowerCase();
      result.push({
        tag: el.getAttribute('role') || el.tagName.toLowerCase(),
        text: label,
        level: 0,
        element: el,
      });
    });

    return result;
  }

  function renderHTML(): string {
    if (items.length === 0) {
      return '<p style="font-size:13px;color:#64748b;padding:8px 0;">No structure found on this page.</p>';
    }

    let html = '<ul class="aa-structure-list">';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const indent = item.level > 0 ? Math.min(item.level - 1, 5) : 0;
      html += `
        <li class="aa-structure-item aa-structure-indent-${indent}"
            tabindex="0"
            role="button"
            data-structure-index="${i}">
          <span class="aa-structure-tag">${item.tag}</span>
          <span class="aa-structure-text">${escapeHtml(item.text)}</span>
        </li>
      `;
    }
    html += '</ul>';
    return html;
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    key: 'pageStructure',
    order: 103,

    getCss(): string { return ''; },

    enable(): void {
      items = scan();
      const html = renderHTML();
      onUpdate?.(html);

      // We'll wire up click handlers after the HTML is injected
      // The panel will handle this via event delegation
      requestAnimationFrame(() => {
        const host = document.getElementById('acorn-access-host');
        if (host?.shadowRoot) {
          const shadowItems = host.shadowRoot.querySelectorAll('[data-structure-index]');
          shadowItems.forEach((el) => {
            const handler = () => {
              const idx = parseInt(el.getAttribute('data-structure-index') || '0');
              const item = items[idx];
              if (item?.element?.isConnected) {
                item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (item.element instanceof HTMLElement) {
                  item.element.focus({ preventScroll: true });
                }
              }
            };
            el.addEventListener('click', handler);
            el.addEventListener('keydown', (e) => {
              if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
                e.preventDefault();
                handler();
              }
            });
            clickHandlers.push(handler);
          });
        }
      });
    },

    disable(): void {
      items = [];
      clickHandlers = [];
      onUpdate?.('');
    },

    reapply(): void {
      items = scan();
      const html = renderHTML();
      onUpdate?.(html);
    },

    isSupported(): boolean { return true; },
    destroy(): void {
      this.disable();
    },
  };
}
