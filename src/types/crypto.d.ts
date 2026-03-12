export type EncryptedPayload = {
  alg: 'A256GCM';
  iv: string; // base64
  ciphertext: string; // base64
};

export type KdfParams = {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  length: number;
};
