# .tide/PROJECT.md
Tide IDE — Agentic Coding Environment (macOS-first)
Spec v0.6 (updated decisions) | 2026-03-03
1) Product Summary
Tide is a desktop IDE built with Tauri (Rust shell) + React (UI) + a Node.js/TypeScript sidecar (“Tide Engine”). It combines a VS Code-like repo browsing/editing experience with a deterministic agent workflow (Scout → Planner → Builder → Validator), plan-first execution, strict JSON tool calling, and durable project memory via a repo-local .tide/ folder.

2) Non-Negotiables (Hard Rules)
Strict JSON tool calling only: every model output is exactly one JSON envelope: tool_call / question / final.
Plan-before-build: Builder does not modify code unless a feature plan exists (unless user explicitly overrides).
Durable context lives in .tide/: chat history is not canonical memory.
Tunable safety: write/command/git-write operations require explicit approval unless enabled.
No Python required: orchestration, tools, routing, skills/extensions in Node/TS (+ Rust shell).
< 1000 LOC per file: CI hard-fails at 1000, warns at 800.
Artifacts over narration: truth = patches, diffs, tool logs, test results, plan versions.
No RAG for project direction / task storage: direction and tasks live in explicit .tide/ files + SQLite (see §8 and §18).
3) Primary UX (v0.1)
3.1 IDE layout
Left: file tree, quick search, .tide shortcuts (open TIDE.md, open active feature plan).
Center: Monaco editor tabs + optional diff view.
Right: Agent panel tabs: Chat, Plan, Execute, Validate, Logs.
Bottom status bar: engine connected, active model/provider, git status, tests status, safety mode, Context Status Dial (see §12).
3.2 Core flows
Open workspace → browse tree → open files in Monaco.
Select lines → Tag Region → attach to agent input.
Plan → generate/update .tide/features/<feature>.json.
Execute → run tasks step-by-step with approvals.
Validate → run validator checks + tests; “Done” requires acceptance criteria pass.
4) Architecture Overview
4.1 Processes
Tauri/Rust (desktop shell): sidecar lifecycle, secure OS boundary, event emission to WebView.
React/WebView (UI): IDE rendering, attachments, approvals, settings, streaming display.
Node/TypeScript sidecar (Tide Engine): orchestration, context packing, strict parsing, routing, tools execution, persistence.
4.2 Authority model (important)
Tide Engine is the authority for: tool schemas, safety enforcement, orchestration, logging, persistence.
UI is the authority for: user intent, approvals/denials, what is attached/pinned as context.
5) Pi Parity Requirement (Skills, Extensions, Context Management)
Tide must support everything Pi can do in principle regarding:

skills (capabilities beyond raw tools)
extensions (packaged skill bundles)
context management (long tasks, context passing, budgeting)
Tide may delegate coding reasoning to Pi-style components, but Tide remains the deterministic harness (strict envelopes + safety + logs).

6) Pi Integration Boundary (Safe Delegation)
6.1 What can be delegated to Pi
The Builder brain (coding reasoning / patch proposal generation)
Optional: specialized skills implemented by Pi modules (refactor/test helpers), if they respect Tide’s tool/safety boundary
6.2 What is never delegated
Safety policy & approvals
Tool registry schema enforcement
Persistent .tide context as source of truth
Logging and audit trail
Orchestration state machine (Scout/Planner/Validator handoffs)
6.3 Compatibility approach
Tide Engine provides a CodingBackend interface for Builder:

native_builder (Tide prompts)
pi_builder (Pi adapter)
Regardless of backend, outputs must be Tide’s strict envelopes. Non-compliant outputs are rejected and retried with explicit validation errors.

