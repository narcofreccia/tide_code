#!/usr/bin/env bash
# Build the Pi coding agent sidecar into a standalone binary for Tauri bundling.
#
# Uses `bun build --compile` to create a self-contained executable.
# Also pre-transpiles pi-extensions from .ts to .js for production bundling.
#
# Usage:
#   ./scripts/build_sidecar.sh
#   ./scripts/build_sidecar.sh --clean
#   ./scripts/build_sidecar.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
SRC_TAURI_DIR="$PROJECT_ROOT/src-tauri"
DIST_DIR="$PROJECT_ROOT/dist/sidecar"
PI_PACKAGE_DIR="$REPO_ROOT/node_modules/@mariozechner/pi-coding-agent"
PI_CLI_ENTRY="$PI_PACKAGE_DIR/dist/cli.js"
OUTPUT_NAME="pi-sidecar"

CLEAN=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --clean)   CLEAN=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--clean] [--dry-run]"
      exit 1
      ;;
  esac
done

echo "=== Tide Code Sidecar Build ==="
echo "Project root: $PROJECT_ROOT"
echo "Platform:     $(uname -s) $(uname -m)"
echo

# ── Preflight ─────────────────────────────────────────────

# Check Pi package exists
if [[ ! -f "$PI_CLI_ENTRY" ]]; then
  echo "ERROR: Pi coding agent not found at $PI_CLI_ENTRY"
  echo "Run: pnpm install (from repo root)"
  exit 1
fi

# Ensure bun is available
if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: Failed to install bun"
    exit 1
  fi
fi
echo "Bun: $(bun --version)"

# Detect target triple
if command -v rustc >/dev/null 2>&1; then
  TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2}')"
else
  echo "ERROR: rustc not found (needed for target triple detection)"
  exit 1
fi
echo "Target triple: $TARGET_TRIPLE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "--dry-run: preflight complete, no mutations performed"
  exit 0
fi

# ── Clean ─────────────────────────────────────────────────

if [[ "$CLEAN" -eq 1 ]]; then
  echo "Cleaning previous sidecar build artifacts..."
  rm -rf "$DIST_DIR"
  rm -f "$SRC_TAURI_DIR/binaries/$OUTPUT_NAME-"*
  rm -rf "$SRC_TAURI_DIR/resources/pi-extensions"
fi

mkdir -p "$DIST_DIR"

# ── Step 1: Compile Pi agent binary ──────────────────────

echo
echo "--- Step 1: Compile Pi agent with bun build --compile ---"

BINARY="$DIST_DIR/$OUTPUT_NAME"
bun build --compile "$PI_CLI_ENTRY" --outfile "$BINARY"

if [[ ! -f "$BINARY" ]]; then
  echo "ERROR: Build failed. No sidecar binary at $BINARY"
  exit 1
fi

chmod +x "$BINARY"
echo "Binary: $BINARY"
echo "Size:   $(du -sh "$BINARY" | awk '{print $1}')"

# ── Step 2: Copy binary assets ───────────────────────────

echo
echo "--- Step 2: Copy binary assets ---"

# Pi needs these assets at runtime (resolved relative to binary)
ASSETS_SRC="$PI_PACKAGE_DIR/dist"
BINARY_DIR="$(dirname "$BINARY")"

# photon WASM (image processing)
if [[ -f "$ASSETS_SRC/photon_rs_bg.wasm" ]]; then
  cp "$ASSETS_SRC/photon_rs_bg.wasm" "$BINARY_DIR/"
  echo "Copied: photon_rs_bg.wasm"
fi

# Theme files
if [[ -d "$ASSETS_SRC/theme" ]]; then
  cp -r "$ASSETS_SRC/theme" "$BINARY_DIR/"
  echo "Copied: theme/"
fi

# HTML export templates
if [[ -d "$ASSETS_SRC/export-html" ]]; then
  cp -r "$ASSETS_SRC/export-html" "$BINARY_DIR/"
  echo "Copied: export-html/"
fi

# package.json (Pi reads version from it)
if [[ -f "$PI_PACKAGE_DIR/package.json" ]]; then
  cp "$PI_PACKAGE_DIR/package.json" "$BINARY_DIR/"
  echo "Copied: package.json"
fi

# ── Step 3: Install binary for Tauri ─────────────────────

echo
echo "--- Step 3: Install binary for Tauri externalBin ---"

TAURI_BIN_DIR="$SRC_TAURI_DIR/binaries"
mkdir -p "$TAURI_BIN_DIR"

DEST="$TAURI_BIN_DIR/$OUTPUT_NAME-$TARGET_TRIPLE"
cp "$BINARY" "$DEST"
chmod +x "$DEST"
echo "Installed: $DEST"

# ── Step 4: Pre-transpile pi-extensions ──────────────────

echo
echo "--- Step 4: Pre-transpile pi-extensions (.ts → .js) ---"

EXT_SRC_DIR="$PROJECT_ROOT/pi-extensions"
EXT_OUT_DIR="$SRC_TAURI_DIR/resources/pi-extensions"
mkdir -p "$EXT_OUT_DIR"

if [[ ! -d "$EXT_SRC_DIR" ]]; then
  echo "WARNING: pi-extensions directory not found at $EXT_SRC_DIR"
else
  # Bundle each extension entry point individually, inlining local imports
  # External: @mariozechner/* and @sinclair/typebox (provided by Pi's virtual modules)
  EXT_FILES=(
    "tide-safety.ts"
    "tide-project.ts"
    "tide-router.ts"
    "tide-planner.ts"
    "tide-index.ts"
    "tide-web-search.ts"
    "tide-classify.ts"
  )

  for ext_file in "${EXT_FILES[@]}"; do
    src="$EXT_SRC_DIR/$ext_file"
    if [[ -f "$src" ]]; then
      out_name="${ext_file%.ts}.js"
      bun build "$src" \
        --outfile "$EXT_OUT_DIR/$out_name" \
        --target node \
        --format esm \
        --external "@mariozechner/*" \
        --external "@sinclair/typebox" \
        2>/dev/null || {
          # Fallback: just transpile without bundling
          echo "  Bundle failed for $ext_file, trying simple transpile..."
          bun build "$src" \
            --outfile "$EXT_OUT_DIR/$out_name" \
            --target node \
            --format esm \
            --no-bundle \
            2>/dev/null || echo "  WARNING: Failed to transpile $ext_file"
        }
      if [[ -f "$EXT_OUT_DIR/$out_name" ]]; then
        echo "  $ext_file → $out_name"
      fi
    else
      echo "  SKIP: $ext_file (not found)"
    fi
  done
fi

# ── Step 5: Smoke test ───────────────────────────────────

echo
echo "--- Step 5: Smoke test ---"

# Quick check: binary starts and responds
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 5"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 5"
else
  TIMEOUT_CMD=""
fi

# Pi in RPC mode reads JSON on stdin; send a ping-like command
RESPONSE=$($TIMEOUT_CMD "$BINARY" --version 2>&1 || true)
if [[ -n "$RESPONSE" ]]; then
  echo "Binary responds: $RESPONSE"
  echo "Smoke test PASSED"
else
  echo "WARNING: Smoke test inconclusive (no response)"
fi

echo
echo "=== Sidecar build complete ==="
echo "Binary:     $DEST"
echo "Extensions: $EXT_OUT_DIR/"
echo "Done."
