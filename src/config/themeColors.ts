/**
 * Colors the browser paints outside the page: the mobile status bar / toolbar
 * (`<meta name="theme-color">`, manifest `theme_color`) and the install splash
 * (`background_color`).
 *
 * `THEME_COLOR_*` mirror `--sidebar` in `globals.css` — that is what paints the
 * fixed `MobileHeader` sitting directly under the system status bar, so the two
 * read as a single surface. `SPLASH_COLOR` mirrors light `--background`.
 * Keep them in sync when those tokens change.
 */
export const THEME_COLOR_LIGHT = '#f7f5f0'; // oklch(97% 0.007 88)
export const THEME_COLOR_DARK = '#171717'; // oklch(0.205 0 0)
export const SPLASH_COLOR = '#ffffff'; // oklch(1 0 0)

/**
 * The manifest cannot vary `theme_color` by color scheme, and an installed app
 * shows it before the page has loaded far enough to report a theme. Light to
 * match the splash it sits above.
 *
 * Once loaded, Chrome is documented to let `<meta name="theme-color">` override
 * this, which is what lets the bar follow the app's theme. Note that #24 read a
 * device as doing the opposite — painting the bar from this value forever and
 * taking only the *icon* color from the meta tag. If that is what a device does,
 * a theme-tracking tag makes the icons disagree with a bar frozen here, and one
 * of the two themes goes unreadable; the escape hatch is to stop tracking and
 * pin `themeColorFor` to whichever single value this holds.
 */
export const MANIFEST_THEME_COLOR = THEME_COLOR_LIGHT;

/** localStorage key next-themes persists the user's choice under. */
export const THEME_STORAGE_KEY = 'sn-theme';

/** Marks the tag the app owns, so React's own metadata tags are left alone. */
export const THEME_COLOR_META_ATTR = 'data-app-theme';

export function themeColorFor(resolvedTheme: string | undefined) {
  return resolvedTheme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/**
 * Runs before first paint, ahead of hydration, so a cold launch never shows a
 * bar from the wrong theme. It prepends the same tag that `ThemeColorMeta` then
 * keeps updated; the storage read mirrors next-themes' own boot script.
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
