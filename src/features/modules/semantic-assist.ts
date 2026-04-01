import type { FeatureModule } from '../types';
import type { FeatureState, ResolvedConfig } from '../../config/types';
import type { PatchRegistry } from '../patch-registry';
import { isSkipped } from '../../utils/dom';

export function createSemanticAssistModule(patchRegistry: PatchRegistry): FeatureModule {
  function processTree(root: Node): void {
    if (!(root instanceof Element)) return;

    // 1. Label icon-only buttons
    const buttons = root.querySelectorAll('button, [role="button"], a[role="button"]');
    buttons.forEach((btn) => {
      if (isSkipped(btn, 'semanticAssist')) return;
      if (patchRegistry.hasPatch('semanticAssist', btn)) return;

      // Check if button has no visible text
      const text = btn.textContent?.trim();
      if (text && text.length > 1) return; // Has text content

      // Check if already labeled
      if (btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby')) return;

      // Try to derive label from title, child img alt, or SVG title
      const label = deriveLabel(btn);
      if (label) {
        patchRegistry.set('semanticAssist', btn, 'aria-label', label);
      }
    });

    // 2. Add keyboard support to clickable non-semantic elements
    const clickables = root.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea)');
    clickables.forEach((el) => {
      if (isSkipped(el, 'semanticAssist')) return;
      if (patchRegistry.hasPatch('semanticAssist', el)) return;

      // Only if no native semantics
      if (el.getAttribute('role')) return;
      if (el.getAttribute('tabindex')) return;

      patchRegistry.set('semanticAssist', el, 'role', 'button');
      patchRegistry.set('semanticAssist', el, 'tabindex', '0');

      // Add keyboard handler
      const handler = (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          e.preventDefault();
          (el as HTMLElement).click();
        }
      };
      el.addEventListener('keydown', handler);
    });

    // 3. Hide decorative SVGs from assistive tech
    const svgs = root.querySelectorAll('svg:not([role])');
    svgs.forEach((svg) => {
      if (isSkipped(svg, 'semanticAssist')) return;
      if (patchRegistry.hasPatch('semanticAssist', svg)) return;

      // If SVG has no title or aria-label and is not interactive, mark as decorative
      if (
        !svg.getAttribute('aria-label') &&
        !svg.querySelector('title') &&
        !svg.closest('button, a, [role="button"], [role="link"]')
      ) {
        patchRegistry.set('semanticAssist', svg, 'aria-hidden', 'true');
        patchRegistry.set('semanticAssist', svg, 'role', 'presentation');
      }
    });
  }

  function deriveLabel(el: Element): string | null {
    // From title attribute
    const title = el.getAttribute('title')?.trim();
    if (title) return title;

    // From child img alt
    const img = el.querySelector('img[alt]');
    if (img) {
      const alt = img.getAttribute('alt')?.trim();
      if (alt) return alt;
    }

    // From child SVG title
    const svgTitle = el.querySelector('svg title');
    if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim();

    // From aria-describedby
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      const desc = document.getElementById(describedBy);
      if (desc?.textContent?.trim()) return desc.textContent.trim();
    }

    return null;
  }

  return {
    key: 'semanticAssist',
    order: 105,

    getCss(): string { return ''; },

    enable(): void {
      processTree(document.body);
    },

    disable(): void {
      patchRegistry.revert('semanticAssist');
    },

    reapply(_state: FeatureState, _config: ResolvedConfig, nodes?: Node[]): void {
      if (nodes && nodes.length > 0) {
        for (const node of nodes) {
          processTree(node);
        }
      } else {
        patchRegistry.revert('semanticAssist');
        processTree(document.body);
      }
    },

    isSupported(): boolean { return true; },
    destroy(): void { this.disable(); },
  };
}
