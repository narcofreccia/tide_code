#!/usr/bin/env bash
# HookMaster — Pre-Compaction Transcript Backup
# Event: PreCompact

set -euo pipefail
INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

BACKUP_DIR="${HOME}/.hookmaster/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%s)
cp "$TRANSCRIPT_PATH" "$BACKUP_DIR/transcript-${SESSION_ID}-${TIMESTAMP}.jsonl"

echo "💾 HookMaster: Transcript backed up before compaction." >&2
exit 0
