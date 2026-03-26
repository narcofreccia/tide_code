#!/usr/bin/env bash
# HookMaster — Secret Scanner
# Event: PostToolUse | Matcher: Write|Edit|MultiEdit

set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Skip binary and non-text files
if file "$FILE_PATH" | grep -q 'binary'; then
  exit 0
fi

SECRET_PATTERNS=(
  'AKIA[0-9A-Z]{16}'                    # AWS Access Key
  'sk-[a-zA-Z0-9]{32,}'                 # OpenAI / Stripe secret key
  'ghp_[a-zA-Z0-9]{36}'                 # GitHub personal access token
  'glpat-[a-zA-Z0-9\-]{20,}'           # GitLab token
  'xoxb-[0-9]{10,}-[a-zA-Z0-9]{24}'     # Slack bot token
  'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.' # JWT tokens
  'PRIVATE KEY-----'                     # Private keys
  'password\s*[:=]\s*["'][^"']{8,}'  # Hardcoded passwords
)

FOUND=0
for pattern in "${SECRET_PATTERNS[@]}"; do
  if grep -qE "$pattern" "$FILE_PATH" 2>/dev/null; then
    FOUND=1
    echo "⚠️  HookMaster: Potential secret detected in $FILE_PATH (pattern: $pattern)" >&2
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo "🔒 HookMaster: Review the file for leaked secrets before committing." >&2
fi

exit 0
