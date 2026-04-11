---
id: activity-logger
name: "Tool Activity Logger"
description: "Logs every tool call (name, input summary) for observability and debugging."
category: workflow
event: PreToolUse
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Tool Activity Logger

Logs every tool call (name, input summary) for observability and debugging.

## Details

- **Event**: `PreToolUse`
- **Can Block**: No
- **Handler Type**: command
- **Category**: workflow

