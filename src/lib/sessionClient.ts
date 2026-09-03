import type { AuthClient } from '@/db/schema';

export const SESSION_CLIENT_HEADER = 'x-signote-client';

type StandaloneNavigator = Navigator & { standalone?: boolean };

/**
 * Installed PWAs generally keep the browser's normal user agent, so display
 * mode has to be detected in the browser rather than inferred on the server.
 */
export function isPwaDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.signoteDesktop?.isDesktop === true) return false;

  const iosStandalone = (navigator as StandaloneNavigator).standalone === true;
  const standaloneDisplay =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;

  return iosStandalone || standaloneDisplay;
}

/** Headers attached to same-origin API calls. The value is only a display
 * label for the sessions screen and is never used as a trust boundary. */
export function getSessionClientHeaders(): Record<string, string> {
  return isPwaDisplayMode() ? { [SESSION_CLIENT_HEADER]: 'pwa' } : {};
}

export function parseWebSessionClient(value: string | null): Extract<AuthClient, 'web' | 'pwa'> {
  return value === 'pwa' ? 'pwa' : 'web';
}
