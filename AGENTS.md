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
bun run db:up        # Start local Postgres (dev on :5434, disposable test DB on :5435)
bun run db:generate  # Generate a migration from src/db/schema.ts into drizzle/
bun run db:migrate   # Apply pending migrations to $DATABASE_URL
bun run db:studio    # Drizzle Studio
npx playwright test tests/specs/notes.spec.ts  # Run a single test file
npx playwright test --ui  # Run tests with Playwright UI
```

Unit tests use Jest + ts-jest. Test files are co-located at `src/**/__tests__/*.test.ts`. DB-backed unit tests run against an in-process **PGlite** instance (`src/test/db.ts`) with the real Drizzle migrations applied — this is why the `test` script sets `NODE_OPTIONS=--experimental-vm-modules` (PGlite loads its wasm through a dynamic import).

E2E tests need a running dev server and a real Postgres; the global setup (`tests/setup/globalSetup.ts`) brings up the `db-test` compose service, migrates it, truncates it, and spawns `npm run dev:test`. It reads **`TEST_DATABASE_URL`**, never `DATABASE_URL`, and refuses to run against anything that isn't a local database whose name ends in `_test` — the suite truncates every table.

## Node / npm

`npm` is not on the default PATH (Node is managed via fnm). Always set up the environment before running npm commands:

```bash
eval "$(/opt/homebrew/bin/fnm env --shell zsh)" && npm run dev
```

## Database

Postgres (Supabase in production) via **Drizzle ORM**, using the `postgres` (postgres.js) driver.

- Schema: `src/db/schema.ts` — the single source of truth. Change it, then `bun run db:generate` and commit the SQL in `drizzle/`. Never hand-write a migration.
- Connection: `src/db/client.ts` — one lazily-created pool, cached on `globalThis` so hot reload doesn't leak pools. Migrations are **not** applied on boot; run `db:migrate` deliberately.
- Local dev: `docker-compose.yml` (`bun run db:up`) — `signote` on :5434 for dev, `signote_test` on :5435 (tmpfs) for E2E.

Conventions worth knowing:

- **Ids are `TEXT`, not `uuid`.** Rows migrated from MongoDB keep their ObjectId hex strings verbatim (so client caches and JWT `sid` claims survived the cutover); new rows get UUIDv7. An unknown id therefore can't raise a cast error — it just matches nothing, so a bad id 404s rather than 400s.
- **The API still exposes `_id`.** `src/db/tier.ts` maps Postgres `id` → `_id` on the way out so no client code had to change. A rename is a deliberate follow-up, not an accident.
- **`updatedAt` auto-bumps only on the auth tables** (`updatedAtAuto()` in the schema), mirroring which Mongo collections had `timestamps: true`. On the note tiers it means "when the content was last saved", so a color/position/pin change must not touch it — it drives both the search sort and the "edited" label.
- **Mongo TTL indexes have no Postgres equivalent.** `src/controllers/cleanup.ts` replaces them and runs from the hourly `/api/service/storage` cron; `cleanupOrphanedFiles` depends on it, since it detects an orphan by its parent note being physically gone.
- **Search is a weighted `tsvector`.** Generated `search_tsv` columns (title weight A, tier-1 content weight B) with GIN indexes, queried through `buildPrefixTsQuery` in `src/db/tier.ts`, which appends `:*` to every term so incremental typing still matches.

## Architecture

### Three-Tier Note Security Model

Notes exist in three security tiers, each with its own table, tRPC router, and UI:

| Tier        | tRPC router | Tables                                  | Encryption                                    |
| ----------- | ----------- | --------------------------------------- | --------------------------------------------- |
| 1 – Notes   | `notes`     | `notes` + `note_versions` + `note_tags` | None — plaintext, full-text searchable        |
| 2 – Secrets | `secrets`   | `secret_notes` + versions + tags        | AES-GCM, shared session key derived from MEK  |
| 3 – Seals   | `seals`     | `seal_notes` + versions + tags          | AES-GCM, unique per-note key wrapped with MEK |

The three tiers differ only in their content columns, so all shared behaviour — list/search/paginate, version recording with its compression window and `MAX_VERSIONS` cap, restore, tag replacement — lives once in `src/db/tier.ts` (`makeTierRepo`) and is wired per tier in `src/db/tiers.ts`. Mongo's embedded `versions` array became a child table ordered by a `seq` identity column (insertion order, **not** `createdAt` — a restore snapshot carries the displaced head's older save time), and its ordered `tags` id array became a join table with `sort_order`.

### Encryption Key Management

All crypto operations are in `src/lib/crypto.ts` using the Web Crypto API only.

The Master Encryption Key (MEK) is never stored:

- `deviceShare` = PBKDF2(passphrase, salt, 600k iterations) → stored in `sessionStorage`
- `serverShare` = random 32 bytes stored in Postgres (`encryption_profiles`)
- `MEK = deviceShare XOR serverShare` — reconstructed in memory on unlock

`src/contexts/EncryptionContext.tsx` manages MEK lifecycle across the app. Working keys for each tier are derived via HKDF with domain-specific `info` strings.

### Data Flow

The JSON API is **tRPC** (`@trpc/server` v11). Only auth (NextAuth/SIWE/OAuth redirects, nonce) and binary file up/download remain Next.js route handlers.

- **tRPC routers** (`src/server/routers/`) validate input with Zod and call controllers. `_app.ts` is the root router; `_commonTier.ts` holds the discrete note-tier procedures (`setColor`/`setTags`/`setMeta`/…) shared by notes/secrets/seals, `_versions.ts` the version sub-routers, `_meta.ts` the pure pin/expiry/burn mutex. Auth is enforced by `protectedProcedure` (`src/server/trpc.ts`), which reuses `authenticateRequest` from `lib/routeAuth.ts`. Fetch handler: `src/app/api/trpc/[trpc]/route.ts`.
- **Controllers** (`src/controllers/`) are thin wrappers over the Drizzle layer in `src/db/`; the three note tiers delegate to `makeTierRepo`
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

### Brand Assets

The logo is one shape, drawn on a 64px grid, used in two forms:

- `public/images/logo.svg` — the bare amber mark (`#DC7702` = `--primary`). `src/app/icon.svg` is a copy of it.
- `scripts/icons/signote-tile.svg` — the same mark knocked out of a full-bleed amber tile. Every raster web icon is rendered from it.

Never hand-edit the PNGs or `.ico`/`.icns`. Change the source SVG, then regenerate:

```bash
npm run icons:web    # favicon.ico, icon1.png, apple-icon.png, web-app-manifest-*.png
bun run --cwd desktop icon   # desktop/assets/icon.{png,icns,ico} from desktop/assets/icon.svg
```

### Path Alias

`@/*` maps to `src/*`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
