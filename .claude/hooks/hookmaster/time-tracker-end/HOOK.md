---
id: time-tracker-end
name: "Session Time Reporter"
description: "Reports total session duration on exit and appends to a time log."
category: workflow
event: SessionEnd
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
pair: "time-tracker"
---

# Session Time Reporter

Reports total session duration on exit and appends to a time log.

## Details

- **Event**: `SessionEnd`
- **Can Block**: No
- **Handler Type**: command
- **Category**: workflow

