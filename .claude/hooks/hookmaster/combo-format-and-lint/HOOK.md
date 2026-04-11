---
id: combo-format-and-lint
name: "Format + Lint (Sequential)"
description: "Runs Prettier then ESLint/Ruff sequentially on every edited file. Use instead of auto-format + auto-lint to avoid race conditions."
category: quality
event: PostToolUse
matcher: "Write|Edit|MultiEdit"
canBlock: false
handlerType: command
entrypoint: script.sh
author: seanrobertwright
version: 1.0.0
combo: true
replaces: "auto-format, auto-lint"
---

# Format + Lint (Sequential)

A combo hook that **replaces** `auto-format` and `auto-lint`.

Because Claude Code runs hooks in parallel, installing both `auto-format` and `auto-lint` causes them to write to the same file simultaneously — a race condition. This combo runs them sequentially: **format first, then lint**.

## Sequence

1. **Format** — Prettier (JS/TS), Black (Python), rustfmt (Rust), gofmt (Go)
2. **Lint + fix** — ESLint --fix (JS/TS), ruff check --fix (Python)

## Details

- **Event**: `PostToolUse`
- **Matcher**: `Write|Edit|MultiEdit`
- **Replaces**: `auto-format`, `auto-lint`
