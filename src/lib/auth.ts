import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions } from 'next-auth';
import { SiweMessage } from 'siwe';

import { consumeNonceRecord, ensureNonceIndexes, upsertSiweUser } from '@/lib/auth-db';

const getExpectedDomain = () => {
  const authUrl = process.env.NEXTAUTH_URL;
  if (!authUrl) {
    return null;
  }

  return new URL(authUrl).host;
};

const getExpectedOrigin = () => {
  const authUrl = process.env.NEXTAUTH_URL;
  if (!authUrl) {
    return null;
  }

  return new URL(authUrl).origin;
};

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 5 * 24 * 60 * 60,
  },
  providers: [
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

          await ensureNonceIndexes();
          const consumedNonce = await consumeNonceRecord(result.data.nonce);
          if (!consumedNonce) {
            return null;
          }

          const user = await upsertSiweUser(result.data.address);
          if (!user) {
            return null;
          }

          return {
            id: user.addressLower,
            name: user.addressChecksum,
            address: user.addressChecksum,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.address = user.address;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.sub === 'string') {
        session.user.id = token.sub;
      }

      if (session.user && typeof token.address === 'string') {
        session.user.address = token.address;
      }

      return session;
    },
  },
};
