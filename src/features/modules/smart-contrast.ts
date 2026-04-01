import type { FeatureModule } from '../types';
import type { FeatureState, ResolvedConfig } from '../../config/types';
import type { PatchRegistry } from '../patch-registry';
import { parseColor, contrastRatio, correctContrast, getEffectiveBackground, rgbToString } from '../../utils/color';
import { isSkipped, isVisible } from '../../utils/dom';

const THRESHOLD_NORMAL = 4.5;
const THRESHOLD_LARGE = 3.0;
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;

let patchCounter = 0;

export function createSmartContrastModule(patchRegistry: PatchRegistry): FeatureModule {
  let styleEl: HTMLStyleElement | null = null;
  const fixRules: string[] = [];

  function processElement(el: HTMLElement): void {
    if (isSkipped(el, 'smartContrast')) return;
    if (!isVisible(el)) return;
    if (patchRegistry.hasPatch('smartContrast', el)) return;

    const style = getComputedStyle(el);
    const fg = parseColor(style.color);
    const bg = getEffectiveBackground(el);

    if (!fg || !bg) return;

    const fontSize = parseFloat(style.fontSize);
    const fontWeight = parseInt(style.fontWeight) || 400;
    const isLarge = fontSize >= LARGE_TEXT_PX || (fontSize >= LARGE_BOLD_TEXT_PX && fontWeight >= 700);
    const threshold = isLarge ? THRESHOLD_LARGE : THRESHOLD_NORMAL;

    const ratio = contrastRatio(fg, bg);
    if (ratio >= threshold) return;

    const corrected = correctContrast(fg, bg, threshold);
    const fixId = `aa-cf-${++patchCounter}`;

    patchRegistry.set('smartContrast', el, 'data-aa-contrast-fix', fixId);
    fixRules.push(`[data-aa-contrast-fix="${fixId}"] { color: ${rgbToString(corrected)} !important; }`);
  }

  function processTree(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node as HTMLElement;
        if (el.id === 'acorn-access-host') return NodeFilter.FILTER_REJECT;
        if (el.id === 'acorn-access-overlays') return NodeFilter.FILTER_REJECT;
        const tag = el.tagName?.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
        if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'svg') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Node | null = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement && node.childNodes.length > 0) {
        // Only process elements that directly contain text
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            processElement(node);
            break;
          }
        }
      }
      node = walker.nextNode();
    }
  }

  function applyFixes(): void {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'acorn-access-smart-contrast';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = fixRules.join('\n');
  }

  return {
    key: 'smartContrast',
    order: 62,

    getCss(): string {
      return ''; // Smart contrast uses its own style element
    },

    enable(): void {
      fixRules.length = 0;
      patchCounter = 0;
      processTree(document.body);
      applyFixes();
    },

    disable(): void {
      patchRegistry.revert('smartContrast');
      fixRules.length = 0;
      if (styleEl) {
        styleEl.remove();
        styleEl = null;
      }
    },

    reapply(_state: FeatureState, _config: ResolvedConfig, nodes?: Node[]): void {
      if (nodes && nodes.length > 0) {
        for (const node of nodes) {
          processTree(node);
        }
      } else {
        patchRegistry.revert('smartContrast');
        fixRules.length = 0;
        patchCounter = 0;
        processTree(document.body);
      }
      applyFixes();
    },

    isSupported(): boolean { return true; },

    destroy(): void {
      this.disable();
    },
  };
}
