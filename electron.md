# SigNote Desktop (Electron) Implementation Plan

## Objective

Ship a secure, installable macOS application that presents the deployed SigNote web app in Electron and uses the existing deployed backend. Authentication happens in the user's system browser and returns to the desktop app through a deep link.

The first release will:

- Target macOS.
- Load the deployed SigNote origin in an Electron `BrowserWindow`.
- Support Google sign-in through the system browser.
- Register and handle a SigNote deep-link protocol.
- Create an independent, revocable session for the desktop app.
- Hide and avoid initializing Ethereum/SIWE functionality in desktop mode.
- Preserve the existing Notes, Secrets, Seals, uploads, offline cache, and encryption behavior.

Windows, Linux, WalletConnect-based SIWE, automatic updates, and a locally bundled frontend are follow-up work unless explicitly pulled into the first release.

## Architecture Decision

### MVP: thin Electron shell

Electron loads the production web origin rather than a local static build:

```text
Electron BrowserWindow
        |
        | HTTPS, same-origin cookies
        v
https://signote.tech
        |
        +-- /api/auth/*
        +-- /api/trpc/*
        +-- file upload/download routes
```

This keeps the current same-origin assumptions intact:

- The tRPC client can continue using `/api/trpc`.
- NextAuth can continue using secure, HTTP-only cookies.
- No new CORS policy is required for application APIs.
- TanStack Query persistence, IndexedDB, `sessionStorage`, and Web Crypto remain in the renderer.
- Next.js server/runtime behavior stays on the deployed application.

Do not bundle a separate frontend in the MVP. A bundled renderer would require a public API origin, CORS, bearer-token authentication, changes to `SessionProvider`, and a clearer separation between client and server Next.js modules.

## Authentication Design

### Required flow

```text
1. Electron creates:
   - random state
   - PKCE verifier and SHA-256 challenge

2. Electron creates a server-side attempt, then opens the returned URL in the system browser:
   https://signote.tech/desktop/login
     ?attempt=<id>
     &state=<state>

3. The browser completes normal Google/NextAuth authentication.

4. SigNote creates a short-lived, single-use desktop authorization code
   bound to the authenticated user, attempt, state, and PKCE challenge.

5. The browser opens:
   signote://auth/callback?attempt=<id>&code=<opaque-code>&state=<state>

6. Electron receives the deep link and verifies state locally.

7. The renderer POSTs the code and PKCE verifier to the deployed exchange
   endpoint over HTTPS.

8. The server consumes the code and issues a new NextAuth JWT cookie with
   a new session ID dedicated to the Electron app.

9. Electron reloads the application and verifies `/api/auth/session`.
```

The browser session must not be copied into Electron. The exchange creates a distinct desktop session so it can be listed, audited, expired, and revoked independently.

### Security invariants

- Authentication must occur in the system browser, not an Electron webview.
- The authorization code is opaque, high entropy, short-lived, and single-use.
- Store only a hash of the authorization code on the server.
- Bind every attempt to a PKCE S256 challenge.
- Verify `state` in Electron before exchanging the code.
- Consume the code atomically so concurrent exchanges cannot both succeed.
- Never put a NextAuth JWT, Google token, passphrase, MEK, or encryption share in a deep link.
- Do not expose authentication tokens through preload APIs or IPC.
- Rate-limit attempt creation and code exchange.
- Reject unknown callback paths, protocols, parameters, and oversized inputs.
- Record a new `sid` and session row for the desktop session.
- Use the existing seven-day session lifetime initially.
- Clear pending verifier/state material on success, cancellation, or expiry.

### Deep-link scheme

Use `signote://` for the MVP if that product name is required. The callback is:

```text
signote://auth/callback
```

PKCE protects the exchange if another application intercepts the custom scheme. Before public release, evaluate a reverse-domain scheme such as `app.signote://` and verified HTTPS app links as a stronger long-term option.

## Server Changes

### 1. Desktop authorization-attempt model

Add a MongoDB model such as `DesktopAuthAttempt` with:

```ts
type DesktopAuthAttempt = {
  attemptId: string;
  stateHash: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  userId: string | null;
  authorizationCodeHash: string | null;
  status: 'pending' | 'authorized' | 'consumed';
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};
```

Requirements:

