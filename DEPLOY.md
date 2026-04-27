# Deploying TideCode

End-to-end instructions for cutting a release. Tide ships as a signed, notarized
macOS `.dmg` plus an auto-update bundle (`.app.tar.gz` + Ed25519 signature) hosted
on Cloudflare R2. The desktop app fetches `latest.json` from R2 on startup and
shows the in-app update banner when a newer version is available.

> **Build tooling is local-only.** The `apps/desktop/scripts/` directory is
> gitignored — `build_sidecar.sh`, `build_release.sh`, `bump-version.sh`,
> `entitlements.plist`, and `.env.build` never enter git. This document explains
> the flow; the operator-runbook copy with concrete paths lives at
> `apps/desktop/scripts/RELEASING.md` (also gitignored).

---

## TL;DR

```bash
cd apps/desktop

# 1. Bump version across package.json + Cargo.toml + tauri.conf.json
./scripts/bump-version.sh 0.2.0

# 2. Commit + tag (manual)
git add -u && git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0

# 3. Build, sign, notarize, upload, update latest.json (one shot)
./scripts/build_release.sh

# 4. Push commit + tag
git push --follow-tags
```

Users running v0.1.x see the update banner on next launch.

---

## Architecture

```
┌─────────────────────────┐    ┌──────────────────────────┐
│  Operator's machine     │    │  Cloudflare R2 (public)  │
│                         │    │                          │
│  build_release.sh       │───▶│  TideCode_X.Y.Z.dmg      │
│   ├── build_sidecar.sh  │    │  Tide.app.tar.gz         │
│   ├── pnpm tauri build  │    │  Tide.app.tar.gz.sig     │
│   ├── codesign + staple │    │  latest.json             │
│   ├── notarytool        │    └──────────────────────────┘
│   └── aws s3 cp         │              │
└─────────────────────────┘              │ HTTPS GET on app start
                                         ▼
                              ┌──────────────────────────┐
                              │  User's installed app    │
                              │                          │
                              │  tauri-plugin-updater    │
                              │   ├── compare versions   │
                              │   ├── verify Ed25519 sig │
                              │   ├── download & extract │
                              │   └── relaunch           │
                              └──────────────────────────┘
```

Key pieces:

- **Sidecar binary** — Pi coding agent compiled to a self-contained executable via `bun build --compile`, bundled into the `.app` as `externalBin`.
- **Code signing** — Apple Developer ID, hardened runtime, custom entitlements (JIT, library validation off, network).
- **Notarization** — `xcrun notarytool` submission + `xcrun stapler staple` so the DMG passes Gatekeeper offline.
- **Updater signature** — Ed25519 keypair (private key at `~/.tauri/tidecode.key`, pubkey baked into `tauri.conf.json`).
- **`latest.json`** — manifest fetched at runtime; updated by step 6 of `build_release.sh` and uploaded to R2.

---

## Prerequisites (one-time setup)

### Tools

| Tool | Purpose |
|------|---------|
| Xcode Command Line Tools | `codesign`, `xcrun`, `hdiutil`, `stapler` |
| Rust toolchain | `rustc` for target-triple detection, `cargo` for Tauri build |
| Node 18+ + pnpm | workspace + `pnpm tauri build` |
| Bun | `bun build --compile` for the sidecar |
| AWS CLI | uploading artifacts to R2 (S3-compatible) |

### Apple credentials

1. Developer ID Application certificate installed in your login Keychain.
2. App-specific password from <https://appleid.apple.com> (Sign-in & Security → App-Specific Passwords). **Not** your main Apple ID password.
3. Apple Team ID (10-character string).

### Tauri updater signing key

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/tidecode.key
```

Run this **once**. Save the password somewhere safe — `build_release.sh` defaults
to `tidecode` as the password if `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is unset.
The matching public key is already baked into
`apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Regenerating
the key requires updating the pubkey too.

### R2 bucket

1. Create an R2 bucket and an API token with read/write scope.
2. Configure `~/.aws/credentials`:
   ```ini
   [r2]
   aws_access_key_id = <R2 token id>
   aws_secret_access_key = <R2 token secret>
   region = auto
   ```
3. Note your account-specific endpoint (`https://<hash>.r2.cloudflarestorage.com`) and the public URL prefix (`https://pub-<id>.r2.dev/<prefix>`).

### `.env.build`

Copy `apps/desktop/scripts/.env.build.example` to `apps/desktop/.env.build` (or `.env.build` at repo root — `build_release.sh` checks both) and fill in:

```bash
export TIDECODE_LICENSE_HMAC_SECRET="<random string>"

export APPLE_ID="you@example.com"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_NOTARY_TEAM_ID="ABCDE12345"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABCDE12345)"

export R2_RELEASE_ENDPOINT_URL="https://<hash>.r2.cloudflarestorage.com"
export R2_RELEASE_BUCKET="s3://<bucket>/<prefix>"
export R2_RELEASE_PUBLIC_URL="https://pub-<id>.r2.dev/<prefix>"
export R2_RELEASE_PROFILE="r2"

export TIDE_UPDATER_URL="https://pub-<id>.r2.dev/<prefix>/latest.json"
```

---

## Release flow

### 1. Bump version

```bash
./apps/desktop/scripts/bump-version.sh 0.2.0
```

