import { shortenAddress } from '@/utils/shortenAddress';

describe('shortenAddress', () => {
  const addr = '0x1234567890abcdef1234567890abcdef12345678';

  it('shortens with default params (4+4)', () => {
    expect(shortenAddress(addr)).toBe('0x1234...5678');
  });

  it('accepts custom lengths', () => {
    expect(shortenAddress(addr, 6, 6)).toBe('0x123456...345678');
  });

  it('returns empty string for empty input', () => {
    expect(shortenAddress('')).toBe('');
  });

  it('handles short address gracefully', () => {
    expect(shortenAddress('0xAB')).toBe('0xAB...0xAB');
  });
});
