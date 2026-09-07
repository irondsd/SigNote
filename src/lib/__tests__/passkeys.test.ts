import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

import { getPasskeyRpConfig, readWebAuthnChallenge } from '@/lib/passkeys';

describe('passkey RP configuration', () => {
  const originalUrl = process.env.NEXTAUTH_URL;
  const originalRpId = process.env.PASSKEY_RP_ID;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalUrl;
    if (originalRpId === undefined) delete process.env.PASSKEY_RP_ID;
    else process.env.PASSKEY_RP_ID = originalRpId;
  });

  it('derives the RP id and exact origin from NEXTAUTH_URL', () => {
    process.env.NEXTAUTH_URL = 'https://notes.example.com/some/path';
    delete process.env.PASSKEY_RP_ID;

    expect(getPasskeyRpConfig()).toEqual({
      rpName: 'SigNote',
      rpID: 'notes.example.com',
      expectedOrigin: 'https://notes.example.com',
    });
  });

  it('allows an explicit RP id for subdomain deployments', () => {
    process.env.NEXTAUTH_URL = 'https://notes.example.com';
    process.env.PASSKEY_RP_ID = 'example.com';

    expect(getPasskeyRpConfig().rpID).toBe('example.com');
  });

  it('reads a challenge from signed client data', () => {
    const response = {
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ challenge: 'challenge-123' })).toString('base64url'),
      },
    } as RegistrationResponseJSON;

    expect(readWebAuthnChallenge(response)).toBe('challenge-123');
  });

  it.each([
    ['malformed JSON', Buffer.from('{').toString('base64url')],
    ['missing challenge', Buffer.from(JSON.stringify({ type: 'webauthn.get' })).toString('base64url')],
    ['non-string challenge', Buffer.from(JSON.stringify({ challenge: 123 })).toString('base64url')],
  ])('returns null for %s client data', (_label, clientDataJSON) => {
    const response = { response: { clientDataJSON } } as AuthenticationResponseJSON;
    expect(readWebAuthnChallenge(response)).toBeNull();
  });
});
