#!/usr/bin/env bash
# Tide Code release pipeline (macOS-focused).
#
# Features:
# - preflight validation
# - sidecar build (Pi agent)
# - Tauri release build
# - updater signature/url extraction
# - latest.json update
# - optional codesigning + notarization + staple
# - optional R2 upload
# - git tag
#
# Usage:
#   ./scripts/build_release.sh
#   ./scripts/build_release.sh --dry-run
#   ./scripts/build_release.sh --skip-notarize --skip-upload

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/../.." && pwd)"
TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"
LATEST_JSON="$PROJECT_ROOT/latest.json"
SRC_TAURI_DIR="$PROJECT_ROOT/src-tauri"
BUNDLE_MACOS_DIR="$SRC_TAURI_DIR/target/release/bundle/macos"

# Load release-time secrets/config from .env.build (check both locations)
for env_file in "$REPO_ROOT/.env.build" "$PROJECT_ROOT/.env.build"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    break
  fi
done

# Accept legacy Apple env names as fallbacks
export APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:-${APPLE_PASSWORD:-}}"
export APPLE_NOTARY_TEAM_ID="${APPLE_NOTARY_TEAM_ID:-${APPLE_TEAM_ID:-}}"
export APPLE_PASSWORD="${APPLE_PASSWORD:-${APPLE_APP_PASSWORD:-}}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-${APPLE_NOTARY_TEAM_ID:-}}"

# Tauri updater signing key
TAURI_KEY_FILE="$HOME/.tauri/tidecode.key"
if [[ -f "$TAURI_KEY_FILE" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_KEY_FILE")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-tidecode}"
else
  echo "WARNING: Tauri signing key not found at $TAURI_KEY_FILE"
  echo "         Run: npx @tauri-apps/cli signer generate -w $TAURI_KEY_FILE"
fi

DRY_RUN=0
MANIFEST_ONLY=0
SKIP_NOTARIZE=0
SKIP_UPLOAD=0
SKIP_SIDECAR=0
PLATFORM="darwin-aarch64"
SIGNATURE="${UPDATER_SIGNATURE:-}"
URL="${UPDATER_URL:-}"

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --dry-run              Validate setup and print actions, do not mutate.
  --manifest-only        Only update latest.json.
  --skip-notarize        Skip notarization/stapling steps.
  --skip-upload          Skip R2 upload step.
  --skip-sidecar         Skip sidecar build (use existing binary).
  --platform <key>       Updater platform key (default: darwin-aarch64).
  --signature <value>    Force signature value in latest.json.
  --url <value>          Force artifact URL value in latest.json.
  -h, --help             Show this help.
EOF
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1"
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1;        shift ;;
    --manifest-only)  MANIFEST_ONLY=1;  shift ;;
    --skip-notarize)  SKIP_NOTARIZE=1;  shift ;;
    --skip-upload)    SKIP_UPLOAD=1;    shift ;;
    --skip-sidecar)   SKIP_SIDECAR=1;   shift ;;
    --platform)       PLATFORM="$2";    shift 2 ;;
    --signature)      SIGNATURE="$2";   shift 2 ;;
    --url)            URL="$2";         shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *)                echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

[[ -f "$TAURI_CONF" ]] || { echo "ERROR: Missing tauri config: $TAURI_CONF"; exit 1; }
[[ -f "$LATEST_JSON" ]] || { echo "ERROR: Missing latest.json: $LATEST_JSON"; exit 1; }

need_cmd python3

VERSION="$(python3 - <<PY
import json
from pathlib import Path
conf = json.loads(Path(r"$TAURI_CONF").read_text(encoding="utf-8"))
print(conf.get("version", ""))
PY
)"

[[ -n "$VERSION" ]] || { echo "ERROR: Could not read app version from tauri.conf.json"; exit 1; }

PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "=== Tide Code Release Pipeline ==="
echo "Version:          $VERSION"
echo "Platform key:     $PLATFORM"
echo "latest.json:      $LATEST_JSON"
echo "manifest-only:    $MANIFEST_ONLY"
echo "skip-notarize:    $SKIP_NOTARIZE"
echo "skip-upload:      $SKIP_UPLOAD"
echo "skip-sidecar:     $SKIP_SIDECAR"

# Version validation: warn if remote latest.json already has this version
if [[ -n "${R2_RELEASE_PUBLIC_URL:-}" && "$MANIFEST_ONLY" -eq 0 ]]; then
  REMOTE_LATEST="${R2_RELEASE_PUBLIC_URL%/}/latest.json"
  REMOTE_VERSION="$(curl -sf "$REMOTE_LATEST" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)"
  if [[ -n "$REMOTE_VERSION" && "$REMOTE_VERSION" == "$VERSION" ]]; then
    echo "WARNING: Remote latest.json already has version $VERSION."
    echo "         Did you forget to bump the version in tauri.conf.json?"
    echo ""
  fi
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "--dry-run: preflight complete, no mutations performed"
  exit 0
