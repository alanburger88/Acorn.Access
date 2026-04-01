export interface AcornAccessConfig {
  enabled?: boolean;
  autoInit?: boolean;
  position?: 'left' | 'right';
  offsetY?: string;
  zIndex?: number;
  size?: 'regular' | 'oversized';
  language?: 'auto' | string;
  storage?: 'local' | 'session' | 'memory' | 'none';
  persist?: boolean;
  safeMode?: boolean;
  cspNonce?: string;
  launcherIcon?: 'default' | 'minimal' | 'text';
  theme?: 'system' | 'light' | 'dark';
  features?: Partial<FeatureFlags>;
  defaults?: Partial<FeatureState>;
  profiles?: Record<string, ProfileDefinition>;
  selectors?: {
    scope?: string[];
    exclude?: string[];
  };
}

export interface FeatureFlags {
  profiles: boolean;
  biggerText: boolean;
  textSpacing: boolean;
  lineHeight: boolean;
  contrast: boolean;
  smartContrast: boolean;
  highlightLinks: boolean;
  pauseAnimations: boolean;
  hideImages: boolean;
  dyslexiaFont: boolean;
  legibleFont: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
  readingMask: boolean;
  tooltips: boolean;
  pageStructure: boolean;
  textAlign: boolean;
  saturation: boolean;
  readAloud: boolean;
  semanticAssist: boolean;
}

export interface FeatureState {
  profile: string | null;
  biggerText: 0 | 1 | 2 | 3 | 4 | 5;
  textSpacing: 0 | 1 | 2 | 3;
  lineHeight: 0 | 1 | 2 | 3;
  contrast: 'off' | 'dark' | 'light' | 'invert' | 'high';
  smartContrast: boolean;
  highlightLinks: boolean;
  pauseAnimations: boolean;
  hideImages: boolean;
  dyslexiaFont: boolean;
  legibleFont: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
  readingMask: boolean;
  tooltips: boolean;
  pageStructure: boolean;
  textAlign: 'off' | 'left' | 'center' | 'right' | 'justify';
  saturation: 'off' | 'low' | 'high' | 'desaturate';
  readAloud: boolean;
  semanticAssist: boolean;
}

export interface ProfileDefinition {
  label: string;
  icon?: string;
  description?: string;
  settings: Partial<FeatureState>;
}

export type FeatureKey = keyof FeatureFlags;
export type FeatureValue = FeatureState[keyof FeatureState];

export interface ResolvedConfig {
  enabled: boolean;
  autoInit: boolean;
  position: 'left' | 'right';
  offsetY: string;
  zIndex: number;
  size: 'regular' | 'oversized';
  language: string;
  storage: 'local' | 'session' | 'memory' | 'none';
  persist: boolean;
  safeMode: boolean;
  cspNonce: string | null;
  launcherIcon: 'default' | 'minimal' | 'text';
  theme: 'system' | 'light' | 'dark';
  features: FeatureFlags;
  defaults: FeatureState;
  profiles: Record<string, ProfileDefinition>;
  selectors: {
    scope: string[];
    exclude: string[];
  };
}
