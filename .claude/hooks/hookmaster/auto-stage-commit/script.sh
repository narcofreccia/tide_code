#!/usr/bin/env bash
# HookMaster — Auto Stage & Commit on Stop
# Event: Stop

set -euo pipefail

# Only proceed if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  exit 0
fi

# Check if there are unstaged changes
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
CHANGED_FILES=$(git diff --name-only | head -5 | tr '\n' ', ' | sed 's/,$//')

git add -A
git commit -m "chore(hookmaster): auto-commit on stop [$TIMESTAMP]

Changed files: $CHANGED_FILES
Branch: $BRANCH" --no-verify 2>/dev/null || true

echo "🔀 HookMaster: Changes auto-committed." >&2
exit 0
