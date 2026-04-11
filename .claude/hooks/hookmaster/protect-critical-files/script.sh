#!/usr/bin/env bash
# HookMaster — Protect Critical Files
# Event: PreToolUse | Matcher: Edit|MultiEdit|Write | Can Block: YES

set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED_PATTERNS=(
  '\.env$'
  '\.env\.'
  'middleware\.ts$'
  'middleware\.js$'
  'auth/'
  'payment/'
  'billing/'
  '\.pem$'
  '\.key$'
  'secrets\.'
  'credentials\.'
  'docker-compose\.prod'
  'Dockerfile\.prod'
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -qE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "🔒 HookMaster: Protected file — manual editing required for: '"$FILE_PATH"'"
      }
    }'
    exit 0
  fi
done

exit 0
