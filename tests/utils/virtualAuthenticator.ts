import type { CDPSession, Page } from '@playwright/test';

export type VirtualAuthenticator = {
  authenticatorId: string;
  dispose: () => Promise<void>;
};

/** Adds a user-verifying resident-key authenticator to Chromium for one test. */
export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const session: CDPSession = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    authenticatorId,
    dispose: async () => {
      await session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => undefined);
      await session.send('WebAuthn.disable').catch(() => undefined);
      await session.detach().catch(() => undefined);
    },
  };
}
