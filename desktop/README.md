# SigNote Desktop Shell

This directory contains the isolated Electron shell for SigNote. The renderer loads an approved SigNote HTTPS origin; the existing Next.js application and deployed API remain the source of application behavior.

## Decisions for the initial scaffold

- Packaging: `electron-builder`
- macOS application ID: `app.signote.desktop`
- Deep-link scheme: `signote://`
- Production origin: `https://signote.tech`
- Development origin: `http://localhost:5000`
- Distribution: unsigned personal build; Developer ID signing is deferred
- Automatic updates: excluded from the first beta until the release channel is selected

The application ID and production origin must be confirmed before distributing a build.

## Commands

From the repository root:

```bash
bun run dev              # start the SigNote web app
bun run desktop:dev      # build and open the Electron shell
bun run desktop:build    # compile the Electron main and preload processes
bun run desktop:pack     # create an unpacked application
bun run desktop:dist     # create explicitly unsigned local DMG and ZIP artifacts
bun run desktop:dist:release # future signed/notarized release (credentials required)
```

Install desktop dependencies separately:

```bash
cd desktop
bun install
```

## Configuration

`SIGNOTE_DESKTOP_ORIGIN` overrides the origin loaded by the shell:

```bash
SIGNOTE_DESKTOP_ORIGIN="https://staging.signote.tech" bun run desktop:dev
```

Only HTTPS origins are accepted in packaged builds. Development builds also allow HTTP on `localhost`, `127.0.0.1`, and `[::1]`.

The current personal build is intentionally unsigned and requires one-time approval in macOS Privacy & Security. Signing and notarization remain configured only as a future opt-in release command. See [RELEASE.md](RELEASE.md) for installation steps and the deferred cold-start auth case.

## Current boundary

Phase 2 browser-to-desktop authentication is implemented. The renderer creates state and a PKCE verifier, opens the server-provided `/desktop/login` URL in the system browser, and exchanges a validated `signote://auth/callback` for an independent desktop session. The main process handles macOS `open-url`, cold-start arguments, and running-instance callbacks, queues one callback until the renderer is ready, and focuses the existing window.

The preload exposes immutable desktop metadata, one constrained `startBrowserLogin` operation, and a validated authentication-callback subscription. The main process accepts only the configured SigNote origin with the exact `/desktop/login` path. It deliberately provides no filesystem, generic shell, cookie, token, or generic IPC access.

Pending state and PKCE material live only in renderer `sessionStorage`; callbacks contain only the attempt ID, opaque single-use code, and state. The persistent Electron partition stores the HTTP-only NextAuth cookie so a desktop session survives window and application restarts.

Desktop mode loads a dedicated RainbowKit configuration with only the generic WalletConnect connector. Injected wallets, browser extensions, and wallet-specific SDK connectors remain unavailable; users connect by scanning the QR code with a compatible mobile wallet. SIWE nonce creation and verification still use the deployed SigNote origin, and the resulting NextAuth cookie is written directly to Electron's persistent session. Add the production and staging origins to the Reown project allowlist before testing those deployments.

Service-worker registrations are cleared in the dedicated Electron session before the page loads so an old worker cannot pin the shell to a stale web deployment; IndexedDB application data remains untouched.
