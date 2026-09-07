import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type Base64URLString,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type { PasskeyRow } from '@/controllers/passkeys';

const DEFAULT_NEXTAUTH_URL = 'http://localhost:5000';

export function getPasskeyRpConfig() {
  const configuredUrl = process.env.NEXTAUTH_URL ?? DEFAULT_NEXTAUTH_URL;
  const url = new URL(configuredUrl);
  return {
    rpName: 'SigNote',
    rpID: process.env.PASSKEY_RP_ID?.trim() || url.hostname,
    expectedOrigin: url.origin,
  };
}

export async function makeRegistrationOptions(params: {
  userId: string;
  userName: string;
  userDisplayName: string;
  excludeCredentialIds?: string[];
}) {
  const config = getPasskeyRpConfig();
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userID: new TextEncoder().encode(params.userId),
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    attestationType: 'none',
    excludeCredentials: (params.excludeCredentialIds ?? []).map((credentialId) => ({
      id: credentialId as Base64URLString,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'preferred',
    },
  });
}

export async function makeAuthenticationOptions() {
  return generateAuthenticationOptions({
    rpID: getPasskeyRpConfig().rpID,
    allowCredentials: [],
    userVerification: 'preferred',
  });
}

export function readWebAuthnChallenge(response: RegistrationResponseJSON | AuthenticationResponseJSON): string | null {
  try {
    const json = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')) as {
      challenge?: unknown;
    };
    return typeof json.challenge === 'string' ? json.challenge : null;
  } catch {
    return null;
  }
}

export async function verifyPasskeyRegistration(response: RegistrationResponseJSON, expectedChallenge: string) {
  const config = getPasskeyRpConfig();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.expectedOrigin,
    expectedRPID: config.rpID,
    // Options say preferred, not required. Presence remains required.
    requireUserVerification: false,
  });
  if (!result.verified) return null;

  const info = result.registrationInfo;
  return {
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: response.response.transports ?? [],
    aaguid: info.aaguid,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  };
}

export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: PasskeyRow,
) {
  const config = getPasskeyRpConfig();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.expectedOrigin,
    expectedRPID: config.rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.credentialId as Base64URLString,
      publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });
  return result.verified ? result.authenticationInfo : null;
}
