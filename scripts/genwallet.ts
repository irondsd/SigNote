import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

// ============================================================================
// 1. Elliptic Curve Math: secp256k1 (pure TS using BigInt)
// ============================================================================
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

interface Point {
  x: bigint;
  y: bigint;
}

const G: Point = { x: Gx, y: Gy };

function mod(a: bigint, m: bigint = P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInverse(a: bigint, m: bigint = P): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

function pointAdd(p1: Point | null, p2: Point | null): Point | null {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (p1.y === p2.y) return pointDouble(p1);
    return null;
  }
  const slope = mod((p2.y - p1.y) * modInverse(p2.x - p1.x));
  const x3 = mod(slope * slope - p1.x - p2.x);
  const y3 = mod(slope * (p1.x - x3) - p1.y);
  return { x: x3, y: y3 };
}

function pointDouble(p: Point | null): Point | null {
  if (!p || p.y === 0n) return null;
  const slope = mod(3n * p.x * p.x * modInverse(2n * p.y));
  const x3 = mod(slope * slope - 2n * p.x);
  const y3 = mod(slope * (p.x - x3) - p.y);
  return { x: x3, y: y3 };
}

function pointMultiply(k: bigint, p: Point = G): Point {
  let r: Point | null = null;
  let base: Point | null = p;
  let scalar = k;
  while (scalar > 0n) {
    if (scalar & 1n) r = pointAdd(r, base);
    base = pointDouble(base);
    scalar >>= 1n;
  }
  if (!r) throw new Error('Invalid point multiplication');
  return r;
}

function getPublicKey(privKey: Uint8Array, compressed = true): Uint8Array {
  const k = BigInt('0x' + Buffer.from(privKey).toString('hex'));
  const pt = pointMultiply(k, G);
  const x = Buffer.from(pt.x.toString(16).padStart(64, '0'), 'hex');
  const y = Buffer.from(pt.y.toString(16).padStart(64, '0'), 'hex');
  if (compressed) {
    const prefix = pt.y % 2n === 0n ? 0x02 : 0x03;
    return Buffer.concat([Buffer.from([prefix]), x]);
  }
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

// ============================================================================
// 2. Keccak-256 (for Ethereum and TRON)
// ============================================================================
const RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

function rotl64(x: bigint, n: number): bigint {
  if (n === 0) return x;
  const s = BigInt(n % 64);
  return ((x << s) | (x >> (64n - s))) & 0xffffffffffffffffn;
}

function keccakF1600(state: BigUint64Array) {
  const B = new BigUint64Array(25);
  const C = new BigUint64Array(5);
  const D = new BigUint64Array(5);

  for (let round = 0; round < 24; round++) {
    // Theta
    for (let x = 0; x < 5; x++) {
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    }
    for (let i = 0; i < 25; i++) {
      state[i] ^= D[i % 5];
    }

    // Rho and Pi
    B[0] = state[0];
    let x = 1,
      y = 0;
    for (let t = 0; t < 24; t++) {
      const rot = (((t + 1) * (t + 2)) / 2) % 64;
      const newX = y;
      const newY = (2 * x + 3 * y) % 5;
      B[newX + 5 * newY] = rotl64(state[x + 5 * y], rot);
      x = newX;
      y = newY;
    }

    // Chi
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        state[cx + 5 * cy] =
          B[cx + 5 * cy] ^ (~B[((cx + 1) % 5) + 5 * cy] & 0xffffffffffffffffn & B[((cx + 2) % 5) + 5 * cy]);
      }
    }

    // Iota
    state[0] ^= RC[round];
  }
}

function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136;
  const padLen = rate - (data.length % rate);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new BigUint64Array(25);
  for (let b = 0; b < padded.length; b += rate) {
    for (let i = 0; i < 17; i++) {
      let word = 0n;
      for (let j = 0; j < 8; j++) {
        word |= BigInt(padded[b + i * 8 + j]) << BigInt(j * 8);
      }
      state[i] ^= word;
    }
    keccakF1600(state);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number((state[i] >> BigInt(j * 8)) & 0xffn);
    }
  }
  return out;
}

