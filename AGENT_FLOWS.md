# Tide IDE — Agent Flows

This document describes all agent workflows in Tide, how they interact, and which models are used at each stage.

---

## 1. Chatbox (Direct Chat)

The simplest flow — user talks directly to the Pi agent.

```
User types message
    ↓
tide-router.ts classifies complexity (quick/standard/complex)
    ↓
Router selects model based on tier (cheap for quick, expensive for complex)
    ↓
Pi agent responds (streaming to Chat tab)
    ↓
Agent can use tools: read, write, edit, bash, grep, find, ls
    + tide_index_* (codebase search)
    + tide_explore, tide_research (subagents)
    + tide_plan_create, tide_plan_update (planning)
    + web_search (Tavily)
```

**Model**: Selected by router based on task complexity, or user's manual selection.

---

## 2. Orchestrator (Plan → Build → Review)

Multi-phase pipeline for complex tasks. Triggered by Cmd+Enter or the "Plan & Execute" button.

```
User prompt (or expert synthesis)
    ↓
[1. ROUTING]     tide-classify.ts analyzes complexity
                 tide-router.ts selects model tier
    ↓
[2. PLANNING]    Orchestrator sends [tide:orchestrated] prompt to Pi
                 Pi explores codebase (tide_dispatch for parallel exploration)
                 Pi creates plan via tide_plan_create
                 Plan written to .tide/plans/*.json
                 If expert_context provided: injected as "## Expert Analysis" section
    ↓
[3. PLAN_READY]  Frontend shows plan in Plan tab
                 User reviews steps → clicks "Confirm" or "Execute Plan"
    ↓
[4. BUILDING]    Each step executed sequentially (dependency-aware via topological sort)
                 Context compacted every 3rd step
                 Step status updated in plan JSON
                 Per-step model switching if configured (lockModelDuringOrchestration: false)
    ↓
[5. REVIEWING]   QA loop: fresh session or compact for clean perspective
                 Runs qa_commands if configured (e.g., "npm run build", "npm test")
                 Findings become fix steps → loops back to Building (max N iterations)
    ↓
[6. COMPLETE]    Plan marked complete, auto-compact/auto-retry restored
```

**Models**:
- Planning: chatbox model (or orchestratorModels.research if configured)
- Building: chatbox model (or per-step assignedModel, or orchestratorModels.codeEditing)
- Reviewing: chatbox model (or orchestratorModels.validation)

**Key files**:
- `src-tauri/src/orchestrator.rs` — Rust pipeline coordinator
- `pi-extensions/tide-planner.ts` — plan CRUD tools
- `pi-extensions/tide-classify.ts` — complexity classification

---

## 3. Subagents (Isolated Exploration & Research)

One-shot Pi processes for parallel codebase exploration and web research.

```
Main agent calls tide_explore / tide_research / tide_dispatch
    ↓
tide-subagent.ts spawns isolated Pi process (--mode json --no-session)
    ↓
Subagent works independently:
  - explore: uses read, grep, find, ls + tide_index_* tools
  - research: uses web_search + read tools
    ↓
Output summarized (max 3000 chars) before returning to main agent
    ↓
Main agent receives summary without context pollution
```

**Models**: Configured per-role in Settings > Routing > Subagent Models, or cheapest available.

**Key files**:
- `pi-extensions/tide-subagent.ts` — agent spawning
- `pi-extensions/tide-agent-utils.ts` — shared utilities (runAgent, spawnPersistentAgent)

---

## 4. Expert Brainstorming (Multi-Agent P2P Discussion)

Team of domain experts + impartial Team Leader brainstorm via peer-to-peer messaging.

