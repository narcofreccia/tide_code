#!/usr/bin/env bash
# HookMaster — Task Completion Notifier
# Event: Stop

set -euo pipefail

# macOS
if command -v osascript &>/dev/null; then
  osascript -e 'display notification "Claude has finished responding" with title "⚡ HookMaster" sound name "Glass"' 2>/dev/null || true
# Linux with notify-send
elif command -v notify-send &>/dev/null; then
  notify-send "⚡ HookMaster" "Claude has finished responding" --urgency=normal 2>/dev/null || true
fi

exit 0
