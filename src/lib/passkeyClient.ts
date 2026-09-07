'use client';

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { signIn } from 'next-auth/react';
import posthog from 'posthog-js';

import { trpcClient } from '@/lib/trpcClient';

export { browserSupportsWebAuthn };

export type PasskeyAuthOutcome = 'success' | 'cancelled' | 'failed';

export async function signInWithPasskey(): Promise<PasskeyAuthOutcome> {
  if (!browserSupportsWebAuthn()) return 'failed';
  posthog.capture('sign_in_started', { method: 'passkey', client: 'web' });

  try {
    const optionsJSON =
      (await trpcClient.passkeys.signInOptions.mutate()) as unknown as PublicKeyCredentialRequestOptionsJSON;
    const assertion = await startAuthentication({ optionsJSON });
    const result = await signIn('passkey', {
      assertion: JSON.stringify(assertion),
      client: 'web',
      redirect: false,
    });
    if (result?.error) {
      posthog.capture('sign_in_failed', { method: 'passkey', client: 'web' });
      return 'failed';
    }
    posthog.capture('sign_in_completed', { method: 'passkey', client: 'web' });
    return 'success';
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'NotAllowedError';
    posthog.capture('sign_in_failed', {
      method: 'passkey',
      client: 'web',
      reason: cancelled ? 'cancelled' : 'ceremony_failed',
    });
    return cancelled ? 'cancelled' : 'failed';
  }
}

export async function signUpWithPasskey(): Promise<PasskeyAuthOutcome> {
  if (!browserSupportsWebAuthn()) return 'failed';
  posthog.capture('sign_in_started', { method: 'passkey', client: 'web', flow: 'sign_up' });

  try {
    const optionsJSON =
      (await trpcClient.passkeys.signUpOptions.mutate()) as unknown as PublicKeyCredentialCreationOptionsJSON;
    const registration = await startRegistration({ optionsJSON });
    const result = await signIn('passkey', {
      registration: JSON.stringify(registration),
      client: 'web',
      redirect: false,
    });
    if (result?.error) {
      posthog.capture('sign_in_failed', { method: 'passkey', client: 'web', flow: 'sign_up' });
      return 'failed';
    }
    posthog.capture('sign_in_completed', { method: 'passkey', client: 'web', flow: 'sign_up' });
    return 'success';
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'NotAllowedError';
    posthog.capture('sign_in_failed', {
      method: 'passkey',
      client: 'web',
      flow: 'sign_up',
      reason: cancelled ? 'cancelled' : 'ceremony_failed',
    });
    return cancelled ? 'cancelled' : 'failed';
  }
}
