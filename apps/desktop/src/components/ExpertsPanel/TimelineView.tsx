import React, { useEffect, useRef, useState } from "react";
import { useExpertsStore } from "../../stores/expertsStore";
import type { ExpertMailboxMessage } from "../../lib/ipc";

// ── Helpers ────────────────────────────────────────────────

/** Deterministic color from expert name */
const EXPERT_COLORS = [
  "#7aa2f7", "#bb9af7", "#9ece6a", "#e0af68", "#f7768e",
  "#7dcfff", "#73daca", "#ff9e64", "#b4f9f8", "#c0caf5",
];

function expertColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return EXPERT_COLORS[Math.abs(hash) % EXPERT_COLORS.length];
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const FINDING_BADGES: Record<string, { icon: string; color: string }> = {
  critical: { icon: "\uD83D\uDD34", color: "var(--error)" },
  warning: { icon: "\uD83D\uDFE1", color: "var(--warning)" },
  info: { icon: "\uD83D\uDD35", color: "var(--accent)" },
};

// ── Entry component (memoized) ─────────────────────────────

interface TimelineEntryProps {
  message: ExpertMailboxMessage;
}

const TimelineEntry = React.memo(function TimelineEntry({
  message,
}: TimelineEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const fromColor = expertColor(message.from);
  const isBroadcast = message.to === "*";
  const isFinding = message.type === "finding";
  const isToolCall = message.type === "tool_call" || message.type === "tool_result";

  // Try parsing finding severity from content
  let findingSeverity: string | null = null;
  if (isFinding) {
    const lower = message.content.toLowerCase();
    if (lower.includes("critical")) findingSeverity = "critical";
    else if (lower.includes("warning")) findingSeverity = "warning";
    else findingSeverity = "info";
  }

  const findingBadge = findingSeverity ? FINDING_BADGES[findingSeverity] : null;

  return (
    <div style={s.entry}>
      {/* Timestamp */}
      <span style={s.entryTime}>{formatTime(message.timestamp)}</span>

      {/* From/To badges */}
      <div style={s.entryBadges}>
        <span
          style={{
            ...s.badge,
            backgroundColor: `${fromColor}20`,
            color: fromColor,
          }}
        >
          {message.from}
        </span>
        <span style={s.arrow}>{"->"}</span>
        {isBroadcast ? (
          <span style={{ ...s.badge, ...s.broadcastBadge }}>*</span>
        ) : (
          <span
            style={{
              ...s.badge,
              backgroundColor: `${expertColor(message.to)}20`,
              color: expertColor(message.to),
            }}
          >
            {message.to}
          </span>
        )}
      </div>

      {/* Type badge */}
      <span style={s.typeBadge}>{message.type}</span>

      {/* Finding severity */}
      {findingBadge && (
        <span style={{ ...s.severityBadge, color: findingBadge.color }}>
          {findingBadge.icon}
        </span>
      )}

      {/* Content */}
      <div style={s.entryContent}>
        {isToolCall ? (
          <>
            <button
              style={s.toolToggle}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "\u25BE" : "\u25B8"} {message.content.slice(0, 60)}
              {message.content.length > 60 ? "\u2026" : ""}
            </button>
            {expanded && (
              <pre style={s.toolDetails}>{message.content}</pre>
            )}
          </>
        ) : (
          <span style={s.contentText}>{message.content}</span>
        )}
      </div>
    </div>
  );
});

// ── Main component ─────────────────────────────────────────

export const TimelineView = React.memo(function TimelineView() {
  const messages = useExpertsStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  // Sort by timestamp
  const sorted = React.useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [messages],
  );

  // Auto-scroll when new messages arrive (only if user was at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [sorted.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    wasAtBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  if (sorted.length === 0) {
    return (
      <div style={s.empty}>
        <span style={s.emptyText}>No messages yet</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      style={s.container}
      onScroll={handleScroll}
    >
      {sorted.map((msg) => (
        <TimelineEntry key={msg.id} message={msg} />
      ))}
    </div>
  );
});

// ── Styles ─────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    opacity: 0.5,
  },
  emptyText: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
  },
  entry: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "5px 8px",
    borderRadius: "var(--radius-sm)",
    transition: "background 0.1s",
  },
  entryTime: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    opacity: 0.7,
    flexShrink: 0,
    minWidth: 58,
    paddingTop: 1,
  },
  entryBadges: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
    minWidth: 130,
  },
  badge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 500,
    padding: "1px 5px",
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap",
    maxWidth: 60,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  broadcastBadge: {
    backgroundColor: "rgba(224, 175, 104, 0.15)",
    color: "var(--warning)",
    fontWeight: 700,
  },
  arrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-secondary)",
    opacity: 0.5,
  },
  typeBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-tertiary)",
    padding: "1px 4px",
    borderRadius: 2,
    flexShrink: 0,
  },
  severityBadge: {
    fontSize: 10,
    flexShrink: 0,
  },
  entryContent: {
    flex: 1,
    minWidth: 0,
  },
  contentText: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  toolToggle: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--accent)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textAlign: "left",
  },
  toolDetails: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    marginTop: 4,
    overflow: "auto",
    maxHeight: 200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
  },
};
