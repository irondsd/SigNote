import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import mongoose from 'mongoose';
import type { NextAuthOptions } from 'next-auth';

import { revokeSessionBySid } from '@/controllers/authSessions';
import { upsertSiweUser, upsertGoogleUser } from '@/controllers/users';
import { validateSiweCredentials } from '@/lib/siwe';

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 2 * 24 * 60 * 60,
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
      },
      async authorize(credentials) {
        if (!credentials?.message || !credentials?.signature) return null;

        const valid = await validateSiweCredentials(credentials.message, credentials.signature);
        if (!valid) return null;

        const user = await upsertSiweUser(valid.address);
        if (!user) return null;

        return { id: user._id.toString(), name: user.displayName };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'google' && profile?.sub) {
        const displayName = profile.name ?? profile.email ?? profile.sub;
        const picture = (profile as { picture?: string }).picture;
        const user = await upsertGoogleUser(profile.sub, displayName, profile.email, picture);
        if (!user) return false;
        // Store MongoDB _id and displayName on the account so jwt callback can use them
        account.userId = user._id.toString();
        account.displayName = user.displayName;
      }
      return true;
    },
    async jwt({ token, account }) {
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
        } else if (account.provider === 'credentials') {
          token.provider = 'siwe';
        }
        token.sid = new mongoose.Types.ObjectId().toString();
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
