import React, { useEffect, useRef, useMemo, useCallback } from "react";
import { useExpertsStore } from "../../stores/expertsStore";
import type { ExpertMailboxMessage } from "../../lib/ipc";

// ── Helpers ────────────────────────────────────────────────

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

// ── Chat Bubble (memoized) ─────────────────────────────────

interface BubbleProps {
  message: ExpertMailboxMessage;
  align: "left" | "right";
}

const ChatBubble = React.memo(function ChatBubble({
  message,
  align,
}: BubbleProps) {
  const color = expertColor(message.from);
  const isLeft = align === "left";

  return (
    <div
      style={{
        ...s.bubbleRow,
        justifyContent: isLeft ? "flex-start" : "flex-end",
      }}
    >
      <div
        style={{
          ...s.bubble,
          borderLeftColor: isLeft ? color : "transparent",
          borderRightColor: isLeft ? "transparent" : color,
          borderLeftWidth: isLeft ? 3 : 0,
          borderRightWidth: isLeft ? 0 : 3,
          marginLeft: isLeft ? 0 : 40,
          marginRight: isLeft ? 40 : 0,
        }}
      >
        <div style={s.bubbleHeader}>
          <span style={{ ...s.bubbleSender, color }}>{message.from}</span>
          {message.to !== "*" && (
            <>
              <span style={s.bubbleArrow}>{"-> "}</span>
              <span style={s.bubbleRecipient}>{message.to}</span>
            </>
          )}
          {message.to === "*" && (
            <span style={s.broadcastTag}>broadcast</span>
          )}
          <span style={s.bubbleTime}>{formatTime(message.timestamp)}</span>
        </div>
        <div style={s.bubbleContent}>{message.content}</div>
        {message.type !== "message" && (
          <span style={s.bubbleType}>{message.type}</span>
        )}
      </div>
    </div>
  );
});

// ── Main component ─────────────────────────────────────────

export function ConversationView() {
  const messages = useExpertsStore((s) => s.messages);
  const selectedExpert = useExpertsStore((s) => s.selectedExpert);
  const setSelectedExpert = useExpertsStore((s) => s.setSelectedExpert);
  const activeSession = useExpertsStore((s) => s.activeSession);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get expert names from session
  const expertNames = useMemo(() => {
    if (!activeSession) return [];
    return activeSession.experts.map((e) => e.name);
  }, [activeSession]);

  // Filter and sort messages
  const filtered = useMemo(() => {
    const sorted = [...messages].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    if (!selectedExpert) return sorted;
    return sorted.filter(
      (m) => m.from === selectedExpert || m.to === selectedExpert || m.to === "*",
    );
  }, [messages, selectedExpert]);

  // Auto-scroll only when user is already near bottom
  const wasAtBottom = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && wasAtBottom.current) el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  return (
    <div style={s.container}>
      {/* Agent selector */}
      <div style={s.selectorRow}>
        <select
          style={s.select}
          value={selectedExpert ?? "__all__"}
          onChange={(e) =>
            setSelectedExpert(
              e.target.value === "__all__" ? null : e.target.value,
            )
          }
        >
          <option value="__all__">All threads</option>
          {expertNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span style={s.messageCount}>
          {filtered.length} message{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={s.messages} onScroll={handleScroll}>
        {filtered.length === 0 && (
          <div style={s.empty}>
            <span style={s.emptyText}>No messages to display</span>
          </div>
        )}
        {filtered.map((msg) => {
          // Determine alignment
          let align: "left" | "right" = "left";
          if (selectedExpert) {
            align = msg.from === selectedExpert ? "left" : "right";
          }
          return <ChatBubble key={msg.id} message={msg} align={align} />;
        })}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    gap: 8,
    minHeight: 0,
  },
  selectorRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  select: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid var(--border, rgba(86, 95, 137, 0.3))",
    borderRadius: "var(--radius-sm)",
    padding: "4px 8px",
    outline: "none",
    flex: 1,
    maxWidth: 200,
  },
  messageCount: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
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
  bubbleRow: {
    display: "flex",
  },
  bubble: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 10px",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-sm)",
    borderStyle: "solid",
    borderTopWidth: 0,
    borderBottomWidth: 0,
    maxWidth: "85%",
    minWidth: 120,
  },
  bubbleHeader: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  bubbleSender: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
  },
  bubbleArrow: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-secondary)",
    opacity: 0.5,
  },
  bubbleRecipient: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
  },
  broadcastTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--warning)",
    backgroundColor: "rgba(224, 175, 104, 0.1)",
    padding: "0 3px",
    borderRadius: 2,
  },
  bubbleTime: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-secondary)",
    opacity: 0.6,
    marginLeft: "auto",
  },
  bubbleContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  bubbleType: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-secondary)",
    opacity: 0.5,
    alignSelf: "flex-end",
  },
};
