import type { AcornAccessConfig, ResolvedConfig } from './types';
import { DEFAULT_CONFIG, DEFAULT_FEATURE_FLAGS, DEFAULT_FEATURE_STATE } from './defaults';

export function parseConfigFromScript(): AcornAccessConfig | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-acorn-access]'
  );
  if (!script) return null;

  const raw = script.getAttribute('data-acorn-access');
  if (!raw) return {};

  try {
    return JSON.parse(raw) as AcornAccessConfig;
  } catch {
    console.warn('[Acorn.Access] Invalid JSON in data-acorn-access attribute');
    return {};
  }
}

export function resolveConfig(
  userConfig: AcornAccessConfig = {}
): ResolvedConfig {
  const features = {
    ...DEFAULT_FEATURE_FLAGS,
    ...userConfig.features,
  };

  const defaults = {
    ...DEFAULT_FEATURE_STATE,
    ...userConfig.defaults,
  };

  return {
    enabled: userConfig.enabled ?? DEFAULT_CONFIG.enabled,
    autoInit: userConfig.autoInit ?? DEFAULT_CONFIG.autoInit,
    position: userConfig.position ?? DEFAULT_CONFIG.position,
    offsetY: userConfig.offsetY ?? DEFAULT_CONFIG.offsetY,
    zIndex: userConfig.zIndex ?? DEFAULT_CONFIG.zIndex,
    size: userConfig.size ?? DEFAULT_CONFIG.size,
    language: userConfig.language ?? DEFAULT_CONFIG.language,
    storage: userConfig.storage ?? DEFAULT_CONFIG.storage,
    persist: userConfig.persist ?? DEFAULT_CONFIG.persist,
    safeMode: userConfig.safeMode ?? DEFAULT_CONFIG.safeMode,
    cspNonce: userConfig.cspNonce ?? DEFAULT_CONFIG.cspNonce,
    launcherIcon: userConfig.launcherIcon ?? DEFAULT_CONFIG.launcherIcon,
    theme: userConfig.theme ?? DEFAULT_CONFIG.theme,
    features,
    defaults,
    profiles: userConfig.profiles ?? DEFAULT_CONFIG.profiles,
    selectors: {
      scope: userConfig.selectors?.scope ?? DEFAULT_CONFIG.selectors.scope,
      exclude:
        userConfig.selectors?.exclude ?? DEFAULT_CONFIG.selectors.exclude,
    },
  };
}
