# SigNote

SigNote is a wallet-native notes app with three security tiers.

It uses **Sign-In with Ethereum (SIWE)** for authentication and a passphrase-based encryption system for higher-security notes. The goal is simple: keep note ownership tied to an Ethereum address while letting users choose the right privacy level for each note.

## Core idea

SigNote organizes notes into three tiers:

### Tier 1 — Notes

- Stored as plain text in MongoDB.
- Searchable by **title and content**.
- Best for everyday notes where convenience matters more than encryption.

### Tier 2 — Secrets

- `title` remains unencrypted for search and navigation.
- `body` is encrypted client-side before leaving the browser.
- All bodies share a single session key derived from the master encryption key (MEK).
- After passphrase unlock, all bodies decrypt in the background for the session.
- Locking clears all key material from memory and session storage.
- Searchable by **title only**.

### Tier 3 — Seals

- `title` remains unencrypted.
- `body` is encrypted with a **unique per-note key** (NEK).
- Bodies are never decrypted in bulk — each seal decrypts individually on demand inside its modal.
- After viewing, the user can re-encrypt the note and the decrypted content is discarded.
- Searchable by **title only**.

For both Tier 2 and Tier 3, the server stores **ciphertext only**, and all encryption and decryption happens **client-side using the Web Crypto API**. The server never sees plaintext note bodies or any key material capable of decrypting them.

---

## Encryption model

### Passphrase and key derivation

Encryption is unlocked with a user-chosen passphrase. The passphrase itself is never stored. Instead, during setup:

1. A random 32-byte `salt` is generated client-side.
2. The passphrase is run through **PBKDF2** (SHA-256, 600,000 iterations) to produce a 32-byte `deviceShare`.
3. A random 32-byte `serverShare` is generated client-side and stored encrypted in MongoDB (associated with the wallet address).
4. The **Master Encryption Key (MEK)** is `deviceShare XOR serverShare`. The MEK is never stored anywhere.

After setup, `deviceShare` is kept in `sessionStorage` for the duration of the browser session. This means the MEK can be reconstructed silently on page reload without re-prompting for a passphrase — and is automatically discarded when the tab closes.

To unlock from a new tab or after `sessionStorage` is cleared, the user re-enters the passphrase. This re-derives `deviceShare` from the stored `salt`, fetches `serverShare` from the server, and reconstructs the MEK.

### Two-share key architecture

The MEK is split into two shares specifically to limit what either side alone can compromise:

- **Server compromise**: An attacker who steals the database gets `serverShare` but not `deviceShare` (which is derived from the passphrase and never stored server-side). Without the passphrase, they cannot reconstruct the MEK.
- **Client compromise**: An attacker who reads `sessionStorage` gets `deviceShare` but not `serverShare`. Without the server, they cannot reconstruct the MEK. (Once `sessionStorage` is cleared — on tab close or explicit lock — there is nothing to steal.)

The MEK itself only ever exists in memory, as a non-extractable `CryptoKey` object, for the duration of an unlocked session.

### Passphrase verification

A `keyCheck` payload is stored with the encryption profile. It is an AES-GCM ciphertext of a known constant, encrypted with a key derived from the MEK using HKDF. On unlock, the app attempts to decrypt `keyCheck` — success means the passphrase was correct, failure means it was wrong. No oracle is needed on the server.

### Key hierarchy (HKDF)

Once the MEK is in memory it is imported as an HKDF base key (non-extractable). All working keys are derived from it using HKDF (SHA-256) with distinct `info` strings to ensure domain separation:

| Derived key       | HKDF info string                | Used for                                     |
| ----------------- | ------------------------------- | -------------------------------------------- |
| `secretBodyKey`   | `signote-v1/secret-body`        | Encrypting and decrypting all Secrets bodies |
| `verifyKey`       | `signote-v1/verify`             | Encrypting the `keyCheck` payload            |
| `sealWrapKey(id)` | `signote-v1/seal-wrap/<noteId>` | Wrapping the per-note NEK for each Seal      |

Because the `sealWrapKey` derivation includes the note ID in the info string, each note gets a unique wrapping key even though they share the same MEK.

### Secrets encryption

Each Secret body is encrypted with AES-GCM 256-bit using `secretBodyKey`. A fresh random 12-byte IV is generated per encryption operation. The ciphertext and IV are stored together in MongoDB.

### Seals encryption — per-note keys

Each Seal uses a unique 32-byte Note Encryption Key (NEK):

1. A random NEK is generated and used to encrypt the note body with AES-GCM 256-bit. The note ID is used as Additional Authenticated Data (AAD) on both operations.
2. The NEK is then wrapped (encrypted) with `sealWrapKey(noteId)` — also AES-GCM, also with the note ID as AAD.
3. The encrypted body and the wrapped NEK are both stored in MongoDB.

