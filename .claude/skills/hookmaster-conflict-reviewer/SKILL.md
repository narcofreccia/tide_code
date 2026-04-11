---
name: hookmaster-conflict-reviewer
description: >
  Activate when HookMaster hook conflicts are detected. Triggers when:
  the conflict-watchdog hook outputs a conflict warning (⚠️ HOOKMASTER CONFLICT DETECTED
  appears in context); the user installs or enables hooks that are known to conflict
  (auto-format, auto-lint, import-sorter in any combination of 2+); or the user
  explicitly runs /hook-analysis. Do NOT activate on every settings.json change —
  only when a conflict warning is present or the user asks.
author: seanrobertwright
version: 1.0.0
---

# HookMaster Conflict Reviewer

You help the user understand and resolve HookMaster hook conflicts with minimal friction. The goal is **one clear recommendation + one yes/no question**, then act.

---

## When You Activate

You activate in two situations:

1. **Automatic** — The conflict-watchdog hook has output a warning block starting with `⚠️  HOOKMASTER CONFLICT DETECTED` into the session context. This means settings.json just changed and conflicts were found.

2. **Manual** — The user has run `/hook-analysis` or has asked about hook conflicts.

---

## SITUATION 1: Conflict Warning in Context

When you see `⚠️  HOOKMASTER CONFLICT DETECTED` in the session context:

### Step 1: Acknowledge briefly

Surface the issue in 2-3 lines. Do not repeat all the details from the watchdog output — just summarize:

```
⚠️  Hook conflict detected: [hook names] will race on file writes.
```

### Step 2: State the single best fix

Pick the most specific combo that covers all the conflicting hooks. The priority is:
- If all three file-writers are installed: recommend `combo-quality-suite`
- If only two are installed: recommend `combo-format-and-lint`

State it plainly:
```
Fix: replace [conflicting hooks] with [combo-id] ([description]).
This runs them sequentially, eliminating the race condition.
```

### Step 3: Ask one question

```
Swap to [combo-id] now? (y/n)
```

Wait for the user's response. Do not ask follow-up questions.

### Step 4a: If yes — apply the fix

Read the appropriate settings.json file(s) to find where the conflicting hooks are installed.

For each conflicting hook to remove:
- Find its entry in `settings.json` under `hooks.<event>.<matcher-group>.hooks[]`
- Remove the handler entry
- If the matcher group is now empty, remove the group
- If the event is now empty, remove the event key

Then add the combo hook. The combo hook's settings.json entry follows this pattern:
- **For global scope**: command path is `~/.claude/hooks/hookmaster/[combo-id]/script.sh`
- **For local scope**: command path is `[project-root]/.claude/hooks/hookmaster/[combo-id]/script.sh`
- Event: `PostToolUse`
- Matcher: `Write|Edit|MultiEdit`
- Type: `command`
- Timeout: 30

Also copy the combo hook's script file:
- Source: wherever HookMaster is installed (from the command path of an existing hookmaster hook — strip the hook ID from the path to find the hookmaster root)
- Destination: same directory structure as the removed hooks

Confirm: "Done. [combo-id] is now installed. The race condition is resolved."

### Step 4b: If no — acknowledge and close

"OK, keeping individual hooks. The race condition remains — if you see file corruption after edits, that's likely the cause. You can run /hook-analysis at any time to revisit."

---

## SITUATION 2: /hook-analysis (Interactive Mode)

When the user runs `/hook-analysis`, perform a full interactive analysis. See the `/hook-analysis` slash command for the detailed flow — it guides you step by step.

---

## Background: Why Conflicts Happen

Claude Code runs all hooks registered for the same event **in parallel**. There is no guaranteed execution order.

**Race condition hooks** — all fire on `PostToolUse (Write|Edit|MultiEdit)` and write to `$FILE_PATH`:
- `auto-format` — Prettier/Black/rustfmt/gofmt
- `auto-lint` — ESLint --fix / ruff --fix
- `import-sorter` — isort / eslint import/order

Installing any two simultaneously causes both to open and write to the same file at the same moment.

**Combo hooks** — sequential alternatives:
- `combo-format-and-lint`: format → lint
- `combo-quality-suite`: format → sort imports → lint

**Paired hooks** — should always coexist:
- `time-tracker` (SessionStart) + `time-tracker-end` (SessionEnd)

---

## Settings.json Path Reference

| Scope | Path |
|-------|------|
| Global | `~/.claude/settings.json` |
| Local | `[cwd]/.claude/settings.json` |
| Local override | `[cwd]/.claude/settings.local.json` |

Hook scripts are installed at:
- Global: `~/.claude/hooks/hookmaster/<hook-id>/script.sh`
- Local: `[cwd]/.claude/hooks/hookmaster/<hook-id>/script.sh`