- Unique index on `attemptId`.
- Unique sparse index on `authorizationCodeHash` if practical.
- TTL index on `expiresAt`.
- Five-minute maximum lifetime for an attempt.
- One-minute target lifetime after an authorization code is issued.

### 2. Attempt creation endpoint

Add:

```text
POST /api/desktop-auth/attempts
```

Input:

```json
{
  "state": "random-value",
  "codeChallenge": "base64url-sha256",
  "codeChallengeMethod": "S256"
}
```

Output:

```json
{
  "attemptId": "opaque-id",
  "loginUrl": "https://signote.tech/desktop/login?...",
  "expiresAt": "ISO-8601 timestamp"
}
```

Validate lengths and base64url encoding. Hash state before persistence.

### 3. Browser login page

Add a route such as:

```text
/desktop/login?attempt=<id>&state=<state>
```

Behavior:

- Validate the pending attempt and state.
- If unauthenticated, start or offer normal Google sign-in.
- Preserve the desktop attempt through the OAuth callback using a validated callback URL or a short-lived HTTP-only browser cookie.
- If authenticated, show a clear confirmation that the browser is authorizing the SigNote desktop application.
- On confirmation, generate an opaque single-use authorization code.
- Store only its hash and bind it to the authenticated `userId`.
- Redirect or offer a button to `signote://auth/callback?code=...&state=...`.
- Provide recovery instructions if the desktop app does not open.

Do not redirect arbitrary callback URLs received from query parameters.

### 4. Code exchange endpoint

Add:

```text
POST /api/desktop-auth/exchange
```

Input:

```json
{
  "attemptId": "opaque-id",
  "code": "opaque-code",
  "state": "random-value",
  "codeVerifier": "pkce-verifier"
}
```

The endpoint must:

1. Validate the request shape and rate limit it.
2. Hash and compare state and authorization code in constant time where applicable.
3. Verify `BASE64URL(SHA256(codeVerifier))` against the stored challenge.
4. Atomically transition the attempt from `authorized` to `consumed`.
5. Create a new `sid` and desktop `AuthSession` record.
6. Encode a NextAuth-compatible JWT containing `sub`, `sid`, and provider claims.
7. Set the production NextAuth session cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, the correct domain/path, and matching expiry.
8. Return only minimal user/session confirmation data.

Factor session-token creation into a shared server helper rather than duplicating cookie names and JWT configuration in the route.

### 5. Session metadata

Extend session metadata if necessary to distinguish a desktop client from an ordinary browser. Prefer an optional `client` or `application` field instead of treating `desktop` as an authentication provider:

```ts
client: 'web' | 'desktop';
```

The provider should remain `google` for this first iteration. Update the profile/session UI to label desktop sessions clearly.

### 6. Sign-out and revocation

Confirm that:

- Signing out inside Electron revokes only the Electron `sid`.
- Revoking the desktop session from another browser makes the next Electron request return `UNAUTHORIZED`.
- The existing unauthorized flow clears account query caches and returns Electron to signed-out state.
- Pending drafts follow the current preservation behavior on session expiry.

## Web Application Changes

### Desktop runtime detection

Expose only a small, immutable desktop descriptor from preload:

```ts
type SigNoteDesktopBridge = {
  platform: 'macos' | 'windows' | 'linux';
  appVersion: string;
  onAuthCallback(callback: (payload: AuthCallback) => void): () => void;
  startBrowserLogin(url: string): Promise<void>;
};
```

Publish it as `window.signoteDesktop` with `contextBridge`. Do not expose generic IPC, shell execution, filesystem access, Electron objects, cookies, or tokens.

Add a typed global declaration in the web application and a helper such as `isDesktopApp()`.

### Disable SIWE in desktop mode

Desktop mode must:

- Hide the SIWE sign-in button.
- Hide SIWE account-linking controls.
- Avoid constructing injected-wallet connectors.
- Avoid initializing Wagmi and RainbowKit when they are not needed.
- Keep Google sign-in available through the browser handoff.

Likely web files to update:

- `src/app/layout.tsx`
- `src/providers/Web3ProviderLazy.tsx`
- `src/components/SignInModal/SignInModal.tsx`
- `src/components/SignInMethods/SignInMethods.tsx`
- A new desktop environment/bridge module

