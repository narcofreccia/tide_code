#!/usr/bin/env bash
# HookMaster — Type Check After Edit
# Event: PostToolUse | Matcher: Write|Edit|MultiEdit

set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TypeScript files
if echo "$FILE_PATH" | grep -qE '\.(ts|tsx)$'; then
  if [ -f "tsconfig.json" ] && command -v npx &>/dev/null; then
    ERRORS=$(npx tsc --noEmit 2>&1 | head -20)
    if [ -n "$ERRORS" ]; then
      echo "⚠️  HookMaster — TypeScript errors detected:" >&2
      echo "$ERRORS" >&2
    fi
  fi
fi

exit 0
