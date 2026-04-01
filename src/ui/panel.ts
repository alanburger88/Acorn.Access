import type { ResolvedConfig, FeatureState, FeatureKey } from '../config/types';
import type { Store } from '../state/store';
import { getIcon } from './icons';
import { createFocusTrap, type FocusTrap } from './focus-trap';

export type FeatureCategory = 'profiles' | 'text' | 'visual' | 'navigation' | 'tools';

export interface FeatureControlConfig {
  key: FeatureKey;
  label: string;
  icon: string;
  category: FeatureCategory;
  type: 'toggle' | 'stepper' | 'select';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  stepLabels?: string[];
}

export const FEATURE_CONTROLS: FeatureControlConfig[] = [
  { key: 'biggerText', label: 'Bigger Text', icon: 'biggerText', category: 'text', type: 'stepper', min: 0, max: 5, stepLabels: ['Off', '115%', '130%', '150%', '175%', '200%'] },
  { key: 'textSpacing', label: 'Text Spacing', icon: 'textSpacing', category: 'text', type: 'stepper', min: 0, max: 3, stepLabels: ['Off', 'Low', 'Medium', 'High'] },
  { key: 'lineHeight', label: 'Line Height', icon: 'lineHeight', category: 'text', type: 'stepper', min: 0, max: 3, stepLabels: ['Off', 'Low', 'Medium', 'High'] },
  { key: 'textAlign', label: 'Text Alignment', icon: 'textAlign', category: 'text', type: 'select', options: [
    { value: 'off', label: 'Off' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }
  ]},
  { key: 'dyslexiaFont', label: 'Dyslexia Font', icon: 'dyslexiaFont', category: 'text', type: 'toggle' },
  { key: 'legibleFont', label: 'Legible Font', icon: 'legibleFont', category: 'text', type: 'toggle' },

  { key: 'contrast', label: 'Contrast', icon: 'contrast', category: 'visual', type: 'select', options: [
    { value: 'off', label: 'Off' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'invert', label: 'Invert' }, { value: 'high', label: 'High' }
  ]},
  { key: 'smartContrast', label: 'Smart Contrast', icon: 'smartContrast', category: 'visual', type: 'toggle' },
  { key: 'saturation', label: 'Saturation', icon: 'saturation', category: 'visual', type: 'select', options: [
    { value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }, { value: 'desaturate', label: 'Mono' }
  ]},
  { key: 'highlightLinks', label: 'Highlight Links', icon: 'highlightLinks', category: 'visual', type: 'toggle' },
  { key: 'hideImages', label: 'Hide Images', icon: 'hideImages', category: 'visual', type: 'toggle' },
  { key: 'pauseAnimations', label: 'Pause Animations', icon: 'pauseAnimations', category: 'visual', type: 'toggle' },
  { key: 'bigCursor', label: 'Big Cursor', icon: 'bigCursor', category: 'visual', type: 'toggle' },

  { key: 'readingGuide', label: 'Reading Guide', icon: 'readingGuide', category: 'navigation', type: 'toggle' },
  { key: 'readingMask', label: 'Reading Mask', icon: 'readingMask', category: 'navigation', type: 'toggle' },
  { key: 'tooltips', label: 'Image Tooltips', icon: 'tooltips', category: 'navigation', type: 'toggle' },
  { key: 'pageStructure', label: 'Page Structure', icon: 'pageStructure', category: 'navigation', type: 'toggle' },

  { key: 'readAloud', label: 'Read Aloud', icon: 'readAloud', category: 'tools', type: 'toggle' },
  { key: 'semanticAssist', label: 'Semantic Assist', icon: 'semanticAssist', category: 'tools', type: 'toggle' },
];

export interface Panel {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  updateFeature(key: string, value: unknown): void;
  setPageStructureContent(html: string): void;
  setReadAloudControls(html: string): void;
  destroy(): void;
}

