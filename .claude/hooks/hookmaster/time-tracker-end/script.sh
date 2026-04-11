#!/usr/bin/env bash
# HookMaster — Session Time Reporter (End)
# Event: SessionEnd

set -euo pipefail
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

TIMER_DIR="${HOME}/.hookmaster/timers"
LOG_DIR="${HOME}/.hookmaster/logs"
mkdir -p "$LOG_DIR"

START_FILE="$TIMER_DIR/$SESSION_ID.start"
if [ ! -f "$START_FILE" ]; then
  exit 0
fi

START_TS=$(cat "$START_FILE")
END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"timestamp\":\"$TIMESTAMP\",\"session_id\":\"$SESSION_ID\",\"duration_seconds\":$DURATION}" >> "$LOG_DIR/time-tracking.jsonl"

rm -f "$START_FILE"
echo "⏱️  HookMaster: Session lasted ${MINUTES}m ${SECONDS}s" >&2
exit 0
