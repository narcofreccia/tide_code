# Agent Flow Validation Checklist

Use after completing each task. Check all flows touched by the change.

## 1. Normal Chat

- [ ] Send a simple prompt (< 50 chars) — routes to `sendPrompt`, not orchestrate
- [ ] Send a complex prompt (with "refactor" keyword) — routes to `orchestrate`
- [ ] Toggle force-orchestrate button — next prompt uses orchestrator
- [ ] Steer agent mid-run — `steerAgent` delivers new direction
- [ ] Abort agent — streaming stops cleanly
- [ ] Context meter updates after agent completes (reads from snapshot, not usage.input)
- [ ] Context meter shows 0% after new session

## 2. Orchestration Pipeline

- [ ] Start orchestration — phases emit: routing -> planning -> plan_ready -> building -> reviewing -> complete
- [ ] Cancel during planning — orchestration stops, phase resets to failed
- [ ] Confirm plan execution at plan_ready — build phase begins
- [ ] Context meter reflects snapshot values during orchestrated run
- [ ] Heartbeat events arrive every 10s during active orchestration

## 3. Saved Plan Execute / Resume

- [ ] Execute a saved plan from Plan tab — calls `execute_plan` backend command (not generic `orchestrate`)
- [ ] Plan loads from `.tide/plans/{id}.json` with correct steps and metadata
- [ ] Execute runs all steps in dependency order
- [ ] Resume picks up from pending steps only (completed steps skipped)
- [ ] Plan's `initialModel` is set before execution begins
- [ ] Cancel during plan execution — stops cleanly

## 4. Clarification Handoff

- [ ] Planning phase — agent calls `tide_plan_clarify` — ClarifyCard appears
- [ ] Answer questions — responses reach the extension, planning continues
- [ ] Timeout — agent proceeds with best judgment
- [ ] No title-matching on "Plan Clarification" — input captured by clarify state, not title string

## 5. Expert Session Start / Resume / Send

- [ ] Start expert session — team spawned, messages appear in ExpertsTab
- [ ] `activeSessionId` in store matches the real session directory
- [ ] Send message to specific expert — lands in correct inbox
- [ ] Send message while multiple sessions exist — explicit session_id routes correctly (no mtime lookup)
- [ ] Resume session — phase hydrated from backend `state.json`, not forced to "exploration"
- [ ] Resume shows correct expert statuses and message history

## 6. Expert-to-Orchestrator Execution

- [ ] Click "Execute via Orchestrator" from synthesis — system message indicates expert-backed orchestration
- [ ] Chat tab activates, messages cleared, orchestration begins
- [ ] Expert synthesis injected as context (via session ID)
- [ ] Orchestrator plans using expert findings (check planning prompt includes synthesis)

## 7. Context Meter Lifecycle

- [ ] Fresh mount — snapshot loaded on first render
- [ ] After agent_end — refreshes from snapshot
- [ ] After session switch — refreshes from snapshot (300ms delay)
- [ ] After compaction — refreshes from snapshot
- [ ] After auto-compaction — refreshes from snapshot
- [ ] After model change (context window changes) — budget updated, usage preserved
- [ ] Categories always consistent with top-line total (both from snapshot)