export function createPanel(
  config: ResolvedConfig,
  store: Store,
  onClose: () => void
): Panel {
  const panel = document.createElement('div');
  panel.className = 'aa-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Accessibility Settings');
  panel.setAttribute('aria-modal', 'true');

  let isOpenState = false;
  const controlUpdaters = new Map<string, (value: unknown) => void>();

  // Build panel HTML
  panel.innerHTML = buildPanelHTML(config, store.getState());

  // Focus trap
  const focusTrap: FocusTrap = createFocusTrap(panel, () => onClose());

  // Wire up close button
  const closeBtn = panel.querySelector('.aa-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', onClose);
  }

  // Wire up reset button
  const resetBtn = panel.querySelector('.aa-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => store.reset());
  }

  // Wire up profile cards
  panel.querySelectorAll('.aa-profile-card').forEach((card) => {
    card.addEventListener('click', () => {
      const profileKey = (card as HTMLElement).dataset.profile;
      if (!profileKey) return;
      const currentState = store.getState();
      if (currentState.profile === profileKey) {
        // Deactivate current profile — reset everything
        store.reset();
      } else {
        const profileDef = config.profiles[profileKey];
        if (profileDef) {
          // Reset to defaults first, then apply new profile
          // This prevents features from a previous profile leaking through
          store.reset();
          store.setState({ ...profileDef.settings, profile: profileKey });
        }
      }
    });
  });

  // Wire up feature controls
  wireUpControls(panel, config, store, controlUpdaters);

  // Subscribe to state changes
  const unsubscribe = store.subscribe((state) => {
    updateAllControls(state, controlUpdaters);
    updateProfileCards(panel, state);
  });

  return {
    element: panel,

    open() {
      isOpenState = true;
      panel.classList.add('aa-open');
      focusTrap.activate();
    },

    close() {
      isOpenState = false;
      panel.classList.remove('aa-open');
      focusTrap.deactivate();
    },

    isOpen() {
      return isOpenState;
    },

    updateFeature(key: string, value: unknown) {
      const updater = controlUpdaters.get(key);
      if (updater) updater(value);
    },

    setPageStructureContent(html: string) {
      const container = panel.querySelector('.aa-page-structure-content');
      if (container) container.innerHTML = html;
    },

    setReadAloudControls(html: string) {
      const container = panel.querySelector('.aa-read-aloud-content');
      if (container) container.innerHTML = html;
    },

    destroy() {
      unsubscribe();
      focusTrap.destroy();
      panel.remove();
    },
  };
}

