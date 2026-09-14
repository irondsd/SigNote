// Shared 401 handler used by both the ky REST client (lib/api.ts, file
// up/download) and the tRPC clients. Guards against multiple concurrent
// unauthorized responses triggering multiple sign-outs.
let signingOut = false;

// Requests already in flight when the user signs out on purpose come back 401.
// Those are the sign-out's own echo, not an ended session: announcing one and
// reloading to `/` would tear down whatever the user did next.
const DELIBERATE_SIGN_OUT_GRACE_MS = 30_000;
let deliberateSignOutAt = 0;

export const noteDeliberateSignOut = () => {
  deliberateSignOutAt = Date.now();
};

export const handleUnauthorized = async () => {
  if (typeof window === 'undefined') return;
  if (signingOut) return;
  if (Date.now() - deliberateSignOutAt < DELIBERATE_SIGN_OUT_GRACE_MS) return;
  signingOut = true;

  // Tell other tabs to drop their session too — mirrors SidebarNav's manual sign-out.
  try {
    const channel = new BroadcastChannel('signote-auth');
    channel.postMessage({ type: 'logout', preserveDraft: true });
    channel.close();
  } catch {
    // BroadcastChannel unavailable (e.g. very old browser); harmless.
  }

  const [{ signOut }, { toast }, { removeAllVaults }] = await Promise.all([
    import('next-auth/react'),
    import('sonner'),
    import('@/lib/otpStore'),
  ]);
  // A browser storage failure must not prevent the revoked server session from
  // being removed client-side. The Auth page is gated by session state too.
  await removeAllVaults().catch(() => undefined);
  toast.error('Your session ended. Please sign in again.');
  await signOut({ callbackUrl: '/' });
};
