// Shadow DOM stylesheet for the widget UI
// Uses all:initial at boundary, CSS variables for theming

export function getWidgetStyles(position: 'left' | 'right', offsetY: string, zIndex: number): string {
  return `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      ${position}: 0;
      z-index: ${zIndex};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      color: var(--aa-text, #1e293b);
      direction: ltr;
      pointer-events: none;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :host([data-aa-theme="dark"]) {
      --aa-bg: #1e293b;
      --aa-bg-surface: #334155;
      --aa-bg-hover: #475569;
      --aa-text: #f1f5f9;
      --aa-text-secondary: #94a3b8;
      --aa-border: #475569;
      --aa-accent: #80d100;
      --aa-accent-hover: #6ab300;
      --aa-accent-text: #0f172a;
      --aa-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    :host(:not([data-aa-theme="dark"])) {
      --aa-bg: #ffffff;
      --aa-bg-surface: #f1f5f9;
      --aa-bg-hover: #e2e8f0;
      --aa-text: #1e293b;
      --aa-text-secondary: #64748b;
      --aa-border: #e2e8f0;
      --aa-accent: #80d100;
      --aa-accent-hover: #6ab300;
      --aa-accent-text: #0f172a;
      --aa-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }

    /* Launcher */
    .aa-launcher {
      position: fixed;
      ${position}: 16px;
      top: ${offsetY};
      transform: translateY(-50%);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: var(--aa-accent, #80d100);
      color: var(--aa-accent-text, #0f172a);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      outline: none;
      z-index: 1;
    }

    .aa-launcher:hover {
      transform: translateY(-50%) scale(1.08);
      box-shadow: 0 6px 24px rgba(0,0,0,0.3);
    }

    .aa-launcher:focus-visible {
      outline: 3px solid var(--aa-accent, #80d100);
      outline-offset: 3px;
    }

    .aa-launcher.aa-oversized {
      width: 72px;
      height: 72px;
    }

    .aa-launcher svg {
      width: 28px;
      height: 28px;
    }

    .aa-launcher.aa-oversized svg {
      width: 36px;
      height: 36px;
    }

    .aa-launcher[aria-expanded="true"] {
      opacity: 0;
      pointer-events: none;
    }

    /* Panel */
    .aa-panel {
      position: fixed;
      ${position}: 16px;
      top: 16px;
      bottom: 16px;
      width: 380px;
      max-width: calc(100vw - 32px);
      background: var(--aa-bg, #ffffff);
      border-radius: 16px;
      box-shadow: var(--aa-shadow, 0 20px 60px rgba(0,0,0,0.15));
      display: flex;
      flex-direction: column;
      pointer-events: auto;
      overflow: hidden;
      opacity: 0;
      transform: translateX(${position === 'right' ? '20px' : '-20px'});
      visibility: hidden;
      transition: opacity 0.25s ease, transform 0.25s ease, visibility 0.25s;
    }

    .aa-panel.aa-open {
      opacity: 1;
      transform: translateX(0);
      visibility: visible;
    }

    @media (prefers-reduced-motion: reduce) {
      .aa-launcher,
      .aa-panel {
        transition: none;
      }
    }

    /* Panel Header */
    .aa-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--aa-border, #e2e8f0);
      flex-shrink: 0;
    }

    .aa-panel-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--aa-text, #1e293b);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .aa-panel-title .aa-logo {
      width: 24px;
      height: 24px;
    }

    .aa-close-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--aa-text-secondary, #64748b);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .aa-close-btn:hover {
      background: var(--aa-bg-hover, #e2e8f0);
    }

    .aa-close-btn:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 2px;
    }

    .aa-close-btn svg {
      width: 20px;
      height: 20px;
    }

    /* Panel Body */
    .aa-panel-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px 0;
      scrollbar-width: thin;
      scrollbar-color: var(--aa-border) transparent;
    }

    .aa-panel-body::-webkit-scrollbar {
      width: 6px;
    }

    .aa-panel-body::-webkit-scrollbar-track {
      background: transparent;
    }

    .aa-panel-body::-webkit-scrollbar-thumb {
      background: var(--aa-border, #e2e8f0);
      border-radius: 3px;
    }

    /* Sections */
    .aa-section {
      padding: 4px 20px 12px;
    }

    .aa-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--aa-text-secondary, #64748b);
      padding: 12px 0 8px;
    }

    /* Profile Cards */
    .aa-profiles {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 0 20px 8px;
    }

    .aa-profile-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 12px 8px;
      border-radius: 10px;
      border: 2px solid var(--aa-border, #e2e8f0);
      background: var(--aa-bg, #ffffff);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      text-align: center;
      font-size: 12px;
      font-weight: 500;
      color: var(--aa-text, #1e293b);
    }

    .aa-profile-card:hover {
      border-color: var(--aa-accent, #80d100);
      background: var(--aa-bg-surface, #f1f5f9);
    }

    .aa-profile-card:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 2px;
    }

    .aa-profile-card.aa-active {
      border-color: var(--aa-accent, #80d100);
      background: rgba(128, 209, 0, 0.1);
    }

    .aa-profile-card svg {
      width: 24px;
      height: 24px;
      color: var(--aa-accent, #80d100);
    }

    /* Feature Row */
    .aa-feature-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      gap: 12px;
      border-bottom: 1px solid var(--aa-border, #e2e8f0);
    }

    .aa-feature-row:last-child {
      border-bottom: none;
    }

    .aa-feature-info {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .aa-feature-icon {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      color: var(--aa-text-secondary, #64748b);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .aa-feature-icon svg {
      width: 18px;
      height: 18px;
    }

    .aa-feature-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--aa-text, #1e293b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Toggle */
    .aa-toggle {
      position: relative;
      width: 44px;
      height: 24px;
      border-radius: 12px;
      border: none;
      background: var(--aa-bg-hover, #e2e8f0);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.2s;
      outline: none;
    }

    .aa-toggle:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 2px;
    }

    .aa-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      transition: transform 0.2s;
    }

    .aa-toggle[aria-checked="true"] {
      background: var(--aa-accent, #80d100);
    }

    .aa-toggle[aria-checked="true"]::after {
      transform: translateX(20px);
    }

    @media (prefers-reduced-motion: reduce) {
      .aa-toggle,
      .aa-toggle::after {
        transition: none;
      }
    }

    /* Stepper */
    .aa-stepper {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .aa-stepper-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--aa-border, #e2e8f0);
      background: var(--aa-bg, #ffffff);
      color: var(--aa-text, #1e293b);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .aa-stepper-btn:hover:not(:disabled) {
      background: var(--aa-bg-hover, #e2e8f0);
    }

    .aa-stepper-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .aa-stepper-btn:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 1px;
    }

    .aa-stepper-btn svg {
      width: 14px;
      height: 14px;
    }

    .aa-stepper-value {
      min-width: 28px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--aa-text, #1e293b);
    }

    .aa-stepper-value.aa-active {
      color: var(--aa-accent, #80d100);
    }

    /* Select (segmented buttons) */
    .aa-select {
      display: flex;
      gap: 2px;
      background: var(--aa-bg-surface, #f1f5f9);
      border-radius: 8px;
      padding: 2px;
      flex-shrink: 0;
    }

    .aa-select-option {
      padding: 4px 10px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--aa-text-secondary, #64748b);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }

    .aa-select-option:hover {
      background: var(--aa-bg-hover, #e2e8f0);
      color: var(--aa-text, #1e293b);
    }

    .aa-select-option:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 1px;
    }

    .aa-select-option[aria-checked="true"] {
      background: var(--aa-accent, #80d100);
      color: var(--aa-accent-text, #0f172a);
    }

    @media (prefers-reduced-motion: reduce) {
      .aa-select-option {
        transition: none;
      }
    }

    /* Panel Footer */
    .aa-panel-footer {
      padding: 12px 20px;
      border-top: 1px solid var(--aa-border, #e2e8f0);
      flex-shrink: 0;
    }

    .aa-reset-btn {
      width: 100%;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid var(--aa-border, #e2e8f0);
      background: var(--aa-bg, #ffffff);
      color: var(--aa-text, #1e293b);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s;
    }

    .aa-reset-btn:hover {
      background: var(--aa-bg-hover, #e2e8f0);
    }

    .aa-reset-btn:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 2px;
    }

    .aa-reset-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Page Structure Panel */
    .aa-structure-list {
      list-style: none;
      padding: 0;
      margin: 8px 0;
    }

    .aa-structure-item {
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      color: var(--aa-text, #1e293b);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }

    .aa-structure-item:hover {
      background: var(--aa-bg-hover, #e2e8f0);
    }

    .aa-structure-item:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 1px;
    }

    .aa-structure-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--aa-accent, #80d100);
      background: rgba(128, 209, 0, 0.1);
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .aa-structure-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .aa-structure-indent-1 { padding-left: 16px; }
    .aa-structure-indent-2 { padding-left: 32px; }
    .aa-structure-indent-3 { padding-left: 48px; }
    .aa-structure-indent-4 { padding-left: 64px; }
    .aa-structure-indent-5 { padding-left: 80px; }

    /* Read Aloud Controls */
    .aa-read-aloud-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
    }

    .aa-read-aloud-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--aa-border, #e2e8f0);
      background: var(--aa-bg, #ffffff);
      color: var(--aa-text, #1e293b);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .aa-read-aloud-btn:hover {
      background: var(--aa-bg-hover, #e2e8f0);
    }

    .aa-read-aloud-btn:focus-visible {
      outline: 2px solid var(--aa-accent, #80d100);
      outline-offset: 1px;
    }

    .aa-read-aloud-btn svg {
      width: 16px;
      height: 16px;
    }

    .aa-read-aloud-speed {
      font-size: 12px;
      color: var(--aa-text-secondary, #64748b);
      min-width: 32px;
      text-align: center;
    }

    /* Responsive */
    @media (max-width: 420px) {
      .aa-panel {
        width: calc(100vw - 16px);
        ${position}: 8px;
        top: 8px;
        bottom: 8px;
      }

      .aa-profiles {
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
    }

    /* Hide/show utility */
    .aa-hidden {
      display: none !important;
    }

    .aa-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `;
}
