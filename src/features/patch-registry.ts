interface Patch {
  element: Element;
  attribute: string;
  originalValue: string | null;
}

export interface PatchRegistry {
  set(featureKey: string, element: Element, attribute: string, value: string): void;
  addClass(featureKey: string, element: Element, className: string): void;
  revert(featureKey: string): void;
  revertAll(): void;
  hasPatch(featureKey: string, element: Element): boolean;
  destroy(): void;
}

export function createPatchRegistry(): PatchRegistry {
  const patches = new Map<string, Patch[]>();
  const classPatches = new Map<string, { element: Element; className: string }[]>();

  return {
    set(featureKey: string, element: Element, attribute: string, value: string): void {
      if (!patches.has(featureKey)) {
        patches.set(featureKey, []);
      }

      const list = patches.get(featureKey)!;
      // Only record original value once
      const existing = list.find(
        (p) => p.element === element && p.attribute === attribute
      );
      if (!existing) {
        list.push({
          element,
          attribute,
          originalValue: element.getAttribute(attribute),
        });
      }

      element.setAttribute(attribute, value);
    },

    addClass(featureKey: string, element: Element, className: string): void {
      if (!classPatches.has(featureKey)) {
        classPatches.set(featureKey, []);
      }
      classPatches.get(featureKey)!.push({ element, className });
      element.classList.add(className);
    },

    revert(featureKey: string): void {
      // Revert attribute patches
      const attrList = patches.get(featureKey);
      if (attrList) {
        for (const patch of attrList) {
          if (!patch.element.isConnected) continue;
          if (patch.originalValue === null) {
            patch.element.removeAttribute(patch.attribute);
          } else {
            patch.element.setAttribute(patch.attribute, patch.originalValue);
          }
        }
        patches.delete(featureKey);
      }

      // Revert class patches
      const classList = classPatches.get(featureKey);
      if (classList) {
        for (const patch of classList) {
          if (!patch.element.isConnected) continue;
          patch.element.classList.remove(patch.className);
        }
        classPatches.delete(featureKey);
      }
    },

    revertAll(): void {
      for (const key of patches.keys()) {
        this.revert(key);
      }
      for (const key of classPatches.keys()) {
        // Already handled in revert() above, but safety check
        const list = classPatches.get(key);
        if (list) {
          for (const patch of list) {
            if (patch.element.isConnected) {
              patch.element.classList.remove(patch.className);
            }
          }
        }
      }
      patches.clear();
      classPatches.clear();
    },

    hasPatch(featureKey: string, element: Element): boolean {
      const attrList = patches.get(featureKey);
      if (attrList?.some((p) => p.element === element)) return true;
      const classList = classPatches.get(featureKey);
      if (classList?.some((p) => p.element === element)) return true;
      return false;
    },

    destroy(): void {
      this.revertAll();
    },
  };
}