// ============================================================================
// 3. BIP-32 HD Node Derivation
// ============================================================================
interface HDNode {
  key: Uint8Array;
  chainCode: Uint8Array;
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return createHmac('sha512', key).update(data).digest();
}

function createMasterKey(seed: Uint8Array): HDNode {
  const I = hmacSha512(Buffer.from('Bitcoin seed', 'utf8'), seed);
  return {
    key: I.subarray(0, 32),
    chainCode: I.subarray(32, 64),
  };
}

function deriveChild(parent: HDNode, index: number): HDNode {
  const isHardened = (index & 0x80000000) !== 0;
  const idxBuf = Buffer.alloc(4);
  idxBuf.writeUInt32BE(index >>> 0, 0);

  const data = isHardened
    ? Buffer.concat([Buffer.from([0x00]), parent.key, idxBuf])
    : Buffer.concat([getPublicKey(parent.key, true), idxBuf]);

  const I = hmacSha512(parent.chainCode, data);
  const IL = I.subarray(0, 32);
  const IR = I.subarray(32, 64);

  const ki =
    (BigInt('0x' + Buffer.from(IL).toString('hex')) + BigInt('0x' + Buffer.from(parent.key).toString('hex'))) % N;
  const childKey = Buffer.from(ki.toString(16).padStart(64, '0'), 'hex');

  return { key: childKey, chainCode: IR };
}

