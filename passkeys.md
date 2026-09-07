# Passkeys

Sign in and sign up with a WebAuthn passkey, alongside Google, email code and
Ethereum wallet. Passkeys are a sign-in method only; they do not touch the
vault. Unlocking the vault with a passkey (Touch ID) is a future phase — see
the end of this file.

## Decisions

- **Own table, not `auth_identities`.** A user has many passkeys (laptop,
  phone, YubiKey), each with its own public key, counter and nickname, and
  removal is per credential rather than per provider. `auth_identities` is
  unique on `(provider, subject)` and models one account per provider — the
  wrong shape. `passkey_credentials` is a sibling table; `'passkey'` joins the
  `AuthProvider` union only where a session or JWT needs to say how it was
  minted.
- **Passkeys count as a sign-in method.** Every "keep at least one way in"
  guard — `unlinkIdentity`, `detachEmail`, and passkey removal itself — counts
  identities + passkeys + (email ? 1 : 0) through one shared helper.
- **Sign-up with a passkey is allowed.** A passkey-only account is the
  wallet-only shape that already exists: no address, no recovery beyond the
  credential, no sign-in alerts to send. The profile nudges to add an email.
- **Discoverable credentials.** `residentKey: 'required'`, `userHandle` = user
  id. "Sign in with a passkey" asks for nothing first.
- **Profile UI.** No separate card. The Sign-in Methods list gets a *Passkeys*
  row where the subject column shows the count ("2 passkeys") and the button
  is **Set up** (none) or **Manage** (some), linking to `/passkeys`.
- **`/passkeys` page** lists, adds, renames and removes credentials.
- **Desktop app is out of scope for in-app passkey ceremonies.** The desktop
  handoff (`/api/desktop-auth/authorize`) is Google-only by design and stays
  so. The Electron client shows the Passkeys row and can *remove* passkeys
  (plain mutation) but the Add button is disabled with a hint to use a
  browser. Whether Electron 44 can drive a platform authenticator is untested;
  not worth finding out this round.
- **No attestation.** `attestationType: 'none'`; `aaguid` is stored for a
  future "Which authenticator" label but never verified.

## Phase 1 — build

### Dependencies

`@simplewebauthn/server` and `@simplewebauthn/browser` (same major). No
hand-rolled CBOR/COSE.

### Config

- RP ID and expected origin derive from `NEXTAUTH_URL` (`localhost` in dev and
  E2E, the production host in prod). `PASSKEY_RP_ID` may override for
  subdomain setups; not needed today.
- RP name: `SigNote`.
- Ceremony policy: `userVerification: 'preferred'`, `residentKey: 'required'`,
  `authenticatorAttachment` unset (platform and roaming both allowed).

### Schema (`src/db/schema.ts` → `bun run db:generate`)

`passkey_credentials`

| column           | type                          | notes                                              |
| ---------------- | ----------------------------- | -------------------------------------------------- |
| id               | text pk                       | uuidv7                                             |
| user_id          | text, indexed                 |                                                    |
| credential_id    | text, unique                  | base64url                                          |
| public_key       | text                          | base64url COSE key, as SimpleWebAuthn returns it    |
| counter          | bigint                        | last seen signCount                                |
| transports       | jsonb `string[]`              | hint for `allowCredentials`, may be empty          |
| aaguid           | text                          |                                                    |
| device_type      | text                          | `singleDevice` \| `multiDevice`                    |
| backed_up        | boolean                       | synced passkey vs device-bound                     |
| nickname         | text                          | user-facing label                                  |
| last_used_at     | timestamptz null              |                                                    |
| created_at / updated_at (auto) |               | `updatedAtAuto()` like the other auth tables       |

`passkey_challenges` — the ceremony nonce. `auth_nonces` is too thin (no kind,
no user binding); this mirrors `email_sign_in_codes` and
`desktop_auth_attempts` instead.

| column       | type             | notes                                                        |
| ------------ | ---------------- | ------------------------------------------------------------ |
| challenge    | text pk          | base64url, 32 random bytes                                   |
| kind         | text             | `register` \| `authenticate`                                 |
| user_id      | text null        | registration: the account the credential must attach to. For sign-up it is a *provisional* id minted with the challenge; the user row is only created once the registration verifies. |
| ip           | text             | rate limit key                                               |
| expires_at   | timestamptz      | 5 minutes                                                    |
| used_at      | timestamptz null | single-use, consumed atomically like `consumeNonceRecord`    |
| created_at   |                  |                                                              |

RLS: the `ensure_rls` event trigger enables it on creation; confirm in the
generated SQL. No FKs, matching the rest of the schema.

### Server

`src/lib/passkeys.ts` — RP config resolution and thin wrappers around
`generateRegistrationOptions` / `verifyRegistrationResponse` /
`generateAuthenticationOptions` / `verifyAuthenticationResponse`.

