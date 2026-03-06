#!/usr/bin/env bash
#
# Prepare the Pi sidecar binary for Tauri dev/build.
# Creates binaries/pi-sidecar-{triple} wrapper that points to node_modules Pi.
#
# Usage: ./scripts/prepare-sidecar.sh
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$PROJECT_ROOT/apps/desktop/src-tauri"
BINARIES_DIR="$TAURI_DIR/binaries"

# Detect target triple
ARCH=$(uname -m)
OS=$(uname -s)
case "$OS-$ARCH" in
  Darwin-arm64)  TARGET_TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)  TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64) TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
  *)             echo "✗ Unsupported: $OS-$ARCH"; exit 1 ;;
esac

PI_PKG="$PROJECT_ROOT/node_modules/@mariozechner/pi-coding-agent"
if [ ! -f "$PI_PKG/dist/cli.js" ]; then
  echo "✗ Pi package not installed. Run: pnpm install"
  exit 1
fi

PI_CLI="$(cd "$PI_PKG" && pwd)/dist/cli.js"

mkdir -p "$BINARIES_DIR"

SIDECAR="$BINARIES_DIR/pi-sidecar-${TARGET_TRIPLE}"
cat > "$SIDECAR" <<WRAPPER
#!/usr/bin/env bash
# Pi sidecar wrapper (dev mode) — points to node_modules
exec node "${PI_CLI}" "\$@"
WRAPPER

chmod +x "$SIDECAR"
echo "✓ Created $SIDECAR"
echo "  Points to: $PI_CLI"
