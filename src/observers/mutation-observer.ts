import { debounce } from '../utils/debounce';

export interface DOMObserver {
  start(): void;
  stop(): void;
  destroy(): void;
}

export function createDOMObserver(
  onMutation: (nodes: Node[]) => void,
  debounceMs: number = 130
): DOMObserver {
  let observer: MutationObserver | null = null;

  const processMutations = debounce((mutations: MutationRecord[]) => {
    const changedNodes = new Set<Node>();

    for (const mutation of mutations) {
      // Skip our own mutations
      const target = mutation.target as Element;
      if (target.id === 'acorn-access-host' || target.id === 'acorn-access-overlays') continue;
      if (target.closest?.('#acorn-access-host, #acorn-access-overlays')) continue;

      // Check for our own attributes
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName?.startsWith('data-aa-')
      ) {
        continue;
      }

      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            if (node.id === 'acorn-access-host' || node.id === 'acorn-access-overlays') return;
            changedNodes.add(node);
          }
        });
      } else if (mutation.type === 'attributes' || mutation.type === 'characterData') {
        if (mutation.target instanceof Element) {
          changedNodes.add(mutation.target);
        }
      }
    }

    if (changedNodes.size > 0) {
      onMutation(Array.from(changedNodes));
    }
  }, debounceMs);

  return {
    start(): void {
      if (observer) return;
      if (typeof MutationObserver === 'undefined') return;

      observer = new MutationObserver((mutations) => {
        processMutations(mutations);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'lang', 'dir'],
      });
    },

    stop(): void {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      processMutations.cancel();
    },

    destroy(): void {
      this.stop();
    },
  };
}