To decrypt, the process is reversed: derive the seal wrapping key → unwrap the NEK → decrypt the body. If the note ID does not match the AAD used during encryption, decryption fails.

This design means that if a single seal's NEK were somehow recovered, it compromises only that note, not all Seals.

### Cryptographic primitives

All cryptography uses the browser's built-in **Web Crypto API** (no third-party crypto libraries):

- **PBKDF2** — passphrase-to-key derivation
- **HKDF** — working key derivation from MEK
- **AES-GCM 256-bit** — authenticated encryption for all ciphertexts
- **XOR** — combining two 32-byte shares into the MEK

Keys are created as non-extractable `CryptoKey` objects where possible, preventing JavaScript from reading the raw key bytes.

---

## Authentication

SigNote authenticates users with SIWE:

1. The client requests a nonce.
2. The user signs a SIWE message with their wallet.
3. The signature is verified server-side.
4. A session is issued and tied to the wallet address.

Because SIWE validates the domain and origin, `NEXTAUTH_URL` must exactly match the URL you use in the browser during local development and deployment.

---

## Search model

| Tier    | Searchable fields |
| ------- | ----------------- |
| Notes   | Title + content   |
| Secrets | Title only        |
| Seals   | Title only        |

Titles are intentionally left unencrypted to enable full-text indexing while keeping bodies private.

---

## Stack

- **Next.js** (App Router)
- **React 19**
- **NextAuth** with SIWE credentials flow
- **MongoDB** with Mongoose
- **Web Crypto API** for all client-side encryption
- **Wagmi** + **RainbowKit** for wallet connection
- **TanStack Query v5** for server state
- **shadcn/ui** components
- **Tiptap** rich text editor
- **dnd-kit** for drag-and-drop reordering
- **Sass modules** for styling

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your local environment file

```bash
cp .env.local.example .env.local
```

### 3. Configure environment variables

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=""
NEXT_PUBLIC_RPC_URL=""
MONGODB_URI="mongodb+srv://<username>:<password>@<cluster-url>/"
MONGODB_DB="signote"
NEXTAUTH_URL="http://localhost:5000"
NEXTAUTH_SECRET="replace-with-a-long-random-secret"
```

| Variable                               | Description                                        |
| -------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID used by RainbowKit/Wagmi  |
| `NEXT_PUBLIC_RPC_URL`                  | Ethereum RPC endpoint used by the app              |
| `MONGODB_URI`                          | MongoDB connection string                          |
| `MONGODB_DB`                           | Database name                                      |
| `NEXTAUTH_URL`                         | Exact public app origin used for SIWE verification |
| `NEXTAUTH_SECRET`                      | Secret used by NextAuth to sign sessions           |

> The local dev script runs on port `5000`, so `NEXTAUTH_URL` should be `http://localhost:5000` unless you change the port.

### 4. Run the app

```bash
npm run dev
```

Then open [http://localhost:5000](http://localhost:5000).

---

## Project structure

```
src/
├── app/                  # App Router pages and API route handlers
│   ├── api/
│   │   ├── encryption/   # Profile and key material endpoints
│   │   ├── notes/        # Tier 1 CRUD
│   │   ├── secrets/      # Tier 2 CRUD
│   │   └── seals/        # Tier 3 CRUD
│   ├── secrets/          # Tier 2 pages
│   └── seals/            # Tier 3 pages
├── components/           # UI and feature components
├── config/               # Auth, wallet, and server configuration
├── contexts/             # EncryptionContext — MEK lifecycle management
├── controllers/          # MongoDB-facing application logic
├── hooks/                # Client data and mutation hooks
├── lib/
│   └── crypto.ts         # All client-side cryptographic operations
├── models/               # Mongoose models
└── providers/            # App-wide React providers
```

---

## Security notes

- Wallet authentication is handled with SIWE; no passwords are involved in authentication.
- The MEK never leaves the browser and is never sent to the server in any form.
- The `serverShare` stored in MongoDB is useless without the user's passphrase.
- `sessionStorage` (which holds `deviceShare`) is tab-scoped and cleared automatically when the tab closes.
- Explicit lock clears both the in-memory MEK and the `sessionStorage` entry immediately.
- Sign-out clears the MEK and device share as soon as the session becomes unauthenticated.
- Tier 1 notes are intentionally not encrypted — they are meant for convenience, not privacy.
- Titles across all tiers are stored unencrypted to support search and navigation.

As with any cryptography-heavy app, treat this as evolving software and review the implementation carefully before using it for sensitive real-world data.

---

## Open source

SigNote is being opened up as a reference project for wallet-based auth, note security tiers, and client-side encryption workflows in a modern Next.js app.

Issues, ideas, and contributions are welcome.
