/**
 * Fills the local database with plausible junk for one account.
 *
 *   bun run ./scripts/seedLocalDb.ts --email you@example.com
 *   bun run ./scripts/seedLocalDb.ts --email you@example.com --wallet 0xabc… --count 25 --wipe
 *
 * The account it makes can be signed into two ways, without either being
 * seeded as a fake identity:
 *
 *   - **an emailed code**, because `emailAuth.requestCode` resolves the account
 *     by `users.email`, and
 *   - **Google**, because a Google sign-in whose address is already held by an
 *     account attaches itself to that account when the provider says it is
 *     verified (`upsertGoogleUser`). Seeding a made-up Google `sub` would only
 *     get in the way — the real one is not knowable from here.
 *
 * `emailOwnerIdentityId` is therefore left null: the address is treated as
 * code-proved, which is both true and what keeps it detachable in the UI.
 *
 * The vault passphrase defaults to the one the E2E suite uses, so an account
 * seeded here unlocks with the passphrase already in your muscle memory.
 *
 * Local only — the target comes from `.env.local` and nothing else. See
 * `scripts/lib/localDb.ts`.
 */
import { and, eq, desc, sql as raw } from 'drizzle-orm';

import { ENC_PBKDF2_ITERATIONS, HKDF_INFO_VERIFY_KEY, KEY_CHECK_PLAINTEXT, POSITION_STEP } from '@/config/constants';
import { autoTagColor, NOTE_COLORS, NOTE_PATTERNS } from '@/config/noteStyles';
import {
  authIdentities,
  encryptionProfiles,
  noteTags,
  otpRecords,
  sealNoteTags,
  secretNoteTags,
  tags as tagsTable,
  users,
} from '../src/db/schema';
import { seedEncryptionProfileForUser } from '../tests/fixtures/seedEncryptionProfile';
import { seedNotesForUser } from '../tests/fixtures/seedNotes';
import { seedOtpRecordsForUser } from '../tests/fixtures/seedOtpRecords';
import { seedSealsForUser } from '../tests/fixtures/seedSeals';
import { seedSecretsForUser } from '../tests/fixtures/seedSecrets';
import { Gibberish, makeRng, TAG_NAMES } from './lib/gibberish';
import { openLocalDb, type LocalDb, wipeLocalDatabase } from './lib/localDb';

/** Same as `tests/pages/SecretsPage.ts`, on purpose. */
const DEFAULT_PASSPHRASE = 'correct-horse-battery-staple-42';
const DEFAULT_COUNT = 10;

const OTP_ISSUERS = [
  'GitHub',
  'Google',
  'AWS',
  'Cloudflare',
  'Vercel',
  'Stripe',
  'Fastmail',
  'Proton',
  'Discord',
  'npm',
  'Linear',
  'Figma',
];

// ─── Arguments ───────────────────────────────────────────────────────────────

type Options = {
  email: string;
  wallet: string | null;
  passphrase: string;
  count: number;
  seed: number;
  wipe: boolean;
};

const USAGE = `Usage: bun run ./scripts/seedLocalDb.ts --email <address> [options]

  --email <address>     Account to seed. Created if it does not exist. Required.
  --wallet <0x…>        Also attach a SIWE identity for this address.
  --passphrase <text>   Vault passphrase (default: ${DEFAULT_PASSPHRASE}).
  --count <n>           Rows per tier (default: ${DEFAULT_COUNT}).
  --seed <n>            PRNG seed, for reproducible filler (default: random).
  --wipe                Empty the whole local database first.`;

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}".\n\n${USAGE}`);
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    const name = equals === -1 ? body : body.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : body.slice(equals + 1);
    const next = argv[i + 1];
    if (inlineValue !== undefined) flags.set(name, inlineValue);
    else if (next && !next.startsWith('--')) flags.set(name, argv[++i]);
    else flags.set(name, true);
  }

  const text = (name: string): string | null => {
    const value = flags.get(name);
    if (value === undefined) return null;
    if (value === true) throw new Error(`--${name} needs a value.\n\n${USAGE}`);
    return value;
  };

  const number = (name: string, fallback: number): number => {
    const value = text(name);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative number.`);
    return parsed;
  };

  const email = text('email');
  if (!email) throw new Error(`--email is required.\n\n${USAGE}`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" does not look like an email address.`);

  const wallet = text('wallet') ?? text('address');
  if (wallet !== null && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    throw new Error(`--wallet must be a 0x-prefixed 20-byte address, got "${wallet}".`);
  }

  return {
    email: email.trim().toLowerCase(),
    wallet,
    passphrase: text('passphrase') ?? DEFAULT_PASSPHRASE,
    count: number('count', DEFAULT_COUNT),
    seed: number('seed', (Math.random() * 2 ** 32) >>> 0),
    wipe: flags.get('wipe') === true,
  };
}

