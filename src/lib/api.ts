import ky from 'ky';

// Guard against multiple concurrent 401s triggering multiple sign-outs.
let signingOut = false;

const handleUnauthorized = async () => {
  if (typeof window === 'undefined') return;
  if (signingOut) return;
  signingOut = true;

  // Tell other tabs to drop their session too — mirrors SidebarNav's manual sign-out.
  try {
    const channel = new BroadcastChannel('signote-auth');
    channel.postMessage({ type: 'logout' });
    channel.close();
  } catch {
    // BroadcastChannel unavailable (e.g. very old browser); harmless.
  }

  const [{ signOut }, { toast }] = await Promise.all([import('next-auth/react'), import('sonner')]);
  toast.error('Your session ended. Please sign in again.');
  await signOut({ callbackUrl: '/' });
};

export const api = ky.create({
  hooks: {
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          // Fire-and-forget so the original caller still receives the 401 response
          // and can resolve/reject naturally. The page-level redirect happens
          // asynchronously and supersedes any subsequent UI state.
          void handleUnauthorized();
        }
        return response;
      },
    ],
  },
});
