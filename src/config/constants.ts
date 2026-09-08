export const POSITION_STEP = 1000;

// Passphrase constraints
export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 256;

// Notes / Secrets / Seals constraints
export const MAX_TITLE = 500;
export const MAX_CONTENT = 500_000;
export const MAX_CIPHER = MAX_CONTENT * 1.5; // Allow for some overhead from encryption, but not unbounded growth
export const MAX_SEARCH = 200;
export const MAX_TAGS_PER_NOTE = 10;

// Version history (embedded per-note snapshots of title + body)
export const MAX_VERSIONS = 10;
// Edits landing within this window of the latest version collapse into the same
// version (the previous snapshot is suppressed) so an autosave burst counts once.
export const VERSION_COMPRESSION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Auto-lock timing
export const HARD_LOCK_MS = 5 * 60 * 1000; // 5 minutes of inactivity
export const SLEEP_CHECK_INTERVAL_MS = 10_000; // interval for sleep detection
export const SLEEP_THRESHOLD_MS = 30_000; // gap that signals device sleep
export const SOFT_LOCK_TS_KEY = 'softLockTs';

// Encryption constants
export const ENC_PBKDF2_ITERATIONS = 600_000;
export const ENC_PBKDF2_LENGTH = 32;
export const ENC_VERSION = 1;
export const ENC_SESSION_KEY = 'enc_device_share_v1';

// HKDF info strings
export const HKDF_INFO_SECRET_BODY = 'secret-body:v1';
export const HKDF_INFO_VERIFY_KEY = 'key-verify:v1';
export const HKDF_INFO_SEAL_WRAP_PREFIX = 'seal-wrap:v1';
export const HKDF_INFO_FILE_ENC = 'file-enc:v1';
export const HKDF_INFO_OTP_VAULT = 'otp-vault:v1';
export const HKDF_INFO_DRAFT = 'draft:v1';
export const KEY_CHECK_PLAINTEXT = 'notes-key-check:v1';

export function getSealKeyString(sealId: string) {
  return `${HKDF_INFO_SEAL_WRAP_PREFIX}:${sealId}`;
}

// Authenticator (TOTP)
export const OTP_AAD_PREFIX = 'otp-record:v1';

/** AAD binding a ciphertext to its row. Without it a stale or malicious server
 *  could move one record's payload onto another id, or replay it. */
export function getOtpRecordAad(recordId: string) {
  return `${OTP_AAD_PREFIX}:${recordId}`;
}

/** Payload-format version stored on the row, independent of `revision`. */
export const OTP_PAYLOAD_VERSION = 1;

/** An OTP envelope is a few hundred bytes. MAX_CIPHER is sized for note bodies
 *  and would let the table be used as free blob storage. */
export const MAX_OTP_CIPHER = 4096;
export const MAX_OTP_RECORDS_PER_USER = 500;

/** Tombstones are kept this long so a device offline for a while still learns
 *  a credential was deleted rather than resurrecting it from its local cache. */
export const OTP_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
