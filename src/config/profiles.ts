import type { ProfileDefinition } from './types';

export const DEFAULT_PROFILES: Record<string, ProfileDefinition> = {
  vision: {
    label: 'Vision Impaired',
    icon: 'eye',
    description: 'Enhanced visibility and contrast for low vision users',
    settings: {
      biggerText: 2,
      contrast: 'high',
      highlightLinks: true,
      bigCursor: true,
    },
  },
  reading: {
    label: 'Reading Friendly',
    icon: 'book',
    description: 'Improved readability with better spacing and fonts',
    settings: {
      biggerText: 1,
      textSpacing: 2,
      lineHeight: 2,
      legibleFont: true,
      readingGuide: true,
    },
  },
  motor: {
    label: 'Motor Impaired',
    icon: 'hand',
    description: 'Larger targets and enhanced navigation',
    settings: {
      biggerText: 2,
      bigCursor: true,
      highlightLinks: true,
      textSpacing: 1,
    },
  },
  focus: {
    label: 'ADHD Friendly',
    icon: 'target',
    description: 'Reduced distractions and visual noise',
    settings: {
      pauseAnimations: true,
      readingMask: true,
      saturation: 'low',
      hideImages: true,
    },
  },
  seizureSafe: {
    label: 'Seizure Safe',
    icon: 'shield',
    description: 'Eliminates flashing and reduces motion',
    settings: {
      pauseAnimations: true,
      saturation: 'low',
      contrast: 'dark',
    },
  },
  cognitive: {
    label: 'Cognitive Support',
    icon: 'brain',
    description: 'Simplified reading with enhanced structure',
    settings: {
      biggerText: 1,
      textSpacing: 1,
      lineHeight: 1,
      legibleFont: true,
      highlightLinks: true,
      readingGuide: true,
    },
  },
};
