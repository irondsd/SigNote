import type { CSSProperties } from 'react';

/**
 * Visual tokens for transactional email.
 *
 * Mail clients don't resolve CSS variables and most of them don't understand
 * `oklch()`, so the palette from `src/styles/globals.css` is mirrored here as
 * plain sRGB hex. Keep the two in step by eye — the amber is `--primary`
 * (`#DC7702`) darkened one step for contrast against white in a mail client
 * that ignores our stylesheet entirely.
 */
export const colors = {
  /** Page (outside the card). */
  page: '#F2F0EC',
  card: '#FFFFFF',
  cardBorder: '#E8E5E0',
  /** Inset panels: the code block, the sign-in detail table. */
  panel: '#FAF8F5',
  panelBorder: '#EDEAE4',
  panelBorderDashed: '#E0DCD4',
  rule: '#EFEDE8',

  heading: '#1A1A19',
  body: '#6B6A66',
  bodyStrong: '#3F3E3B',
  muted: '#8A8880',
  subtle: '#A3A099',

  brand: '#D97706',
  onBrand: '#FFFFFF',
} as const;

/**
 * Arial rather than Geist: web fonts are unreliable in mail clients, and a
 * missing @font-face falls back to something we didn't pick. The monospace
 * stack is only used for the one-time code.
 */
export const fonts = {
  sans: 'Arial, Helvetica, sans-serif',
  mono: "'Courier New', Courier, monospace",
} as const;

/**
 * `mso-line-height-rule: exactly` is the only way to make Outlook honour a
 * line-height instead of rounding it to its own idea of one. csstype has no
 * entry for it, so widen the style type rather than casting at every use.
 */
export type EmailStyle = CSSProperties & { msoLineHeightRule?: 'exactly' | 'at-least' };
