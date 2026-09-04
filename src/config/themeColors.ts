/**
 * Colors the browser paints outside the page: the system bar of the installed
 * app (manifest `theme_color`, `<meta name="theme-color">`) and the install
 * splash (`background_color`).
 *
 * One value for both themes, which is a platform constraint rather than a
 * preference — verified on a device, twice, in both directions.
 *
 * Installing a PWA on Android generates a WebAPK, and the status bar's
 * background is an Android theme resource baked into that APK at install time.
 * Web content cannot repaint it: a manifest cannot vary `theme_color` by color
 * scheme, and updating `<meta name="theme-color">` at runtime does not touch it.
 * The tag *is* still read, but only for the clock and system icons drawn on top
 * — those are a live window flag Chrome sets from the tag's luminance, not an
 * APK resource, which is why exactly half of the bar responds to it.
 *
 * So a tag that tracks the app's theme only makes the icons disagree with a
 * frozen bar, and whichever theme does not match the manifest goes unreadable:
 * a dark manifest gave dark icons on a dark bar in light theme, and a light one
 * gave white icons on a white bar in dark theme. The two have to name the same
 * color, so `viewport.themeColor` in `config/meta.ts` is pinned to this rather
 * than keyed on `prefers-color-scheme`.
 *
 * `SYSTEM_BAR_COLOR` is dark `--sidebar` from `globals.css` — the surface that
 * paints the fixed `MobileHeader` under the bar, so in dark theme the two read
 * as one surface. Keep it in sync when that token changes.
 */
export const SYSTEM_BAR_COLOR = '#171717'; // oklch(0.205 0 0)
export const SPLASH_COLOR = '#000000'; // oklch(0% 0 0)
