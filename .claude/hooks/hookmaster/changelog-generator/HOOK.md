---
id: changelog-generator
name: "Changelog Entry Generator"
description: "Appends a changelog entry based on git diff when Claude finishes and changes exist."
category: git
event: Stop
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Changelog Entry Generator

Appends a changelog entry based on git diff when Claude finishes and changes exist.

## Details

- **Event**: `Stop`
- **Can Block**: No
- **Handler Type**: command
- **Category**: git

