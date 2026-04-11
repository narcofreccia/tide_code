import React from "react";
import { useExpertsStore } from "../../stores/expertsStore";
import type { ExpertMailboxMessage } from "../../lib/ipc";

// ── Types ──────────────────────────────────────────────────

interface ExpertInfo {
  name: string;
  model: string;
  status: string;
  messageCount: number;
  findingCount: number;
}

interface ExpertCardProps {
  expert: ExpertInfo;
  messages: ExpertMailboxMessage[];
}

// ── Status config ──────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { color: string; icon: string; label: string }
> = {
  pending: { color: "var(--text-secondary)", icon: "○", label: "Pending" },
  running: { color: "var(--warning)", icon: "◑", label: "Running" },
  thinking: { color: "var(--warning)", icon: "◑", label: "Thinking" },
  done: { color: "var(--success)", icon: "●", label: "Done" },
  completed: { color: "var(--success)", icon: "●", label: "Done" },
  failed: { color: "var(--error)", icon: "✕", label: "Failed" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
}

function abbreviate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "\u2026";
}

// ── Component ──────────────────────────────────────────────

export const ExpertCard = React.memo(function ExpertCard({
  expert,
  messages,
}: ExpertCardProps) {
  const expandedCards = useExpertsStore((s) => s.expandedCards);
  const toggleCardExpanded = useExpertsStore((s) => s.toggleCardExpanded);
  const setSelectedExpert = useExpertsStore((s) => s.setSelectedExpert);
  const setViewMode = useExpertsStore((s) => s.setViewMode);

  const isExpanded = !!expandedCards[expert.name];
  const sc = getStatusConfig(expert.status);

  // Messages from this expert
  const expertMessages = messages.filter((m) => m.from === expert.name);
  const recentMessages = expertMessages.slice(-3);

  const handleViewChat = () => {
    setSelectedExpert(expert.name);
    setViewMode("conversation");
  };

  return (
    <div
      style={{
        ...s.card,
        borderLeftColor: sc.color,
      }}
    >
      {/* Header */}
      <div style={s.header}>
        <div style={s.nameRow}>
          <span style={s.name}>{expert.name}</span>
          <span style={s.modelBadge}>{expert.model}</span>
        </div>
        <div style={s.statusRow}>
          <span style={{ ...s.statusIcon, color: sc.color }}>{sc.icon}</span>
          <span style={{ ...s.statusLabel, color: sc.color }}>{sc.label}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={s.stats}>
        <span style={s.stat}>
          <span style={s.statValue}>{expert.messageCount}</span>
          <span style={s.statLabel}>msgs</span>
        </span>
        <span style={s.stat}>
          <span style={s.statValue}>{expert.findingCount}</span>
          <span style={s.statLabel}>findings</span>
        </span>
      </div>

      {/* Recent messages preview */}
      {recentMessages.length > 0 && (
        <div style={s.preview}>
          {recentMessages.map((msg) => (
            <div key={msg.id} style={s.previewItem}>
              <span style={s.previewTo}>{msg.to === "*" ? "all" : msg.to}</span>
              <span style={s.previewContent}>
                {abbreviate(msg.content, 80)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Expand toggle */}
      <button
        style={s.expandBtn}
        onClick={() => toggleCardExpanded(expert.name)}
      >
        {isExpanded ? "Collapse" : "Show all messages"}
      </button>

      {/* Expanded full message list */}
      {isExpanded && (
        <div style={s.expanded}>
          {expertMessages.length === 0 && (
            <span style={s.noMessages}>No messages yet</span>
          )}
          {expertMessages.map((msg) => (
            <div key={msg.id} style={s.messageItem}>
              <div style={s.messageMeta}>
                <span style={s.messageType}>{msg.type}</span>
                <span style={s.messageArrow}>
                  {msg.from} {"-> "}
                  {msg.to === "*" ? "all" : msg.to}
                </span>
                <span style={s.messageTime}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={s.messageContent}>{msg.content}</div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={s.footer}>
        <button style={s.viewChatBtn} onClick={handleViewChat}>
          View Full Chat
        </button>
      </div>
    </div>
  );
});

// ── Styles ─────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-sm)",
    borderLeft: "3px solid",
    borderLeftColor: "var(--text-secondary)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  name: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--text-bright)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  modelBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--accent)",
    backgroundColor: "rgba(122, 162, 247, 0.1)",
    padding: "1px 5px",
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  statusIcon: {
    fontSize: "var(--font-size-sm)",
    lineHeight: 1,
  },
  statusLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
  },
  stats: {
    display: "flex",
    gap: 12,
  },
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  statValue: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  statLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    color: "var(--text-secondary)",
  },
  preview: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  previewItem: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
  },
  previewTo: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    flexShrink: 0,
    minWidth: 40,
  },
  previewContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  expandBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--accent)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textAlign: "left",
    opacity: 0.8,
  },
  expanded: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 300,
    overflowY: "auto",
    padding: "4px 0",
    borderTop: "1px solid var(--bg-tertiary)",
  },
  noMessages: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
  messageItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "4px 0",
  },
  messageMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  messageType: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--accent)",
    backgroundColor: "rgba(122, 162, 247, 0.1)",
    padding: "0 4px",
    borderRadius: 2,
  },
  messageArrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
  },
  messageTime: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    opacity: 0.7,
    marginLeft: "auto",
  },
  messageContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: 4,
    borderTop: "1px solid var(--bg-tertiary)",
  },
  viewChatBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--accent)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
    textDecorationColor: "rgba(122, 162, 247, 0.3)",
  },
};
