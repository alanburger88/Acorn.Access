import type { AcornAccessConfig, FeatureState } from '../config/types';

export interface AcornAccessAPI {
  init(config?: AcornAccessConfig): void;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  reset(): void;
  setFeature(name: string, value: unknown): void;
  setProfile(name: string | null): void;
  getState(): FeatureState;
}

export function createPublicAPI(handlers: {
  init: (config?: AcornAccessConfig) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
  reset: () => void;
  setFeature: (name: string, value: unknown) => void;
  setProfile: (name: string | null) => void;
  getState: () => FeatureState;
}): AcornAccessAPI {
  return {
    init: handlers.init,
    open: handlers.open,
    close: handlers.close,
    toggle: handlers.toggle,
    destroy: handlers.destroy,
    reset: handlers.reset,
    setFeature: handlers.setFeature,
    setProfile: handlers.setProfile,
    getState: handlers.getState,
  };
}

export function exposeAPI(api: AcornAccessAPI): void {
  // Create Acorn namespace if needed
  const win = window as unknown as Record<string, unknown>;
  if (!win.Acorn) {
    win.Acorn = {};
  }
  (win.Acorn as Record<string, unknown>).Access = api;
}
