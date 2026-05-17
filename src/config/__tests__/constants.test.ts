import { getSealKeyString, HKDF_INFO_SEAL_WRAP_PREFIX, POSITION_STEP } from '@/config/constants';

describe('constants', () => {
  describe('getSealKeyString', () => {
    it('concatenates prefix with sealId', () => {
      expect(getSealKeyString('abc123')).toBe(`${HKDF_INFO_SEAL_WRAP_PREFIX}:abc123`);
    });

    it('handles empty sealId', () => {
      expect(getSealKeyString('')).toBe(`${HKDF_INFO_SEAL_WRAP_PREFIX}:`);
    });
  });

  describe('POSITION_STEP', () => {
    it('is 1000', () => {
      expect(POSITION_STEP).toBe(1000);
    });
  });
});