`src/controllers/passkeyChallenges.ts` — `createChallenge`, `consumeChallenge`
(atomic update-where-unused-and-unexpired), `checkChallengeRateLimit(ip)`
(same window/limit shape as `nonces.ts`).

`src/controllers/passkeys.ts` — `listPasskeys(userId)`, `countPasskeys(userId)`,
`insertPasskey(...)`, `findPasskeyByCredentialId`, `recordPasskeyUse(id,
counter)`, `renamePasskey`, `deletePasskey` (throws `LastIdentityError`).

`src/controllers/identities.ts` — extract `countSignInMethods(userId)` and use
it in `unlinkIdentity`; `detachEmail` in `userEmail.ts` uses it too. Today the
two guards count differently (`<= 1 && !email` vs `identities === 0`); one
helper, one rule. `linkIdentity`'s merge transaction also moves the secondary
user's passkeys to the primary — otherwise deleting the secondary user row
orphans them.

`src/controllers/erase.ts` — `eraseAccount` deletes `passkey_credentials`.
`src/controllers/cleanup.ts` — sweep expired `passkey_challenges`.

**tRPC router `passkeys`** (`src/server/routers/passkeys.ts`, wired in `_app.ts`):

| procedure           | access    | does                                                                    |
| ------------------- | --------- | ----------------------------------------------------------------------- |
| `signInOptions`     | public    | `authenticate` challenge, empty `allowCredentials`. Reveals nothing.   |
| `signUpOptions`     | public    | `register` challenge with a provisional user id; rate limited per IP. |
| `registrationOptions` | protected | `register` challenge for `ctx.userId`, `excludeCredentials` = existing |
| `finishRegistration` | protected | verify, insert credential. Input: registration response + nickname.  |
| `list`, `rename`, `remove` | protected | `remove` maps `LastIdentityError` → `BAD_REQUEST LAST_IDENTITY`, like `identities.unlink` |

**NextAuth** — a third `CredentialsProvider({ id: 'passkey' })` in
`src/config/auth.ts` with credentials `{ assertion?, registration?, nickname?, client }`
(JSON strings, since NextAuth credentials are flat strings):

- `assertion` → consume the `authenticate` challenge, look up by credential id,
  verify, `recordPasskeyUse`, return the user. Any failure returns `null`,
  same as email-otp: which failure it was is only useful to a guesser.
- `registration` → consume the `register` challenge (must be `user_id` =
  provisional, i.e. a sign-up challenge), verify, create user + credential in
  one transaction (display name convention as `upsertEmailUser`), return the
  user. `created` → `sendWelcomeEmail` is a no-op without an address, wired
  anyway like SIWE.

The jwt callback maps `account.provider === 'passkey'` → `token.provider =
'passkey'`. `resolveSignInClient` learns the provider (always `web` this round).

**Type fan-out for the new provider value:** `AuthProvider` in `schema.ts`,
`JWT.provider` in `src/types/next-auth.d.ts`, the narrowing at
`src/lib/routeAuth.ts:54`, `Identity['provider']` stays as is (passkeys are not
identities).

### Client

`src/hooks/usePasskeys.ts` — `usePasskeys()` (list), `useAddPasskey()`
(`registrationOptions` → `startRegistration` → `finishRegistration`),
`useRenamePasskey()`, `useRemovePasskey()`. Query key `['passkeys', userId]`;
removal also invalidates `identities` / `email-method` since it can flip the
"last method" state elsewhere.

`src/lib/passkeyClient.ts` — `signInWithPasskey(client)`:
`signInOptions` → `startAuthentication` → `signIn('passkey', { assertion })`;
`signUpWithPasskey(client)` likewise with `signUpOptions` / `startRegistration`.
`browserSupportsWebAuthn()` gates every entry point; an unsupported browser
simply doesn't render the button.

**Sign-in modal** (`src/components/SignInModal/SignInModal.tsx`): a "Sign in
with a passkey" button (`data-testid="passkey-sign-in-btn"`) next to Google,
and a "Create a passkey instead" secondary action for new accounts
(`data-testid="passkey-sign-up-btn"`). Hidden on desktop. Conditional UI
(`autocomplete="username webauthn"` on the email input +
`startAuthentication({ useBrowserAutofill: true })`) is a nice-to-have; add it
if it drops in cleanly, otherwise leave for later.

**Sign-in Methods** (`WebSignInMethods.tsx`, `DesktopSignInMethods.tsx`): a
Passkeys row, `data-testid="identity-passkey"`, icon `Fingerprint` (lucide),
subject "1 passkey" / "3 passkeys", button **Set up** / **Manage** → `/passkeys`
(`data-testid="manage-passkeys-btn"`). `isOnlyOne` in both components includes
the passkey count.

