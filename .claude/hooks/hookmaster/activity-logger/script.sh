#!/usr/bin/env bash
# HookMaster — Tool Activity Logger
# Event: PreToolUse (all tools)

set -euo pipefail
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}' | head -c 200)

LOG_DIR="${HOME}/.hookmaster/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"timestamp\":\"$TIMESTAMP\",\"session_id\":\"$SESSION_ID\",\"tool\":\"$TOOL_NAME\",\"input\":\"$(echo "$TOOL_INPUT" | jq -Rsa .)\"}" >> "$LOG_DIR/activity.jsonl"

exit 0
