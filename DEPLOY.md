# Deploy -- Tide IDE Production Build & Release

This guide covers building, signing, notarizing, and distributing Tide as a macOS `.dmg` with auto-updater support via Cloudflare R2.

## Overview

The release pipeline:

```
prepare-sidecar.sh  ->  build-release.sh  ->  Cloudflare R2
                              |
                              +-- 1. Prepare Pi sidecar binary
                              +-- 2. Bundle Pi dist + extensions as resources
                              +-- 3. Compile Tauri app (pnpm tauri build)
                              +-- 4. Sign with Apple Developer certificate
                              +-- 5. Notarize with Apple (xcrun notarytool)
                              +-- 6. Generate latest.json updater manifest
                              +-- 7. Upload DMG + updater bundle + manifest to R2
```

## Prerequisites

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| Node.js >= 20 | Pi sidecar runtime | `brew install node` |
| pnpm | Package manager | `npm install -g pnpm` |
| Rust (stable) | Tauri backend | `rustup update stable` |
| Xcode CLT | macOS compilation | `xcode-select --install` |
| rclone | R2 upload | `brew install rclone` |

### Apple Signing (required for distribution)

- **Apple Developer account** with an active membership
- **Developer ID Application** certificate installed in Keychain
- **App-specific password** for notarization (generate at [appleid.apple.com](https://appleid.apple.com))

### One-Time Setup

#### 1. Generate Tauri updater keys

The updater uses Ed25519 signing to verify update integrity:

```bash
cd apps/desktop
pnpm tauri signer generate -w ../../.tauri-keys/tide-updater.key
```

This prompts for a password and creates:
- `.tauri-keys/tide-updater.key` (private key -- keep secret)
- The public key is printed to stdout -- it's already configured in `tauri.conf.json`

#### 2. Configure rclone for Cloudflare R2

```bash
rclone config create r2 s3 \
  provider Cloudflare \
  access_key_id YOUR_R2_ACCESS_KEY \
  secret_access_key YOUR_R2_SECRET_KEY \
  endpoint https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

Verify: `rclone ls r2:storage/tidecode/`

#### 3. Create `.env.build`

Create `.env.build` in the project root (gitignored):

```bash
# Apple signing
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
APPLE_ID="your@email.com"
APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
APPLE_NOTARY_TEAM_ID="YOUR_TEAM_ID"

# Tauri updater
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"

# Cloudflare R2
R2_RELEASE_PROFILE="r2"
R2_RELEASE_PUBLIC_URL="https://pub-xxxxx.r2.dev"
R2_RELEASE_ENDPOINT_URL="https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
```

## Building a Release

### Full pipeline (build + sign + notarize + upload)

```bash
./scripts/build-release.sh
```

This runs all 7 steps automatically. Typical time: 5-10 minutes.

### Build only (no upload)

```bash
./scripts/build-release.sh --build-only
```

Useful for testing the build locally. Outputs to `apps/desktop/src-tauri/target/release/bundle/`.

### Upload only (existing build)

```bash
./scripts/build-release.sh --upload-only
```

Re-uploads artifacts from a previous build without rebuilding.

## What the Build Script Does

### Step 1: Prepare Pi Sidecar

Creates `binaries/pi-sidecar-{target-triple}` -- a shell wrapper that:
- Finds `node` on the system
- Resolves the Pi CLI at `../Resources/pi-sidecar/dist/cli.js` (bundled) or falls back to `node_modules` (dev)
- Executes Pi with all forwarded arguments

### Step 2: Bundle Resources

Copies into `src-tauri/resources/`:
- `pi-sidecar/` -- Pi's `dist/`, `node_modules/`, and `package.json`
- `pi-extensions/` -- Transpiled `.ts` -> `.js` via esbuild (or raw `.ts` as fallback since Pi's jiti can transpile at runtime)

### Step 3: Tauri Build

Runs `pnpm tauri build` which:
- Builds the React frontend (`vite build`)
- Compiles the Rust backend in release mode
- Packages into a `.app` bundle, `.dmg` installer, and `.tar.gz` updater archive

### Step 4: Notarize

Submits the DMG to Apple's notarization service and waits for approval. Then staples the ticket to the DMG so it passes Gatekeeper on first launch.

### Step 5: Generate Update Manifest

Creates `latest.json` with the version, signature, and download URL:

```json
{
  "version": "0.1.0",
  "notes": "Tide v0.1.0",
  "pub_date": "2026-03-06T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://pub-xxx.r2.dev/tidecode/v0.1.0/Tide.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://pub-xxx.r2.dev/tidecode/v0.1.0/Tide.app.tar.gz"
    }
  }
}
```

### Step 6: Upload to R2

Uploads to Cloudflare R2:
- `v{VERSION}/Tide_{VERSION}.dmg` -- Installer for new users
- `v{VERSION}/Tide.app.tar.gz` -- Updater bundle for existing users
- `latest.json` -- Updater endpoint (checked by the app on startup)

## Auto-Updater

Tide checks for updates on every launch via the Tauri updater plugin.

### How it works

1. App starts -> `updater.ts` calls `check()` from `@tauri-apps/plugin-updater`
2. Tauri fetches `latest.json` from the R2 endpoint configured in `tauri.conf.json`
3. If a newer version is available, Tauri shows a native dialog
4. User confirms -> downloads `.tar.gz`, verifies Ed25519 signature, replaces app
5. App restarts via `@tauri-apps/plugin-process`

### Configuration

In `tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "...",
      "endpoints": [
        "https://pub-xxx.r2.dev/tidecode/latest.json"
      ]
    }
  }
}
```

The public key must match the private key in `.tauri-keys/tide-updater.key`.

## Version Bumping

Use the version bump script before building a release:

```bash
./scripts/bump-version.sh 0.2.0
```

This updates the version in:
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`

## Build Artifacts

After a successful build, artifacts are at:

```
apps/desktop/src-tauri/target/release/bundle/
  dmg/
    Tide_0.1.0_aarch64.dmg       # Installer
  macos/
    Tide.app.tar.gz               # Updater bundle
    Tide.app.tar.gz.sig           # Ed25519 signature
  latest.json                     # Update manifest (generated by build script)
```

## Troubleshooting

**"Pi package not found"** -- Run `pnpm install` from the project root before building.

**Notarization fails** -- Check that your Apple Developer certificate is valid and the app-specific password is correct. Run `security find-identity -v -p codesigning` to verify your signing identity.

**rclone upload fails** -- Verify your R2 credentials: `rclone ls r2:storage/tidecode/`. Ensure the bucket exists and the API token has write permissions.

**Updater not working in dev** -- The updater silently catches errors in dev mode (no `latest.json` at the endpoint). It only works with a published release.

**Build fails on "resource not found"** -- The build script creates resources in `src-tauri/resources/`. If the directory is empty, re-run the build script from the project root (not from `apps/desktop/`).

**Signature verification fails** -- The public key in `tauri.conf.json` must match the private key used during build. If you regenerated keys, update the `pubkey` field.