Atomically updates three files:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`

Surgical regex edits — preserves existing formatting and CRLF line endings.

### 2. Commit + tag

```bash
git add -u
git commit -m "chore: bump version to 0.2.0"
git tag v0.2.0
```

### 3. Run the release pipeline

```bash
./apps/desktop/scripts/build_release.sh
```

| Step | Action | Skip flag |
|------|--------|-----------|
| 1 | Compile Pi sidecar (bun) + transpile pi-extensions | `--skip-sidecar` |
| 2 | Build `@tide/shared` workspace package | — |
| 3 | `pnpm tauri build` → `.app.tar.gz` + `.sig` + `.dmg` | — |
| 4 | Codesign all binaries with Developer ID + entitlements; submit DMG to Apple notary; staple ticket | `--skip-notarize` |
| 5 | Upload `.app.tar.gz` and `.dmg` to R2 | `--skip-upload` |
| 6 | Update `apps/desktop/latest.json` with new version + signature + URL | always runs |
| 7 | Upload `latest.json` to R2 | `--skip-upload` |
| 8 | Create local git tag `vX.Y.Z` (idempotent) | always runs |

Useful invocations:

- `./scripts/build_release.sh --dry-run` — preflight only, no mutations.
- `./scripts/build_release.sh --manifest-only` — just refresh `latest.json` (no rebuild).
- `./scripts/build_release.sh --skip-notarize --skip-upload` — local smoke test of the build pipeline.
- `./scripts/build_release.sh --platform darwin-x86_64` — write the manifest entry under a different platform key.

### 4. Push

```bash
git push --follow-tags
```

Users on older versions will see the update banner on next app launch.

---

## How the auto-updater works

1. App boots → `useUpdaterStore.triggerCheck()` (`apps/desktop/src/stores/updaterStore.ts`).
2. Tauri's updater plugin fetches the configured URL — at build time, `build_release.sh` injects `TAURI_CONFIG` to override the `YOUR_UPDATE_SERVER` placeholder in tracked `tauri.conf.json` with the real `TIDE_UPDATER_URL` from `.env.build`.
3. If `latest.json` reports a newer version, `<UpdateBanner />` renders the `available` state at the top of the window. User clicks **Update Now** → plugin downloads `.app.tar.gz`, verifies the Ed25519 signature against the pubkey in `tauri.conf.json`, extracts in place.
4. User clicks **Restart** → `relaunch()` from `@tauri-apps/plugin-process`.
5. **Settings → General → "Check for updates"** can also force a re-check (resets the dismissed flag so the banner reappears).

---

## Adding a new platform

Tide is currently darwin-aarch64 only. To add a new target:

1. Add a stub entry to `apps/desktop/latest.json`:
   ```json
   "darwin-x86_64": { "signature": "", "url": "" }
   ```
2. Build on that platform: `./scripts/build_release.sh --platform darwin-x86_64`.
3. R2 holds artifacts for all platforms; the manifest URL stays the same.

Windows and Linux signing are not wired into `build_release.sh` — see `docs/WINDOWS_SIGNING.md` for the Windows certificate setup if/when CI returns.

---

## Troubleshooting

**"Tide is damaged and can't be opened"**
Typically an unnotarized dev build. For your own machine: `xattr -cr /Applications/TideCode.app`. For releases, ensure `--skip-notarize` was *not* set during build.

**Notarization hangs**
`APPLE_APP_PASSWORD` must be an app-specific password from <https://appleid.apple.com>, not the main Apple ID password.

**`tauri signer sign` fails: "no private key"**
Pass via `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tidecode.key)"`, not `_PATH`. `build_release.sh` already does this correctly.

**Sidecar crashes silently after install**
Run from terminal to see stderr:
```bash
"/Applications/TideCode.app/Contents/MacOS/tide-desktop"
```

**"Could not detect Developer ID Application identity"**
Set `APPLE_SIGNING_IDENTITY` explicitly in `.env.build`. To list available identities:
```bash
security find-identity -v -p codesigning
```

**Updater says "no update available" but a newer version exists**
- Check `https://pub-<id>.r2.dev/<prefix>/latest.json` returns the new version.
- Check the build was done with `TIDE_UPDATER_URL` exported (otherwise the binary still points at the `YOUR_UPDATE_SERVER` placeholder).
- Pubkey in `tauri.conf.json` must match the private key that signed `.app.tar.gz`.

**Updater signature verification fails**
The `.sig` file emitted by Tauri must be uploaded as part of `latest.json`'s `signature` field — `build_release.sh` step 6 does this automatically by reading the `.sig` next to `.app.tar.gz`. If you're updating the manifest by hand, the signature is the contents of `*.app.tar.gz.sig`.

---

## File reference

**Tracked in git:**

- `DEPLOY.md` (this file)
- `apps/desktop/src-tauri/tauri.conf.json` — bundle config + updater pubkey + `YOUR_UPDATE_SERVER` placeholder
- `apps/desktop/latest.json` — manifest written by `build_release.sh` step 6
- `apps/desktop/src/components/UpdateBanner.tsx` — top-of-window banner UI
- `apps/desktop/src/stores/updaterStore.ts` — state machine + `check()` / `downloadAndInstall()` / `relaunch()` lifecycle
- `docs/WINDOWS_SIGNING.md` — reference for Windows EV/OV cert setup (CI-oriented)

**Local-only (gitignored under `scripts/`):**

- `apps/desktop/scripts/build_sidecar.sh`
- `apps/desktop/scripts/build_release.sh`
- `apps/desktop/scripts/bump-version.sh`
- `apps/desktop/scripts/entitlements.plist`
- `apps/desktop/scripts/.env.build.example` (template)
- `apps/desktop/scripts/RELEASING.md` (operator runbook with concrete paths)
- `apps/desktop/.env.build` (or `.env.build` at repo root)
- `~/.tauri/tidecode.key`
