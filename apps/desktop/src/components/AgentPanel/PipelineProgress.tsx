import { useOrchestrationStore, type OrcPhase } from "../../stores/orchestrationStore";
import { cancelOrchestration, confirmPlanExecution } from "../../lib/ipc";

const PHASES: { key: OrcPhase; label: string }[] = [
  { key: "routing", label: "Route" },
  { key: "planning", label: "Plan" },
  { key: "plan_ready", label: "Confirm" },
  { key: "building", label: "Build" },
  { key: "reviewing", label: "Review" },
  { key: "complete", label: "Done" },
];

function phaseIndex(phase: OrcPhase): number {
  const i = PHASES.findIndex((p) => p.key === phase);
  return i >= 0 ? i : -1;
}

export function PipelineProgress() {
  const { phase, currentStep, totalSteps, message } = useOrchestrationStore();

  if (phase === "idle") return null;

  const activeIdx = phaseIndex(phase);
  const isFailed = phase === "failed";
  const isActive = phase !== "complete" && phase !== "failed";
  const isPlanReady = phase === "plan_ready";

  return (
    <div style={s.container}>
      <div style={s.phases}>
        {PHASES.map((p, i) => {
          const isDone = activeIdx > i || phase === "complete";
          const isActive = activeIdx === i && !isFailed;
          const isPending = activeIdx < i && !isFailed;

          let label = p.label;
          if (p.key === "building" && isActive && totalSteps > 0) {
            label = `Build ${currentStep}/${totalSteps}`;
          }

          return (
            <div key={p.key} style={s.phaseGroup}>
              {i > 0 && (
                <div
                  style={{
                    ...s.connector,
                    backgroundColor: isDone
                      ? "var(--success, #4ade80)"
                      : "var(--border)",
                  }}
                />
              )}
              <div
                style={{
                  ...s.dot,
                  ...(isDone ? s.dotDone : {}),
                  ...(isActive ? s.dotActive : {}),
                  ...(isPending ? s.dotPending : {}),
                  ...(isFailed && activeIdx === i ? s.dotFailed : {}),
                  ...(isPlanReady && p.key === "plan_ready" ? s.dotConfirm : {}),
                }}
              />
              <span
                style={{
                  ...s.label,
                  ...(isActive ? s.labelActive : {}),
                  ...(isDone ? s.labelDone : {}),
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
        {isPlanReady ? (
          <div style={s.actionBtns}>
            <button
              style={s.executeBtn}
              onClick={() => confirmPlanExecution().catch(console.error)}
              title="Execute the plan"
            >
              Execute Plan
            </button>
            <button
              style={s.cancelBtn}
              onClick={() => cancelOrchestration().catch(console.error)}
              title="Cancel orchestration"
            >
              Cancel
            </button>
          </div>
        ) : isActive ? (
          <button
            style={s.cancelBtn}
            onClick={() => cancelOrchestration().catch(console.error)}
            title="Cancel orchestration"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {isPlanReady && (
        <div style={s.planReadyMsg}>Review the plan, then click Execute to proceed.</div>
      )}
      {isFailed && message && (
        <div style={s.errorMsg}>{message}</div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-tertiary)",
  },
  phases: {
    display: "flex",
    alignItems: "center",
    gap: 0,
  },
  phaseGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  connector: {
    width: 16,
    height: 1,
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
    transition: "all 0.2s ease",
  },
  dotDone: {
    backgroundColor: "var(--success, #4ade80)",
  },
  dotActive: {
    backgroundColor: "var(--accent)",
    boxShadow: "0 0 0 2px rgba(122, 162, 247, 0.3)",
  },
  dotPending: {
    backgroundColor: "var(--border)",
  },
  dotFailed: {
    backgroundColor: "var(--error, #f87171)",
  },
  dotConfirm: {
    backgroundColor: "var(--warning, #eab308)",
    boxShadow: "0 0 0 2px rgba(234, 179, 8, 0.3)",
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
  },
  labelActive: {
    color: "var(--accent)",
    fontWeight: 600,
  },
  labelDone: {
    color: "var(--success, #4ade80)",
  },
  actionBtns: {
    marginLeft: "auto",
    display: "flex",
    gap: 6,
  },
  executeBtn: {
    padding: "3px 12px",
    fontSize: 10,
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    color: "#fff",
    background: "var(--success, #4ade80)",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  cancelBtn: {
    marginLeft: "auto",
    padding: "2px 8px",
    fontSize: 10,
    fontFamily: "var(--font-ui)",
    color: "var(--text-secondary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  planReadyMsg: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--warning, #eab308)",
    marginTop: 4,
  },
  errorMsg: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--error, #f87171)",
    marginTop: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
};
