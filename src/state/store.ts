import type { FeatureState, ResolvedConfig } from '../config/types';
import { loadState, saveState, clearState } from './serializer';

type Listener = (state: FeatureState) => void;
type KeyListener = (value: FeatureState[keyof FeatureState], key: string) => void;

export interface Store {
  getState(): FeatureState;
  setState(partial: Partial<FeatureState>): void;
  subscribe(callback: Listener): () => void;
  subscribeKey(key: string, callback: KeyListener): () => void;
  reset(): void;
  destroy(): void;
}

export function createStore(config: ResolvedConfig): Store {
  let state: FeatureState = { ...config.defaults };
  const listeners = new Set<Listener>();
  const keyListeners = new Map<string, Set<KeyListener>>();

  // Hydrate persisted state
  if (config.persist) {
    const persisted = loadState(config.storage);
    if (persisted) {
      state = { ...state, ...persisted };
    }
  }

  function notify(changedKeys: string[]): void {
    for (const listener of listeners) {
      listener(state);
    }
    for (const key of changedKeys) {
      const kl = keyListeners.get(key);
      if (kl) {
        const value = state[key as keyof FeatureState];
        for (const listener of kl) {
          listener(value, key);
        }
      }
    }
  }

  function persist(): void {
    if (config.persist) {
      saveState(state, config.storage);
    }
  }

  return {
    getState(): FeatureState {
      return { ...state };
    },

    setState(partial: Partial<FeatureState>): void {
      const changedKeys: string[] = [];

      for (const [key, value] of Object.entries(partial)) {
        if (
          key in state &&
          state[key as keyof FeatureState] !== value
        ) {
          // Enforce mutual exclusivity: dyslexiaFont / legibleFont
          if (key === 'dyslexiaFont' && value === true) {
            if (state.legibleFont) {
              (state as unknown as Record<string, unknown>).legibleFont = false;
              changedKeys.push('legibleFont');
            }
          } else if (key === 'legibleFont' && value === true) {
            if (state.dyslexiaFont) {
              (state as unknown as Record<string, unknown>).dyslexiaFont = false;
              changedKeys.push('dyslexiaFont');
            }
          }

          (state as unknown as Record<string, unknown>)[key] = value;
          changedKeys.push(key);
        }
      }

      if (changedKeys.length > 0) {
        persist();
        notify(changedKeys);
      }
    },

    subscribe(callback: Listener): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    subscribeKey(key: string, callback: KeyListener): () => void {
      if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
      }
      keyListeners.get(key)!.add(callback);
      return () => keyListeners.get(key)?.delete(callback);
    },

    reset(): void {
      state = { ...config.defaults };
      clearState(config.storage);
      if (config.persist) {
        saveState(state, config.storage);
      }
      notify(Object.keys(state));
    },

    destroy(): void {
      listeners.clear();
      keyListeners.clear();
    },
  };
}
