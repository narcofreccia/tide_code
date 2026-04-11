# Tide

> **Now available on Windows!** Tide runs natively on Windows 10/11 with full feature parity -- PTY terminal (PowerShell/cmd), Windows Credential Manager for secure key storage, MSVC build toolchain support, and NSIS/MSI installers. See the [Windows setup guide](./WIN.md) for details.

An AI-native code editor with orchestrated multi-step workflows and multi-agent collaboration, built on [Tauri v2](https://v2.tauri.app) and the [Pi coding agent](https://shittycodingagent.ai) (v0.66.1).

Tide wraps Pi as a sidecar process, adding a full IDE around it: Monaco editor, file tree, integrated terminal, codebase indexing, project memory, an orchestration engine that breaks complex tasks into plan-build-review pipelines, and an Agent Experts mode where multiple AI agents brainstorm together via peer-to-peer messaging.

**Platforms:** macOS 12+ | Windows 10/11 | Linux (planned)

## What Makes Tide Different

**Glass-box context** -- See exactly what the agent sees: token budget, context usage, injected files, and cost breakdown in real time.

**Orchestrated workflows** -- Complex tasks are automatically routed through a multi-phase pipeline: classify complexity -> select the right model -> generate a plan -> execute steps -> review and iterate. Simple questions just get answered directly. Cancel any pipeline mid-run.

**Built-in codebase index** -- Tree-sitter parses your entire project into a SQLite+FTS5 symbol database (`.tide/index.db`). The AI agent can search for functions, classes, and types across the codebase instantly -- no LSP server required.

**Project memory** -- Tide remembers across sessions. The agent stores learned facts about your project (architecture decisions, conventions, patterns) in `.tide/memory.json`. Session summaries are saved to `.tide/sessions/` and automatically injected as context in future conversations.

**Smart context injection** -- Priority-based injection with token budgeting: TIDE.md rules (always) -> pinned region tags -> active feature plan -> project memory -> recent session summaries. Trimmable items are dropped when the budget is tight.

**Cost-aware model routing** -- Simple edits use fast, cheap models. Multi-file architecture tasks get routed to powerful models. The router classifies every prompt and picks the best model for the job.

**Editable editor** -- Full read-write Monaco editor with Cmd+S / Ctrl+S save, dirty state tracking, and Tokyo Night theme. Not just a viewer.

**Agent Experts** -- Assemble teams of expert agents (architect, security, performance, UX, devil's advocate) that brainstorm together via peer-to-peer messaging. Each expert has its own model, temperature, and system prompt. Experts explore code, share findings, challenge each other's reasoning, and produce a synthesized recommendation. Configurable time limits with automatic convergence. Feed the synthesis directly into the orchestration pipeline.

**Subagents** -- Spawn isolated Pi processes for codebase exploration and web research. Results are summarized before returning to the main agent's context, preventing context pollution. Run multiple tasks in parallel with concurrency limiting.

**Configurable everything** -- Review mode, QA commands, clarify timeouts, model lock during orchestration, tier model preferences, expert teams -- all configurable per-project via `.tide/orchestrator-config.json`, `.tide/router-config.json`, and `.tide/experts/`.

## How It Works

### Architecture

```
+------------------+     JSON-RPC (stdin/stdout)     +------------------+
|   Tauri (Rust)   | <-----------------------------> |   Pi Agent       |
|                  |                                  |   (Node.js)      |
|  - Orchestrator  |     Tauri Events                 |  - LLM calls     |
|  - Experts Mgr   | ------------------------------>  |  - Tool use      |
|  - Tree-sitter   |                                  |  - Sessions      |
|  - Git (libgit2) |     +--- Pi Extensions ----+     |  - Compaction    |
|  - PTY terminal  |     | tide-router.ts       |     +------------------+
|  - Keychain      |     | tide-planner.ts      |
|  - SQLite index  |     | tide-index.ts        |     +------------------+
+------------------+     | tide-safety.ts       |     | Expert Agents    |
        |                 | tide-project.ts      |     |  (Pi processes)  |
   Tauri Events           | tide-session.ts      |     |                  |
        |                 | tide-classify.ts     |     | P2P via mailbox  |
        v                 | tide-web-search.ts   |     | files in .tide/  |
+------------------+      | tide-subagent.ts     |     | experts/sessions |
|   React UI       |      | tide-experts.ts      |     +------------------+
|  - Monaco Editor |      | tide-expert-comms.ts |
|  - Agent Chat    |      | tide-agent-utils.ts  |
|  - Experts Panel |      +---------------------+
|  - File Tree     |
|  - Terminal      |
|  - Settings      |
+------------------+
```

### Pi Integration

Tide runs Pi as a sidecar process in RPC mode. On startup:

1. **Sidecar resolution** -- Rust finds the Pi binary: checks `binaries/pi-sidecar-{target-triple}` (production bundle), then `node_modules` (dev), then PATH
2. **API key injection** -- Reads keys from the platform credential store (macOS Keychain or Windows Credential Manager), injects as environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`). Pi also supports OAuth2 login for subscription providers (ChatGPT Plus/Pro Codex, Claude Pro/Max, GitHub Copilot, Gemini CLI) with credentials cached in `~/.pi/agent/auth.json`.
3. **Extension loading** -- Passes 12 custom extensions via `-e` flags
4. **JSON-RPC bridge** -- Rust reads Pi's stdout line-by-line, parses events, and emits them as Tauri events to the React frontend

Pi retains full ownership of: LLM interaction, tool execution (read/write/edit/bash/grep), session management (JSONL tree structure, auto-compaction), and the agent loop.

Tide adds on top: orchestration (multi-step pipelines), multi-agent expert brainstorming, subagent dispatch, the codebase index, project memory, session intelligence, native git/terminal, and the full IDE UI.

### Codebase Indexing

Tide includes a built-in codebase indexer:

- **Tree-sitter parsing** for TypeScript, JavaScript, Rust, Python, and Go
- **Symbol extraction**: functions, classes, interfaces, types, methods with line ranges
- **SQLite + FTS5** full-text search stored in `.tide/index.db`
- **Live updates** via filesystem watcher -- changes are indexed incrementally
- **Exposed to Pi** via the `tide-index.ts` extension, which registers tools like `tide_search_symbols` and `tide_get_file_symbols`

The agent can search your entire codebase by symbol name, find all symbols in a file, or get index stats -- all without reading every file into the context window.

### Orchestration Engine

When you send a complex prompt (detected automatically or forced with Cmd+Enter / Ctrl+Enter):

1. **Routing** -- `tide-classify.ts` analyzes complexity, `tide-router.ts` selects the appropriate model tier
2. **Planning** -- Pi generates a structured plan with steps, files, and acceptance criteria. Optionally asks clarifying questions. Writes a research cache to `.tide/research.md`.
3. **Building** -- Each step executes sequentially with context compaction between steps. Dependency-aware execution via topological sort. Prompts are prefixed with `[tide:orchestrated]` to prevent re-routing.
4. **Reviewing** -- An iterative QA loop checks the output. If configured, runs test commands. May generate findings that trigger additional fix steps (capped at configurable max iterations).
5. **Completion** -- Frontend displays the final status. A heartbeat monitors for stalls (warning after 30s of silence). Cancel button available at any phase.

All orchestration settings are configurable per-project in `.tide/orchestrator-config.json`.

### Agent Experts

Tide includes a multi-agent brainstorming mode where teams of expert agents collaborate:

1. **Team setup** -- Select a pre-configured team (e.g., "Code Review Team" with architect, security, and performance experts) or create custom teams in Settings. Each expert has its own model, temperature, and system prompt.
2. **Exploration** -- All experts are spawned as persistent Pi processes in RPC mode. Each independently analyzes the task, reading code and using tools.
3. **P2P discussion** -- Experts communicate directly via file-based mailboxes in `.tide/experts/sessions/{id}/mailboxes/`. They send observations, ask questions, challenge assumptions, and share findings on a shared board.
4. **Time-limited convergence** -- A configurable time limit (default 10 minutes) ensures sessions converge. At 80% elapsed, agents are warned to wrap up. At 100%, the judge agent is forced to synthesize.
5. **Synthesis** -- The designated judge expert reads all messages and findings, producing a structured synthesis: consensus, disagreements, recommendations, action items, and risk level.
6. **Execution** -- The synthesis can be fed directly into the orchestration pipeline, giving the planner the full benefit of multi-expert analysis.

The Experts tab in the agent panel shows real-time activity across three views: grid (card overview), timeline (chronological P2P messages), and conversation (threaded chat between agents).

Expert teams and individual expert configurations are stored in `.tide/experts/teams/` and `.tide/experts/experts/`. Five default experts ship out of the box: System Architect, Security Reviewer, Performance Engineer, UX/API Designer, and Devil's Advocate.

### Session Intelligence

Tide remembers what happened across sessions:

- **Session summaries** -- The agent can call `tide_session_summary` to save a structured summary (files changed, decisions, TODOs) to `.tide/sessions/<timestamp>.md`
- **Project memory** -- Key-value store at `.tide/memory.json` for persistent project facts. Tools: `tide_memory_read`, `tide_memory_write`, `tide_memory_delete`
- **Smart context injection** -- On every agent start, Tide injects prioritized context: TIDE.md rules, pinned tags, active plans, memory entries, and recent session summaries -- all within a token budget
- **Session history UI** -- Browse past sessions in the History tab, expand summaries, and continue from any previous session

## Project Structure

```
tide_code/
  packages/shared/          # Shared types (Zod schemas)
  apps/desktop/
    pi-extensions/          # 12 Pi extensions (routing, planning, indexing, experts, etc.)
      expert-defaults/      # Default expert presets and team templates
    src/                    # React frontend (18 Zustand stores, 40+ components)
      components/
        ExpertsPanel/       # Expert brainstorming UI (6 components)
    src-tauri/src/          # Rust backend (orchestrator, experts, sidecar, git, pty, indexer)
  scripts/                  # Build, release, sidecar prep scripts
  .tide/                    # Per-project data (index.db, config, memory, sessions, plans)
    experts/                # Expert teams, definitions, and session data
      teams/                # Team templates (JSON)
      experts/              # Individual expert definitions (Markdown + YAML frontmatter)
      sessions/             # Past brainstorming sessions with mailbox directories
```

See [PROJECT.md](./PROJECT.md) for the complete file-by-file structure.

## Tutorial

New to Tide Code? The **[TaskFlow Tutorial](./TUTORIAL.md)** walks you through building a full-stack todolist app (React + FastAPI + HTML/CSS/JS) while learning every feature of the IDE — from basic editing to AI-powered orchestration. It covers all 12 major features across 12 chapters and takes 3-5 hours to complete.

## Quick Links

- [TUTORIAL.md](./TUTORIAL.md) -- Step-by-step tutorial building a full-stack app with Tide Code
- [QUICKSTART.md](./QUICKSTART.md) -- Development setup and running locally
- [WIN.md](./WIN.md) -- Windows port implementation details
- [PROJECT.md](./PROJECT.md) -- Detailed architecture, data flows, and design decisions

## Requirements

| | macOS | Windows |
|---|---|---|
| **OS** | macOS 12+ | Windows 10/11 |
| **Node.js** | >= 20 | >= 20 |
| **pnpm** | latest | latest |
| **Rust** | stable (via rustup) | stable (via rustup) |
| **Build tools** | Xcode CLT | Visual Studio Build Tools 2022 ("Desktop development with C++" workload) |
| **WebView** | Built-in (WebKit) | WebView2 (pre-installed on Win 10/11) |

Plus at least one LLM API key (Anthropic, OpenAI, or Google) or an OAuth-supported subscription (ChatGPT Plus/Pro, GitHub Copilot, Gemini CLI, etc.).

## License

[MIT](./LICENSE)
