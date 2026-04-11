#!/usr/bin/env bash
# HookMaster — Error Alert on Tool Failure
# Event: PostToolUseFailure

set -euo pipefail
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')

# macOS
if command -v osascript &>/dev/null; then
  osascript -e "display notification \"Tool failed: $TOOL_NAME\" with title \"❌ HookMaster\" sound name \"Basso\"" 2>/dev/null || true
# Linux
elif command -v notify-send &>/dev/null; then
  notify-send "❌ HookMaster" "Tool failed: $TOOL_NAME" --urgency=critical 2>/dev/null || true
fi

exit 0
