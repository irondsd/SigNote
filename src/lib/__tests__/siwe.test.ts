jest.mock('siwe', () => ({ SiweMessage: jest.fn() }));
jest.mock('@/controllers/nonces', () => ({ consumeNonceRecord: jest.fn() }));

import { SiweMessage } from 'siwe';
import { consumeNonceRecord } from '@/controllers/nonces';
import { validateSiweCredentials } from '@/lib/siwe';

const MockSiweMessage = SiweMessage as unknown as jest.Mock;
const mockConsumeNonce = consumeNonceRecord as jest.MockedFunction<typeof consumeNonceRecord>;

type SiweFields = {
  domain?: string;
  uri?: string;
  verifyResult?: { success: boolean; data?: { nonce?: string; address?: string } };
  verifyThrows?: boolean;
};

function mockSiweInstance(fields: SiweFields = {}) {
  const {
    domain = 'example.com',
    uri = 'https://example.com',
    verifyResult = { success: true, data: { nonce: 'n1', address: '0xabc' } },
    verifyThrows = false,
  } = fields;
  MockSiweMessage.mockImplementation(() => ({
    domain,
    uri,
    verify: jest.fn().mockImplementation(() => (verifyThrows ? Promise.reject(new Error('verify failed')) : Promise.resolve(verifyResult))),
  }));
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  MockSiweMessage.mockReset();
  mockConsumeNonce.mockReset();
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('validateSiweCredentials', () => {
  it('returns null when SiweMessage construction throws', async () => {
    MockSiweMessage.mockImplementation(() => {
      throw new Error('bad message');
    });
    const result = await validateSiweCredentials('msg', 'sig');
    expect(result).toBeNull();
  });

  it('returns null when domain does not match NEXTAUTH_URL host', async () => {
    process.env.NEXTAUTH_URL = 'https://example.com';
    mockSiweInstance({ domain: 'other.com' });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('returns null when uri does not match NEXTAUTH_URL origin', async () => {
    process.env.NEXTAUTH_URL = 'https://example.com';
    mockSiweInstance({ domain: 'example.com', uri: 'https://attacker.com' });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('uses VERCEL_URL fallback for domain when NEXTAUTH_URL is unset', async () => {
    process.env.VERCEL_URL = 'deploy.vercel.app';
    mockSiweInstance({ domain: 'wrong.com', uri: 'https://deploy.vercel.app' });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('uses VERCEL_URL fallback for origin (https://${VERCEL_URL}) when NEXTAUTH_URL is unset', async () => {
    process.env.VERCEL_URL = 'deploy.vercel.app';
    mockConsumeNonce.mockResolvedValue({} as never);
    mockSiweInstance({ domain: 'deploy.vercel.app', uri: 'https://deploy.vercel.app' });
    const result = await validateSiweCredentials('msg', 'sig');
    expect(result).toEqual({ address: '0xabc' });
  });

  it('skips domain/origin check when neither env var is set', async () => {
    mockConsumeNonce.mockResolvedValue({} as never);
    mockSiweInstance({ domain: 'whatever.com', uri: 'https://anything.com' });
    const result = await validateSiweCredentials('msg', 'sig');
    expect(result).toEqual({ address: '0xabc' });
  });

  it('returns null when siwe.verify returns success=false', async () => {
    mockSiweInstance({ verifyResult: { success: false } });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('returns null when siwe.verify returns success but missing nonce', async () => {
    mockSiweInstance({ verifyResult: { success: true, data: { address: '0xabc' } } });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('returns null when consumeNonceRecord returns null (nonce already consumed)', async () => {
    mockConsumeNonce.mockResolvedValue(null);
    mockSiweInstance();
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });

  it('returns { address } on success and calls consumeNonceRecord with the verified nonce', async () => {
    mockConsumeNonce.mockResolvedValue({} as never);
    mockSiweInstance();
    const result = await validateSiweCredentials('msg', 'sig');
    expect(result).toEqual({ address: '0xabc' });
    expect(mockConsumeNonce).toHaveBeenCalledWith('n1');
  });

  it('returns null when verify itself throws (caught by outer try)', async () => {
    mockSiweInstance({ verifyThrows: true });
    expect(await validateSiweCredentials('msg', 'sig')).toBeNull();
  });
});
