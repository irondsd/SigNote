import { SiweMessage } from 'siwe';
import { consumeNonceRecord } from '@/controllers/nonces';

const getExpectedDomain = () => {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (nextAuthUrl) return new URL(nextAuthUrl).host;
  if (vercelUrl) return vercelUrl;
  return null;
};

const getExpectedOrigin = () => {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (nextAuthUrl) return new URL(nextAuthUrl).origin;
  if (vercelUrl) return `https://${vercelUrl}`;
  return null;
};

export async function validateSiweCredentials(message: string, signature: string): Promise<{ address: string } | null> {
  try {
    const siwe = new SiweMessage(message);
    const expectedDomain = getExpectedDomain();
    const expectedOrigin = getExpectedOrigin();

    if (expectedDomain && siwe.domain !== expectedDomain) return null;
    if (expectedOrigin && siwe.uri !== expectedOrigin) return null;

    const result = await siwe.verify({ signature });

    if (!result.success || !result.data?.nonce) return null;

    const consumedNonce = await consumeNonceRecord(result.data.nonce);
    if (!consumedNonce) return null;

    return { address: result.data.address };
  } catch {
    return null;
  }
}
