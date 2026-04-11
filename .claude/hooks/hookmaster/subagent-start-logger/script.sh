#!/usr/bin/env bash
# HookMaster — Subagent Start Logger
# Event: SubagentStart

set -euo pipefail
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

LOG_DIR="${HOME}/.hookmaster/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"timestamp\":\"$TIMESTAMP\",\"session_id\":\"$SESSION_ID\",\"event\":\"subagent_start\"}" >> "$LOG_DIR/subagents.jsonl"

echo "🤖 HookMaster: Subagent started." >&2
exit 0
