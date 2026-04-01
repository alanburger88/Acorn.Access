export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  if (children) {
    for (const child of children) {
      el.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return el;
}

export function isSkipped(element: Element, feature: string): boolean {
  const skip = element.closest('[data-aa-skip]');
  if (!skip) return false;
  const val = skip.getAttribute('data-aa-skip') ?? '';
  return val === 'all' || val.split(/\s+/).includes(feature);
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export function waitForBody(): Promise<HTMLElement> {
  if (document.body) return Promise.resolve(document.body);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        resolve(document.body);
      }
    });
    observer.observe(document.documentElement, { childList: true });
  });
}

export function createStyleElement(
  css: string,
  nonce: string | null,
  id?: string
): HTMLStyleElement {
  const style = document.createElement('style');
  if (id) style.id = id;
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  return style;
}

const AA_PREFIX = 'acorn-access';

export function aaId(name: string): string {
  return `${AA_PREFIX}-${name}`;
}

export function aaClass(name: string): string {
  return `${AA_PREFIX}-${name}`;
}

export function aaAttr(name: string): string {
  return `data-aa-${name}`;
}
