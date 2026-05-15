import type { CSSProperties } from 'react';
import { NOTE_COLOR_CONFIG, type NoteColor, type NotePattern } from './noteColors';

function svgURI(svg: string) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

function resolve(color: NoteColor | null, isDark: boolean) {
  const cfg = color ? NOTE_COLOR_CONFIG[color] : null;
  if (!cfg) {
    const pat = isDark ? 'oklch(0.55 0.01 260 / 0.6)' : 'oklch(0.65 0.01 260 / 0.55)';
    const pat2 = isDark ? 'oklch(0.45 0.04 50 / 0.5)' : 'oklch(0.85 0.04 50 / 0.4)';
    return { pat, pat2 };
  }

  const [L, C] = isDark ? cfg.dark : cfg.light;
  const hue = cfg.hue;

  let pat: string;
  if (isDark) {
    pat = `oklch(${Math.min(L + 0.22, 0.62)} ${Math.min(C + 0.04, 0.12)} ${hue} / 0.6)`;
  } else {
    pat = `oklch(${Math.max(L - 0.18, 0.65)} ${Math.min(C + 0.06, 0.14)} ${hue} / 0.55)`;
  }

  const hue2 = (hue + 35) % 360;
  let pat2: string;
  if (isDark) {
    pat2 = `oklch(${Math.min(L + 0.16, 0.55)} ${Math.min(C + 0.05, 0.13)} ${hue2} / 0.55)`;
  } else {
    pat2 = `oklch(${Math.max(L - 0.1, 0.78)} ${Math.min(C + 0.08, 0.16)} ${hue2} / 0.55)`;
  }

  return { pat, pat2 };
}

const PATTERN_GENERATORS: Record<Exclude<NotePattern, 'plain'>, (r: { pat: string; pat2: string }) => CSSProperties> = {
  grid: ({ pat }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M22 0H0v22" fill="none" stroke="${pat}" stroke-width="0.7"/></svg>`;
    return { backgroundImage: svgURI(svg), backgroundSize: '22px 22px' };
  },

  dots: ({ pat }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="5" cy="5" r="1" fill="${pat}" /></svg>`;
    return { backgroundImage: svgURI(svg), backgroundSize: '14px 14px' };
  },

  stars: ({ pat, pat2 }) => {
    const star = (x: number, y: number, s: number, o: number, fill: string) =>
      `<g transform="translate(${x},${y}) scale(${s})" opacity="${o}"><path d="M0 -4 L0.9 -0.9 L4 0 L0.9 0.9 L0 4 L-0.9 0.9 L-4 0 L-0.9 -0.9 Z" fill="${fill}"/></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">${star(12, 14, 1.1, 0.85, pat)}${star(58, 8, 0.9, 0.7, pat2)}${star(38, 34, 0.7, 0.75, pat)}${star(70, 46, 1.0, 0.8, pat2)}${star(20, 56, 0.85, 0.7, pat)}${star(48, 70, 0.7, 0.7, pat2)}${star(8, 76, 0.6, 0.6, pat)}</svg>`;
    return { backgroundImage: svgURI(svg), backgroundSize: '80px 80px' };
  },

  hatch: ({ pat }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M-1 3 L3 -1 M0 10 L10 0 M7 11 L11 7" stroke="${pat}" stroke-width="0.4" /></svg>`;
    return { backgroundImage: svgURI(svg), backgroundSize: '10px 10px' };
  },

  blobs: ({ pat, pat2 }) => ({
    backgroundImage: `radial-gradient(circle 140px at 12% 18%, ${pat2} 0%, transparent 62%), radial-gradient(circle 180px at 92% 88%, ${pat} 0%, transparent 60%)`,
  }),
};

export function getPatternStyle(
  color: NoteColor | null,
  pattern: NotePattern | null,
  isDark: boolean,
): CSSProperties | undefined {
  if (!pattern || pattern === 'plain') return undefined;
  const generator = PATTERN_GENERATORS[pattern];
  if (!generator) return undefined;
  const r = resolve(color, isDark);
  return generator(r);
}