Do not use the desktop flag as an authorization boundary. It only selects UI and runtime behavior; the server remains responsible for authentication and authorization.

### Desktop sign-in UI

In desktop mode, replace direct `signIn('google')` behavior with:

1. Generate PKCE verifier, challenge, and state in Electron or trusted preload/main process code.
2. Create the server attempt.
3. Open the returned HTTPS login URL with the operating system browser.
4. Show a waiting state with cancel and retry actions.
5. Handle the verified callback.
6. Exchange the code and refresh the NextAuth session.

Provide explicit error states for:

- Browser login cancelled.
- Attempt expired.
- Invalid or mismatched callback.
- Code already consumed.
- Network unavailable.
- Session cookie rejected.

## Electron Application

### Project layout

Keep the shell isolated from the Next.js application, for example:

```text
desktop/
  package.json
  tsconfig.json
  src/
    main.ts
    preload.ts
    deepLinks.ts
    authFlow.ts
    security.ts
  assets/
    icon.icns
  tests/
```

Use Electron Forge or Electron Builder consistently; do not combine packaging systems. Choose based on the desired signing, notarization, and update workflow before scaffolding.

### BrowserWindow baseline

Configure the production window with:

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  preload: PRELOAD_PATH,
}
```

Also:

- Load only the configured SigNote HTTPS origin.
- Use a dedicated persistent session partition.
- Deny unexpected permission requests.
- Block navigation away from the allowed SigNote origin.
- Send ordinary external links to `shell.openExternal` after validating `https:`.
- Deny unapproved `window.open` calls.
- Do not ignore TLS certificate errors.
- Disable or tightly restrict DevTools in production.
- Set an identifiable desktop user agent suffix for support/session auditing.
- Avoid remote module usage.
- Apply appropriate Electron fuses in packaged builds.

### Deep-link handling

Implement all relevant launch cases:

- Register `signote` as the application protocol.
- macOS cold start through `open-url`.
- macOS callback while the app is running.
- Windows/Linux cold start through command-line arguments.
- Windows/Linux callback through `second-instance`.
- Acquire the single-instance lock before creating the window.
- Queue a callback received before the renderer is ready.
- Bring the existing window to the foreground without creating a second window.
- Parse the URL with the platform URL API and accept only `signote://auth/callback`.
- Pass only validated fields to the renderer.

### Lifecycle and encrypted state

- Confirm whether closing the last macOS window quits the app or leaves it running.
- Preserve the current hard/soft lock semantics when the window is hidden, minimized, suspended, or resumed.
- Verify that `visibilitychange` behavior does not make normal macOS window switching excessively disruptive.
- Keep the MEK and passphrase in renderer memory only under the existing encryption design.
- Do not move encryption material into the Electron main process.
- Confirm that the persistent partition stores session cookies while `sessionStorage` maintains the intended window-lifetime behavior.

## Delivery Phases

### Phase 0: decisions and scaffolding

- [x] Select `https://signote.tech` as the configurable production-origin default; confirm before release.
- [x] Select `app.signote.desktop` as the initial macOS bundle ID; confirm before signing.
- [x] Select `signote://` as the initial deep-link scheme.
- [x] Choose Electron Builder.
- [x] Exclude automatic updates from the first beta until the release channel is selected.
- [x] Add the isolated `desktop/` project.
- [x] Add development scripts without changing the behavior of existing web scripts.
- [x] Document environment variables for origin and future signing.

Exit criteria: a development Electron window securely loads the configured SigNote origin and external navigation is constrained.

Phase 0 status (2026-09-01): complete. The shell compiles with Electron 44, its navigation policy has automated coverage, and an unpacked arm64 macOS application was produced successfully. The packaged metadata contains the selected bundle ID and deep-link scheme. The build is intentionally unsigned and uses Electron's default icon until Phase 4.

### Phase 1: desktop-aware web UI

- [x] Add the minimal preload bridge and TypeScript declarations.
- [x] Add reusable desktop-environment detection.
- [x] Hide SIWE sign-in and identity-linking controls in desktop mode.
- [x] Avoid loading Wagmi/RainbowKit in desktop mode.
- [x] Add a desktop Google sign-in waiting/error state.
- [x] Prevent service-worker behavior from interfering with desktop deployments.

