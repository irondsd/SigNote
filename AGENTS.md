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
bun run db:check     # Preflight: resolve + connect + report schema/migration state
bun run db:check:prod
bun run db:push      # Sync schema straight into the LOCAL db (no migration file)
bun run db:generate  # Generate a migration from src/db/schema.ts into drizzle/
bun run db:migrate   # Apply pending migrations to the LOCAL db
bun run db:studio    # Drizzle Studio against the local db
bun run db:push:prod # …the same three against PRODUCTION (reads .env.prod)
bun run db:migrate:prod
bun run db:studio:prod
bun run email        # react-email preview app for the templates in email/
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

**The public schema is locked down (`drizzle/0001_lock_down_public_schema.sql`).** Supabase exposes `public` via PostgREST and grants `anon`/`authenticated` full CRUD on every table; the anon key is meant to be published in client code, so that was a full read/delete path around the app. This app never uses PostgREST, so the migration removes the surface rather than writing policies: RLS on with **no policies** (default-deny), the grants revoked, and `ALTER DEFAULT PRIVILEGES` fixed so the next created table isn't silently re-granted. The Supabase-specific statements are guarded on the roles existing, so it's a no-op locally.

`0002_harden_rls_auto_enable.sql` versions the `ensure_rls` event trigger, which enables RLS on any newly created `public` table so one can't ship without it. It was created by hand on production; defining it in a migration keeps every environment identical and pins its `search_path` (it is SECURITY DEFINER, owned by a BYPASSRLS role) while revoking EXECUTE from `PUBLIC`/`anon`/`authenticated`.

Two things not to do: never add `FORCE ROW LEVEL SECURITY` (the app connects as the table owner, which is exempt — forcing it would default-deny the application itself), and if you add a table, make sure RLS is enabled on it. The Supabase linter will flag it as an ERROR if you forget.

**Supabase connection strings.** The direct endpoint (`db.<ref>.supabase.co`) is IPv6-only without the IPv4 add-on and does not resolve on a typical machine — drizzle-kit reports this as a bare `exit 1`, so run `db:check:prod` first. Use pooler strings from Dashboard → Connect: **session mode** (`...pooler.supabase.com:5432`) for drizzle-kit, **transaction mode** (`:6543`) for the serverless runtime. Pooler usernames are `postgres.<project-ref>`, not `postgres`, so copy the whole string rather than swapping the host.

**Which database a command hits.** `.env.local` holds the local container URL and is what the app and every bare drizzle-kit command use. `.env.prod` (gitignored, not committed) holds only the production `DATABASE_URL` and is read solely by the `:prod` scripts via `DRIZZLE_ENV=.env.prod`. `drizzle.config.ts` loads the selected file with `override: true` — that matters, because Bun auto-loads `.env.local` and dotenv won't replace an existing variable, so without it `db:push:prod` would silently hit local. Every drizzle-kit run prints the host it resolved. Day to day: `db:push` locally while iterating, then `db:generate` once the shape settles, commit the SQL, and `db:migrate:prod` at release.

Conventions worth knowing:

- **Ids are `TEXT`, not `uuid`.** Live data holds two shapes: 24-char hex ids on older rows and UUIDv7 on everything newer. Both are permanent. An unknown id therefore can't raise a cast error — it just matches nothing, so a bad id 404s rather than 400s.
- **The API still exposes `_id`.** `src/db/tier.ts` maps Postgres `id` → `_id` on the way out so no client code had to change. A rename is a deliberate follow-up, not an accident.
- **`updatedAt` auto-bumps only on the auth tables** (`updatedAtAuto()` in the schema). On the note tiers it means "when the content was last saved", so a color/position/pin change must not touch it — it drives both the search sort and the "edited" label.
- **Nothing expires rows on its own.** Postgres has no TTL index, so `src/controllers/cleanup.ts` is the only thing that deletes expired/soft-deleted rows, driven by the hourly `/api/service/storage` cron. `cleanupOrphanedFiles` depends on it, since it detects an orphan by its parent note being physically gone.
- **Search is a weighted `tsvector`.** Generated `search_tsv` columns (title weight A, tier-1 content weight B) with GIN indexes, queried through `buildPrefixTsQuery` in `src/db/tier.ts`, which appends `:*` to every term so incremental typing still matches.

## Architecture

### Three-Tier Note Security Model

Notes exist in three security tiers, each with its own table, tRPC router, and UI:

| Tier        | tRPC router | Tables                                  | Encryption                                    |
| ----------- | ----------- | --------------------------------------- | --------------------------------------------- |
| 1 – Notes   | `notes`     | `notes` + `note_versions` + `note_tags` | None — plaintext, full-text searchable        |
| 2 – Secrets | `secrets`   | `secret_notes` + versions + tags        | AES-GCM, shared session key derived from MEK  |
| 3 – Seals   | `seals`     | `seal_notes` + versions + tags          | AES-GCM, unique per-note key wrapped with MEK |

