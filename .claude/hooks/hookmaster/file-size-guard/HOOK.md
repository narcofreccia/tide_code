---
id: file-size-guard
name: "File Size Guard"
description: "Warns when a file exceeds 500 lines or 20KB — a signal it may need refactoring."
category: quality
event: PostToolUse
matcher: "Write|Edit|MultiEdit"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# File Size Guard

Warns when a file exceeds 500 lines or 20KB — a signal it may need refactoring.

## Details

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit|MultiEdit`
- **Can Block**: No
- **Handler Type**: command
- **Category**: quality