**`/passkeys` page** (`src/app/(main)/passkeys/page.tsx`, modelled on
`/sessions`): auth-gated, one card per credential — nickname (inline rename),
created, last used, "Synced" badge when `backedUp`, Remove with an
`AlertDialog` confirm. Remove is disabled with the usual tooltip when it is
the last sign-in method. "Add passkey" runs the ceremony and inserts with a
default nickname (`Passkey` / `Synced passkey`), rename afterwards. Empty
state explains what a passkey is in two lines. On desktop the Add button is
disabled with "Add passkeys from a browser".

**Elsewhere:** `SessionCard` icon/label for `'passkey'`; `Identity` union
untouched; PostHog `sign_in_completed` / `sign_in_failed` with
`method: 'passkey'`; profile page keeps its layout (the row lives inside Sign-in
Methods). Check `(docs)` for a sign-in methods page and add a line.

### Out of Phase 1

- Desktop in-app ceremonies (see Decisions).
- PRF / vault unlock.
- Attestation verification, authenticator allow-lists, AAGUID → product name
  lookup.
- Conditional UI if it doesn't fit cleanly.

## Phase 2 — tests

### Unit (Jest + PGlite, `src/**/__tests__`)

- `controllers/__tests__/passkeys.test.ts` — insert/list/rename/delete; counter
  and `lastUsedAt` update; delete throws `LastIdentityError` when it is the
  last method and succeeds when an identity or email remains.
- `controllers/__tests__/passkeyChallenges.test.ts` — single use, expiry,
  kind/user binding, per-IP rate limit.
- `controllers/__tests__/identities.test.ts` (extend) — `countSignInMethods`
  across the three sources; `unlinkIdentity` allowed when only a passkey
  remains; merge moves passkeys.
- `controllers/__tests__/userEmail.test.ts` (extend) — `detachEmail` allowed
  when a passkey remains.
- `lib/__tests__/passkeys.test.ts` — RP ID / origin from `NEXTAUTH_URL`.
- Ceremony verification itself is not unit-tested with synthetic
  authenticators; the E2E suite covers it with a real (virtual) one.

### E2E (Playwright, Chromium)

`tests/utils/virtualAuthenticator.ts` — CDP `WebAuthn.enable` +
`addVirtualAuthenticator({ protocol: 'ctap2', transport: 'internal',
hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
automaticPresenceSimulation: true })`. One per test; removed in teardown.
RP ID is `localhost`, so no config change to the test server.

`tests/specs/passkeys.spec.ts`:

1. Sign up with a passkey → signed in, Sign-in Methods shows "1 passkey" and
   **Manage**, no email row value.
2. Sign out, sign in with the same passkey.
3. `/passkeys`: add a second, rename, remove one; count updates on the profile.
4. Passkey-only account: Remove on the last passkey is disabled; the tRPC
   `remove` returns `LAST_IDENTITY` when called directly (`tests/utils/trpc.ts`).
5. Email account adds a passkey, then detaches the email → allowed; the
   reverse (remove last passkey with an email present) → allowed.
6. SIWE account links a passkey, unlinks SIWE → allowed.
7. Sessions page shows the "Passkey" label for a passkey session.
8. Erase account removes the credential (sign-in with it afterwards fails
   and creates nothing).
9. A tampered/replayed assertion (reuse a consumed challenge) is rejected
   with the generic error.

`tests/specs/security.spec.ts` (extend): `signUpOptions` per-IP rate limit
(mind `EMAIL_CODE_MAX_PER_IP`-style override if the suite trips it).

## Phase 3 — fixes and review

- `bun run lint`, `bun run test`, `bun run test:e2e`; fix what falls out.
- `/code-review` on the branch, then `/security-review`. Things the review
  should specifically confirm: challenge bound to origin + RP ID and
  single-use; sign-up challenge cannot be redeemed as a link and vice versa;
  the provisional user id in a sign-up challenge is never trusted to *find* a
  user; counter regression rejected (SimpleWebAuthn default) while 0/0 from
  Apple passkeys still passes; no enumeration on `signInOptions`; every
  failure in `authorize` returns the same `null`; the last-method guard has one
  implementation.
- Migration applied to production with `db:migrate:prod` at release.

## Future — vault unlock with a passkey (not planned)

WebAuthn's `prf` extension yields a deterministic 32-byte secret per
(credential, salt) that never leaves the authenticator. The additive design:
a `mek_wraps` table `(user_id, credential_id, wrapped_mek)`; at enrolment
(vault already unlocked) derive a wrapping key from the PRF output and wrap
the MEK; on unlock, passphrase as today *or* passkey → PRF → unwrap. Nothing
in the XOR-share scheme changes and no key rotates, so seal NEKs are untouched.

Constraints to carry into that design: the passphrase stays as the recovery
path forever; PRF support is uneven, so the feature is opt-in per passkey and
degrades to the passphrase; and it merges account auth and vault auth into one
gesture, which is a real change to the threat model, not a free win.
