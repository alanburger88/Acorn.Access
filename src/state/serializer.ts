import type { FeatureState } from '../config/types';
import { DEFAULT_FEATURE_STATE } from '../config/defaults';

const STORAGE_KEY = 'acorn.access.v1.state';
const DISMISSED_KEY = 'acorn.access.v1.dismissedUntil';

export function serialize(state: FeatureState): string {
  return JSON.stringify(state);
}

export function deserialize(raw: string): FeatureState | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return validateState(parsed);
  } catch {
    return null;
  }
}

function validateState(obj: Record<string, unknown>): FeatureState {
  const state = { ...DEFAULT_FEATURE_STATE };

  if (obj.profile === null || typeof obj.profile === 'string') {
    state.profile = obj.profile as string | null;
  }

  const stepKeys = ['biggerText', 'textSpacing', 'lineHeight'] as const;
  const stepMaxes = { biggerText: 5, textSpacing: 3, lineHeight: 3 } as const;
  for (const key of stepKeys) {
    if (typeof obj[key] === 'number') {
      const val = obj[key] as number;
      if (val >= 0 && val <= stepMaxes[key]) {
        (state as Record<string, unknown>)[key] = val;
      }
    }
  }

  const contrastValues = ['off', 'dark', 'light', 'invert', 'high'] as const;
  if (
    typeof obj.contrast === 'string' &&
    (contrastValues as readonly string[]).includes(obj.contrast)
  ) {
    state.contrast = obj.contrast as FeatureState['contrast'];
  }

  const alignValues = ['off', 'left', 'center', 'right', 'justify'] as const;
  if (
    typeof obj.textAlign === 'string' &&
    (alignValues as readonly string[]).includes(obj.textAlign)
  ) {
    state.textAlign = obj.textAlign as FeatureState['textAlign'];
  }

  const satValues = ['off', 'low', 'high', 'desaturate'] as const;
  if (
    typeof obj.saturation === 'string' &&
    (satValues as readonly string[]).includes(obj.saturation)
  ) {
    state.saturation = obj.saturation as FeatureState['saturation'];
  }

  const boolKeys = [
    'smartContrast',
    'highlightLinks',
    'pauseAnimations',
    'hideImages',
    'dyslexiaFont',
    'legibleFont',
    'bigCursor',
    'readingGuide',
    'readingMask',
    'tooltips',
    'pageStructure',
    'readAloud',
    'semanticAssist',
  ] as const;
  for (const key of boolKeys) {
    if (typeof obj[key] === 'boolean') {
      (state as Record<string, unknown>)[key] = obj[key];
    }
  }

  return state;
}

export function loadState(
  storageType: 'local' | 'session' | 'memory' | 'none'
): FeatureState | null {
  if (storageType === 'none' || storageType === 'memory') return null;

  try {
    const storage =
      storageType === 'local' ? localStorage : sessionStorage;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function saveState(
  state: FeatureState,
  storageType: 'local' | 'session' | 'memory' | 'none'
): void {
  if (storageType === 'none' || storageType === 'memory') return;

  try {
    const storage =
      storageType === 'local' ? localStorage : sessionStorage;
    storage.setItem(STORAGE_KEY, serialize(state));
  } catch {
    // Storage unavailable — silently degrade
  }
}

export function clearState(
  storageType: 'local' | 'session' | 'memory' | 'none'
): void {
  if (storageType === 'none' || storageType === 'memory') return;

  try {
    const storage =
      storageType === 'local' ? localStorage : sessionStorage;
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(DISMISSED_KEY);
  } catch {
    // Ignore
  }
}

export { STORAGE_KEY, DISMISSED_KEY };
