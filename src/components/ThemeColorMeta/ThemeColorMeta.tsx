'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { THEME_COLOR_META_ATTR, themeColorFor } from '@/config/themeColors';

/**
 * Keeps `<meta name="theme-color">` on the theme the app is actually rendering.
 *
 * The tags Next emits are keyed on `prefers-color-scheme`, i.e. the OS setting,
 * while the app follows the in-app toggle (`next-themes`, class-based). Whenever
 * the two disagree — say a dark app on a light phone — an installed PWA paints
 * its status bar from the wrong one, which is how a light bar ends up under
 * white system icons.
 *
 * The fix is a tag of our own rather than an edit to Next's: a browser uses the
 * first `theme-color` tag whose media matches, so one carrying no media at the
 * top of the head wins outright, and React keeps ownership of what it rendered.
 */
export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    applyThemeColor(themeColorFor(resolvedTheme));
  }, [resolvedTheme]);

  return null;
}

export function applyThemeColor(color: string) {
  const head = document.head;
  let meta = head.querySelector<HTMLMetaElement>(`meta[name="theme-color"][${THEME_COLOR_META_ATTR}]`);

  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute(THEME_COLOR_META_ATTR, '');
    head.insertBefore(meta, head.firstChild);
  }

  meta.setAttribute('content', color);
}