Exit criteria: the desktop renderer shows no Ethereum sign-in capability and normal authenticated application behavior is unchanged in browsers.

Phase 1 status (2026-09-01): complete. Electron exposes a narrow typed bridge, opens only the configured `/desktop/login` URL through IPC, and skips all wallet providers and wallet UI. Desktop startup clears previous service-worker registrations while retaining the existing browser registration behavior. The browser login page and session handoff are implemented in Phase 2.

### Phase 2: browser-to-desktop authentication

- [x] Add the desktop auth-attempt model and TTL indexes.
- [x] Add attempt creation, browser completion, and exchange endpoints.
- [x] Add shared NextAuth JWT/cookie issuance helper.
- [x] Add PKCE, state verification, one-time consumption, expiry, and rate limits.
- [x] Add the browser login/confirmation page.
- [x] Register the Electron protocol and implement every lifecycle case.
- [x] Connect callback delivery to the renderer and refresh `SessionProvider`.
- [x] Mark the issued session as a desktop client.

Exit criteria: a signed-out Electron install can authenticate through the default browser, receive a new independent session, restart, and remain signed in until expiry or revocation.

Phase 2 status (2026-09-01): complete. The browser authorizes only Google-backed sessions and issues a one-minute, single-use code bound to a five-minute PKCE attempt. Electron validates and queues exact `signote://auth/callback` links across cold-start, macOS `open-url`, and running-instance paths, then the renderer exchanges the code for a separate seven-day HTTP-only desktop session. Automated coverage verifies hashing, expiry, guess limits, concurrent replay prevention, browser confirmation, cookie persistence, session metadata, replay rejection, and remote revocation. The unpacked arm64 app packages successfully; installed-app protocol and lifecycle testing remains part of Phase 3 validation.

### Phase 3: security and functional validation

- [x] Test Notes create/read/update/delete.
- [x] Test Secrets and Seals setup, unlock, soft lock, hard lock, and renderer-reload behavior.
- [x] Test attachments, downloads, clipboard, note URLs, and offline cache.
- [x] Test sign-out, session expiry, remote revocation, and preserved drafts.
- [x] Test expired, replayed, intercepted, malformed, and mismatched auth callbacks.
- [x] Test cold-start and already-running deep links at the Electron lifecycle boundary.
- [x] Review navigation, popup, permission, IPC, preload, and CSP boundaries.
- [x] Run dependency and Electron security checks.

Exit criteria: automated tests cover the auth protocol and manual regression passes cover all three note security tiers.

Phase 3 status (2026-09-01): accepted with one deferred release-gate issue. The installed-app manual regression passed Notes, Secrets, Seals, auth while already running, relaunch persistence, attachments, downloads, clipboard, note URLs, and offline-cache behavior. The final dependency state passes 323 Jest tests, 15 Electron security/lifecycle tests, and all 378 Playwright scenarios. The E2E suite covers Notes CRUD, both encrypted tiers, locks and reloads, attachments and downloads, clipboard actions, note URLs, drafts, sign-out, session revocation, and the desktop authorization protocol. A production Next.js build succeeds, and its emitted CSP omits `unsafe-eval`.

The packaged arm64 app registers `signote://`, uses ASAR integrity metadata, denies arbitrary and local cleartext App Transport Security loads, and has the following Electron fuses enforced: `RunAsNode` off, cookie encryption on, `NODE_OPTIONS` and CLI inspection off, embedded ASAR integrity validation on, ASAR-only application loading on, and extra `file://` privileges off. Electronegativity reports the expected custom-protocol and `openExternal` review points; both call sites are constrained by exact URL parsers. Its CSP finding is not applicable to this thin-shell ASAR because the renderer CSP is delivered by the production HTTPS response and was verified in the generated Next.js route manifest.

The desktop production dependency audit reports no known vulnerabilities. The web dependency audit has no critical findings after the security upgrades, but still reports 106 transitive findings (45 high, 55 moderate, 6 low), concentrated in the browser wallet connector stack and build/development tooling. These remain a tracked release risk; forcing incompatible transitive overrides is not accepted as remediation without upstream-compatible releases and regression coverage.