function buildPanelHTML(config: ResolvedConfig, state: FeatureState): string {
  const categories: { key: FeatureCategory; label: string }[] = [
    { key: 'text', label: 'Text & Content' },
    { key: 'visual', label: 'Visual & Display' },
    { key: 'navigation', label: 'Navigation & Reading' },
    { key: 'tools', label: 'Tools' },
  ];

  let html = `
    <div class="aa-panel-header">
      <div class="aa-panel-title">
        <span>${getIcon('accessibility', 22)}</span>
        <span>Accessibility</span>
      </div>
      <button class="aa-close-btn" aria-label="Close accessibility settings">
        ${getIcon('close', 20)}
      </button>
    </div>
    <div class="aa-panel-body">
  `;

  // Profiles section
  if (config.features.profiles && Object.keys(config.profiles).length > 0) {
    html += `<div class="aa-section-title" style="padding: 12px 20px 8px;">Quick Profiles</div>`;
    html += `<div class="aa-profiles">`;
    for (const [key, profile] of Object.entries(config.profiles)) {
      const isActive = state.profile === key;
      html += `
        <button class="aa-profile-card${isActive ? ' aa-active' : ''}"
                data-profile="${key}"
                role="switch"
                aria-checked="${isActive}"
                aria-label="${profile.label}">
          ${profile.icon ? getIcon(profile.icon, 24) : ''}
          <span>${profile.label}</span>
        </button>
      `;
    }
    html += `</div>`;
  }

  // Feature categories
  for (const category of categories) {
    const controls = FEATURE_CONTROLS.filter(
      (c) => c.category === category.key && config.features[c.key]
    );
    if (controls.length === 0) continue;

    html += `<div class="aa-section">`;
    html += `<div class="aa-section-title">${category.label}</div>`;

    for (const ctrl of controls) {
      html += buildFeatureRow(ctrl, state);
    }

    // Page structure content placeholder
    if (category.key === 'navigation') {
      html += `<div class="aa-page-structure-content"></div>`;
    }

    // Read aloud controls placeholder
    if (category.key === 'tools') {
      html += `<div class="aa-read-aloud-content"></div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;

  // Footer
  html += `
    <div class="aa-panel-footer">
      <button class="aa-reset-btn" aria-label="Reset all accessibility settings">
        ${getIcon('reset', 16)}
        <span>Reset All Settings</span>
      </button>
    </div>
  `;

  return html;
}

function buildFeatureRow(ctrl: FeatureControlConfig, state: FeatureState): string {
  const value = state[ctrl.key as keyof FeatureState];

  let controlHTML = '';

  if (ctrl.type === 'toggle') {
    const checked = value === true;
    controlHTML = `
      <button class="aa-toggle"
              role="switch"
              aria-checked="${checked}"
              data-feature="${ctrl.key}"
              aria-label="${ctrl.label}">
      </button>
    `;
  } else if (ctrl.type === 'stepper') {
    const numVal = value as number;
    const label = ctrl.stepLabels?.[numVal] ?? String(numVal);
    controlHTML = `
      <div class="aa-stepper" data-feature="${ctrl.key}">
        <button class="aa-stepper-btn aa-stepper-dec" aria-label="Decrease ${ctrl.label}"${numVal <= (ctrl.min ?? 0) ? ' disabled' : ''}>
          ${getIcon('minus', 14)}
        </button>
        <span class="aa-stepper-value${numVal > 0 ? ' aa-active' : ''}">${label}</span>
        <button class="aa-stepper-btn aa-stepper-inc" aria-label="Increase ${ctrl.label}"${numVal >= (ctrl.max ?? 3) ? ' disabled' : ''}>
          ${getIcon('plus', 14)}
        </button>
      </div>
    `;
  } else if (ctrl.type === 'select' && ctrl.options) {
    controlHTML = `
      <div class="aa-select" role="radiogroup" aria-label="${ctrl.label}" data-feature="${ctrl.key}">
        ${ctrl.options
          .map(
            (opt) => `
          <button class="aa-select-option"
                  role="radio"
                  aria-checked="${value === opt.value}"
                  data-value="${opt.value}"
                  aria-label="${opt.label}">
            ${opt.label}
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  return `
    <div class="aa-feature-row">
      <div class="aa-feature-info">
        <span class="aa-feature-icon">${getIcon(ctrl.icon, 18)}</span>
        <span class="aa-feature-label">${ctrl.label}</span>
      </div>
      ${controlHTML}
    </div>
  `;
}

function wireUpControls(
  panel: HTMLElement,
  _config: ResolvedConfig,
  store: Store,
  updaters: Map<string, (value: unknown) => void>
): void {
  // Toggles
  panel.querySelectorAll<HTMLButtonElement>('.aa-toggle').forEach((toggle) => {
    const key = toggle.dataset.feature as FeatureKey;
    if (!key) return;

    toggle.addEventListener('click', () => {
      const state = store.getState();
      const current = state[key as keyof FeatureState];
      store.setState({ [key]: !current } as Partial<FeatureState>);
    });

    updaters.set(key, (value: unknown) => {
      toggle.setAttribute('aria-checked', String(!!value));
    });
  });

  // Steppers
  panel.querySelectorAll<HTMLElement>('.aa-stepper').forEach((stepper) => {
    const key = stepper.dataset.feature as FeatureKey;
    if (!key) return;

    const ctrl = FEATURE_CONTROLS.find((c) => c.key === key);
    if (!ctrl) return;

    const decBtn = stepper.querySelector<HTMLButtonElement>('.aa-stepper-dec');
    const incBtn = stepper.querySelector<HTMLButtonElement>('.aa-stepper-inc');
    const valueEl = stepper.querySelector<HTMLSpanElement>('.aa-stepper-value');

    decBtn?.addEventListener('click', () => {
      const state = store.getState();
      const current = state[key as keyof FeatureState] as number;
      if (current > (ctrl.min ?? 0)) {
        store.setState({ [key]: current - 1 } as Partial<FeatureState>);
      }
    });

    incBtn?.addEventListener('click', () => {
      const state = store.getState();
      const current = state[key as keyof FeatureState] as number;
      if (current < (ctrl.max ?? 3)) {
        store.setState({ [key]: current + 1 } as Partial<FeatureState>);
      }
    });

    updaters.set(key, (value: unknown) => {
      const numVal = value as number;
      if (valueEl) {
        const label = ctrl.stepLabels?.[numVal] ?? String(numVal);
        valueEl.textContent = label;
        valueEl.classList.toggle('aa-active', numVal > 0);
      }
      if (decBtn) decBtn.disabled = numVal <= (ctrl.min ?? 0);
      if (incBtn) incBtn.disabled = numVal >= (ctrl.max ?? 3);
    });
  });

  // Selects
  panel.querySelectorAll<HTMLElement>('.aa-select').forEach((select) => {
    const key = select.dataset.feature as FeatureKey;
    if (!key) return;

    const options = select.querySelectorAll<HTMLButtonElement>('.aa-select-option');
    options.forEach((option) => {
      option.addEventListener('click', () => {
        const val = option.dataset.value;
        store.setState({ [key]: val } as Partial<FeatureState>);
      });
    });

    updaters.set(key, (value: unknown) => {
      options.forEach((option) => {
        option.setAttribute(
          'aria-checked',
          String(option.dataset.value === String(value))
        );
      });
    });
  });
}

function updateAllControls(
  state: FeatureState,
  updaters: Map<string, (value: unknown) => void>
): void {
  for (const [key, updater] of updaters) {
    const value = state[key as keyof FeatureState];
    updater(value);
  }
}

function updateProfileCards(panel: HTMLElement, state: FeatureState): void {
  panel.querySelectorAll<HTMLElement>('.aa-profile-card').forEach((card) => {
    const profileKey = card.dataset.profile;
    const isActive = state.profile === profileKey;
    card.classList.toggle('aa-active', isActive);
    card.setAttribute('aria-checked', String(isActive));
  });
}
