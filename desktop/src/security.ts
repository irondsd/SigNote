const DEVELOPMENT_ORIGIN = 'http://localhost:5000';
const PRODUCTION_ORIGIN = 'https://signote.tech';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseOrigin(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid SigNote desktop origin: ${value}`);
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SIGNOTE_DESKTOP_ORIGIN must be an origin without credentials, a path, query, or hash');
  }

  return url;
}

export function resolveAppOrigin(isPackaged: boolean, configuredOrigin = process.env.SIGNOTE_DESKTOP_ORIGIN): URL {
  const url = parseOrigin(configuredOrigin ?? (isPackaged ? PRODUCTION_ORIGIN : DEVELOPMENT_ORIGIN));
  const isLocalDevelopmentOrigin = !isPackaged && url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);

  if (url.protocol !== 'https:' && !isLocalDevelopmentOrigin) {
    throw new Error('SigNote desktop requires HTTPS except for a local development origin');
  }

  return url;
}

export function isAllowedAppNavigation(rawUrl: string, appOrigin: URL): boolean {
  try {
    const target = new URL(rawUrl);
    return target.origin === appOrigin.origin && (target.protocol === 'https:' || target.protocol === 'http:');
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const target = new URL(rawUrl);
    return target.protocol === 'https:' && !target.username && !target.password;
  } catch {
    return false;
  }
}

export function isAllowedBrowserLoginUrl(rawUrl: string, appOrigin: URL): boolean {
  try {
    const target = new URL(rawUrl);
    return (
      target.origin === appOrigin.origin &&
      target.pathname === '/desktop/login' &&
      !target.username &&
      !target.password &&
      !target.hash
    );
  } catch {
    return false;
  }
}
