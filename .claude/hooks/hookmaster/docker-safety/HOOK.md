---
id: docker-safety
name: "Docker Safety Guard"
description: "Blocks dangerous Docker commands: --privileged, host network, volume mounts to /, system prune."
category: security
event: PreToolUse
matcher: "Bash"
canBlock: true
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Docker Safety Guard

Blocks dangerous Docker commands: --privileged, host network, volume mounts to /, system prune.

## Details

- **Event**: `PreToolUse`
- **Matcher**: `Bash`
- **Can Block**: Yes ⛔
- **Handler Type**: command
- **Category**: security