Deferred release-gate issue: test 9, end-to-end cold-start authorization, did not pass in the development runner. Quitting SigNote while the system-browser authorization was in progress also ended `bun run desktop:dev`; the `signote://` callback relaunched a blank Electron window. Pending PKCE verifier/state currently lives in renderer `sessionStorage`, so a true application restart during authorization also needs a deliberate recovery design. Re-test and resolve this against an installed build before wider use. The automated lifecycle test still verifies that a callback arriving before the renderer is ready is queued correctly within one application process.

### Phase 4: personal unsigned macOS distribution

- [x] Create production application icons and metadata.
- [x] Configure bundle ID and protocol registration.
- [x] Configure hardened runtime and required entitlements.
- [x] Explicitly disable automatic signing for personal builds.
- [x] Defer Developer ID signing and Apple notarization until the project has a distribution budget.
- [x] Produce a local unsigned DMG and ZIP installer for packaging validation.
- [x] Test installation, Privacy & Security approval, first launch, protocol registration, upgrade, and uninstall on the owner's Mac.
- [x] Keep crash reporting disabled until privacy and redaction behavior is documented.
- [x] Use manually published downloads for the first beta; keep automatic updates disabled.

Unsigned installation, future signing, and the deferred cold-start auth case are tracked in `desktop/RELEASE.md`.

Exit criteria for the personal build: the owner can install, explicitly approve, launch, authenticate, update or reinstall, and remove SigNote. Signing and notarization become mandatory before distributing the application to other users.

### Phase 5: later platform work

- [x] Add WalletConnect-only SIWE sign-in and Ethereum identity linking for desktop.
- [x] Keep injected, extension, and wallet-specific SDK connectors disabled in desktop mode.
- [x] Manually validate QR pairing, signing, rejection, disconnect, relaunch, and session revocation with supported mobile wallets.
- [ ] Add Windows packaging, code signing, installer, protocol registration, and update testing.
- [ ] Add Linux packages and desktop-entry/protocol registration.
- [x] Evaluate verified HTTPS links or loopback callbacks.
- [x] Evaluate whether offline/product requirements justify a locally bundled frontend.

Phase 5 WalletConnect status (2026-09-02): implementation and automated desktop-mode coverage are complete. Electron uses a dedicated RainbowKit configuration containing only the generic WalletConnect connector; the ordinary web application retains its existing wallet list and injected fallback. SIWE nonce creation and signature verification remain on the deployed backend, while the credentials callback writes the resulting session cookie directly into Electron's persistent partition and labels it as a desktop session. No system-browser consent page or `signote://` exchange is involved. Before relying on this path, add every deployed SigNote origin to the Reown project allowlist and complete the mobile-wallet manual matrix.

Phase 5 checkbox note: the Windows and Linux items stay unchecked because their packaging, protocol registration, and hardening have landed and build successfully, but no part of either platform has been installed or exercised on its own operating system. Code signing on both platforms remains deliberately deferred under the Phase 4 budget decision.

### Phase 5 Windows and Linux packaging status (2026-09-02)

Configuration, installer scripting, icons, and cross-platform hardening are implemented, and every artifact type builds from the macOS development host: `makensis`, `fpm`, and the AppImage tooling all have host builds that electron-builder downloads, so `bun run desktop:dist:win` and `bun run desktop:dist:linux` produce real installers without a Windows or Linux machine.

Windows:

- NSIS installers for x64 and arm64, per user (`perMachine: false`, `allowElevation: false`), so no administrator prompt and no machine-wide state.
- `desktop/build/installer.nsh` registers `Software\Classes\signote` under `SHCTX` with `URL Protocol`, a `DefaultIcon`, and a `shell\open\command` that quotes `"%1"`, and deletes the key on uninstall. electron-builder's `protocols` field is macOS-only, so the installer has to do this itself; the registry keys also let a cold-start deep link resolve before the app has ever been launched. A deliberate syntax error inserted into the include aborts `makensis`, which confirms the file is compiled into the shipped installer.
- `app.setAppUserModelId('app.signote.desktop')` matches the AppUserModelID electron-builder stamps on the installed shortcuts, so the taskbar button groups correctly.
- A multi-slot `assets/icon.ico` (16/24/32/48/64/128/256) is generated from the same SVG as the macOS icon; electron-builder requires the 256px slot.
- `desktop:dist:win` passes `--config.win.signExecutable=false` so a certificate present in the build environment can never be used by the personal channel; the log records `file signing skipped via signExecutable configuration` for every executable. `desktop:dist:win:release` sets `forceCodeSigning` and enables the cookie-encryption fuse for a future signed channel.

