# Tide

An AI-native code editor with orchestrated multi-step workflows, built on [Tauri v2](https://v2.tauri.app) and the [Pi coding agent](https://shittycodingagent.ai).

Tide wraps Pi as a sidecar process, adding a full IDE around it: Monaco editor, file tree, integrated terminal, codebase indexing, and an orchestration engine that breaks complex tasks into plan-build-review pipelines.

## What Makes Tide Different

**Glass-box context** -- See exactly what the agent sees: token budget, context usage, injected files, and cost breakdown in real time.

**Orchestrated workflows** -- Complex tasks are automatically routed through a multi-phase pipeline: classify complexity -> select the right model -> generate a plan -> execute steps -> review and iterate. Simple questions just get answered directly.

**Built-in codebase index** -- Tree-sitter parses your entire project into a SQLite+FTS5 symbol database (`.tide/index.db`). The AI agent can search for functions, classes, and types across the codebase instantly -- no LSP server required. This is the same approach as [jcodemunch-mcp](https://github.com/jgravelle/jcodemunch-mcp), but built natively into the editor.

**Cost-aware model routing** -- Simple edits use fast, cheap models. Multi-file architecture tasks get routed to powerful models. The router classifies every prompt and picks the best model for the job, with automatic fallback if a provider key is missing.

**Configurable everything** -- Review mode, QA commands, clarify timeouts, model lock during orchestration -- all configurable per-project via `.tide/orchestrator-config.json` or the Settings panel.

## How It Works

### Architecture

```
+------------------+     JSON-RPC (stdin/stdout)     +------------------+
|   Tauri (Rust)   | <-----------------------------> |   Pi Agent       |
|                  |                                  |   (Node.js)      |
|  - Orchestrator  |     Tauri Events                 |  - LLM calls     |
|  - Tree-sitter   | ------------------------------>  |  - Tool use      |
|  - Git (libgit2) |                                  |  - Sessions      |
|  - PTY terminal  |     +--- Pi Extensions ---+      |  - Compaction    |
|  - Keychain      |     | tide-router.ts      |      +------------------+
|  - SQLite index  |     | tide-planner.ts     |
+------------------+     | tide-index.ts       |
        |                 | tide-safety.ts      |
   Tauri Events           | tide-project.ts     |
        |                 | tide-classify.ts    |
        v                 | tide-web-search.ts  |
+------------------+      +--------------------+
|   React UI       |
|  - Monaco Editor |
|  - Agent Chat    |
|  - File Tree     |
|  - Terminal      |
|  - Settings      |
+------------------+
```

### Pi Integration

Tide runs Pi as a sidecar process in RPC mode. On startup:

1. **Sidecar resolution** -- Rust finds the Pi binary: checks `binaries/pi-sidecar-{target-triple}` (production bundle), then `node_modules` (dev), then PATH
2. **API key injection** -- Reads keys from macOS Keychain, injects as environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`)
3. **Extension loading** -- Passes 7 custom extensions via `-e` flags
4. **JSON-RPC bridge** -- Rust reads Pi's stdout line-by-line, parses events, and emits them as Tauri events to the React frontend

Pi retains full ownership of: LLM interaction, tool execution (read/write/edit/bash/grep), session management (JSONL tree structure, auto-compaction), and the agent loop.

Tide adds on top: orchestration (multi-step pipelines), the codebase index, native git/terminal, and the full IDE UI.

### Codebase Indexing

Tide includes a built-in codebase indexer that works like [jcodemunch-mcp](https://github.com/jgravelle/jcodemunch-mcp):

- **Tree-sitter parsing** for TypeScript, JavaScript, Rust, Python, and Go
- **Symbol extraction**: functions, classes, interfaces, types, methods with line ranges
- **SQLite + FTS5** full-text search stored in `.tide/index.db`
- **Live updates** via filesystem watcher -- changes are indexed incrementally
- **Exposed to Pi** via the `tide-index.ts` extension, which registers tools like `tide_search_symbols` and `tide_get_file_symbols`

The agent can search your entire codebase by symbol name, find all symbols in a file, or get index stats -- all without reading every file into the context window.

### Orchestration Engine

When you send a complex prompt (detected automatically or forced with Cmd+Enter):

1. **Routing** -- `tide-classify.ts` analyzes complexity, `tide-router.ts` selects the appropriate model tier
2. **Planning** -- Pi generates a structured plan with steps, files, and acceptance criteria. Optionally asks clarifying questions.
3. **Building** -- Each step executes sequentially in its own session. Prompts are prefixed with `[tide:orchestrated]` to prevent re-routing.
4. **Reviewing** -- An iterative QA loop checks the output. If configured, runs test commands. May generate findings that trigger additional build steps.
5. **Completion** -- Frontend displays the final status. A heartbeat monitors for stalls (warning after 30s of silence).

All orchestration settings are configurable per-project in `.tide/orchestrator-config.json`.

## Project Structure

```
tide_code/
  packages/shared/          # Shared types (Zod schemas)
  apps/desktop/
    pi-extensions/          # 7 Pi extensions (routing, planning, indexing, etc.)
    src/                    # React frontend (15+ Zustand stores, 30+ components)
    src-tauri/src/          # Rust backend (orchestrator, sidecar, git, pty, index)
  scripts/                  # Build, release, sidecar prep scripts
  .tide/                    # Per-project data (index.db, config, research cache)
```

See [PROJECT.md](./PROJECT.md) for the complete file-by-file structure.

## Quick Links

- [QUICKSTART.md](./QUICKSTART.md) -- Development setup and running locally
- [DEPLOY.md](./DEPLOY.md) -- Production build, signing, notarization, and release
- [PROJECT.md](./PROJECT.md) -- Detailed architecture, data flows, and design decisions

## Requirements

- **Node.js** >= 20
- **pnpm** (package manager)
- **Rust** (stable toolchain, installed via rustup)
- **macOS** 12+ (primary platform; Linux support planned)
- At least one LLM API key (Anthropic, OpenAI, or Google)

## License

Private / Proprietary
