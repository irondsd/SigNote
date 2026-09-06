import { getDocs } from '@/config/docs';
import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_REPOSITORY, SITE_SUMMARY } from '@/config/meta';

/**
 * `/llms.txt` — the llmstxt.org convention: one plain-text file an assistant can
 * read instead of crawling an app whose every interesting page is behind
 * sign-in. The document list is generated from `src/docs`, so it cannot drift.
 */

export const dynamic = 'force-static';

function body(origin: string) {
  const absolute = (route: string) => new URL(route, origin).toString();

  const docs = getDocs()
    .map((doc) => `- [${doc.title}](${absolute(doc.href)})${doc.description ? `: ${doc.description}` : ''}`)
    .join('\n');

  return `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_SUMMARY}

## The three tiers

Every note lives in exactly one tier, chosen per note. All three support rich
text, file attachments, tags, archiving, and version history.

- Notes — stored as plaintext, so they are fully searchable by title and body
  through a weighted Postgres full-text index. For everyday writing where
  convenience matters more than secrecy.
- Secrets — the body is encrypted in the browser with AES-GCM under one session
  key derived from the master key; titles stay plaintext so search and
  navigation still work. Unlocked once per session.
- Seals — the body is encrypted under a key unique to that note, wrapped with
  the master key. Seals are decrypted one at a time, on demand, and re-sealed
  after viewing. For the most sensitive material.

## How the encryption works

Encryption is unlocked with a passphrase that is never stored or transmitted.
The master encryption key (MEK) is split into two shares that are useless
apart: a device share derived from the passphrase with PBKDF2-SHA256 at 600,000
iterations, and a random server share held in the database. The MEK is their
XOR, exists only in memory as a non-extractable Web Crypto key, and is
reconstructed on unlock. A database breach yields ciphertext and one half of a
key; the passphrase is the other half and is not there to steal.

The consequence is deliberate: because the server cannot decrypt anything, it
cannot reset a lost passphrase either. There is no recovery path and no
backdoor.

## Signing in

There is no password. An account can be reached through any of several methods,
and several can be linked to one account:

- A one-time code sent to an email address — signing in and signing up are the
  same call.
- Google, through OAuth. An address is attached to the account only when Google
  asserts it is verified.
- Sign-In with Ethereum (SIWE) — a domain-bound message signed by a wallet. No
  email address is involved, so an account created this way is anonymous.
- Passkeys are planned.

Whichever method is used, it governs access to the account only. The passphrase
that unlocks Secrets and Seals is independent of it.

## What the app is not

- Not a blockchain application. Nothing is written on-chain and no token,
  payment, or transaction is involved; a wallet is only used as a way to prove
  identity without an email address.
- Not a plaintext cloud notebook. Tier 2 and tier 3 bodies are ciphertext to the
  server, and it is the browser that holds the keys.
- Not recoverable. A forgotten passphrase means the encrypted notes are gone.

## Documentation

${docs}

## Optional

- [Source code](${SITE_REPOSITORY}): the app is open source — a Next.js, Postgres/Drizzle and tRPC codebase, self-hostable.
- [Sitemap](${absolute('/sitemap.xml')}): every publicly crawlable URL. Everything not listed there is behind sign-in and renders nothing to a crawler.
`;
}

export function GET() {
  return new Response(body(getSiteUrl().origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
