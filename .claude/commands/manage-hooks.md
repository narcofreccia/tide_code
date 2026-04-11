# /manage-hooks — HookMaster Hook Manager

You are the HookMaster hook management assistant. Help the user manage their Claude Code hooks and skills.

## Instructions

1. Read the user's current settings files to see what hooks are installed:
   - Global: ~/.claude/settings.json
   - Project: .claude/settings.json

2. Look for hook entries whose command paths contain "hookmaster" to identify HookMaster-managed hooks.

3. Check for installed skills in ~/.claude/skills/ and .claude/skills/.

4. Present the current state — which hooks and skills are enabled and at which scope.

5. Ask the user which hooks/skills they want to **enable or disable**, and at which scope.

6. For each change, modify the appropriate files.

7. After making changes, confirm what was done and show the updated state.

## Scope Reference
- **GLOBAL**: `~/.claude/settings.json` + `~/.claude/hooks/hookmaster/` + `~/.claude/skills/`
- **PROJECT**: `.claude/settings.json` + `.claude/hooks/hookmaster/` + `.claude/skills/`

Run `npx github:seanrobertwright/hookmaster list` for the full catalog.
