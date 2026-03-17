# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on port 5000
npm run build        # Production build
npm run lint         # ESLint + TypeScript type check (tsc --noEmit)
npm run format       # Prettier format
npm run test         # Run all Playwright E2E tests
npx playwright test tests/specs/notes.spec.ts  # Run a single test file
npx playwright test --ui  # Run tests with Playwright UI
```

Tests require a running dev server and MongoDB; the global setup (`tests/setup/globalSetup.ts`) starts both automatically (mongodb-memory-server + `npm run dev`).

## Architecture

### Three-Tier Note Security Model

Notes exist in three security tiers, each with its own MongoDB model, API route, and UI:

| Tier        | Route             | Model        | Encryption                                    |
| ----------- | ----------------- | ------------ | --------------------------------------------- |
| 1 – Notes   | `/api/notes/t1`   | `Note`       | None — plaintext, full-text searchable        |
| 2 – Secrets | `/api/secrets/t2` | `SecretNote` | AES-GCM, shared session key derived from MEK  |
| 3 – Seals   | `/api/seals/t3`   | `SealNote`   | AES-GCM, unique per-note key wrapped with MEK |

### Encryption Key Management

All crypto operations are in `src/lib/crypto.ts` using the Web Crypto API only.

The Master Encryption Key (MEK) is never stored:

- `deviceShare` = PBKDF2(passphrase, salt, 600k iterations) → stored in `sessionStorage`
- `serverShare` = random 32 bytes encrypted in MongoDB (`EncryptionProfile`)
- `MEK = deviceShare XOR serverShare` — reconstructed in memory on unlock

`src/contexts/EncryptionContext.tsx` manages MEK lifecycle across the app. Working keys for each tier are derived via HKDF with domain-specific `info` strings.

### Data Flow

- **API routes** (`src/app/api/`) handle HTTP and call controllers
- **Controllers** (`src/controllers/`) perform MongoDB operations via Mongoose
- **Hooks** (`src/hooks/`) wrap TanStack Query v5 — `useNotes`, `useSecrets`, `useSeals` for infinite queries; `useNoteMutations` etc. for mutations
- **Components** consume hooks and render UI; `TiptapEditor` handles rich text input

### State & Rendering

- TanStack Query v5 manages all server state with infinite scroll (30 first page, 10 subsequent)
- Notes content is stored as HTML (Tiptap output); `NoteCard` strips tags for plain-text preview
- `EncryptionContext` provides `mek`, `isUnlocked`, `unlock()`, `lock()`, `setupProfile()` app-wide

### Styling

- Tailwind CSS v4 (no `tailwind.config.ts` — configured inline in `src/styles/globals.css`)
- SCSS Modules for component-level styles (co-located `.module.scss` files)
- CSS variables for color tokens defined in `globals.css`
- shadcn/ui components in `src/components/ui/`

### Auth

SIWE (Sign-In with Ethereum) via NextAuth credentials provider in `src/config/auth.ts`. Sessions use JWT strategy (7-day max age). Wallet address is injected into the session token and available as `session.user.address`.

### Path Alias

`@/*` maps to `src/*`.
