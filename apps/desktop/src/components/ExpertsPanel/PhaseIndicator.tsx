import React, { useEffect, useState } from "react";
import { useExpertsStore, type ExpertsPhase } from "../../stores/expertsStore";

// ── Phase definitions ──────────────────────────────────────

const PHASES: { key: ExpertsPhase; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "exploration", label: "Exploration" },
  { key: "discussion", label: "Discussion" },
  { key: "synthesis", label: "Synthesis" },
  { key: "complete", label: "Done" },
];

const PHASE_ORDER: ExpertsPhase[] = PHASES.map((p) => p.key);

function phaseIndex(phase: ExpertsPhase): number {
  // "ready" and "executing" map to after synthesis
  if (phase === "ready" || phase === "executing") return PHASE_ORDER.indexOf("synthesis") + 0.5;
  if (phase === "complete") return PHASE_ORDER.length - 1;
  if (phase === "failed") return -1;
  return PHASE_ORDER.indexOf(phase);
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Component ──────────────────────────────────────────────

export function PhaseIndicator() {
  const phase = useExpertsStore((s) => s.phase);
  const startedAt = useExpertsStore((s) => s.startedAt);
  const timeLimitMinutes = useExpertsStore((s) => s.timeLimitMinutes);
  const isActive = useExpertsStore((s) => s.isActive);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive || !startedAt || !timeLimitMinutes) {
      setRemaining(null);
      return;
    }
    let iv: ReturnType<typeof setInterval>;
    const update = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const total = timeLimitMinutes * 60;
      const left = Math.max(0, total - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(iv);
    };
    update();
    iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [isActive, startedAt, timeLimitMinutes]);

  const currentIdx = phaseIndex(phase);

  return (
    <div style={s.container}>
      <div style={s.phases}>
        {PHASES.map((p, i) => {
          const isCurrent = p.key === phase || (phase === "ready" && p.key === "complete") || (phase === "executing" && p.key === "complete");
          const isCompleted = i < currentIdx;
          const isFailed = phase === "failed";

          return (
            <React.Fragment key={p.key}>
              {i > 0 && (
                <div
                  style={{
                    ...s.connector,
                    backgroundColor: isCompleted
                      ? "var(--accent)"
                      : "var(--bg-tertiary)",
                  }}
                />
              )}
              <div style={s.phaseItem}>
                <div
                  style={{
                    ...s.dot,
                    backgroundColor: isFailed && isCurrent
                      ? "var(--error)"
                      : isCurrent
                        ? "var(--accent)"
                        : isCompleted
                          ? "var(--accent)"
                          : "var(--bg-tertiary)",
                    border: isCurrent
                      ? "2px solid var(--accent)"
                      : isCompleted
                        ? "2px solid var(--accent)"
                        : "2px solid var(--text-secondary)",
                  }}
                />
                <span
                  style={{
                    ...s.label,
                    color: isCurrent
                      ? "var(--text-bright)"
                      : isCompleted
                        ? "var(--accent)"
                        : "var(--text-secondary)",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {p.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {remaining !== null && (
        <div style={s.timer}>
          <span
            style={{
              ...s.timerText,
              color: remaining < 60 ? "var(--error)" : "var(--text-secondary)",
            }}
          >
            {formatCountdown(remaining)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
  },
  phases: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    flex: 1,
  },
  phaseItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    boxSizing: "border-box",
  },
  label: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    whiteSpace: "nowrap",
  },
  connector: {
    flex: 1,
    height: 2,
    minWidth: 12,
    borderRadius: 1,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  timer: {
    flexShrink: 0,
    padding: "2px 8px",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--bg-tertiary)",
  },
  timerText: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
  },
};
