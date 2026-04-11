#!/usr/bin/env bash
# HookMaster — Changelog Entry Generator
# Event: Stop

set -euo pipefail

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  exit 0
fi

# Only proceed if there are uncommitted changes
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

CHANGELOG="CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
  exit 0
fi

DATE=$(date +"%Y-%m-%d")
FILES_CHANGED=$(git diff --name-only 2>/dev/null | head -10 | tr '\n' ', ' | sed 's/,$//')

# Prepend entry (after the first heading)
ENTRY="- [$DATE] Modified: $FILES_CHANGED"

echo "📝 HookMaster: Suggested changelog entry:" >&2
echo "  $ENTRY" >&2

exit 0