The three tiers differ only in their content columns, so all shared behaviour — list/search/paginate, version recording with its compression window and `MAX_VERSIONS` cap, restore, tag replacement — lives once in `src/db/tier.ts` (`makeTierRepo`) and is wired per tier in `src/db/tiers.ts`. Version history is a child table ordered by a `seq` identity column (insertion order, **not** `createdAt` — a restore snapshot carries the displaced head's older save time, so sorting by timestamp breaks restore); tags are a join table with `sort_order`.

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

**The email address lives on `users`, not on an identity.** "One address = one
account" is a constraint _across_ providers, and `auth_identities` is keyed
`(provider, subject)` — it cannot express it. `users.email` carries a unique
index on `lower(email)`; `auth_identities.email` survives only as a record of
what a provider reported, verified or not, and must never be mailed.

One rule governs the column (`src/controllers/userEmail.ts`): **an address
attaches to a user only on proof of control.** A one-time code is proof by
definition; an OIDC provider is proof only when it asserts `email_verified:
true`. So an unverified Google sign-in creates an account with _no_ address
rather than claiming one — and because the claim re-runs on every sign-in, that
account picks the address up by itself once Google verifies it.

`users.email_owner_identity_id` records which identity proved it, and is what
makes the address read-only in the UI ("via Google"). Unlinking that identity
clears the owner but **keeps the address** — removing one sign-in method must
not silently remove a second. Ownership is stored rather than derived so a
provider flipping `email_verified` can't move an address or make it
un-removable behind the user's back.

### Signing in with an emailed code

`CredentialsProvider({ id: 'email-otp' })` in `src/config/auth.ts`. Two steps:
`emailAuth.requestCode` (public tRPC) issues one, then `signIn('email-otp')`
burns it. It creates the account if the address is new, so signing in and
signing up are the same call — which is also why there is no account
enumeration to defend against: the two cases are genuinely identical.

Codes live in `email_sign_in_codes` (`src/controllers/emailSignInCodes.ts`).
The code is **never stored** — the column holds an HMAC peppered with
`NEXTAUTH_SECRET`, six digits being a space a leaked table would give up
instantly. One live code per address, single-use, 10 minutes, five wrong
guesses and it dies. Rate limited per address and per IP; the per-IP cap is
overridable via `EMAIL_CODE_MAX_PER_IP` because the E2E suite drives every
account from loopback.

Every failure mode — wrong, expired, never issued — returns the same thing to
the caller on purpose. Which one it was is only useful to someone guessing.

Attaching an address to an account that already exists (`emailAuth.requestLinkCode`
/ `verifyLink`) runs the same two steps and then calls `claimEmailForUser` with
no owning identity, so a code-proved address stays detachable. Unlike sign-in it
_does_ refuse a taken address before sending anything: the caller is a known
user, so there is nothing to enumerate.

**Reading a code in tests.** With no `RESEND_API_KEY` the mailer prints each
message and, when `MAIL_CAPTURE_PATH` is set, appends it as one JSON line.
`globalSetup` points that at `.mail-capture.jsonl` and `tests/utils/emailInbox.ts`
reads codes back out — the only way to get one, since the server stores a hash
and runs in a process Playwright doesn't share. `tests/specs/email.spec.ts`
covers the flows end to end.

### Brand Assets

The logo is one shape, drawn on a 64px grid, used in two forms:

- `public/images/logo.svg` — the bare amber mark (`#DC7702` = `--primary`). `src/app/icon.svg` is a copy of it.
- `scripts/icons/signote-tile.svg` — the same mark knocked out of a full-bleed amber tile. Every raster web icon is rendered from it.

Never hand-edit the PNGs or `.ico`/`.icns`. Change the source SVG, then regenerate:

```bash
npm run icons:web    # favicon.ico, icon1.png, apple-icon.png, web-app-manifest-*.png
bun run --cwd desktop icon   # desktop/assets/icon.{png,icns,ico} from desktop/assets/icon.svg
```

### Email

Templates live in `email/` (outside `src/`, since the `react-email` preview
server renders them too) and reach `src/` through the `@email/*` alias.
`EmailLayout` is the shell all three share. `email/README.md` has the details.

```bash
bun run email        # react-email preview app on :3001
```

The send path is `src/lib/mailer.ts` (Resend transport) and
`src/lib/notificationEmails.tsx` (recipient + opt-out + render). **`RESEND_API_KEY`
is optional**: without it each message is summarised to the server console
instead of sent — the template's inputs (code, browser, os, when), never its
rendered body. Who sends what:

| Email        | Fired from                                                         | Opt-out              |
| ------------ | ------------------------------------------------------------------ | -------------------- |
| Welcome      | `config/auth.ts`, when a user row is created                       | none — one-time      |
| New sign-in  | `lib/routeAuth.ts` / `lib/desktopSession.ts`, on a new session row | "New sign-ins"       |
| Sign-in code | nothing yet — awaits the email sign-in flow                        | none — transactional |

The two courtesy emails go out through `after()` and swallow their errors; the
sign-in code throws, because its caller is a sign-in that has to know.

The mark the emails use, `public/images/email/signote-mark-52.png`, is rendered
from `public/images/logo.svg` by `npm run icons:web` — mail clients don't render SVG.

### Path Alias

`@/*` maps to `src/*`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
