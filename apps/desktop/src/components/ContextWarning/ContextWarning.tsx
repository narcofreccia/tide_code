import { useContextStore } from "../../stores/contextStore";
import { useStreamStore } from "../../stores/stream";
import { compactContext } from "../../lib/ipc";

export function ContextWarning() {
  const breakdown = useContextStore((s) => s.breakdown);
  const warningDismissedAt = useContextStore((s) => s.warningDismissedAt);
  const dismissWarning = useContextStore((s) => s.dismissWarning);
  const isCompacting = useStreamStore((s) => s.isCompacting);

  if (!breakdown) return null;

  const pct = Math.round(breakdown.usagePercent * 100);

  // Don't show if already dismissed at or above this percentage
  if (pct <= warningDismissedAt) return null;

  // Only show at 70%+ thresholds
  if (pct < 70) return null;

  const isCritical = pct >= 85;

  return (
    <div style={{
      ...s.container,
      background: isCritical ? "rgba(247,118,142,0.1)" : "rgba(224,175,104,0.08)",
      borderColor: isCritical ? "rgba(247,118,142,0.3)" : "rgba(224,175,104,0.2)",
    }}>
      <span style={{
        ...s.text,
        color: isCritical ? "var(--error)" : "var(--warning)",
      }}>
        {isCritical
          ? `Context nearly full (${pct}%). Compact now to avoid degraded responses.`
          : `Context is ${pct}% full. Consider compacting or starting a new session.`
        }
      </span>
      <div style={s.actions}>
        {isCritical && (
          <button
            style={s.compactBtn}
            onClick={async () => {
              if (isCompacting) return;
              const ctxStore = useContextStore.getState();
              if (ctxStore.breakdown) {
                ctxStore.setPreCompactTokens(ctxStore.breakdown.totalTokens);
              }
              useStreamStore.setState({ isCompacting: true });
              try {
                await compactContext();
              } catch {
                useStreamStore.setState({ isCompacting: false });
              }
            }}
            disabled={isCompacting}
            type="button"
          >
            {isCompacting ? "Compacting..." : "Compact Now"}
          </button>
        )}
        <button
          style={s.dismissBtn}
          onClick={dismissWarning}
          type="button"
          title="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderTop: "1px solid",
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: "var(--font-size-xs)",
    lineHeight: 1.3,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  compactBtn: {
    background: "var(--error)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "3px 10px",
    fontSize: "var(--font-size-xs)",
    color: "#fff",
    fontWeight: 600,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  dismissBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 14,
    padding: "0 4px",
    fontFamily: "var(--font-mono)",
  },
};
