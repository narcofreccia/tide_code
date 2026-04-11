#!/usr/bin/env bash
# HookMaster — Docker Safety Guard
# Event: PreToolUse | Matcher: Bash | Can Block: YES

set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if ! echo "$COMMAND" | grep -qE '^\s*docker'; then
  exit 0
fi

BLOCKED_PATTERNS=(
  '--privileged'
  '--network[= ]host'
  '-v /:/\|--volume /:/\|-v /etc\|--volume /etc'
  'system prune -a'
  'docker rm -f \$\(docker ps'
  'docker rmi.*--force'
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "🔒 HookMaster: Dangerous Docker command blocked — pattern: '"$pattern"'"
      }
    }'
    exit 0
  fi
done

exit 0