// ─── Account ─────────────────────────────────────────────────────────────────

/**
 * The user row, created if the address is new.
 *
 * Mirrors `upsertEmailUser` rather than calling it: that path goes through the
 * app's own pool (`@/db/client`), and this script deliberately owns exactly one
 * connection, to the one URL it vetted.
 */
async function ensureUser(db: LocalDb, email: string): Promise<{ userId: string; created: boolean }> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(raw`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing[0]) return { userId: existing[0].id, created: false };

  const [user] = await db
    .insert(users)
    .values({ displayName: email, email, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  return { userId: user.id, created: true };
}

/** Attaches a SIWE identity, unless this address is already on the account. */
async function ensureWalletIdentity(db: LocalDb, userId: string, address: string): Promise<boolean> {
  const addressLower = address.toLowerCase();
  const existing = await db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'siwe'), eq(authIdentities.providerSubject, addressLower)))
    .limit(1);

  if (existing[0]) {
    if (existing[0].userId !== userId) throw new Error(`${address} is already signed in as a different account.`);
    return false;
  }

  await db.insert(authIdentities).values({
    userId,
    provider: 'siwe',
    providerSubject: addressLower,
    lastLoginAt: new Date(),
    rawProfileJson: { addressLower, addressChecksum: address },
  });
  return true;
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The MEK to encrypt the seeded rows with.
 *
 * A second run must not mint a new profile: the rows already in the database
 * are sealed under the old one, and replacing it would leave them permanently
 * unreadable. The existing profile is enough to recover the key — MEK is
 * `PBKDF2(passphrase, salt) XOR serverShare`, and both halves of that are on
 * the row — so the passphrase is re-derived and checked instead.
 */
async function ensureEncryptionProfile(db: LocalDb, userId: string, passphrase: string): Promise<Uint8Array> {
  const [profile] = await db
    .select({
      serverShare: encryptionProfiles.serverShare,
      salt: encryptionProfiles.salt,
      kdf: encryptionProfiles.kdf,
      keyCheck: encryptionProfiles.keyCheck,
    })
    .from(encryptionProfiles)
    .where(eq(encryptionProfiles.userId, userId))
    .limit(1);

  if (!profile) return (await seedEncryptionProfileForUser(userId, passphrase)).mekBytes;

  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const deviceShare = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: fromBase64(profile.salt),
        iterations: profile.kdf.iterations ?? ENC_PBKDF2_ITERATIONS,
      },
      material,
      32 * 8,
    ),
  );

  const serverShare = fromBase64(profile.serverShare);
  const mekBytes = deviceShare.map((byte, i) => byte ^ serverShare[i]);

  // Prove the passphrase before encrypting anything under a key derived from it.
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);
  const verifyKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(HKDF_INFO_VERIFY_KEY) },
    mek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await subtle
    .decrypt(
      { name: 'AES-GCM', iv: fromBase64(profile.keyCheck.iv) },
      verifyKey,
      fromBase64(profile.keyCheck.ciphertext),
    )
    .then((buffer) => new TextDecoder().decode(buffer))
    .catch(() => null);

  if (plaintext !== KEY_CHECK_PLAINTEXT) {
    throw new Error(
      'This account already has an encryption profile and the given passphrase does not open it. ' +
        'Pass the original --passphrase, or start over with --wipe.',
    );
  }

  return mekBytes;
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/** Tags are unique per (user, name); re-running reuses the ones already there. */
async function ensureTags(db: LocalDb, userId: string, names: string[]): Promise<{ id: string }[]> {
  await db
    .insert(tagsTable)
    .values(names.map((name) => ({ userId, name, color: autoTagColor(name) })))
    .onConflictDoNothing();

  return db.select({ id: tagsTable.id }).from(tagsTable).where(eq(tagsTable.userId, userId));
}

type JoinTable = typeof noteTags | typeof secretNoteTags | typeof sealNoteTags;

/** Applies 0–3 tags per row and bumps `last_used_at`, as the app's setTags does. */
async function applyTags(
  db: LocalDb,
  join: JoinTable,
  rows: { _id: string }[],
  tagIds: { id: string }[],
  gib: Gibberish,
): Promise<void> {
  if (tagIds.length === 0) return;
  const used = new Set<string>();

  for (const row of rows) {
    const chosen = gib.sample(tagIds, gib.int(0, 3));
    if (chosen.length === 0) continue;
    await db
      .insert(join)
      .values(chosen.map((tag, sortOrder) => ({ noteId: row._id, tagId: tag.id, sortOrder })))
      .onConflictDoNothing();
    chosen.forEach((tag) => used.add(tag.id));
  }

  for (const tagId of used) {
    await db
      .update(tagsTable)
      .set({ lastUsedAt: gib.recentDate(30) })
      .where(eq(tagsTable.id, tagId));
  }
}

/** Shared metadata roll: color, pattern, pinned, archived, the odd expiry. */
function metadata(gib: Gibberish, withPattern: boolean) {
  return {
    color: gib.chance(0.75) ? gib.pick(NOTE_COLORS) : null,
    ...(withPattern ? { pattern: gib.chance(0.5) ? gib.pick(NOTE_PATTERNS) : null } : {}),
    pinned: gib.chance(0.2),
    archived: gib.chance(0.15),
    expiresAt: gib.chance(0.1) ? new Date(Date.now() + gib.int(1, 30) * 86_400_000) : null,
    burnAfterReading: gib.chance(0.08),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gib = new Gibberish(makeRng(options.seed));
  const { db, close } = openLocalDb();

  try {
    if (options.wipe) {
      const wiped = await wipeLocalDatabase(db);
      console.log(`Wiped ${wiped.length} tables.`);
    }

    const { userId, created } = await ensureUser(db, options.email);
    console.log(`${created ? 'Created' : 'Found'} user ${userId} (${options.email})`);

    if (options.wallet && (await ensureWalletIdentity(db, userId, options.wallet))) {
      console.log(`Linked wallet ${options.wallet}`);
    }

    const mekBytes = await ensureEncryptionProfile(db, userId, options.passphrase);
    const tagIds = await ensureTags(db, userId, TAG_NAMES);

    const { count } = options;

    const notes = await seedNotesForUser(
      userId,
      Array.from({ length: count }, () => ({
        title: gib.title(),
        content: gib.html(),
        ...metadata(gib, true),
        // A little history on some of them, so the version modal has something
        // to show. Ordered oldest-first: `seq`, not `createdAt`, is the key.
        versions: gib.chance(0.4)
          ? Array.from({ length: gib.int(1, 4) }, () => ({
              title: gib.title(),
              content: gib.html(),
              createdAt: gib.recentDate(60),
            }))
          : [],
        // One in ten lands in the trash rather than the grid.
        deletedAt: gib.chance(0.1) ? gib.recentDate(10) : null,
      })),
    );

    const secrets = await seedSecretsForUser(
      userId,
      mekBytes,
      Array.from({ length: count }, () => ({ title: gib.title(), content: gib.html(), ...metadata(gib, false) })),
    );

    const seals = await seedSealsForUser(
      userId,
      mekBytes,
      Array.from({ length: count }, () => ({ title: gib.title(), content: gib.html(), ...metadata(gib, false) })),
    );

    // Positions descend from the top of the list, so start above whatever a
    // previous run left behind instead of colliding with it.
    const [highest] = await db
      .select({ position: otpRecords.position })
      .from(otpRecords)
      .where(eq(otpRecords.userId, userId))
      .orderBy(desc(otpRecords.position))
      .limit(1);
    const base = (highest?.position ?? 0) + count * POSITION_STEP;

    const auths = await seedOtpRecordsForUser(
      userId,
      mekBytes,
      Array.from({ length: count }, (_, i) => ({
        issuer: OTP_ISSUERS[i % OTP_ISSUERS.length],
        account: options.email,
        position: base - i * POSITION_STEP,
        archived: gib.chance(0.1),
        color: gib.chance(0.6) ? gib.pick(NOTE_COLORS) : null,
        pattern: gib.chance(0.4) ? gib.pick(NOTE_PATTERNS) : null,
      })),
    );

    await applyTags(db, noteTags, notes, tagIds, gib);
    await applyTags(db, secretNoteTags, secrets, tagIds, gib);
    await applyTags(db, sealNoteTags, seals, tagIds, gib);

    console.log(
      `Seeded ${notes.length} notes, ${secrets.length} secrets, ${seals.length} seals, ${auths.length} authenticators ` +
        `and ${tagIds.length} tags (--seed ${options.seed}).`,
    );
    console.log(
      `Sign in as ${options.email} with an emailed code or with Google; unlock with "${options.passphrase}".`,
    );
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
