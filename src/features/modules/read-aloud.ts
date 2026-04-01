import type { FeatureModule } from '../types';
import { hasSpeechSynthesis } from '../../utils/platform';
import { getIcon } from '../../ui/icons';

export function createReadAloudModule(
  onUpdate?: (html: string) => void
): FeatureModule {
  let synth: SpeechSynthesis | null = null;
  let utterance: SpeechSynthesisUtterance | null = null;
  let isPlaying = false;
  let isPaused = false;
  let speed = 1.0;
  let cleanupHandlers: (() => void)[] = [];

  function getVisibleText(): string {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('#acorn-access-host, #acorn-access-overlays, script, style, noscript'))
          return NodeFilter.FILTER_REJECT;
        if (!parent.offsetParent && parent.tagName !== 'BODY') return NodeFilter.FILTER_REJECT;
        const text = node.textContent?.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const parts: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      if (text) parts.push(text);
    }
    return parts.join(' ');
  }

  function speak(): void {
    if (!synth) return;
    const text = getVisibleText();
    if (!text) return;

    synth.cancel();

    utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.lang = document.documentElement.lang || navigator.language || 'en';

    utterance.onend = () => {
      isPlaying = false;
      isPaused = false;
      updateControls();
    };

    utterance.onerror = () => {
      isPlaying = false;
      isPaused = false;
      updateControls();
    };

    synth.speak(utterance);
    isPlaying = true;
    isPaused = false;
    updateControls();
  }

  function pauseResume(): void {
    if (!synth) return;
    if (isPaused) {
      synth.resume();
      isPaused = false;
    } else if (isPlaying) {
      synth.pause();
      isPaused = true;
    }
    updateControls();
  }

  function stopSpeech(): void {
    if (!synth) return;
    synth.cancel();
    isPlaying = false;
    isPaused = false;
    updateControls();
  }

  function adjustSpeed(delta: number): void {
    speed = Math.max(0.5, Math.min(2.0, speed + delta));
    if (utterance) utterance.rate = speed;
    updateControls();
  }

  function updateControls(): void {
    const html = `
      <div class="aa-read-aloud-controls">
        <button class="aa-read-aloud-btn" data-ra-action="play" aria-label="${isPlaying && !isPaused ? 'Pause' : 'Play'}">
          ${isPlaying && !isPaused ? getIcon('pause', 16) : getIcon('play', 16)}
        </button>
        <button class="aa-read-aloud-btn" data-ra-action="stop" aria-label="Stop"${!isPlaying ? ' disabled' : ''}>
          ${getIcon('stop', 16)}
        </button>
        <button class="aa-read-aloud-btn" data-ra-action="slower" aria-label="Slower">
          ${getIcon('minus', 14)}
        </button>
        <span class="aa-read-aloud-speed">${speed.toFixed(1)}x</span>
        <button class="aa-read-aloud-btn" data-ra-action="faster" aria-label="Faster">
          ${getIcon('plus', 14)}
        </button>
      </div>
    `;
    onUpdate?.(html);

    // Wire up handlers after render
    requestAnimationFrame(() => {
      // Clean up previous handlers
      cleanupHandlers.forEach((fn) => fn());
      cleanupHandlers = [];

      const host = document.getElementById('acorn-access-host');
      if (!host?.shadowRoot) return;

      host.shadowRoot.querySelectorAll('[data-ra-action]').forEach((btn) => {
        const action = (btn as HTMLElement).dataset.raAction;
        const handler = () => {
          switch (action) {
            case 'play':
              if (isPlaying) pauseResume();
              else speak();
              break;
            case 'stop':
              stopSpeech();
              break;
            case 'slower':
              adjustSpeed(-0.25);
              break;
            case 'faster':
              adjustSpeed(0.25);
              break;
          }
        };
        btn.addEventListener('click', handler);
        cleanupHandlers.push(() => btn.removeEventListener('click', handler));
      });
    });
  }

  return {
    key: 'readAloud',
    order: 104,

    getCss(): string { return ''; },

    enable(): void {
      if (!hasSpeechSynthesis()) return;
      synth = window.speechSynthesis;
      updateControls();
    },

    disable(): void {
      stopSpeech();
      synth = null;
      cleanupHandlers.forEach((fn) => fn());
      cleanupHandlers = [];
      onUpdate?.('');
    },

    reapply(): void {},

    isSupported(): boolean {
      return hasSpeechSynthesis();
    },

    destroy(): void {
      this.disable();
    },
  };
}
