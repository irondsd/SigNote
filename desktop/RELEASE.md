# SigNote Desktop macOS Distribution Checklist

Phase 4 targets an unsigned personal build. This avoids Apple Developer Program costs while the app is used only by its owner. Signing and notarization are deferred until SigNote is distributed to other users.

## Known release gate

- [ ] Resolve and re-test end-to-end cold-start authorization. In the development runner, quitting during browser authorization ends `bun run desktop:dev`, and the callback relaunches a blank shell. The PKCE verifier and state are intentionally held only in renderer `sessionStorage`, which is lost across a true app restart.
- [ ] Verify both callback paths with an installed unsigned build: SigNote already running and SigNote fully quit.
- [ ] Decide whether to persist pending auth material securely across restarts or present a clean retry flow. Do not weaken state or PKCE verification.

## Release policy

- Current DMG and ZIP artifacts are intentionally unsigned and unnotarized.
- The owner must explicitly approve the application through macOS Privacy & Security after the first blocked launch.
- Do not ask other users to bypass Gatekeeper; obtain a Developer ID and notarize before wider distribution.
- First-beta updates are manual downloads. No automatic updater is included.
- Crash reporting is disabled until its data collection, retention, privacy notice, and redaction rules are documented.

## Personal unsigned build

No paid Apple membership or signing credentials are required. Build host-architecture artifacts with:

```bash
bun run desktop:dist
```

`desktop:dist` explicitly disables certificate auto-discovery so local personal builds remain unsigned even if a certificate is added to the Keychain later. Artifacts are written to `desktop/release/`.

## Install and approve on the owner's Mac

1. Open the DMG and copy SigNote to Applications.
2. Try to open SigNote normally. A locally built artifact may open directly; a quarantined copy downloaded through a browser is normally blocked on its first launch.
3. If it is blocked, open **System Settings → Privacy & Security**.
4. Find the message that SigNote was blocked and click **Open Anyway**.
5. Confirm **Open** in the final warning. Later launches should open normally unless the application changes enough for macOS to request approval again.

Keep the DMG and its SHA-256 checksum together so the downloaded file can be checked before approval:

```bash
shasum -a 256 "desktop/release/SigNote-0.1.0-arm64.dmg"
hdiutil verify "desktop/release/SigNote-0.1.0-arm64.dmg"
```

Do not remove quarantine attributes or globally disable Gatekeeper as part of the normal installation instructions.

## Personal-build acceptance

- [ ] Install from the unsigned DMG and approve it through Privacy & Security.
- [ ] Confirm the correct app name, icon, version, bundle ID `app.signote.desktop`, and `signote://` registration.
- [ ] Complete Google authorization with the app already running.
- [ ] Complete Google authorization from a fully quit state.
- [ ] Connect a supported mobile wallet by scanning the desktop WalletConnect QR code and complete SIWE sign-in.
- [ ] Before re-testing WalletConnect client changes, disconnect the old SigNote pairing in the mobile wallet and restart both the Next.js and Electron development processes; Fast Refresh can leave obsolete development listeners alive.
- [ ] Reject a pairing and a signature, then confirm the desktop UI recovers and permits a retry.
- [ ] Confirm injected/browser wallets never appear in the desktop wallet chooser.
- [ ] Quit and relaunch after SIWE sign-in; confirm the NextAuth session persists without requiring the wallet to remain connected.
- [ ] Quit and relaunch; confirm the desktop session persists and encrypted tiers return in the expected locked state.
- [ ] Verify Notes, Secrets, Seals, attachments, downloads, clipboard, note URLs, and offline cache.
- [ ] Verify remote session revocation and local sign-out.
- [ ] Install a newer build over an older build and confirm data/session behavior.
- [ ] Remove the application and document whether retained Electron profile data is intentional.
- [ ] Repeat the core install/auth flow after a macOS update or on a clean local user account before relying on it for important data.

## Future signed distribution

When budget permits and SigNote is ready for other users, enroll in the Apple Developer Program and run:

```bash
bun run desktop:dist:release
```

That command builds a universal app and deliberately fails unless a Developer ID Application identity is available. Before using it, configure notarization credentials and restore the signed/notarized verification matrix: `codesign --verify`, `spctl --assess`, `xcrun stapler validate`, and testing on both Apple silicon and Intel Macs. Signing credentials must stay in the release environment or macOS Keychain and must never be committed.
