// Shared 401 handler used by both the ky REST client (lib/api.ts, file
// up/download) and the tRPC clients. Guards against multiple concurrent
// unauthorized responses triggering multiple sign-outs.
let signingOut = false;

export const handleUnauthorized = async () => {
  if (typeof window === 'undefined') return;
  if (signingOut) return;
  signingOut = true;

  // Tell other tabs to drop their session too — mirrors SidebarNav's manual sign-out.
  try {
    const channel = new BroadcastChannel('signote-auth');
    channel.postMessage({ type: 'logout', preserveDraft: true });
    channel.close();
  } catch {
    // BroadcastChannel unavailable (e.g. very old browser); harmless.
  }

  const [{ signOut }, { toast }] = await Promise.all([import('next-auth/react'), import('sonner')]);
  toast.error('Your session ended. Please sign in again.');
  await signOut({ callbackUrl: '/' });
};