fi

if [[ "$MANIFEST_ONLY" -eq 0 ]]; then
  # ── Step 1: Build sidecar ────────────────────────────────

  if [[ "$SKIP_SIDECAR" -eq 0 ]]; then
    echo ""
    echo "--- Step 1: Build sidecar (Pi agent) ---"
    "$SCRIPT_DIR/build_sidecar.sh" --clean
  else
    echo ""
    echo "--- Step 1: Skipping sidecar build (--skip-sidecar) ---"
  fi

  # ── Step 2: Build shared package ─────────────────────────

  echo ""
  echo "--- Step 2: Build shared package ---"
  need_cmd pnpm
  cd "$REPO_ROOT"
  pnpm --filter @tide/shared build

  # ── Step 3: Tauri release build ──────────────────────────

  echo ""
  echo "--- Step 3: Build app (tauri build) ---"
  cd "$PROJECT_ROOT"
  pnpm tauri build

  APP_TAR_GZ="$(ls -t "$BUNDLE_MACOS_DIR"/*.app.tar.gz 2>/dev/null | head -n1 || true)"
  APP_SIG="${APP_TAR_GZ}.sig"

  if [[ -z "$APP_TAR_GZ" || ! -f "$APP_TAR_GZ" ]]; then
    echo "ERROR: Could not locate updater archive (*.app.tar.gz) in $BUNDLE_MACOS_DIR"
    exit 1
  fi
  if [[ ! -f "$APP_SIG" ]]; then
    echo "ERROR: Missing updater signature file: $APP_SIG"
    exit 1
  fi

  if [[ -z "$SIGNATURE" ]]; then
    SIGNATURE="$(tr -d '\r\n' < "$APP_SIG")"
  fi

  if [[ -z "$URL" && -n "${R2_RELEASE_PUBLIC_URL:-}" ]]; then
    URL="${R2_RELEASE_PUBLIC_URL%/}/$(basename "$APP_TAR_GZ")"
  fi

  APP_BUNDLE="$(ls -td "$BUNDLE_MACOS_DIR"/*.app 2>/dev/null | head -n1 || true)"

  # ── Step 4: Codesign + Notarization ────────────────────

  if [[ "$SKIP_NOTARIZE" -eq 0 ]]; then
    echo ""
    echo "--- Step 4: Codesign + Notarization ---"
    if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" && -n "${APPLE_NOTARY_TEAM_ID:-}" ]]; then
      need_cmd xcrun
      need_cmd codesign

      SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
      if [[ -z "$SIGNING_IDENTITY" ]]; then
        SIGNING_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p' | head -n1 || true)"
      fi
      if [[ -z "$SIGNING_IDENTITY" ]]; then
        echo "ERROR: Could not detect Developer ID Application identity. Set APPLE_SIGNING_IDENTITY in .env.build"
        exit 1
      fi

      if [[ -z "$APP_BUNDLE" || ! -d "$APP_BUNDLE" ]]; then
        echo "ERROR: .app bundle not found in $BUNDLE_MACOS_DIR"
        exit 1
      fi

      ENTITLEMENTS_PATH="${CODESIGN_ENTITLEMENTS_PATH:-$SCRIPT_DIR/entitlements.plist}"

      echo "Signing app binaries with Developer ID..."
      for bin in "$APP_BUNDLE"/Contents/MacOS/*; do
        [[ -f "$bin" ]] || continue
        if [[ -f "$ENTITLEMENTS_PATH" ]]; then
          codesign --force --sign "$SIGNING_IDENTITY" \
            --options runtime \
            --entitlements "$ENTITLEMENTS_PATH" \
            "$bin"
        else
          codesign --force --sign "$SIGNING_IDENTITY" --options runtime "$bin"
        fi
      done

      echo "Signing .app bundle..."
      if [[ -f "$ENTITLEMENTS_PATH" ]]; then
        codesign --force --sign "$SIGNING_IDENTITY" \
          --options runtime \
          --entitlements "$ENTITLEMENTS_PATH" \
          "$APP_BUNDLE"
      else
        echo "WARNING: entitlements not found at $ENTITLEMENTS_PATH; signing without entitlements"
        codesign --force --sign "$SIGNING_IDENTITY" --options runtime "$APP_BUNDLE"
      fi

      codesign --verify --deep --strict "$APP_BUNDLE"

      DMG_DIR="$SRC_TAURI_DIR/target/release/bundle/dmg"
      DMG_PATH="$(ls -t "$DMG_DIR"/*.dmg 2>/dev/null | head -n1 || true)"
      if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
        echo "Submitting DMG for notarization..."
        xcrun notarytool submit "$DMG_PATH" \
          --apple-id "$APPLE_ID" \
          --password "$APPLE_APP_PASSWORD" \
          --team-id "$APPLE_NOTARY_TEAM_ID" \
          --wait
        xcrun stapler staple "$DMG_PATH"
      else
        echo "WARNING: .dmg not found in $DMG_DIR; skipping notarization"
      fi
    else
      echo "Skipping notarization: APPLE_ID / APPLE_APP_PASSWORD / APPLE_NOTARY_TEAM_ID not fully set"
    fi
  fi

  # ── Step 5: Upload to R2 ──────────────────────────────

  if [[ "$SKIP_UPLOAD" -eq 0 ]]; then
    echo ""
    echo "--- Step 5: Upload artifacts to R2 ---"
    if [[ -n "${R2_RELEASE_ENDPOINT_URL:-}" && -n "${R2_RELEASE_BUCKET:-}" ]]; then
      need_cmd aws
      PROFILE_ARGS=()
      if [[ -n "${R2_RELEASE_PROFILE:-}" ]]; then
        PROFILE_ARGS=(--profile "$R2_RELEASE_PROFILE")
      fi

      aws s3 cp "$APP_TAR_GZ" "$R2_RELEASE_BUCKET/$(basename "$APP_TAR_GZ")" \
        --endpoint-url "$R2_RELEASE_ENDPOINT_URL" "${PROFILE_ARGS[@]}"

      DMG_DIR="$SRC_TAURI_DIR/target/release/bundle/dmg"
      DMG_PATH="$(ls -t "$DMG_DIR"/*.dmg 2>/dev/null | head -n1 || true)"
      if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
        aws s3 cp "$DMG_PATH" "$R2_RELEASE_BUCKET/$(basename "$DMG_PATH")" \
          --endpoint-url "$R2_RELEASE_ENDPOINT_URL" "${PROFILE_ARGS[@]}"
      else
        echo "WARNING: .dmg not found; skipping DMG upload"
      fi
    else
      echo "Skipping upload: R2_RELEASE_ENDPOINT_URL / R2_RELEASE_BUCKET not set"
    fi
  fi
fi

# ── Step 6: Update latest.json ─────────────────────────

echo ""
echo "--- Step 6: Update latest.json ---"
python3 - <<PY
import json
from pathlib import Path

latest_path = Path(r"$LATEST_JSON")
platform = "$PLATFORM"
version = "$VERSION"
pub_date = "$PUB_DATE"
signature = "$SIGNATURE"
url = "$URL"

data = json.loads(latest_path.read_text(encoding="utf-8"))
platforms = data.get("platforms")
if not isinstance(platforms, dict):
    platforms = {}

entry = platforms.get(platform)
if not isinstance(entry, dict):
    entry = {"signature": "", "url": ""}

if signature:
    entry["signature"] = signature
if url:
    entry["url"] = url

platforms[platform] = entry
data["version"] = version
data["notes"] = f"v{version}"
data["pub_date"] = pub_date
data["platforms"] = platforms

latest_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

# ── Step 7: Upload latest.json ─────────────────────────

if [[ "$SKIP_UPLOAD" -eq 0 && -n "${R2_RELEASE_ENDPOINT_URL:-}" && -n "${R2_RELEASE_BUCKET:-}" ]]; then
  echo ""
  echo "--- Step 7: Upload latest.json to R2 ---"
  need_cmd aws
  PROFILE_ARGS=()
  if [[ -n "${R2_RELEASE_PROFILE:-}" ]]; then
    PROFILE_ARGS=(--profile "$R2_RELEASE_PROFILE")
  fi
  aws s3 cp "$LATEST_JSON" "$R2_RELEASE_BUCKET/latest.json" \
    --endpoint-url "$R2_RELEASE_ENDPOINT_URL" "${PROFILE_ARGS[@]}"
fi

# ── Step 8: Git tag ────────────────────────────────────

TAG_NAME="v$VERSION"
if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo ""
  echo "WARNING: Git tag $TAG_NAME already exists, skipping tag creation."
else
  git tag -a "$TAG_NAME" -m "Release $TAG_NAME"
  echo ""
  echo "Created git tag: $TAG_NAME"
fi

echo ""
echo "=== Release pipeline completed ==="
echo "Version: $VERSION"
echo "Done."
