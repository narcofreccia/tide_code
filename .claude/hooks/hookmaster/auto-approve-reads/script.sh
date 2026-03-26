#!/usr/bin/env bash
# HookMaster — Auto-Approve Safe Read Operations
# Event: PermissionRequest | Matcher: Read|Glob|Grep|LS

set -euo pipefail

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: {
      behavior: "allow"
    }
  }
}'
exit 0
