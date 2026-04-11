#!/usr/bin/env bash
# HookMaster — Format + Lint (Sequential Combo)
# Replaces: auto-format + auto-lint
# Event: PostToolUse | Matcher: Write|Edit|MultiEdit

set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# ── Step 1: Format ─────────────────────────────────────────────
if command -v npx &>/dev/null && { [ -f "node_modules/.bin/prettier" ] || npx prettier --version &>/dev/null 2>&1; }; then
  npx prettier --write "$FILE_PATH" 2>/dev/null || true
elif echo "$FILE_PATH" | grep -qE '\.(py)$' && command -v black &>/dev/null; then
  black --quiet "$FILE_PATH" 2>/dev/null || true
elif echo "$FILE_PATH" | grep -qE '\.(rs)$' && command -v rustfmt &>/dev/null; then
  rustfmt "$FILE_PATH" 2>/dev/null || true
elif echo "$FILE_PATH" | grep -qE '\.(go)$' && command -v gofmt &>/dev/null; then
  gofmt -w "$FILE_PATH" 2>/dev/null || true
fi

# ── Step 2: Lint + fix (after format) ─────────────────────────
if echo "$FILE_PATH" | grep -qE '\.(js|jsx|ts|tsx|mjs|cjs)$'; then
  if command -v npx &>/dev/null; then
    npx eslint --fix "$FILE_PATH" 2>/dev/null || true
  fi
fi

if echo "$FILE_PATH" | grep -qE '\.(py)$'; then
  if command -v ruff &>/dev/null; then
    ruff check --fix "$FILE_PATH" 2>/dev/null || true
  elif command -v flake8 &>/dev/null; then
    flake8 "$FILE_PATH" 2>/dev/null || true
  fi
fi

exit 0
