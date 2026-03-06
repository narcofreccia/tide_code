import { useEffect, useState } from "react";
import { keychainSetKey, keychainDeleteKey, keychainHasKey } from "../../lib/keychain";
import { restartPi } from "../../lib/ipc";

interface ProviderConfig {
  id: string;
  name: string;
  placeholder: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  { id: "google", name: "Google AI", placeholder: "AIza..." },
];

const SERVICES: ProviderConfig[] = [
  { id: "tavily", name: "Tavily (Web Search)", placeholder: "tvly-..." },
];

export function ProviderSettings() {
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const allKeys = [...PROVIDERS, ...SERVICES];

  useEffect(() => {
    checkAllKeys();
  }, []);

  const checkAllKeys = async () => {
    const status: Record<string, boolean> = {};
    for (const p of allKeys) {
      try {
        status[p.id] = await keychainHasKey(p.id);
      } catch {
        status[p.id] = false;
      }
    }
    setKeyStatus(status);
  };

  const handleSave = async (providerId: string) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    try {
      await keychainSetKey(providerId, keyInput.trim());
      setKeyStatus((prev) => ({ ...prev, [providerId]: true }));
      setEditing(null);
      setKeyInput("");
      setNeedsRestart(true);
    } catch (err) {
      console.error("Failed to save key:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await keychainDeleteKey(providerId);
      setKeyStatus((prev) => ({ ...prev, [providerId]: false }));
      setNeedsRestart(true);
    } catch (err) {
      console.error("Failed to delete key:", err);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartPi();
      setNeedsRestart(false);
    } catch (err) {
      console.error("Failed to restart Pi:", err);
    } finally {
      setRestarting(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setKeyInput("");
  };

  const renderKeyCard = (item: ProviderConfig) => (
    <div key={item.id} style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.providerName}>{item.name}</span>
        <span
          style={{
            ...s.badge,
            background: keyStatus[item.id]
              ? "var(--success)"
              : "var(--bg-tertiary)",
            color: keyStatus[item.id]
              ? "white"
              : "var(--text-secondary)",
          }}
        >
          {keyStatus[item.id] ? "Configured" : "Not set"}
        </span>
      </div>

      {editing === item.id ? (
        <div style={s.editRow}>
          <input
            style={s.input}
            type="password"
            placeholder={item.placeholder}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave(item.id);
              if (e.key === "Escape") handleCancel();
            }}
            autoFocus
          />
          <button
            style={s.saveBtn}
            onClick={() => handleSave(item.id)}
            disabled={saving || !keyInput.trim()}
          >
            Save
          </button>
          <button style={s.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={s.actionRow}>
          <button
            style={s.actionBtn}
            onClick={() => {
              setEditing(item.id);
              setKeyInput("");
            }}
          >
            {keyStatus[item.id] ? "Update" : "Add Key"}
          </button>
          {keyStatus[item.id] && (
            <button
              style={s.deleteBtn}
              onClick={() => handleDelete(item.id)}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <h3 style={s.heading}>API Keys</h3>
      <p style={s.description}>
        Keys are stored securely in the macOS Keychain. They are never displayed
        after saving.
      </p>

      {needsRestart && (
        <div style={s.restartBanner}>
          <span>API keys changed. Restart the agent to apply.</span>
          <button
            style={s.restartBtn}
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? "Restarting..." : "Restart Agent"}
          </button>
        </div>
      )}

      <div style={s.list}>
        {PROVIDERS.map((provider) => renderKeyCard(provider))}
      </div>

      <h3 style={{ ...s.heading, marginTop: 24 }}>Services</h3>
      <p style={s.description}>
        Optional service keys for extended capabilities like web search.
      </p>
      <div style={s.list}>
        {SERVICES.map((service) => renderKeyCard(service))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  heading: {
    margin: "0 0 4px 0",
    fontSize: "var(--font-size-lg)",
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  description: {
    margin: "0 0 16px 0",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
  },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: {
    padding: 12,
    background: "var(--bg-tertiary)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  providerName: {
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--text-bright)",
  },
  badge: {
    padding: "2px 8px",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
  },
  editRow: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    padding: "6px 10px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
  },
  actionRow: { display: "flex", gap: 8 },
  actionBtn: {
    padding: "4px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "white",
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  saveBtn: {
    padding: "4px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "white",
    background: "var(--success)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "4px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "var(--text-primary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  restartBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    marginBottom: 12,
    background: "rgba(59, 130, 246, 0.1)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
  },
  restartBtn: {
    padding: "4px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "white",
    background: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  deleteBtn: {
    padding: "4px 12px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "var(--error)",
    background: "transparent",
    border: "1px solid var(--error)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
};