```
User clicks "Start Brainstorming" (Experts tab)
    ↓
Rust start_experts_session → sends [tide:experts] prompt to Pi
    ↓
tide-experts.ts spawns persistent Pi processes (--mode rpc --no-session):
  - Domain experts: architect, security, performance, etc.
  - ★ Team Leader: impartial orchestrator (auto-added)
    ↓
[1. EXPLORATION]  Domain experts analyze code using tide_index_* + read/grep tools
                  Leader monitors progress, asks follow-up questions
                  Agents communicate via file-based mailboxes (.tide/experts/sessions/{id}/mailboxes/)
                  send_message, check_messages, post_finding, read_findings tools
    ↓
[2. DISCUSSION]   Leader drives discussion — identifies agreement/tension
                  Leader asks targeted questions to specific experts
                  Experts respond, challenge, build on each other's ideas
    ↓
[3. SYNTHESIS]    Leader produces FINAL VERDICT:
                  - Consensus points
                  - Disagreements & rulings (with reasoning)
                  - Final recommendation
                  - Action items (prioritized)
                  - Risk assessment
    ↓
[4. PRESENT]      Synthesis appears in Experts tab group chat
                  User can: "▶ Plan & Execute" or "New Session"
    ↓
[5. EXECUTE]      (Optional) Feeds synthesis into Orchestrator pipeline
                  Expert analysis becomes the planning context
                  Orchestrator creates plan → user confirms → builds → reviews
```

**Models**:
- Domain experts: per-expert model configured in Settings > Experts (e.g., openai/gpt-5.4-mini)
- Team Leader: leader expert's configured model (editable in Expert Library)
- Plan execution: chatbox model (or per-step model via orchestrator)

**Time limits**: Configurable per team (default 5-15 min). At 80%, agents warned to wrap up. At 100%, leader forced to synthesize.

**Communication**: P2P via file-based mailboxes. Messages are JSON files written to `.tide/experts/sessions/{id}/mailboxes/{agent}/inbox/`. Frontend polls every 2s for live updates.

**Key files**:
- `pi-extensions/tide-experts.ts` — brainstorming orchestrator
- `pi-extensions/tide-expert-comms.ts` — P2P messaging tools
- `pi-extensions/tide-agent-utils.ts` — spawnPersistentAgent()
- `src-tauri/src/experts.rs` — Rust session management, mailbox watcher
- `src/components/ExpertsPanel/ExpertsTab.tsx` — group chat UI
- `src/stores/expertsStore.ts` — frontend state

---

## 5. Expert → Orchestrator Pipeline (End-to-End)

The full flow from brainstorming to code execution:

```
┌─────────────────────────────────────────────────────┐
│                  EXPERT BRAINSTORMING                │
│                                                      │
│  architect ←→ security ←→ performance                │
│       ↑           ↑           ↑                      │
│       └───── ★ Team Leader ────┘                     │
│              (drives + synthesizes)                   │
│                      ↓                               │
│              Final Verdict + Action Items             │
└──────────────────────┬──────────────────────────────┘
                       ↓
              "▶ Plan & Execute"
                       ↓
┌─────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                      │
│                                                      │
│  [Planning] Expert synthesis as context              │
│      ↓      → Pi creates structured plan             │
│  [PlanReady] User reviews in Plan tab                │
│      ↓      → User confirms                         │
│  [Building] Steps executed sequentially              │
│      ↓      → Code changes applied                   │
│  [Reviewing] QA loop checks output                   │
│      ↓      → Fixes applied if needed                │
│  [Complete] All steps done                           │
└─────────────────────────────────────────────────────┘
```

---

## 6. Plan Tab Actions

The Plan tab shows all plans and provides execution controls:

- **▶ Execute Plan** — Shown when a plan has all pending steps. Creates new chat, starts orchestrator.
- **▶ Resume from Step N** — Shown when a plan has some completed steps. Creates new chat, orchestrator picks up from first pending step with completed step summaries as context.

**Models**: Execution uses the chatbox's current model. Per-step model switching is available if `lockModelDuringOrchestration: false` in orchestrator config.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.tide/router-config.json` | Tier models (quick/standard/complex), orchestrator models, subagent models |
| `.tide/orchestrator-config.json` | Review mode, max iterations, QA commands, clarify timeout |
| `.tide/experts/experts/*.md` | Individual expert configs (model, temp, system prompt) |
| `.tide/experts/teams/*.json` | Team templates (members, leader, time limit, rounds) |
| `.tide/plans/*.json` | Execution plans with steps, statuses, dependencies |
| `.tide/experts/sessions/*/` | Brainstorming session data (state, mailboxes, findings) |
