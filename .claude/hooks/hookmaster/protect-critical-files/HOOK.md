---
id: protect-critical-files
name: "Protect Critical Files"
description: "Prevents editing of .env, auth modules, middleware, payment logic, and other sensitive files."
category: security
event: PreToolUse
matcher: "Edit|MultiEdit|Write"
canBlock: true
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Protect Critical Files

Prevents editing of .env, auth modules, middleware, payment logic, and other sensitive files.

## Details

- **Event**: `PreToolUse`
- **Matcher**: `Edit|MultiEdit|Write`
- **Can Block**: Yes ⛔
- **Handler Type**: command
- **Category**: security

