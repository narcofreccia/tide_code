---
id: conflict-watchdog
name: "Hook Conflict Watchdog"
description: "Fires on ConfigChange and checks for conflicting HookMaster hooks (race conditions, missing pairs). Outputs a warning if conflicts are detected."
category: workflow
event: ConfigChange
canBlock: false
handlerType: command
entrypoint: script.cjs
author: seanrobertwright
version: 1.0.0
---

# Hook Conflict Watchdog

A ConfigChange hook that fires whenever your Claude Code settings files change. It reads your installed HookMaster hooks and checks for known race conditions and missing paired hooks.

When conflicts are found, it outputs a warning that Claude reads. The `hookmaster-conflict-reviewer` skill then guides Claude to propose the fix and ask for your confirmation before making any changes.

## What it checks

- **Race conditions**: hooks that write to the same file in parallel (e.g., auto-format + auto-lint)
- **Missing pairs**: hooks that should always be installed together (e.g., time-tracker + time-tracker-end)

## Details

- **Event**: `ConfigChange`
- **Handler**: Node.js (requires Node.js >= 18)
