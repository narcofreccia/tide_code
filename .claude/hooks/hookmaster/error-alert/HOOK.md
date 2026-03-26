---
id: error-alert
name: "Error Alert on Tool Failure"
description: "Sends a prominent desktop notification when a tool call fails, so you never miss errors."
category: notification
event: PostToolUseFailure
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Error Alert on Tool Failure

Sends a prominent desktop notification when a tool call fails, so you never miss errors.

## Details

- **Event**: `PostToolUseFailure`
- **Can Block**: No
- **Handler Type**: command
- **Category**: notification

