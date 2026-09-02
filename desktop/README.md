# SigNote Desktop Shell

This directory contains the isolated Electron shell for SigNote. The renderer loads an approved SigNote HTTPS origin; the existing Next.js application and deployed API remain the source of application behavior.

## Decisions for the initial scaffold

- Packaging: `electron-builder`
- Application ID: `app.signote.desktop`
- Deep-link scheme: `signote://`
- Production origin: `https://signote.tech`
- Development origin: `http://localhost:5000`
- Distribution: ad-hoc signed, unnotarized personal build; Developer ID signing is deferred
- Automatic updates: excluded from the first beta until the release channel is selected

The application ID and production origin must be confirmed before distributing a build.

## Commands

From the repository root:

```bash
bun run dev              # start the SigNote web app
bun run desktop:dev      # build and open the Electron shell
bun run desktop:build    # compile the Electron main and preload processes
bun run desktop:pack     # create an unpacked application
bun run desktop:dist     # create ad-hoc signed, unnotarized local macOS DMG and ZIP artifacts
bun run desktop:dist:win # create unsigned Windows NSIS installers (x64 and arm64)
bun run desktop:dist:linux # create AppImage and deb packages (x64 and arm64)
bun run desktop:dist:release     # future signed/notarized macOS release (credentials required)
bun run desktop:dist:win:release # future signed Windows release (certificate required)
```

Both cross-platform commands run from macOS: `makensis`, `fpm`, and the AppImage
tooling all have host builds that electron-builder downloads. Installing,
launching, and protocol-handler testing still require the target operating
system. See [RELEASE.md](RELEASE.md) for the per-platform acceptance matrices.

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

The current personal build has only a free ad-hoc integrity signature and remains unnotarized, so it may require one-time approval in macOS Privacy & Security. Developer ID signing and notarization remain configured only as a future opt-in release command. See [RELEASE.md](RELEASE.md) for installation steps and the deferred cold-start auth case.

Because ad-hoc signatures change between builds, the personal channel keeps Electron's Keychain-backed cookie encryption fuse disabled and stores its HTTP-only session cookie in the local Chromium profile. Version 0.1.1 uses the fresh `persist:signote-v2` partition to avoid the unreadable encrypted cookie database created by 0.1.0. This requires one sign-in after upgrading, but later restarts persist without a Keychain prompt. The Developer ID release command re-enables cookie encryption once a stable signing identity is available.

## Current boundary

Phase 2 browser-to-desktop authentication is implemented. The renderer creates state and a PKCE verifier, opens the server-provided `/desktop/login` URL in the system browser, and exchanges a validated `signote://auth/callback` for an independent desktop session. The main process handles macOS `open-url`, cold-start arguments, and running-instance callbacks, queues one callback until the renderer is ready, and focuses the existing window.

The preload exposes immutable desktop metadata, one constrained `startBrowserLogin` operation, and a validated authentication-callback subscription. The main process accepts only the configured SigNote origin with the exact `/desktop/login` path. It deliberately provides no filesystem, generic shell, cookie, token, or generic IPC access.

Pending state and PKCE material live only in renderer `sessionStorage`; callbacks contain only the attempt ID, opaque single-use code, and state. The persistent Electron partition stores the HTTP-only NextAuth cookie so a desktop session survives window and application restarts.

Desktop mode loads a dedicated RainbowKit configuration with only the generic WalletConnect connector. Injected wallets, browser extensions, and wallet-specific SDK connectors remain unavailable; users connect by scanning the QR code with a compatible mobile wallet. SIWE nonce creation and verification still use the deployed SigNote origin, and the resulting NextAuth cookie is written directly to Electron's persistent session. Add the production and staging origins to the Reown project allowlist before testing those deployments.

## Platform packaging

| Platform | Targets                    | Protocol registration                                                 | Signing                       |
| -------- | -------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| macOS    | DMG, ZIP                   | `CFBundleURLTypes` from `build.protocols`                             | Ad-hoc; Developer ID deferred |
| Windows  | NSIS (x64, arm64)          | `build/installer.nsh` writes `Software\Classes\signote` under `SHCTX` | None; SmartScreen warns       |
| Linux    | AppImage, deb (x64, arm64) | `MimeType=x-scheme-handler/signote` in the generated desktop entry    | None                          |

electron-builder only emits protocol declarations for macOS bundles and Linux
desktop entries, so Windows registration is done by the installer. Electron also
calls `app.setAsDefaultProtocolClient` at every start, but the installer's
registry keys let a cold-start `signote://` link resolve before the application
has been launched for the first time.

The Windows installer is per-user (`perMachine: false`, `allowElevation: false`),
so it writes to `HKCU\Software\Classes` and needs no administrator prompt.
Uninstalling removes the protocol keys and leaves the Electron profile in
`%APPDATA%` intact.

On Linux the deb package registers the scheme system-wide through
`update-desktop-database` and keeps the Chromium sandbox: its post-install script
sets the `chrome-sandbox` SUID bit only on kernels without unprivileged user
namespaces. The AppImage desktop entry deliberately omits the historical
unconditional `--no-sandbox` argument; the bundled `AppRun` wrapper probes for
user namespaces and adds the flag only when the sandbox cannot start.

The hardening `afterPack` hook applies the Electron fuses on all three platforms.
Embedded ASAR integrity validation is enabled on macOS and Windows only, because
Electron does not implement it on Linux.

Service-worker registrations are cleared in the dedicated Electron session before the page loads so an old worker cannot pin the shell to a stale web deployment; IndexedDB application data remains untouched.