Linux:

- AppImage and deb for x64 and arm64. electron-builder derives `MimeType=x-scheme-handler/signote;` in the generated desktop entry from `build.protocols`, which was verified by extracting `signote.desktop` from both built packages.
- `desktopName`, `linux.executableName`, and `linux.syncDesktopName` are aligned so `StartupWMClass` matches Electron's `app_id` and window managers associate running windows with the installed entry.
- The AppImage desktop entry drops the historical unconditional `--no-sandbox` argument (`appImage.executableArgs: []`). The bundled `AppRun` wrapper probes for unprivileged user namespaces and adds the flag only when the Chromium sandbox cannot start, so the sandbox stays on wherever the kernel allows it.
- The deb keeps the sandbox as well: its post-install script sets the `chrome-sandbox` SUID bit only on kernels without user namespaces, and calls `update-desktop-database` so the scheme is registered system-wide. An AppImage registers the scheme only once its desktop entry is integrated, so the deb is the package to use when deep links matter.
- The hardening `afterPack` hook now runs on all three platforms. Embedded ASAR integrity validation is enabled on macOS and Windows and left off on Linux, where Electron does not implement it; the remaining fuses (`RunAsNode`, `NODE_OPTIONS`, CLI inspection, `file://` privileges off, ASAR-only loading on) are identical everywhere, verified by reading the fuse wire back from each packaged binary.

Remaining before either platform can be checked off: install, first launch, protocol registration, cold-start and already-running deep links, the three note tiers, upgrade over an older build, and uninstall, each on its own operating system. The per-platform acceptance matrices are in `desktop/RELEASE.md`. Automatic updates stay disabled everywhere; NSIS emits `.blockmap` files that a future `electron-updater` channel could use, but no updater is bundled and no publish target is configured, so "update testing" means installing a newer build over an older one.

### Phase 5 evaluation: verified HTTPS links and loopback callbacks (2026-09-02)

Decision: keep `signote://` as the only callback transport.

Verified HTTPS links cannot cover the supported platforms. macOS universal links need an `apple-app-site-association` file served from the SigNote origin _and_ a Developer ID team identifier baked into a signed, notarized bundle, which the Phase 4 budget decision explicitly defers. Windows has no equivalent for a Win32/NSIS application; App URI handlers require MSIX packaging with domain validation. Linux has no verified-link mechanism at all beyond the desktop-entry MIME association already in use. So the best case is one extra macOS-only transport that still needs the custom scheme as a fallback, in exchange for a paid signing identity and a new server-hosted association file.

Loopback callbacks (RFC 8252 section 7.3) are the standard native-app alternative and do remove scheme hijacking: only the process holding the ephemeral `127.0.0.1` port receives the redirect. They are rejected for now because they trade that for worse properties here. A loopback listener cannot start the application, so the cold-start case — the one already tracked as a release gate — becomes impossible rather than merely awkward. It adds an inbound HTTP surface inside the process that holds the PKCE verifier. It requires the server to accept a dynamic-port redirect target, weakening the current fixed-callback validation. And a local process can still race to bind the port before Electron does.

The custom scheme's residual risk is bounded by the existing protocol rather than by the transport. A hostile local application that registers `signote://` receives the attempt ID, the state, and the opaque authorization code, but not the PKCE verifier, which never leaves the Electron renderer's `sessionStorage`. Without the verifier the exchange endpoint rejects the code, and the code is single-use with a one-minute lifetime, so interception yields a denial of service and never a session. Revisit this only if universal links become free as a side effect of Developer ID signing, and treat them as an additional macOS transport rather than a replacement.

### Phase 5 evaluation: locally bundled frontend (2026-09-02)

Decision: keep the thin shell over the deployed origin; do not bundle a renderer.

Bundling cannot deliver offline use, which is its only compelling motivation. Unlocking Secrets and Seals reconstructs the MEK as `deviceShare XOR serverShare`, and `serverShare` lives in the `EncryptionProfile` document on the server. An offline SigNote therefore cannot decrypt anything it has cached, so a bundled renderer would ship an application that loads without a network and then refuses to open the two tiers that motivate the product. Making it genuinely offline means caching the server share locally, which collapses the two-share model into a single local secret — a security redesign, not a packaging change.

