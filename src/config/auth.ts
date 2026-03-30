import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { SiweMessage } from 'siwe';

import { consumeNonceRecord } from '@/controllers/nonces';
import { upsertSiweUser, upsertGoogleUser } from '@/controllers/users';

const vercelUrl = process.env.VERCEL_URL;
const nextAuthUrl = process.env.NEXTAUTH_URL;

const getExpectedDomain = () => {
  if (nextAuthUrl) return new URL(nextAuthUrl).host;
  if (vercelUrl) return vercelUrl;
  return null;
};

const getExpectedOrigin = () => {
  if (nextAuthUrl) return new URL(nextAuthUrl).origin;
  if (vercelUrl) return `https://${vercelUrl}`;
  return null;
};

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 5 * 24 * 60 * 60,
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
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
        try {
          if (!credentials?.message || !credentials?.signature) {
            return null;
          }

          const siwe = new SiweMessage(credentials.message);
          const expectedDomain = getExpectedDomain();
          const expectedOrigin = getExpectedOrigin();

          if (expectedDomain && siwe.domain !== expectedDomain) {
            return null;
          }

          if (expectedOrigin && siwe.uri !== expectedOrigin) {
            return null;
          }

          const result = await siwe.verify({
            signature: credentials.signature,
          });

          if (!result.success || !result.data?.nonce) {
            return null;
          }

          const consumedNonce = await consumeNonceRecord(result.data.nonce);
          if (!consumedNonce) {
            return null;
          }

          const user = await upsertSiweUser(result.data.address);
          if (!user) {
            return null;
          }

          return {
            id: user._id.toString(),
            name: user.displayName,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      console.log('signIn callback', { account, profile });
      if (account?.provider === 'google' && profile?.sub) {
        const displayName = profile.name ?? profile.email ?? profile.sub;
        const picture = (profile as { picture?: string }).picture;
        const user = await upsertGoogleUser(profile.sub, displayName, profile.email, picture);
        if (!user) return false;
        // Store MongoDB _id on the account so jwt callback can use it
        account.userId = user._id.toString();
      }
      return true;
    },
    async jwt({ token, account }) {
      if (account?.provider === 'google' && account.userId) {
        token.sub = account.userId as string;
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
};
