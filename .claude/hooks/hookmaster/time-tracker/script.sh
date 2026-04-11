#!/usr/bin/env bash
# HookMaster — Session Time Tracker (Start)
# Event: SessionStart

set -euo pipefail
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

TIMER_DIR="${HOME}/.hookmaster/timers"
mkdir -p "$TIMER_DIR"

date +%s > "$TIMER_DIR/$SESSION_ID.start"
echo "⏱️  HookMaster: Timer started for session $SESSION_ID"
exit 0
