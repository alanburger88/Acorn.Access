import type { FeatureState, ResolvedConfig } from '../config/types';

export type FeatureCategory = 'text' | 'visual' | 'navigation' | 'tools';

export interface FeatureModule {
  key: string;
  order: number;

  getCss(state: FeatureState, config: ResolvedConfig): string;
  enable(state: FeatureState, config: ResolvedConfig): void;
  disable(): void;
  reapply(state: FeatureState, config: ResolvedConfig, nodes?: Node[]): void;
  isSupported(): boolean;
  destroy(): void;
}

export function isFeatureActive(state: FeatureState, key: string): boolean {
  const value = state[key as keyof FeatureState];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value !== 'off';
  return false;
}
