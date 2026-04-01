import type { FeatureState, ResolvedConfig } from '../config/types';
import type { FeatureModule } from './types';
import { isFeatureActive } from './types';
import type { Compositor } from './compositor';
import type { PatchRegistry } from './patch-registry';
import type { OverlayManager } from './overlay-manager';

// Feature module factories
import { createBiggerTextModule } from './modules/bigger-text';
import { createTextSpacingModule } from './modules/text-spacing';
import { createLineHeightModule } from './modules/line-height';
import { createTextAlignModule } from './modules/text-align';
import { createContrastModule } from './modules/contrast';
import { createSmartContrastModule } from './modules/smart-contrast';
import { createSaturationModule } from './modules/saturation';
import { createHighlightLinksModule } from './modules/highlight-links';
import { createHideImagesModule } from './modules/hide-images';
import { createPauseAnimationsModule } from './modules/pause-animations';
import { createBigCursorModule } from './modules/big-cursor';
import { createDyslexiaFontModule } from './modules/dyslexia-font';
import { createLegibleFontModule } from './modules/legible-font';
import { createReadingGuideModule } from './modules/reading-guide';
import { createReadingMaskModule } from './modules/reading-mask';
import { createTooltipsModule } from './modules/tooltips';
import { createPageStructureModule } from './modules/page-structure';
import { createReadAloudModule } from './modules/read-aloud';
import { createSemanticAssistModule } from './modules/semantic-assist';

export interface FeatureEngine {
  applyState(state: FeatureState): void;
  reapply(state: FeatureState, nodes?: Node[]): void;
  getModule(key: string): FeatureModule | undefined;
  destroy(): void;
}

export function createFeatureEngine(
  config: ResolvedConfig,
  compositor: Compositor,
  patchRegistry: PatchRegistry,
  overlayManager: OverlayManager,
  onPageStructureUpdate?: (html: string) => void,
  onReadAloudUpdate?: (html: string) => void
): FeatureEngine {
  const modules: FeatureModule[] = [];
  const activeFeatures = new Set<string>();

  // Create all enabled feature modules
  if (config.features.biggerText) modules.push(createBiggerTextModule());
  if (config.features.textSpacing) modules.push(createTextSpacingModule());
  if (config.features.lineHeight) modules.push(createLineHeightModule());
  if (config.features.textAlign) modules.push(createTextAlignModule());
  if (config.features.dyslexiaFont) modules.push(createDyslexiaFontModule());
  if (config.features.legibleFont) modules.push(createLegibleFontModule());
  if (config.features.contrast) modules.push(createContrastModule());
  if (config.features.smartContrast) modules.push(createSmartContrastModule(patchRegistry));
  if (config.features.saturation) modules.push(createSaturationModule());
  if (config.features.highlightLinks) modules.push(createHighlightLinksModule());
  if (config.features.hideImages) modules.push(createHideImagesModule());
  if (config.features.pauseAnimations) modules.push(createPauseAnimationsModule());
  if (config.features.bigCursor) modules.push(createBigCursorModule());
  if (config.features.readingGuide) modules.push(createReadingGuideModule(overlayManager));
  if (config.features.readingMask) modules.push(createReadingMaskModule(overlayManager));
  if (config.features.tooltips) modules.push(createTooltipsModule(overlayManager));
  if (config.features.pageStructure) modules.push(createPageStructureModule(onPageStructureUpdate));
  if (config.features.readAloud) modules.push(createReadAloudModule(onReadAloudUpdate));
  if (config.features.semanticAssist) modules.push(createSemanticAssistModule(patchRegistry));

  const moduleMap = new Map(modules.map((m) => [m.key, m]));

  // Register modules with compositor and apply defaults
  compositor.setModules(modules);
  compositor.update(config.defaults);

  return {
    applyState(state: FeatureState): void {
      // Determine which features need enabling/disabling
      for (const mod of modules) {
        const shouldBeActive = isFeatureActive(state, mod.key);
        const isActive = activeFeatures.has(mod.key);

        if (shouldBeActive && !isActive) {
          if (mod.isSupported()) {
            mod.enable(state, config);
            activeFeatures.add(mod.key);
          }
        } else if (!shouldBeActive && isActive) {
          mod.disable();
          activeFeatures.delete(mod.key);
        } else if (shouldBeActive && isActive) {
          // Value changed but still active — reapply
          mod.reapply(state, config);
        }
      }

      // Update compositor CSS
      compositor.update(state);
    },

    reapply(state: FeatureState, nodes?: Node[]): void {
      for (const key of activeFeatures) {
        const mod = moduleMap.get(key);
        if (mod) {
          mod.reapply(state, config, nodes);
        }
      }
    },

    getModule(key: string): FeatureModule | undefined {
      return moduleMap.get(key);
    },

    destroy(): void {
      for (const mod of modules) {
        if (activeFeatures.has(mod.key)) {
          mod.disable();
        }
        mod.destroy();
      }
      activeFeatures.clear();
      compositor.destroy();
    },
  };
}
