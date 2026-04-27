import { useState } from "react";
import { useUpdaterStore } from "../stores/updaterStore";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function UpdateBanner() {
  const state = useUpdaterStore((s) => s.state);
  const dismissed = useUpdaterStore((s) => s.dismissed);
  const version = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const contentLength = useUpdaterStore((s) => s.contentLength);
  const downloaded = useUpdaterStore((s) => s.downloaded);
  const progress = useUpdaterStore((s) => s.progress);
  const errorMsg = useUpdaterStore((s) => s.errorMsg);

  const [showDetails, setShowDetails] = useState(false);

  if (dismissed) return null;
  if (state === "idle" || state === "checking") return null;

  const handleDownload = () => useUpdaterStore.getState().downloadAndInstall();
  const handleRelaunch = () => useUpdaterStore.getState().relaunch();
  const handleDismiss = () => useUpdaterStore.getState().dismiss();
  const handleRetry = () => useUpdaterStore.getState().downloadAndInstall();

  const isError = state === "error";
  const bg = isError ? "var(--error, #ef4444)" : "var(--accent)";

  return (
    <>
      <div style={{ ...s.bar, background: bg }}>
        {state === "available" && (
          <>
            <span style={s.icon} aria-hidden>↓</span>
            <span style={s.text}>
              <strong>TideCode v{version}</strong> is available.
              {notes && <span style={s.notes}> {notes.split("\n")[0]}</span>}
            </span>
            <button style={s.button} onClick={handleDownload}>Update Now</button>
            <button style={s.iconBtn} onClick={handleDismiss} aria-label="Dismiss">×</button>
          </>
        )}

        {state === "downloading" && (
          <>
            <span style={{ ...s.icon, animation: "tidePulse 1s ease-in-out infinite" }} aria-hidden>⟳</span>
            <span style={s.text}>
              Downloading update…
              {contentLength > 0 && ` ${formatBytes(downloaded)} / ${formatBytes(contentLength)}`}
            </span>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${progress}%` }} />
            </div>
          </>
        )}

        {state === "ready" && (
          <>
            <span style={s.icon} aria-hidden>✓</span>
            <span style={s.text}>Update downloaded. Restart to apply.</span>
            <button style={s.button} onClick={handleRelaunch}>Restart</button>
          </>
        )}

        {state === "error" && (
          <>
            <span style={s.icon} aria-hidden>!</span>
            <span style={s.text}>
              Update failed: {(errorMsg.split("\n")[0] || "unknown error").slice(0, 120)}
              <button
                onClick={() => setShowDetails((v) => !v)}
                style={s.detailsLink}
              >
                details
              </button>
            </span>
            <button style={s.button} onClick={handleRetry}>Retry</button>
            <button style={s.iconBtn} onClick={handleDismiss} aria-label="Dismiss">×</button>
          </>
        )}
      </div>
      {state === "error" && showDetails && (
        <pre style={s.errorDetails}>{errorMsg}</pre>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "6px 12px",
    color: "#fff",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-ui)",
    boxSizing: "border-box",
  },
  icon: {
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
    fontWeight: 700,
    width: 16,
    textAlign: "center" as const,
  },
  text: {
    flex: 1,
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  notes: {
    opacity: 0.8,
    marginLeft: 6,
  },
  button: {
    padding: "3px 10px",
    background: "rgba(255,255,255,0.18)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  },
  iconBtn: {
    padding: "2px 8px",
    background: "transparent",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    lineHeight: 1,
  },
  progressTrack: {
    width: 120,
    height: 4,
    background: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    overflow: "hidden",
    flexShrink: 0,
  },
  progressFill: {
    height: "100%",
    background: "#fff",
    borderRadius: 2,
    transition: "width 0.15s ease-out",
  },
  detailsLink: {
    marginLeft: 6,
    background: "transparent",
    border: "none",
    color: "#fff",
    textDecoration: "underline",
    opacity: 0.85,
    cursor: "pointer",
    padding: 0,
    fontSize: "var(--font-size-xs)",
  },
  errorDetails: {
    width: "100%",
    margin: 0,
    padding: "8px 12px",
    background: "rgba(0,0,0,0.4)",
    color: "var(--error, #fca5a5)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    whiteSpace: "pre-wrap" as const,
    maxHeight: 140,
    overflow: "auto",
    boxSizing: "border-box",
  },
};
