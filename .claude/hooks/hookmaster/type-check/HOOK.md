---
id: type-check
name: "Type Check After Edit"
description: "Runs TypeScript type checker (tsc --noEmit) after edits to catch type errors instantly."
category: quality
event: PostToolUse
matcher: "Write|Edit|MultiEdit"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Type Check After Edit

Runs TypeScript type checker (tsc --noEmit) after edits to catch type errors instantly.

## Details

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit|MultiEdit`
- **Can Block**: No
- **Handler Type**: command
- **Category**: quality

