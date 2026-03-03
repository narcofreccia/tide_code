import { useState, useEffect, useRef } from "react";
import { useStreamStore } from "./stores/stream";
import { useEngineStore } from "./stores/engine";
import { sendMessage } from "./lib/ipc";
import "./styles/global.css";

export function App() {
  const [input, setInput] = useState("");
  const { content, isStreaming, handleEvent, reset } = useStreamStore();
  const { status, setStatus } = useEngineStore();
  const outputRef = useRef<HTMLDivElement>(null);

  // Check engine status on mount
  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<string>("get_engine_status");
        if (!cancelled) {
          setStatus(result === "connected" ? "connected" : "disconnected");
        }
      } catch {
        if (!cancelled) setStatus("disconnected");
      }
    };

    // Poll until connected
    const interval = setInterval(checkStatus, 1000);
    checkStatus();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setStatus]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [content]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput("");
    reset();

    try {
      await sendMessage(msg, handleEvent);
    } catch (err) {
      console.error("Send failed:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor =
    status === "connected"
      ? "var(--success)"
      : status === "error"
        ? "var(--error)"
        : "var(--text-secondary)";

  return (
    <div style={styles.container}>
      {/* Top status bar */}
      <div style={styles.topBar}>
        <span style={styles.title}>Tide</span>
        <span style={{ ...styles.statusDot, background: statusColor }} />
        <span style={styles.statusText}>
          Engine: {status}
        </span>
      </div>

      {/* Main content */}
      <div style={styles.main}>
        {/* Output area */}
        <div ref={outputRef} style={styles.output}>
          {content ? (
            <pre style={styles.outputText}>{content}</pre>
          ) : (
            <p style={styles.placeholder}>
              Send a message to test streaming...
            </p>
          )}
          {isStreaming && <span style={styles.cursor}>|</span>}
        </div>

        {/* Input area */}
        <div style={styles.inputArea}>
          <textarea
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Cmd+Enter to send)"
            rows={2}
            disabled={isStreaming}
          />
          <button
            style={{
              ...styles.button,
              opacity: isStreaming || !input.trim() ? 0.5 : 1,
            }}
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
          >
            {isStreaming ? "Streaming..." : "Send"}
          </button>
        </div>
      </div>

      {/* Bottom status bar */}
      <div style={styles.bottomBar}>
        <span style={styles.bottomText}>Tide v0.1.0</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: "var(--status-bar-height)",
    padding: "0 12px",
    background: "var(--bg-tertiary)",
    borderBottom: "1px solid var(--border)",
    fontSize: "var(--font-size-sm)",
  },
  title: {
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    marginLeft: 8,
  },
  statusText: {
    color: "var(--text-secondary)",
    fontSize: "var(--font-size-xs)",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: 16,
    gap: 12,
    overflow: "hidden",
  },
  output: {
    flex: 1,
    overflow: "auto",
    padding: 12,
    background: "var(--bg-secondary)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
  },
  outputText: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-md)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
    lineHeight: 1.5,
  },
  placeholder: {
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
  cursor: {
    color: "var(--accent)",
    animation: "blink 1s step-end infinite",
  },
  inputArea: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    padding: "8px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-md)",
    color: "var(--text-primary)",
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    resize: "none",
    outline: "none",
  },
  button: {
    padding: "8px 20px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-md)",
    fontWeight: 500,
    color: "white",
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  },
  bottomBar: {
    display: "flex",
    alignItems: "center",
    height: "var(--status-bar-height)",
    padding: "0 12px",
    background: "var(--bg-tertiary)",
    borderTop: "1px solid var(--border)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
  },
  bottomText: {},
};
