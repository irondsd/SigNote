import { after } from 'next/server';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { v7 as uuidv7 } from 'uuid';

import { revokeSessionBySid } from '@/controllers/authSessions';
import { upsertEmailUser, upsertSiweUser, upsertGoogleUser } from '@/controllers/users';
import { consumeSignInCode } from '@/controllers/emailSignInCodes';
import { sendWelcomeEmail } from '@/lib/notificationEmails';
import { validateSiweCredentials } from '@/lib/siwe';
import { resolveSignInClient } from '@/lib/authClient';
import { AUTH_SESSION_MAX_AGE_SECONDS, AUTH_SESSION_UPDATE_AGE_SECONDS } from '@/config/authConstants';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    updateAge: AUTH_SESSION_UPDATE_AGE_SECONDS,
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
      // In tests, GOOGLE_OAUTH_WELL_KNOWN points to a local mock OIDC server so
      // NextAuth discovers all endpoints from there instead of real Google.
      // Omitting the spread (undefined value) preserves the built-in default.
      ...(process.env.GOOGLE_OAUTH_WELL_KNOWN ? { wellKnown: process.env.GOOGLE_OAUTH_WELL_KNOWN } : {}),
    }),
    CredentialsProvider({
      name: 'Ethereum',
      credentials: {
        message: {
          label: 'Message',
          type: 'text',
        },
        signature: {
          label: 'Signature',
          type: 'text',
        },
        client: {
          label: 'Client',
          type: 'text',
        },
      },
      async authorize(credentials) {
        if (!credentials?.message || !credentials?.signature) return null;

        const valid = await validateSiweCredentials(credentials.message, credentials.signature);
        if (!valid) return null;

        const result = await upsertSiweUser(valid.address);
        if (!result) return null;

        // A wallet-only account has no address, so this is a no-op today. It
        // stays wired so a later-linked identity isn't the only way in.
        if (result.created) after(() => sendWelcomeEmail(result.user._id));

        // This value labels the session in the device list only. It is never
        // used as an authorization or trust boundary.
        const client = credentials.client === 'desktop' ? 'desktop' : 'web';
        return { id: result.user._id.toString(), name: result.user.displayName, client };
      },
    }),
    CredentialsProvider({
      // An explicit id, unlike the SIWE provider above: `account.provider` is
      // how the jwt callback tells the two credentials flows apart.
      id: 'email-otp',
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
        client: { label: 'Client', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) return null;

        // Burning the code is the whole authentication. Every failure returns
        // the same null — which of them it was is only useful to a guesser.
        const outcome = await consumeSignInCode({ email: credentials.email, code: credentials.code });
        if (outcome !== 'ok') return null;

        const result = await upsertEmailUser(credentials.email);
        if (!result) return null;

        if (result.created) after(() => sendWelcomeEmail(result.user._id));

        const client = credentials.client === 'desktop' ? 'desktop' : 'web';
        return { id: result.user._id.toString(), name: result.user.displayName, client };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'google' && profile?.sub) {
        const displayName = profile.name ?? profile.email ?? profile.sub;
        const picture = (profile as { picture?: string }).picture;
        // Only a `true` here lets the address attach to the account. Google
        // sets it on every real account, so the false branch should never fire
        // — but an unverified claim is not proof of anything, and the whole
        // one-address-one-account rule rests on this flag.
        const emailVerified = (profile as { email_verified?: boolean }).email_verified === true;
        const result = await upsertGoogleUser(profile.sub, displayName, profile.email, picture, emailVerified);
        if (!result) return false;
        if ('error' in result) {
          // A string return is a redirect. The address belongs to someone, and
          // Google didn't vouch for it, so there is nothing safe to do here.
          return '/?auth_error=email_taken';
        }

        if (result.created) after(() => sendWelcomeEmail(result.user._id));

        // Store the user id and displayName on the account so jwt callback can use them
        account.userId = result.user._id.toString();
        account.displayName = result.user.displayName;
      }
      return true;
    },
    async jwt({ token, account, user }) {
      if (account) {
        // First sign-in for this JWT — issue a session id and capture the provider.
        // Subsequent calls (token refresh) have no `account` and pass the existing claims through unchanged.
        if (account.provider === 'google' && account.userId) {
          token.sub = account.userId;
          token.name = account.displayName ?? token.name;
        }
        // NextAuth's CredentialsProvider has no explicit `id`, so account.provider
        // is the literal 'credentials' — map it to our internal 'siwe' label.
        if (account.provider === 'google') {
          token.provider = 'google';
        } else if (account.provider === 'email-otp') {
          token.provider = 'email';
        } else if (account.provider === 'credentials') {
          token.provider = 'siwe';
        }
        token.client = resolveSignInClient(account.provider, user?.client);
        token.sid = uuidv7();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.sub === 'string') {
        session.user.id = token.sub;
      }

      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.sid) {
        await revokeSessionBySid(token.sid);
      }
    },
  },
};