The rest of the cost is unchanged from the original architecture decision and remains substantial: a public API origin with CORS, bearer tokens in place of same-origin HTTP-only cookies, `SessionProvider` changes, a clean client/server module split in a Next.js application that currently relies on server rendering and route handlers, and an auto-update channel so the bundled renderer can be patched at all — updates being the thing the first beta deliberately excludes. Meanwhile the existing TanStack Query persistence and IndexedDB cache already serve cached plaintext notes once the document has loaded, which is the only offline behavior actually reachable today.

One thin-shell weakness this evaluation did surface is worth fixing independently of bundling: the main process calls `loadURL` with no `did-fail-load` handling, so an unreachable origin shows Chromium's default error page instead of a SigNote retry state. That is a small, self-contained shell improvement and is recommended as follow-up work rather than a reason to bundle.

## Testing Plan

### Server unit/integration tests

- Valid attempt creation.
- Invalid challenge format and oversized inputs.
- Browser completion requires an authenticated user.
- State mismatch.
- Expired attempt.
- Successful PKCE exchange.
- Wrong verifier.
- Wrong or missing authorization code.
- Atomic replay prevention under concurrent exchange requests.
- Cookie flags and token claims.
- New `sid` creation and revocation.
- Rate-limit behavior.

### Electron tests

- Protocol URL parsing accepts only the exact callback shape.
- Cold-start callback is queued until the renderer is ready.
- Running-instance callback focuses the existing window.
- Unexpected protocols and hosts are rejected.
- Navigation outside the production origin is blocked or opened externally.
- Popups and permission requests are denied by default.
- Preload exports only the documented API.

### End-to-end scenarios

1. Fresh install -> Google login -> callback -> authenticated desktop session.
2. User already signed into SigNote in browser -> authorize desktop -> no unnecessary Google prompt.
3. App closed when callback arrives -> app launches and completes authentication.
4. App already running when callback arrives -> existing window completes authentication.
5. Attempt expires while the user is in the browser -> clear retry experience.
6. Callback is replayed -> exchange is rejected without affecting the valid session.
7. Desktop session is remotely revoked -> next request signs out safely.
8. App restarts -> session cookie persists but encryption remains locked according to the existing model.
9. Web browser remains unaffected and still offers SIWE.
10. Electron never displays or initializes injected-wallet sign-in.

## Deployment and Rollback

- Gate desktop-auth endpoints behind a server-side feature flag for initial rollout.
- Deploy server support before distributing the Electron build.
- Keep schema additions backward compatible with existing browser sessions.
- Log attempt lifecycle events without logging codes, verifiers, JWTs, deep-link URLs, or personal note data.
- Monitor attempt creation, authorization, exchange success, expiry, replay rejection, and error rates.
- If the flow must be disabled, turn off attempt creation while leaving existing desktop sessions valid until expiry or revocation.
- Electron should show a clear minimum-version/update message if a future server change makes an old auth flow unsafe.

## Definition of Done for the First macOS Beta

- The application installs normally and passes macOS Gatekeeper checks.
- `signote://auth/callback` opens or focuses the application reliably.
- Google authentication occurs only in the system browser.
- Electron receives an independent, secure, revocable session.
- Authorization codes are single-use, short-lived, and protected with state and PKCE.
- No Ethereum/SIWE UI or injected-wallet initialization is present in desktop mode.
- Existing browser behavior, including SIWE, remains unchanged.
- Notes, Secrets, Seals, attachments, offline cache, locking, and session revocation pass regression testing.
- Production Electron security settings and navigation restrictions are verified.
- Signing, notarization, installation, upgrade, and uninstall are documented and tested.

## Initial Effort Estimate

- Secure Electron shell and desktop detection: 2-4 engineering days.
- Browser-to-desktop authentication and server tests: 3-6 engineering days.
- Application regression and security hardening: 2-4 engineering days.
- macOS signing, notarization, packaging, and release polish: 2-5 engineering days.

A working prototype is realistic in several days. A secure, signed macOS beta is approximately two to three weeks of focused work, depending mainly on signing/release setup and the depth of cross-platform preparation included in the first pass.
