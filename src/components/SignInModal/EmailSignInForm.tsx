'use client';

import { signIn } from 'next-auth/react';
import posthog from 'posthog-js';

import { EmailCodeForm } from '@/components/EmailCodeForm/EmailCodeForm';
import { errorCode, useRequestSignInCode } from '@/hooks/useEmailAuth';

/**
 * Wrong code, expired code and no-code-requested are one message on purpose:
 * the server won't say which, because the difference only helps a guesser.
 */
const describeSignInError = (err: unknown, step: 'request' | 'verify') => {
  const code = errorCode(err);
  if (code.includes('Too many')) return code;
  return step === 'request'
    ? 'Could not send a code. Check the address and try again.'
    : 'That code is not valid. Request a new one.';
};

/**
 * Split out of `SignInModal` and loaded only once the user picks email.
 *
 * It reaches `trpcClient`, and importing that eagerly put the whole tRPC client
 * on the critical path of the signed-out page — enough extra dev-mode compile
 * and main-thread work to leave RainbowKit's connect modal still animating when
 * the wallet tests tried to click it.
 */
export default function EmailSignInForm({ isDesktop }: { isDesktop: boolean }) {
  const { mutateAsync: requestCode } = useRequestSignInCode();

  return (
    <EmailCodeForm
      testIdPrefix="signin-email"
      submitLabel="Sign in"
      describeError={describeSignInError}
      onRequestCode={(email) => requestCode(email)}
      onSubmitCode={async (email, code) => {
        const result = await signIn('email-otp', {
          email,
          code,
          client: isDesktop ? 'desktop' : 'web',
          redirect: false,
        });
        // NextAuth turns a null from `authorize` into ok:false rather than a
        // throw, so the form only learns about it if we throw here.
        if (!result?.ok) throw new Error('BAD_CODE');
        posthog.capture('sign_in_completed', { method: 'email' });
      }}
    />
  );
}
