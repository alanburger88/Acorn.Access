export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function parseColor(color: string): RGB | null {
  if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;

  const rgba = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
  );
  if (rgba) {
    const alpha = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    if (alpha < 0.1) return null;
    return { r: parseInt(rgba[1]), g: parseInt(rgba[2]), b: parseInt(rgba[3]) };
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  return null;
}

export function relativeLuminance(color: RGB): number {
  const [rs, gs, bs] = [color.r / 255, color.g / 255, color.b / 255].map(
    (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function rgbToHsl(color: RGB): HSL {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

export function rgbToString(color: RGB): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function correctContrast(
  fg: RGB,
  bg: RGB,
  targetRatio: number = 4.5
): RGB {
  const currentRatio = contrastRatio(fg, bg);
  if (currentRatio >= targetRatio) return fg;

  const bgLum = relativeLuminance(bg);
  const fgHsl = rgbToHsl(fg);

  // Try darkening or lightening based on background luminance
  const goLight = bgLum < 0.5;

  for (let step = 0; step <= 100; step++) {
    const newL = goLight
      ? Math.min(100, fgHsl.l + step)
      : Math.max(0, fgHsl.l - step);

    const candidate = hslToRgb({ ...fgHsl, l: newL });
    if (contrastRatio(candidate, bg) >= targetRatio) {
      return candidate;
    }
  }

  // Fallback: pure black or white
  return goLight ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
}

export function getEffectiveBackground(element: Element): RGB | null {
  let el: Element | null = element;
  while (el && el instanceof HTMLElement) {
    const style = getComputedStyle(el);
    const bg = parseColor(style.backgroundColor);
    if (bg) return bg;
    el = el.parentElement;
  }
  return { r: 255, g: 255, b: 255 }; // Default to white
}
