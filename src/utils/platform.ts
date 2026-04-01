export function isTouchOnly(): boolean {
  return (
    'ontouchstart' in window &&
    !window.matchMedia('(pointer: fine)').matches
  );
}

export function hasSpeechSynthesis(): boolean {
  return 'speechSynthesis' in window;
}

export function hasLocalStorage(): boolean {
  try {
    const key = '__aa_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function hasSessionStorage(): boolean {
  try {
    const key = '__aa_test__';
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function resolveStorageType(
  preferred: 'local' | 'session' | 'memory' | 'none'
): 'local' | 'session' | 'memory' | 'none' {
  if (preferred === 'none') return 'none';
  if (preferred === 'local' && hasLocalStorage()) return 'local';
  if (preferred === 'session' || (preferred === 'local' && hasSessionStorage()))
    return hasSessionStorage() ? 'session' : 'memory';
  return 'memory';
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function getDocumentLang(): string {
  return document.documentElement.lang || navigator.language || 'en';
}

export function isRTL(): boolean {
  const dir = document.documentElement.dir?.toLowerCase();
  if (dir === 'rtl') return true;
  if (dir === 'ltr') return false;
  return getComputedStyle(document.documentElement).direction === 'rtl';
}
