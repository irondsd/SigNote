# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # Start dev server on port 5000
bun run build        # Production build
bun run lint         # ESLint + TypeScript type check (tsc --noEmit)
bun run format       # Prettier format
bun run test         # Run unit tests (Jest)
bun run test:e2e     # Run all Playwright E2E tests
bun install          # We use bun as package manager. Everything else is still npm
npx playwright test tests/specs/notes.spec.ts  # Run a single test file
npx playwright test --ui  # Run tests with Playwright UI
```

Unit tests use Jest + ts-jest. Test files are co-located at `src/**/__tests__/*.test.ts`. E2E tests require a running dev server and MongoDB; the global setup (`tests/setup/globalSetup.ts`) starts both automatically (mongodb-memory-server + `npm run dev`).

## Node / npm

`npm` is not on the default PATH (Node is managed via fnm). Always set up the environment before running npm commands:

```bash
eval "$(/opt/homebrew/bin/fnm env --shell zsh)" && npm run dev
```

## Architecture

### Three-Tier Note Security Model

Notes exist in three security tiers, each with its own MongoDB model, API route, and UI:

| Tier        | tRPC router | Model        | Encryption                                    |
| ----------- | ----------- | ------------ | --------------------------------------------- |
| 1 – Notes   | `notes`     | `Note`       | None — plaintext, full-text searchable        |
| 2 – Secrets | `secrets`   | `SecretNote` | AES-GCM, shared session key derived from MEK  |
| 3 – Seals   | `seals`     | `SealNote`   | AES-GCM, unique per-note key wrapped with MEK |

### Encryption Key Management

All crypto operations are in `src/lib/crypto.ts` using the Web Crypto API only.

The Master Encryption Key (MEK) is never stored:

- `deviceShare` = PBKDF2(passphrase, salt, 600k iterations) → stored in `sessionStorage`
- `serverShare` = random 32 bytes encrypted in MongoDB (`EncryptionProfile`)
- `MEK = deviceShare XOR serverShare` — reconstructed in memory on unlock

`src/contexts/EncryptionContext.tsx` manages MEK lifecycle across the app. Working keys for each tier are derived via HKDF with domain-specific `info` strings.

### Data Flow

The JSON API is **tRPC** (`@trpc/server` v11). Only auth (NextAuth/SIWE/OAuth redirects, nonce) and binary file up/download remain Next.js route handlers.

- **tRPC routers** (`src/server/routers/`) validate input with Zod and call controllers. `_app.ts` is the root router; `_commonTier.ts` holds the discrete note-tier procedures (`setColor`/`setTags`/`setMeta`/…) shared by notes/secrets/seals, `_versions.ts` the version sub-routers, `_meta.ts` the pure pin/expiry/burn mutex. Auth is enforced by `protectedProcedure` (`src/server/trpc.ts`), which reuses `authenticateRequest` from `lib/routeAuth.ts`. Fetch handler: `src/app/api/trpc/[trpc]/route.ts`.
- **Controllers** (`src/controllers/`) perform MongoDB operations via Mongoose (unchanged by the tRPC migration)
- **Client** uses two tRPC clients: `trpc` (`@trpc/react-query`, in `lib/trpc.ts`) for the `tags` hooks, and a vanilla `trpcClient` (`lib/trpcClient.ts`) used inside the note-tier/version/session/etc. hooks that keep the hand-tuned optimistic cache (`lib/queryCache.ts`, `hooks/internal/tierPagination.ts`). The polymorphic update is mapped to discrete procedures by `hooks/internal/tierClient.ts`. A shared `unauthorizedLink` (`lib/trpcLinks.ts`) does 401→sign-out.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
