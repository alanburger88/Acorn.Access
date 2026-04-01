import type { FeatureModule } from '../types';
import { setDataAttr, removeDataAttr } from '../../utils/css';

export function createHideImagesModule(): FeatureModule {
  return {
    key: 'hideImages',
    order: 80,

    getCss(): string {
      return `
        html[data-aa-hide-images] img:not([data-aa-skip~="images"]):not([role="presentation"]) {
          visibility: hidden !important;
          position: relative !important;
        }
        html[data-aa-hide-images] img[alt]:not([alt=""]):not([data-aa-skip~="images"])::after {
          content: attr(alt);
          visibility: visible;
          position: absolute;
          top: 0;
          left: 0;
          padding: 4px 8px;
          font-size: 12px;
          color: #666;
          background: #f0f0f0;
          border: 1px dashed #ccc;
        }
        html[data-aa-hide-images] picture:not([data-aa-skip~="images"]) {
          visibility: hidden !important;
        }
        html[data-aa-hide-images] svg[role="img"]:not([data-aa-skip~="images"]),
        html[data-aa-hide-images] svg.decorative:not([data-aa-skip~="images"]) {
          visibility: hidden !important;
        }
        html[data-aa-hide-images] *:not([data-aa-skip~="images"]) {
          background-image: none !important;
        }
        /* Don't hide functional controls */
        html[data-aa-hide-images] button img,
        html[data-aa-hide-images] a img,
        html[data-aa-hide-images] [role="button"] img {
          visibility: visible !important;
          opacity: 0.3 !important;
        }
      `;
    },

    enable(): void {
      setDataAttr('hide-images', true);
    },

    disable(): void {
      removeDataAttr('hide-images');
    },

    reapply(): void {},
    isSupported(): boolean { return true; },
    destroy(): void {
      removeDataAttr('hide-images');
    },
  };
}
