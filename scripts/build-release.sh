#!/usr/bin/env bash
#
# Tide IDE — Production Build, Sign, Notarize & Upload
#
# Prerequisites:
#   1. Source .env.build:  source .env.build
#   2. Generate updater keys (one-time):
#        cd apps/desktop && pnpm tauri signer generate -w ../../.tauri-keys/tide-updater.key
#   3. Install rclone:  brew install rclone
#   4. Configure rclone r2 profile with R2 credentials
#
# Usage:
#   ./scripts/build-release.sh              # Full build + sign + notarize + upload
#   ./scripts/build-release.sh --build-only # Just build (no upload)
#   ./scripts/build-release.sh --upload-only # Upload existing artifacts
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$PROJECT_ROOT/apps/desktop/src-tauri"

# ── Load env ───────────────────────────────────────────────
if [ -f "$PROJECT_ROOT/.env.build" ]; then
  source "$PROJECT_ROOT/.env.build"
  echo "✓ Loaded .env.build"
else
  echo "✗ .env.build not found — run from project root"
  exit 1
fi

# ── Detect target triple ───────────────────────────────────
ARCH=$(uname -m)
OS=$(uname -s)
case "$OS-$ARCH" in
  Darwin-arm64)  TARGET_TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)  TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64) TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
  *)             echo "✗ Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac
echo "Target: $TARGET_TRIPLE"

# ── Parse args ─────────────────────────────────────────────
BUILD=true
UPLOAD=true
for arg in "$@"; do
  case "$arg" in
    --build-only)  UPLOAD=false ;;
    --upload-only) BUILD=false ;;
  esac
done

# ── Read version ───────────────────────────────────────────
VERSION=$(python3 -c "import json; print(json.load(open('$TAURI_DIR/tauri.conf.json'))['version'])")
echo "Building Tide v${VERSION}"

if $BUILD; then
  # ── Step 1: Prepare Pi sidecar binary ───────────────────
  echo ""
  echo "── Preparing Pi sidecar (externalBin) ──────────────"

  BINARIES_DIR="$TAURI_DIR/binaries"
  mkdir -p "$BINARIES_DIR"

  PI_PKG="$PROJECT_ROOT/node_modules/@mariozechner/pi-coding-agent"
  if [ ! -f "$PI_PKG/dist/cli.js" ]; then
    echo "✗ Pi package not found. Run: pnpm install"
    exit 1
  fi

  PI_CLI_PATH=$(cd "$PI_PKG" && pwd)/dist/cli.js

  # Create a wrapper shell script that acts as the sidecar binary.
  # It invokes Node.js with the bundled Pi CLI, forwarding all arguments.
  SIDECAR="$BINARIES_DIR/pi-sidecar-${TARGET_TRIPLE}"
  cat > "$SIDECAR" <<WRAPPER
#!/usr/bin/env bash
# Pi sidecar wrapper — invoked by Tide as an externalBin
# Resolves node and runs the Pi CLI with all forwarded arguments.

# Find node: prefer bundled, then system
if command -v node &>/dev/null; then
  NODE=node
else
  echo "Error: Node.js not found. Install Node.js 20+ to use Tide." >&2
  exit 1
fi

# Resolve the Pi CLI relative to this wrapper script
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

# In the Tauri bundle, Pi's dist/ is in ../Resources/pi-sidecar/dist/
PI_CLI="\$SCRIPT_DIR/../Resources/pi-sidecar/dist/cli.js"

if [ ! -f "\$PI_CLI" ]; then
  # Fallback: check if Pi is in node_modules (dev mode — sidecar invoked directly)
  PI_CLI="${PI_CLI_PATH}"
fi

if [ ! -f "\$PI_CLI" ]; then
  echo "Error: Pi CLI not found at \$PI_CLI" >&2
  exit 1
fi

