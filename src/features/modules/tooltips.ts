import type { FeatureModule } from '../types';
import type { OverlayManager } from '../overlay-manager';
import { isSkipped } from '../../utils/dom';

const TOOLTIP_ID = 'aa-tooltip';

export function createTooltipsModule(overlayManager: OverlayManager): FeatureModule {
  let tooltipEl: HTMLElement | null = null;
  let currentTarget: Element | null = null;
  let hoverHandler: ((e: MouseEvent) => void) | null = null;
  let outHandler: ((e: MouseEvent) => void) | null = null;
  let focusInHandler: ((e: FocusEvent) => void) | null = null;
  let focusOutHandler: ((e: FocusEvent) => void) | null = null;

  function createTooltip(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      max-width: 300px;
      padding: 8px 12px;
      background: #1e293b;
      color: #f1f5f9;
      font-size: 13px;
      line-height: 1.4;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      pointer-events: none;
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      word-break: break-word;
    `;
    el.setAttribute('role', 'tooltip');
    return el;
  }

  function getTooltipText(el: Element): string | null {
    if (isSkipped(el, 'tooltips')) return null;

    // For images
    if (el instanceof HTMLImageElement) {
      const alt = el.getAttribute('alt')?.trim();
      if (alt) return alt;
      const title = el.getAttribute('title')?.trim();
      if (title) return title;
      const ariaLabel = el.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
    }

    // For elements with aria-label
    if (el.hasAttribute('aria-label')) {
      return el.getAttribute('aria-label')?.trim() || null;
    }

    return null;
  }

  function showTooltip(target: Element, text: string, x: number, y: number): void {
    if (!tooltipEl) return;
    tooltipEl.textContent = text;
    tooltipEl.style.opacity = '1';

    // Position above the cursor
    const rect = tooltipEl.getBoundingClientRect();
    let left = x + 12;
    let top = y - 8 - (rect.height || 30);

    // Keep within viewport
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;
    if (top < 8) top = y + 20;
    if (left < 8) left = 8;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    currentTarget = target;
  }

  function hideTooltip(): void {
    if (tooltipEl) {
      tooltipEl.style.opacity = '0';
    }
    currentTarget = null;
  }

  return {
    key: 'tooltips',
    order: 102,

    getCss(): string { return ''; },

    enable(): void {
      tooltipEl = createTooltip();
      overlayManager.addOverlay(TOOLTIP_ID, tooltipEl);

      hoverHandler = (e: MouseEvent) => {
        const target = (e.target as Element)?.closest('img, [aria-label]');
        if (!target || target === currentTarget) return;

        const text = getTooltipText(target);
        if (text) {
          showTooltip(target, text, e.clientX, e.clientY);
        } else {
          hideTooltip();
        }
      };

      outHandler = (e: MouseEvent) => {
        const related = e.relatedTarget as Element | null;
        if (currentTarget && (!related || !currentTarget.contains(related))) {
          hideTooltip();
        }
      };

      focusInHandler = (e: FocusEvent) => {
        const target = e.target as Element;
        if (!target) return;
        const text = getTooltipText(target);
        if (text) {
          const rect = target.getBoundingClientRect();
          showTooltip(target, text, rect.left, rect.top);
        }
      };

      focusOutHandler = () => {
        hideTooltip();
      };

      document.addEventListener('mouseover', hoverHandler);
      document.addEventListener('mouseout', outHandler);
      document.addEventListener('focusin', focusInHandler);
      document.addEventListener('focusout', focusOutHandler);
    },

    disable(): void {
      if (hoverHandler) document.removeEventListener('mouseover', hoverHandler);
      if (outHandler) document.removeEventListener('mouseout', outHandler);
      if (focusInHandler) document.removeEventListener('focusin', focusInHandler);
      if (focusOutHandler) document.removeEventListener('focusout', focusOutHandler);
      hoverHandler = null;
      outHandler = null;
      focusInHandler = null;
      focusOutHandler = null;
      overlayManager.removeOverlay(TOOLTIP_ID);
      tooltipEl = null;
      currentTarget = null;
    },

    reapply(): void {},
    isSupported(): boolean { return true; },
    destroy(): void { this.disable(); },
  };
}