7) Tech Stack (No MUI)
7.1 Desktop/UI
Tauri (Rust)
React + Vite
Monaco Editor
UI components strategy:
accessible primitives (menus, dialogs, popovers)
“copy-in” component approach (shadcn-style) where useful
Tide-specific IDE chrome components (SplitPane, FileTree, ToolCallViewer, ContextInspector)
State: Zustand
Runtime validation: Zod
7.2 Engine
Node.js + TypeScript
SQLite (local persistence)
Git integration (read by default; write optional)
Structured JSON logs + DB records
8) .tide/ Durable Context System (Canonical Memory)
8.1 Files
TIDE.md (repo root): operational rules, safety profile, allowlists, router defaults, test commands (source of truth).
.tide/PROJECT.md: this spec.
.tide/features/*.json: plans (execution contracts).
8.2 Context precedence (highest → lowest)
User attachments (regions, files, diffs)
Active feature plan
.tide/PROJECT.md
TIDE.md
Repo map summary (Scout output)
Session history summary (bounded)
9) Strict JSON Output Envelopes (One per model turn)
9.1 Tool call
json
Copy
{ "type": "tool_call", "tool": "apply_patch", "arguments": { "path": "apps/engine/src/x.ts", "patch": "@@ ..." } }
9.2 Clarifying question
json
Copy
{ "type": "question", "message": "Confirm the default test command?", "choices": ["pnpm test", "pnpm test:unit"] }
9.3 Final
json
Copy
{ "type": "final", "message": "Plan updated at .tide/features/feature_x.json." }
Any other output is rejected with schema errors + retry instruction.

10) Tools vs Skills vs Extensions (Pi-Parity Surface)
10.1 Definitions
Tool: low-level deterministic operation with strict schema + safety level (file read, patch apply, command exec).
Skill: higher-level capability composed of tools (e.g., “Generate tests for task P2.T3”).
Extension: packaged distribution of engine-only skills (and optional configuration/templates) with a manifest + permissions.
v0.x constraint: extensions cannot add UI panels or modify the UI.
10.2 Tool inventory (v0.1 minimum)
Read-only:

fs_list, fs_read, fs_stat
ripgrep
git_status, git_diff, git_log
Write (approval gated by default):

apply_patch
fs_write
Commands (disabled by default; direct-exec only):

run_command (see §14)
10.3 Skills system (required)
Tide Engine contains a SkillRegistry:
id, description
inputs_schema, outputs_schema
implementation: TS module OR “LLM-driven skill template” that results in Tide tool calls
permissions: allowed underlying tools + command allowlist constraints
Skills can be invoked by:
orchestrator internally
user via command palette (“Run Skill…”)
Pi backend via compatibility mapping (never bypassing safety)
11) Extensions: Global + Workspace-Local (Decision Locked)
11.1 Locations
Global extensions: ~/.tide/extensions
Workspace-local extensions: <repo>/.tide/extensions
11.2 Precedence and overrides
If the same extension_id is present in both:
workspace-local wins
UI must clearly show source (“Workspace” vs “Global”)
11.3 Trust and safety defaults (supply-chain aware)
Workspace-local extensions are disabled by default until the user explicitly enables them for that workspace.
Extension manifest declares required permissions:
tool access
command allowlists
any network capability (off by default in v0.x)
GPT-5.2 Thinking
Update locked: extensions are skills/tools only (engine-only)
Locked in for v0.x: extensions may contribute skills (and any underlying tool wrappers they are permitted to call), but no UI panels, no UI contributions, no custom React components.

Below are the exact edits to apply to .tide/PROJECT.md (v0.6 → v0.7).

1) Replace §10 “Tools vs Skills vs Extensions” definitions with this
10.1 Definitions
Tool: low-level deterministic operation with strict schema + safety level (file read, patch apply, command exec).
Skill: higher-level capability composed of tools (e.g., “Generate tests for task P2.T3”).
Extension: packaged distribution of engine-only skills (and optional configuration/templates) with a manifest + permissions.
v0.x constraint: extensions cannot add UI panels or modify the UI.
2) Add this to §11 (Extensions) as an explicit rule
11.4 Engine-only extensions (v0.x)
Extensions are limited to:
registering skills in the SkillRegistry
providing prompt templates / skill logic (TS modules)
declaring permissions (tools + command allowlists)
Extensions cannot:
add UI panels/tabs
inject UI components
alter layout or editor behavior directly
12) Context Management (Long Tasks) + Context Status Dial
12.1 ContextPack
Engine builds a ContextPack per step from:

pinned .tide docs
active feature plan task(s) + acceptance criteria
selected/tagged regions
bounded file snippets (not entire files by default)
repo map summary (bounded)
session summary (bounded)
Large artifacts are referenced by pointer and pulled on-demand.

12.2 Context budget policy
Each role gets a target budget derived from selected model context window + user “cost vs quality.”
When over budget, trim in order:
old chat history
repo map verbosity
non-pinned attachments
Never trim:
critical rules from TIDE.md
active task acceptance criteria
safety policy constraints
12.3 Context Status Dial (must-have)
Bottom status bar shows:

% budget used (e.g., 62%)
green/yellow/red thresholds (<70 / 70–90 / >90)
hover breakdown (estimated tokens):
.tide docs
active plan
attachments
repo map
session summary
Click opens Context Inspector:

list of context items with size estimates
pin/unpin toggles
engine “trim suggestions”
“simulate next step budget” per role (Planner/Builder/Validator)
13) Tests: Discovery Policy (Hybrid)
Tide scans repo to suggest test commands (e.g., package.json scripts).
UI asks user to confirm.
Confirmed commands are written into TIDE.md.
From then on: TIDE.md is source of truth (deterministic).
14) Command Execution Surface (Direct Exec Only)
run_command is direct exec only (no shell features):

cmd: program name
args: string[]
cwd: workspace-relative
timeout_ms: enforced
env_whitelist: optional
Safety:

disabled by default per workspace
allowlist commands in TIDE.md
approvals required unless explicitly relaxed
15) Streaming Output (Fast “token feel” without jank)
Stream delta chunks, not per-token IPC.
UI renders at most ~30–60 updates/sec (16–50ms flush).
Message pattern: start | delta | end with request_id, stream_id, seq.
Node↔Rust transport: framed socket.
Rust→UI: Tauri events, coalesced.
16) Cancellation Semantics (Decision Locked: Option B)
Cancel must stop the current work reliably without pretending to rollback history.

16.1 What “Cancel” does
On user cancel:

Immediately stop LLM streaming
engine stops forwarding deltas
provider request is aborted if supported
Prevent starting any new tool calls for the current step
Attempt to cancel the currently running tool, if any
16.2 Tool-specific cancellation behavior
run_command:
terminate the process (graceful kill, then force kill if needed)
capture partial stdout/stderr and record cancelled=true
ripgrep and other short-lived processes:
terminate similarly (usually instant)
apply_patch / fs_write:
treated as atomic; cancellation won’t “half-apply”
no automatic rollback in v0.1
16.3 No rollback (explicit)
Cancellation does not attempt to revert code changes automatically. Any changes already applied remain visible as diffs/artifacts.

UI must show:

what was cancelled (stream vs tool)
which tool was running
partial outputs captured so far
17) IPC Transport (Default for scaffold)
Node ↔ Rust: framed socket protocol (UDS macOS; TCP localhost fallback)
Rust ↔ UI: Tauri events (stream) + invoke (request/response)
18) No RAG Policy (Explicit)
Tide does not use embedding-based RAG as a memory store for:
tasks
project direction
“overall intent”
Canonical sources are:
.tide/PROJECT.md, TIDE.md, .tide/features/*.json
SQLite session/task logs
Retrieval in v0.1 is deterministic:
ripgrep + explicit file reads + repo map summaries
(Future) semantic search may exist only as an explicit tool with citations and user pinning, but is out of scope for v0.1.
19) Milestones (Including extensions + cancellation)
M0 (1–2 days): skeleton

Tauri window
sidecar spawn + handshake
streaming demo: start/delta/end with coalescing
M1 (week 1): workspace + navigation

open folder, file tree, Monaco tabs
fs_list/fs_read end-to-end
M2 (week 2): region tagging + context dial

tag ranges, attach to prompt, persist
Context Status Dial + Context Inspector v0
M3 (weeks 3–4): strict tools + patching + approvals

tool registry + schemas
apply_patch + diff preview + approvals
tool logging
M4 (weeks 5–6): Plan → Execute → Validate

Planner writes .tide/features/*.json
Builder executes tasks from plan
Validator runs tests + verifies acceptance
M5 (weeks 7–8): providers + router

adapters for OpenAI/Anthropic/GLM/Qwen/MiniMax
router UI + budgets
M6 (next): Pi parity layer + extensions

SkillRegistry + extension manifest support (engine-only)
extension loading global + workspace-local (with trust gating)
Pi adapter for Builder backend + skills mapping
“Run Skill…” command palette (built-in UI only; extensions do not ship UI)

SkillRegistry + extension manifest support
extension loading global + workspace-local (with trust gating)
Pi adapter for Builder backend + skills mapping
“Run Skill…” command palette
20) Locked Decisions (Current)
React UI + Monaco
Node.js TypeScript sidecar engine
Strict JSON only
Tests: hybrid discovery → confirm → write to TIDE.md
Commands: direct exec only
Streaming: delta chunks + throttled UI updates
Cancellation: Option B (cancel stream + cancel active tool; no rollback)
Extensions: both global and workspace-local, workspace overrides global, workspace-local disabled by default until trusted
No RAG for direction/tasks; .tide + SQLite are canonical
Pi: delegated backend option; Tide remains authority
Context Status Dial + Context Inspector are first-class UX
Extensions: skills/tools only (engine-only) for v0.x; no UI extension surfaces