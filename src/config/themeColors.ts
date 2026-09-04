/**
 * Colors the browser paints outside the page: the PWA status bar / toolbar
 * (`<meta name="theme-color">`, manifest `theme_color`) and the install splash
 * (`background_color`).
 *
 * `THEME_COLOR_*` mirror `--sidebar` in `globals.css` — that is what paints the
 * fixed `MobileHeader` sitting directly under the system status bar, so the two
 * read as a single surface. `BACKGROUND_COLOR_*` mirror `--background`.
 * Keep them in sync when those tokens change.
 */
export const THEME_COLOR_LIGHT = '#f7f5f0'; // oklch(97% 0.007 88)
export const THEME_COLOR_DARK = '#171717'; // oklch(0.205 0 0)
export const BACKGROUND_COLOR_LIGHT = '#ffffff'; // oklch(1 0 0)
export const BACKGROUND_COLOR_DARK = '#000000'; // oklch(0 0 0)

/**
 * The one color the installed app's system bar can be.
 *
 * Android paints an installed PWA's status bar from the manifest's `theme_color`
 * and nothing else: the value is captured at install, a manifest cannot vary it
 * by color scheme, and updating `<meta name="theme-color">` at runtime does not
 * repaint it. That meta tag *is* still read, but only to pick the color of the
 * clock and system icons drawn on top. Left to disagree, the two produce the bug
 * this constant exists for — white icons on a light bar, unreadable — because
 * the icons follow the app's theme while the bar cannot.
 *
 * So the installed app commits to dark system chrome in both themes and points
 * the manifest and the meta tag at the same value, which keeps the icons white
 * and legible. Drawing the strip ourselves would let it track the theme, but
 * Chrome does not let an installed PWA paint behind the status bar yet
 * (crbug 40759522), so there is nothing to track it with.
 *
 * Flip this to `THEME_COLOR_LIGHT` for light system chrome instead; what matters
 * is that the manifest and the installed app agree on one value.
 */
export const INSTALLED_CHROME_COLOR = THEME_COLOR_DARK;
export const INSTALLED_SPLASH_COLOR = BACKGROUND_COLOR_DARK;

/** localStorage key next-themes persists the user's choice under. */
export const THEME_STORAGE_KEY = 'sn-theme';

/** Marks the tag the app owns, so React's own metadata tags are left alone. */
export const THEME_COLOR_META_ATTR = 'data-app-theme';

/** Display modes that mean "launched from the home screen", not a browser tab. */
export const INSTALLED_DISPLAY_QUERY =
  '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)';

export function isInstalledDisplayMode() {
  return window.matchMedia(INSTALLED_DISPLAY_QUERY).matches;
}

/**
 * A browser tab paints its toolbar from this tag and does follow it as it
 * changes, so there the color tracks the theme the app is rendering.
 */
export function themeColorFor(resolvedTheme: string | undefined, installed: boolean) {
  if (installed) return INSTALLED_CHROME_COLOR;

  return resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/**
 * Runs before first paint, ahead of hydration, so a cold launch never shows a
 * toolbar from the wrong theme. It prepends the same tag that `ThemeColorMeta`
 * then keeps updated; the storage read mirrors next-themes' own boot script.
 */
export const themeColorInitScript = `(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark =
      stored === 'dark' ||
      ((!stored || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var installed = window.matchMedia(${JSON.stringify(INSTALLED_DISPLAY_QUERY)}).matches;
    var color = installed
      ? ${JSON.stringify(INSTALLED_CHROME_COLOR)}
      : dark
        ? ${JSON.stringify(THEME_COLOR_DARK)}
        : ${JSON.stringify(THEME_COLOR_LIGHT)};
    var meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute(${JSON.stringify(THEME_COLOR_META_ATTR)}, '');
    meta.setAttribute('content', color);
    document.head.insertBefore(meta, document.head.firstChild);
  } catch (e) {}
})();`;
