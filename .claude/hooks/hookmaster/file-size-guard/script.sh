#!/usr/bin/env bash
# HookMaster — File Size Guard
# Event: PostToolUse | Matcher: Write|Edit|MultiEdit

set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null || echo "0")
BYTE_SIZE=$(wc -c < "$FILE_PATH" 2>/dev/null || echo "0")

if [ "$LINE_COUNT" -gt 500 ]; then
  echo "⚠️  HookMaster: $FILE_PATH has $LINE_COUNT lines — consider splitting into smaller modules." >&2
fi

if [ "$BYTE_SIZE" -gt 20480 ]; then
  KB=$((BYTE_SIZE / 1024))
  echo "⚠️  HookMaster: $FILE_PATH is ${KB}KB — large files are harder to maintain." >&2
fi

exit 0
