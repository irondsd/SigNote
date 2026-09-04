/**
 * Colors the browser paints outside the page: the PWA status bar / toolbar
 * (`<meta name="theme-color">`, manifest `theme_color`) and the install splash
 * (`background_color`).
 *
 * `THEME_COLOR_*` mirror `--sidebar` in `globals.css` — that is what paints the
 * fixed `MobileHeader` sitting directly under the system status bar, so the two
 * read as a single surface. `BACKGROUND_COLOR_LIGHT` mirrors `--background`.
 * Keep them in sync when those tokens change.
 */
export const THEME_COLOR_LIGHT = '#f7f5f0'; // oklch(97% 0.007 88)
export const THEME_COLOR_DARK = '#171717'; // oklch(0.205 0 0)
export const BACKGROUND_COLOR_LIGHT = '#ffffff'; // oklch(1 0 0)

/** localStorage key next-themes persists the user's choice under. */
export const THEME_STORAGE_KEY = 'sn-theme';

export function themeColorFor(resolvedTheme: string | undefined) {
  return resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/** Marks the tag the app owns, so React's own metadata tags are left alone. */
export const THEME_COLOR_META_ATTR = 'data-app-theme';

/**
 * Runs before first paint, ahead of hydration, so a cold PWA launch never shows
 * a status bar from the wrong theme. It prepends the same tag that
 * `ThemeColorMeta` then keeps updated; the storage read mirrors next-themes'
 * own boot script.
 */
export const themeColorInitScript = `(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark =
      stored === 'dark' ||
      ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute(${JSON.stringify(THEME_COLOR_META_ATTR)}, '');
    meta.setAttribute('content', dark ? ${JSON.stringify(THEME_COLOR_DARK)} : ${JSON.stringify(THEME_COLOR_LIGHT)});
    document.head.insertBefore(meta, document.head.firstChild);
  } catch (e) {}
})();`;
