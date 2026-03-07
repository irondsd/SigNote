# SigNote

SigNote is a wallet-native notes app with three security tiers.

It uses **Sign-In with Ethereum (SIWE)** for authentication and wallet signatures to derive encryption keys for higher-security notes. The goal is simple: keep note ownership tied to an Ethereum address while letting users choose the right privacy level for each note.

## Core idea

SigNote organizes notes into three tiers:

### Tier 1 — Notes

- Stored in MongoDB as plain text.
- Searchable by **title and content**.
- Best for everyday notes where convenience matters more than encryption.

### Tier 2 — Secrets

- `title` remains unencrypted.
- `content` is encrypted on the client.
- Search works by **title only**.
- Encryption uses a single symmetric key derived from the user signing a predictable wallet message.
- That derived key is kept **in memory for the active session**.

### Tier 3 — Seals

- `title` remains unencrypted.
- `content` is encrypted on the client.
- Search works by **title only**.
- Each note gets its own symmetric key.
- The key is derived from a wallet signature over a message that includes the `noteId`, so encryption is **per note**, not per session.

For both Tier 2 and Tier 3, the database stores **encrypted note data only**, and encryption/decryption happen **client-side**.

## Current repo status

This repository already includes:

- SIWE-based authentication
- Wallet connection with RainbowKit + Wagmi
- Tier 1 note CRUD
- Tier 1 search by title and content
- Archive flow for Tier 1 notes
- Next.js App Router UI with shadcn/ui-based components

Tier 2 (**Secrets**) and Tier 3 (**Seals**) represent the intended security model of the app and are currently being built out in the product.

## Stack

- **Next.js** (App Router)
- **React**
- **NextAuth** with SIWE credentials flow
- **MongoDB** with Mongoose
- **Vercel-style serverless route handlers**
- **Wagmi** + **RainbowKit** for wallet connection
- **shadcn/ui** components
- **Tiptap** editor
- **Sass modules** for styling

## How authentication works

SigNote authenticates users with SIWE:

1. The client requests a nonce.
2. The user signs a SIWE message with their wallet.
3. The signature is verified server-side.
4. A session is issued and tied to the wallet address.

Because SIWE validates the domain and origin, `NEXTAUTH_URL` must exactly match the URL you use in the browser during local development and deployment.

## Search model

- **Tier 1:** searchable by title and content.
- **Tier 2:** searchable by title only.
- **Tier 3:** searchable by title only.

This is intentional: titles stay visible for indexing and navigation, while higher-tier note bodies stay encrypted.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your local environment file

Copy `.env.local.example` to `.env.local` and fill in the values.

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

#### Variable reference

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: WalletConnect project ID used by RainbowKit/Wagmi.
- `NEXT_PUBLIC_RPC_URL`: Ethereum RPC endpoint used by the app.
- `MONGODB_URI`: MongoDB connection string.
- `MONGODB_DB`: database name.
- `NEXTAUTH_URL`: exact public app origin used for SIWE verification.
- `NEXTAUTH_SECRET`: secret used by NextAuth to sign sessions.

> Note: the local dev script runs on port `5000`, so `NEXTAUTH_URL` should usually be `http://localhost:5000` unless you intentionally change the port.

### 4. Run the app

```bash
npm run dev
```

Then open [http://localhost:5000](http://localhost:5000).

## Project structure

- `src/app` — App Router pages and API route handlers
- `src/components` — UI and feature components
- `src/config` — auth, wallet, and server configuration
- `src/controllers` — MongoDB-facing application logic
- `src/models` — Mongoose models
- `src/hooks` — client data and mutation hooks
- `src/providers` — app-wide React providers

## Security notes

- Wallet authentication is handled with SIWE.
- Tier 1 notes are intentionally not encrypted.
- Tier 2 and Tier 3 are designed so encrypted note bodies are never decrypted on the server.
- Higher-tier search is title-only because titles stay unencrypted.
- Session-scoped key material should remain in memory only.

As with any cryptography-heavy app, treat this project as evolving software and review the implementation carefully before using it for sensitive real-world data.

## Open source

SigNote is being opened up as a reference project for wallet-based auth, note security tiers, and client-side encryption workflows in a modern Next.js app.

Issues, ideas, and contributions are welcome.
