#!/usr/bin/env bash
#
# Bump Tide version across all config files.
# Usage: ./scripts/bump-version.sh 0.2.0
#
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

NEW_VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Bumping to v${NEW_VERSION}..."

# tauri.conf.json
python3 -c "
import json
p = '$ROOT/apps/desktop/src-tauri/tauri.conf.json'
with open(p) as f: d = json.load(f)
d['version'] = '$NEW_VERSION'
with open(p, 'w') as f: json.dump(d, f, indent=2); f.write('\n')
"
echo "  ✓ tauri.conf.json"

# Desktop package.json
python3 -c "
import json
p = '$ROOT/apps/desktop/package.json'
with open(p) as f: d = json.load(f)
d['version'] = '$NEW_VERSION'
with open(p, 'w') as f: json.dump(d, f, indent=2); f.write('\n')
"
echo "  ✓ apps/desktop/package.json"

# Root package.json
python3 -c "
import json
p = '$ROOT/package.json'
with open(p) as f: d = json.load(f)
d['version'] = '$NEW_VERSION'
with open(p, 'w') as f: json.dump(d, f, indent=2); f.write('\n')
"
echo "  ✓ package.json"

# Cargo.toml
sed -i '' "s/^version = \"[0-9.]*\"/version = \"${NEW_VERSION}\"/" "$ROOT/apps/desktop/src-tauri/Cargo.toml"
echo "  ✓ Cargo.toml"

echo ""
echo "Version bumped to v${NEW_VERSION}"
echo "Don't forget to commit and tag: git tag v${NEW_VERSION}"
