---
id: transcript-backup
name: "Pre-Compaction Transcript Backup"
description: "Backs up the full transcript before Claude compacts context, preserving conversation history."
category: workflow
event: PreCompact
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Pre-Compaction Transcript Backup

Backs up the full transcript before Claude compacts context, preserving conversation history.

## Details

- **Event**: `PreCompact`
- **Can Block**: No
- **Handler Type**: command
- **Category**: workflow

