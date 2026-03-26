---
id: stop-until-tests-pass
name: "Block Stop Until Tests Pass"
description: "Prevents Claude from finishing (Stop) unless the test suite passes. Forces Claude to keep fixing."
category: testing
event: Stop
canBlock: true
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
---

# Block Stop Until Tests Pass

Prevents Claude from finishing (Stop) unless the test suite passes. Forces Claude to keep fixing.

## Details

- **Event**: `Stop`
- **Can Block**: Yes ⛔
- **Handler Type**: command
- **Category**: testing

