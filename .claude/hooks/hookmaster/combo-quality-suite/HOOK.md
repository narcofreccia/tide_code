---
id: combo-quality-suite
name: "Quality Suite (Sequential)"
description: "Runs Format → Sort Imports → Lint sequentially on every edited file. Replaces auto-format + import-sorter + auto-lint."
category: quality
event: PostToolUse
matcher: "Write|Edit|MultiEdit"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
combo: true
replaces: "auto-format, auto-lint, import-sorter"
---

# Quality Suite (Sequential)

A combo hook that **replaces** `auto-format`, `auto-lint`, and `import-sorter`.

## Sequence

1. **Format** — Prettier / Black / rustfmt / gofmt
2. **Sort Imports** — isort (Python), ESLint import/order (JS/TS)
3. **Lint + fix** — ESLint --fix (JS/TS), ruff (Python)

## Details

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit|MultiEdit`
- **Replaces**: `auto-format`, `auto-lint`, `import-sorter`