exec "\$NODE" "\$PI_CLI" "\$@"
WRAPPER

  chmod +x "$SIDECAR"
  echo "  ✓ Sidecar wrapper: $SIDECAR"

  # ── Step 2: Prepare bundled resources ─────────────────────
  echo ""
  echo "── Preparing bundled resources ─────────────────────"

  # Pi sidecar dist (bundled into Resources/pi-sidecar/)
  RESOURCES="$TAURI_DIR/resources"
  rm -rf "$RESOURCES/pi-sidecar"
  mkdir -p "$RESOURCES/pi-sidecar"

  cp -R "$PI_PKG/dist" "$RESOURCES/pi-sidecar/dist"
  if [ -d "$PI_PKG/node_modules" ]; then
    cp -R "$PI_PKG/node_modules" "$RESOURCES/pi-sidecar/node_modules"
  fi
  cp "$PI_PKG/package.json" "$RESOURCES/pi-sidecar/package.json"
  echo "  ✓ Pi dist: $(du -sh "$RESOURCES/pi-sidecar" | cut -f1)"

  # Pi extensions (transpiled .ts → .js for production)
  rm -rf "$RESOURCES/pi-extensions"
  mkdir -p "$RESOURCES/pi-extensions"

  EXT_DIR="$PROJECT_ROOT/apps/desktop/pi-extensions"
  if [ -d "$EXT_DIR" ]; then
    # Use esbuild to transpile TS → JS (Pi uses jiti in dev, but bundled should be JS)
    if command -v npx &>/dev/null; then
      for ts_file in "$EXT_DIR"/*.ts; do
        base=$(basename "$ts_file" .ts)
        npx esbuild "$ts_file" \
          --outfile="$RESOURCES/pi-extensions/${base}.js" \
          --format=esm \
          --platform=node \
          --target=node20 \
          --bundle \
          --external:@mariozechner/pi-coding-agent \
          --external:@sinclair/typebox \
          --external:better-sqlite3 \
          2>/dev/null || {
            # Fallback: just copy .ts files (Pi's jiti will transpile at runtime)
            cp "$ts_file" "$RESOURCES/pi-extensions/"
          }
      done
      echo "  ✓ Extensions: $(ls "$RESOURCES/pi-extensions/" | wc -l | tr -d ' ') files"
    else
      cp "$EXT_DIR"/*.ts "$RESOURCES/pi-extensions/"
      echo "  ✓ Extensions (raw .ts): $(ls "$RESOURCES/pi-extensions/" | wc -l | tr -d ' ') files"
    fi
  fi

  # ── Step 3: Build Tauri app ───────────────────────────────
  echo ""
  echo "── Building Tauri app ───────────────────────────────"

  cd "$PROJECT_ROOT/apps/desktop"

  # Updater signing key
  UPDATER_KEY="$PROJECT_ROOT/.tauri-keys/tide-updater.key"
  if [ -f "$UPDATER_KEY" ]; then
    export TAURI_SIGNING_PRIVATE_KEY=$(cat "$UPDATER_KEY")
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
    echo "  ✓ Updater signing key loaded"
  else
    echo "  ⚠ No updater key — updater artifacts won't be signed"
  fi

  # Apple signing (from .env.build)
  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

  pnpm tauri build 2>&1 | tee "$PROJECT_ROOT/build.log"

  echo ""
  echo "  ✓ Build complete"

  # ── Step 4: Notarize ────────────────────────────────────
  echo ""
  echo "── Notarizing ───────────────────────────────────────"

  BUNDLE_DIR="$TAURI_DIR/target/release/bundle"
  DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)

  if [ -n "$DMG" ] && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
    echo "  Submitting $(basename "$DMG") for notarization..."
    xcrun notarytool submit "$DMG" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_APP_PASSWORD" \
      --team-id "$APPLE_NOTARY_TEAM_ID" \
      --wait 2>&1 | tee -a "$PROJECT_ROOT/build.log"

    echo "  Stapling..."
    xcrun stapler staple "$DMG" 2>&1 || true
    echo "  ✓ Notarization complete"
  else
    echo "  ⚠ Skipping notarization (missing DMG or Apple credentials)"
  fi

  # ── Step 5: Generate update manifest ──────────────────────
  echo ""
  echo "── Generating update manifest (latest.json) ────────"

  UPDATER_BUNDLE=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz" 2>/dev/null | head -1)
  UPDATER_SIG=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz.sig" 2>/dev/null | head -1)

  if [ -n "$UPDATER_BUNDLE" ] && [ -n "$UPDATER_SIG" ]; then
    SIG_CONTENT=$(cat "$UPDATER_SIG")
    ARTIFACT_URL="${R2_RELEASE_PUBLIC_URL}/v${VERSION}/Tide.app.tar.gz"

    cat > "$BUNDLE_DIR/latest.json" <<MANIFEST
{
  "version": "${VERSION}",
  "notes": "Tide v${VERSION}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIG_CONTENT}",
      "url": "${ARTIFACT_URL}"
    },
    "darwin-x86_64": {
      "signature": "${SIG_CONTENT}",
      "url": "${ARTIFACT_URL}"
    }
  }
}
MANIFEST
    echo "  ✓ latest.json generated"
  else
    echo "  ⚠ Updater bundle not found — skipping manifest"
  fi
fi

# ── Step 6: Upload to R2 ─────────────────────────────────
if $UPLOAD; then
  echo ""
  echo "── Uploading to Cloudflare R2 ──────────────────────"

  BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

  # Ensure rclone r2 profile exists
  if ! rclone listremotes 2>/dev/null | grep -q "^${R2_RELEASE_PROFILE:-r2}:"; then
    echo "  ⚠ rclone remote '${R2_RELEASE_PROFILE:-r2}' not configured."
    echo "  Run: rclone config create ${R2_RELEASE_PROFILE:-r2} s3 provider Cloudflare endpoint $R2_RELEASE_ENDPOINT_URL"
    exit 1
  fi

  R2_REMOTE="${R2_RELEASE_PROFILE:-r2}"
  R2_BUCKET="storage/tidecode"

  DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)
  UPDATER_BUNDLE=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz" 2>/dev/null | head -1)
  MANIFEST="$BUNDLE_DIR/latest.json"

  if [ -n "$DMG" ]; then
    echo "  Uploading DMG..."
    rclone copyto "$DMG" "${R2_REMOTE}:${R2_BUCKET}/v${VERSION}/Tide_${VERSION}.dmg" --progress
  fi

  if [ -n "$UPDATER_BUNDLE" ]; then
    echo "  Uploading updater bundle..."
    rclone copyto "$UPDATER_BUNDLE" "${R2_REMOTE}:${R2_BUCKET}/v${VERSION}/Tide.app.tar.gz" --progress
  fi

  if [ -f "$MANIFEST" ]; then
    echo "  Uploading latest.json (updater endpoint)..."
    rclone copyto "$MANIFEST" "${R2_REMOTE}:${R2_BUCKET}/latest.json" --progress
  fi

  echo ""
  echo "  ✓ Upload complete"
  echo "  DMG:     ${R2_RELEASE_PUBLIC_URL}/v${VERSION}/Tide_${VERSION}.dmg"
  echo "  Updater: ${R2_RELEASE_PUBLIC_URL}/latest.json"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Tide v${VERSION} release complete!"
echo "═══════════════════════════════════════════════════════"
