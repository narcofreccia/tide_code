import { useEffect, useState } from "react";
import { listSkills, type SkillInfo } from "../../lib/ipc";

export function SkillsPlaceholder() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  async function loadSkills() {
    setLoading(true);
    setError(null);
    try {
      const result = await listSkills();
      setSkills(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={s.header}>
        <h3 style={s.heading}>Skills</h3>
        <button style={s.refreshBtn} onClick={loadSkills} title="Refresh">
          ↻
        </button>
      </div>
      <p style={s.description}>
        Pi skills are capability packages that load on-demand. They live in{" "}
        <code style={s.code}>~/.pi/agent/skills/</code> (global) or{" "}
        <code style={s.code}>.pi/skills/</code> (workspace).
      </p>

      {loading && <p style={s.status}>Discovering skills...</p>}
      {error && <p style={s.error}>Error: {error}</p>}

      {!loading && skills.length === 0 && (
        <div style={s.empty}>
          <p style={s.emptyText}>No skills installed.</p>
          <p style={s.emptyHint}>
            Install skills with <code style={s.code}>pi install &lt;source&gt;</code> or
            add <code style={s.code}>SKILL.md</code> files to your skills directories.
          </p>
        </div>
      )}

      {skills.length > 0 && (
        <div style={s.list}>
          {skills.map((skill) => (
            <div key={skill.path} style={s.card}>
              <div style={s.cardHeader}>
                <span style={s.name}>{skill.name}</span>
                <span style={s.badge}>{skill.source}</span>
              </div>
              {skill.description && (
                <p style={s.cardDesc}>{skill.description}</p>
              )}
              <p style={s.cardPath}>{skill.path}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  heading: {
    margin: 0,
    fontSize: "var(--font-size-lg)",
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  refreshBtn: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
  },
  description: {
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
    marginBottom: 12,
  },
  code: {
    background: "var(--bg-secondary, #1e1e2e)",
    padding: "1px 4px",
    borderRadius: 3,
    fontSize: "0.9em",
  },
  status: {
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
  error: {
    fontSize: "var(--font-size-sm)",
    color: "var(--error, #f38ba8)",
  },
  empty: {
    padding: "16px 0",
  },
  emptyText: {
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
    fontStyle: "italic",
    margin: "0 0 8px 0",
  },
  emptyHint: {
    fontSize: "var(--font-size-xs, 11px)",
    color: "var(--text-tertiary, #6c7086)",
    margin: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  card: {
    background: "var(--bg-secondary, #1e1e2e)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    fontWeight: 600,
    fontSize: "var(--font-size-sm)",
    color: "var(--text-bright)",
  },
  badge: {
    fontSize: "var(--font-size-xs, 11px)",
    color: "var(--text-secondary)",
    background: "var(--bg-tertiary, #313244)",
    padding: "1px 6px",
    borderRadius: 3,
  },
  cardDesc: {
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    margin: "0 0 4px 0",
  },
  cardPath: {
    fontSize: "var(--font-size-xs, 11px)",
    color: "var(--text-tertiary, #6c7086)",
    margin: 0,
    fontFamily: "monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
