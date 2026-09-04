'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { isInstalledDisplayMode, THEME_COLOR_META_ATTR, themeColorFor } from '@/config/themeColors';

/**
 * Keeps `<meta name="theme-color">` on a color the system chrome can actually
 * use: the theme the app is rendering in a browser tab, and the one fixed color
 * the installed app commits to (see `INSTALLED_CHROME_COLOR`, which explains
 * why an installed PWA cannot follow the theme).
 *
 * Either way the tag has to beat the pair Next renders from `viewport.themeColor`,
 * which is keyed on `prefers-color-scheme` — the OS setting, not the in-app
 * toggle. The fix is a tag of our own rather than an edit to Next's: a browser
 * uses the first `theme-color` tag whose media matches, so one carrying no media
 * at the top of the head wins outright, and React keeps ownership of what it
 * rendered.
 */
export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    applyThemeColor(themeColorFor(resolvedTheme, isInstalledDisplayMode()));
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
