/**
 * Everything in an email has to be an absolute URL, so the templates resolve
 * links and images against the deployed origin.
 *
 * The env chain mirrors `getSiteUrl()` in `src/config/meta.ts`; it is repeated
 * rather than imported because that module pulls in `fs` and Next's types,
 * and these templates also render inside the `react-email` preview server.
 */
const FALLBACK_ORIGIN = 'https://signote.tech';

function resolveOrigin() {
  const raw =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;

  if (!raw) {
    return FALLBACK_ORIGIN;
  }

  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

export const origin = resolveOrigin();

export const absoluteUrl = (path: string) => new URL(path, origin).toString();

export const brand = {
  name: 'SigNote',
  /** Rendered at 26px; the file is 52px so it stays sharp on retina clients. */
  logoUrl: absoluteUrl('/images/email/signote-mark-52.png'),
  /**
   * A physical postal address is required by CAN-SPAM/CASL on anything that
   * isn't purely transactional. Placeholder until we have one to publish.
   */
  postalAddress: 'Buenos Aires, Argentina',
} as const;

export const links = {
  vault: absoluteUrl('/'),
  sessions: absoluteUrl('/sessions'),
  privacy: absoluteUrl('/docs/privacy'),
  /**
   * These two routes don't exist yet. They have to before we send anything:
   * an unsubscribe link that 404s is worse than no link at all.
   */
  emailPreferences: absoluteUrl('/profile/notifications'),
  unsubscribe: absoluteUrl('/unsubscribe'),
} as const;
