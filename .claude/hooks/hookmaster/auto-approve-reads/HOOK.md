---
id: auto-approve-reads
name: "Auto-Approve Safe Read Operations"
description: "Automatically approves file read, glob, grep, and list operations without prompting."
category: permission
event: PermissionRequest
matcher: "Read|Glob|Grep|LS"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Auto-Approve Safe Read Operations

Automatically approves file read, glob, grep, and list operations without prompting.

## Details

- **Event**: `PermissionRequest`
- **Matcher**: `Read|Glob|Grep|LS`
- **Can Block**: No
- **Handler Type**: command
- **Category**: permission

