export const POSITION_STEP = 1000;

// Passphrase constraints
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 256;

// Notes / Secrets / Seals constraints
export const MAX_TITLE = 500;
export const MAX_CONTENT = 500_000;
export const MAX_CIPHER = MAX_CONTENT * 1.5; // Allow for some overhead from encryption, but not unbounded growth
export const MAX_SEARCH = 200;

// Encryption constants
export const ENC_PBKDF2_ITERATIONS = 600_000;
export const ENC_PBKDF2_LENGTH = 32;
export const ENC_VERSION = 1;
export const ENC_SESSION_KEY = 'enc_device_share_v1';

// HKDF info strings
export const HKDF_INFO_SECRET_BODY = 'secret-body:v1';
export const HKDF_INFO_VERIFY_KEY = 'key-verify:v1';
export const HKDF_INFO_SEAL_WRAP_PREFIX = 'seal-wrap:v1';
export const KEY_CHECK_PLAINTEXT = 'notes-key-check:v1';

export function getSealKeyString(sealId: string) {
  return `${HKDF_INFO_SEAL_WRAP_PREFIX}:${sealId}`;
}