function derivePath(root: HDNode, path: string): HDNode {
  const segments = path.split('/').slice(1);
  return segments.reduce((node, seg) => {
    const hardened = seg.endsWith("'") || seg.endsWith('h');
    const idx = parseInt(seg.replace(/['h]/g, ''), 10);
    return deriveChild(node, hardened ? (idx | 0x80000000) >>> 0 : idx);
  }, root);
}

// ============================================================================
// 4. Base58 & Bech32 Encodings
// ============================================================================
const B58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Check(payload: Uint8Array): string {
  const h1 = createHash('sha256').update(payload).digest();
  const checksum = createHash('sha256').update(h1).digest().subarray(0, 4);
  const data = Buffer.concat([payload, checksum]);

  let num = BigInt('0x' + data.toString('hex'));
  let encoded = '';
  while (num > 0n) {
    encoded = B58_CHARS[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  for (let i = 0; i < data.length && data[i] === 0; i++) {
    encoded = '1' + encoded;
  }
  return encoded;
}

const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function encodeBech32(hrp: string, data5bit: number[]): string {
  const hrpExpanded: number[] = [];
  for (let i = 0; i < hrp.length; i++) hrpExpanded.push(hrp.charCodeAt(i) >> 5);
  hrpExpanded.push(0);
  for (let i = 0; i < hrp.length; i++) hrpExpanded.push(hrp.charCodeAt(i) & 31);

  const values = hrpExpanded.concat(data5bit).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;
  const checksum = [];
  for (let p = 0; p < 6; p++) checksum.push((mod >> (5 * (5 - p))) & 31);

  return (
    hrp +
    '1' +
    data5bit
      .concat(checksum)
      .map((d) => BECH32_ALPHABET[d])
      .join('')
  );
}

function convertBits(data: Uint8Array, from: number, to: number, pad = true): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const byte of data) {
    acc = (acc << from) | byte;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (to - bits)) & maxv);
  return ret;
}

// ============================================================================
// 5. Chain Address Builders
// ============================================================================

// Bitcoin: Legacy (P2PKH) & Native SegWit (BIP-84)
function getBtcAddresses(privKey: Uint8Array) {
  const pubCompressed = getPublicKey(privKey, true);
  const sha = createHash('sha256').update(pubCompressed).digest();
  const hash160 = createHash('ripemd160').update(sha).digest();

  // Legacy P2PKH (starts with 1)
  const legacy = base58Check(Buffer.concat([Buffer.from([0x00]), hash160]));

  // SegWit P2WPKH (starts with bc1q)
  const segwit5bit = [0].concat(convertBits(hash160, 8, 5, true));
  const segwit = encodeBech32('bc', segwit5bit);

  // WIF Private Key
  const wif = base58Check(Buffer.concat([Buffer.from([0x80]), privKey, Buffer.from([0x01])]));

  return { legacy, segwit, wif };
}

// Ethereum: EIP-55 Checksum Address
function getEthAddress(privKey: Uint8Array): string {
  const pubUncompressed = getPublicKey(privKey, false).subarray(1); // strip 0x04
  const hash = keccak256(pubUncompressed);
  const addrBytes = hash.subarray(12, 32);
  const hex = Buffer.from(addrBytes).toString('hex');

  const hashHex = Buffer.from(keccak256(Buffer.from(hex, 'ascii'))).toString('hex');
  let checksummed = '0x';
  for (let i = 0; i < hex.length; i++) {
    checksummed += parseInt(hashHex[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return checksummed;
}

// TRON: Base58 Address (starts with T)
function getTronAddress(privKey: Uint8Array): { base58: string; hex: string } {
  const pubUncompressed = getPublicKey(privKey, false).subarray(1);
  const hash = keccak256(pubUncompressed);
  const addrBytes = hash.subarray(12, 32);

  // Tron prepends mainnet byte 0x41 (21 bytes total)
  const tronBytes = Buffer.concat([Buffer.from([0x41]), addrBytes]);
  return {
    base58: base58Check(tronBytes),
    hex: '41' + Buffer.from(addrBytes).toString('hex'),
  };
}

// ============================================================================
// 6. Main Runner
// ============================================================================
function main() {
  // Pass a custom 12/24-word mnemonic as an argument, or fallback to demo mnemonic
  const mnemonicArg = process.argv.slice(2).join(' ');
  const mnemonic =
    mnemonicArg.trim() ||
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  console.log('='.repeat(70));
  console.log('Mnemonic Phrase:');
  console.log(`  "${mnemonic}"`);
  console.log('='.repeat(70));

  // BIP-39 PBKDF2: 2048 iterations with salt "mnemonic" + optional passphrase
  const seed = pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  const root = createMasterKey(seed);

  // 1. Bitcoin
  const btcPath = "m/44'/0'/0'/0/0";
  const btcNode = derivePath(root, btcPath);
  const btcInfo = getBtcAddresses(btcNode.key);

  console.log('\n[ BITCOIN (BTC) ]');
  console.log(`  Path:           ${btcPath}`);
  console.log(`  Private Key:    0x${Buffer.from(btcNode.key).toString('hex')}`);
  console.log(`  WIF Key:        ${btcInfo.wif}`);
  console.log(`  Legacy (P2PKH): ${btcInfo.legacy}`);
  console.log(`  SegWit (BIP-84):${btcInfo.segwit}`);

  // 2. Ethereum
  const ethPath = "m/44'/60'/0'/0/0";
  const ethNode = derivePath(root, ethPath);
  const ethAddress = getEthAddress(ethNode.key);

  console.log('\n[ ETHEREUM (ETH) ]');
  console.log(`  Path:           ${ethPath}`);
  console.log(`  Private Key:    0x${Buffer.from(ethNode.key).toString('hex')}`);
  console.log(`  Address:        ${ethAddress}`);

  // 3. TRON
  const trxPath = "m/44'/195'/0'/0/0";
  const trxNode = derivePath(root, trxPath);
  const trxInfo = getTronAddress(trxNode.key);

  console.log('\n[ TRON (TRX) ]');
  console.log(`  Path:           ${trxPath}`);
  console.log(`  Private Key:    0x${Buffer.from(trxNode.key).toString('hex')}`);
  console.log(`  Address:        ${trxInfo.base58}`);
  console.log(`  Address (Hex):  ${trxInfo.hex}`);
  console.log('='.repeat(70));
}

main();
