import type { FeatureModule } from '../types';

export function createPauseAnimationsModule(): FeatureModule {
  const pausedMedia: HTMLMediaElement[] = [];

  return {
    key: 'pauseAnimations',
    order: 90,

    getCss(): string {
      return `
        *:not([data-aa-skip~="animations"]):not(#acorn-access-host):not(#acorn-access-host *) {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `;
    },

    enable(): void {
      // Pause same-origin media elements
      document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
        try {
          if (!el.paused) {
            el.pause();
            pausedMedia.push(el);
          }
        } catch {
          // Cross-origin or other restriction
        }
      });
    },

    disable(): void {
      // Resume previously paused media
      for (const el of pausedMedia) {
        try {
          if (el.isConnected && el.paused) {
            el.play().catch(() => {});
          }
        } catch {
          // Ignore
        }
      }
      pausedMedia.length = 0;
    },

    reapply(): void {
      // Pause any new media elements
      document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
        try {
          if (!el.paused && !pausedMedia.includes(el)) {
            el.pause();
            pausedMedia.push(el);
          }
        } catch {
          // Ignore
        }
      });
    },

    isSupported(): boolean { return true; },
    destroy(): void {
      this.disable();
    },
  };
}
