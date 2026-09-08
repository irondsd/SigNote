/**
 * Web Crypto and the text codecs for the jsdom test environment, which provides
 * neither. Import once, before the module under test.
 */
import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
