import { useEffect, useState, useCallback } from "react";
import { useContextStore } from "../../stores/contextStore";
import { getMessages } from "../../lib/ipc";
import { useStreamStore } from "../../stores/stream";

interface RawMessage {
  id?: string;
  entryId?: string;
  role?: string;
  type?: string;
  content?: unknown;
  timestamp?: string;
}

interface DisplayMessage {
  id: string;
  role: string;
  preview: string;
  tokens: number;
  timestamp: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part.text) return part.text;
        return "";
      })
      .join("");
  }
  return JSON.stringify(content ?? "");
}

const ROLE_ICONS: Record<string, string> = {
  user: "\u{1F464}",
  assistant: "\u{1F916}",
  system: "\u2699\uFE0F",
  tool: "\u{1F527}",
  tool_result: "\u{1F527}",
};

const ROLE_COLORS: Record<string, string> = {
  user: "#7aa2f7",
  assistant: "#9ece6a",
  system: "#565f89",
  tool: "#ff9e64",
  tool_result: "#ff9e64",
};

export function MessageList() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const { excludedIds, toggleExclusion, loadExclusions } = useContextStore();
  const streamMessages = useStreamStore((s) => s.messages);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      // Trigger get_messages — the response handler in stream.ts processes it,
      // but we also need to build our own display from the raw store messages
      await getMessages();
    } catch {
      // Ignore — Pi not ready
    }

    // Build display messages from the stream store
    const msgs = useStreamStore.getState().messages;
    const display: DisplayMessage[] = msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m, i) => {
        const text = "content" in m ? (m.content || "") : "";
        const ts = "timestamp" in m ? m.timestamp : Date.now();
        return {
          id: (m as any).piId || (m as any).entryId || `msg-${i}-${ts}`,
          role: m.role,
          preview: text.slice(0, 120).replace(/\n/g, " "),
          tokens: estimateTokens(text),
          timestamp: ts,
        };
      })
      .reverse(); // newest first

    setMessages(display);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadExclusions();
    fetchMessages();
  }, [fetchMessages, loadExclusions]);

  // Re-derive messages when stream messages change
  useEffect(() => {
    const msgs = streamMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m, i) => {
        const text = "content" in m ? (m.content || "") : "";
        const ts = "timestamp" in m ? m.timestamp : Date.now();
        return {
          id: (m as any).piId || (m as any).entryId || `msg-${i}-${ts}`,
          role: m.role,
          preview: text.slice(0, 120).replace(/\n/g, " "),
          tokens: estimateTokens(text),
          timestamp: ts,
        };
      })
      .reverse();
    setMessages(msgs);
    setLoading(false);
  }, [streamMessages]);

  const totalExcludedTokens = messages
    .filter((m) => excludedIds.has(m.id))
    .reduce((sum, m) => sum + m.tokens, 0);

  if (loading) {
    return <div style={s.empty}>Loading messages...</div>;
  }

  if (messages.length === 0) {
    return <div style={s.empty}>No messages in this session yet.</div>;
  }

  return (
    <div style={s.container}>
      {totalExcludedTokens > 0 && (
        <div style={s.savingsBanner}>
          Hiding {excludedIds.size} message{excludedIds.size !== 1 ? "s" : ""} (~{(totalExcludedTokens / 1000).toFixed(1)}K tokens saved)
        </div>
      )}
      <div style={s.list}>
        {messages.map((msg) => {
          const isExcluded = excludedIds.has(msg.id);
          return (
            <div
              key={msg.id}
              style={{
                ...s.row,
                opacity: isExcluded ? 0.4 : 1,
              }}
            >
              <span style={{ ...s.roleIcon, color: ROLE_COLORS[msg.role] || "var(--text-secondary)" }}>
                {ROLE_ICONS[msg.role] || "\u25CF"}
              </span>
              <div style={s.msgContent}>
                <div style={{
                  ...s.preview,
                  textDecoration: isExcluded ? "line-through" : "none",
                }}>
                  {msg.preview || "(empty)"}
                </div>
                <div style={s.meta}>
                  <span style={s.tokenBadge}>{msg.tokens.toLocaleString()} tok</span>
                  {isExcluded && <span style={s.hiddenBadge}>hidden from AI</span>}
                </div>
              </div>
              <button
                style={{
                  ...s.excludeBtn,
                  color: isExcluded ? "var(--error)" : "var(--text-secondary)",
                }}
                onClick={() => toggleExclusion(msg.id)}
                title={isExcluded ? "Re-include in context" : "Hide from context"}
                type="button"
              >
                {isExcluded ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
  },
  savingsBanner: {
    padding: "6px 12px",
    fontSize: "var(--font-size-xs)",
    color: "var(--success)",
    background: "rgba(158,206,106,0.08)",
    borderBottom: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflow: "auto",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid rgba(60,60,60,0.3)",
    transition: "opacity 0.15s ease",
  },
  roleIcon: {
    fontSize: 13,
    flexShrink: 0,
    marginTop: 2,
  },
  msgContent: {
    flex: 1,
    minWidth: 0,
  },
  preview: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    lineHeight: 1.4,
  },
  meta: {
    display: "flex",
    gap: 6,
    marginTop: 2,
  },
  tokenBadge: {
    fontSize: 10,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  hiddenBadge: {
    fontSize: 10,
    color: "var(--error)",
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
  },
  excludeBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  empty: {
    padding: 24,
    textAlign: "center" as const,
    color: "var(--text-secondary)",
    fontStyle: "italic",
    fontSize: "var(--font-size-sm)",
  },
};
