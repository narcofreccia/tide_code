---
id: secret-scanner
name: "Secret/Key Scanner"
description: "Scans edited files for accidentally committed secrets, API keys, and tokens."
category: security
event: PostToolUse
matcher: "Write|Edit|MultiEdit"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Secret/Key Scanner

Scans edited files for accidentally committed secrets, API keys, and tokens.

## Details

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit|MultiEdit`
- **Can Block**: No
- **Handler Type**: command
- **Category**: security

