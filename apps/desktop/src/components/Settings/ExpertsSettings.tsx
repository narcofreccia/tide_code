import { useEffect, useState, useCallback } from "react";
import { useExpertsStore } from "../../stores/expertsStore";
import { useStreamStore, type AvailableModel } from "../../stores/stream";
import type { TeamConfig, ExpertConfigEntry } from "../../lib/ipc";

// ── Model Dropdown (reuses Pi's available models) ──────────

function groupByProvider(models: AvailableModel[]): Record<string, AvailableModel[]> {
  const grouped: Record<string, AvailableModel[]> = {};
  for (const m of models) {
    const p = m.provider || "other";
    if (!grouped[p]) grouped[p] = [];
    grouped[p].push(m);
  }
  return grouped;
}

function ModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const availableModels = useStreamStore((s) => s.availableModels);
  const grouped = groupByProvider(availableModels);
  return (
    <select style={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default (team model)</option>
      {Object.entries(grouped).map(([provider, models]) => (
        <optgroup key={provider} label={provider}>
          {models.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
              {m.name || m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function generateId(): string {
  return `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function emptyTeam(): TeamConfig {
  const now = nowISO();
  return {
    id: generateId(),
    name: "",
    description: "",
    experts: [],
    leader: "",
    debateRounds: 2,
    timeLimitMinutes: 10,
    createdAt: now,
    updatedAt: now,
  };
}

/** Parse expert config content as key: value lines (simple format). */
function parseExpertContent(content: string): {
  model: string;
  temperature: number;
  maxTurns: number;
  systemPrompt: string;
} {
  const lines = content.split("\n");
  let model = "";
  let temperature = 0.7;
  let maxTurns = 5;
  const promptLines: string[] = [];
  let inPrompt = false;

  for (const line of lines) {
    if (inPrompt) {
      promptLines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("model:")) {
      model = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("temperature:")) {
      temperature = parseFloat(trimmed.slice(12).trim()) || 0.7;
    } else if (trimmed.startsWith("maxTurns:")) {
      maxTurns = parseInt(trimmed.slice(9).trim(), 10) || 5;
    } else if (trimmed.startsWith("systemPrompt:")) {
      inPrompt = true;
      const rest = trimmed.slice(13).trim();
      if (rest) promptLines.push(rest);
    } else if (trimmed === "---") {
      inPrompt = true;
    }
  }

  return { model, temperature, maxTurns, systemPrompt: promptLines.join("\n").trim() };
}

function serializeExpertContent(fields: {
  model: string;
  temperature: number;
  maxTurns: number;
  systemPrompt: string;
}): string {
  return [
    `model: ${fields.model}`,
    `temperature: ${fields.temperature}`,
    `maxTurns: ${fields.maxTurns}`,
    `---`,
    fields.systemPrompt,
  ].join("\n");
}

// ── Team Editor ─────────────────────────────────────────────

function TeamEditor({
  team,
  allExperts,
  onSave,
  onCancel,
}: {
  team: TeamConfig;
  allExperts: ExpertConfigEntry[];
  onSave: (t: TeamConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TeamConfig>({ ...team });
  const [newMember, setNewMember] = useState("");

  const availableExperts = allExperts
    .map((e) => e.name)
    .filter((n) => !draft.experts.includes(n));

  const updateField = <K extends keyof TeamConfig>(key: K, value: TeamConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const addMember = () => {
    const name = newMember.trim();
    if (!name || draft.experts.includes(name)) return;
    updateField("experts", [...draft.experts, name]);
    setNewMember("");
  };

  const removeMember = (name: string) => {
    const next = draft.experts.filter((e) => e !== name);
    setDraft((d) => ({
      ...d,
      experts: next,
      leader: d.leader === name ? "" : d.leader,
    }));
  };

  const canSave = draft.name.trim().length > 0;

  return (
    <div style={s.editorCard}>
      {/* Name */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Name</label>
        <input
          style={s.input}
          value={draft.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="e.g. Security Review Team"
        />
      </div>

      {/* Description */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Description</label>
        <input
          style={s.input}
          value={draft.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="What this team specializes in..."
        />
      </div>

      {/* Output Mode */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Output Mode</label>
        <select
          style={s.select}
          value={draft.outputMode || "execute"}
          onChange={(e) => updateField("outputMode", e.target.value)}
        >
          <option value="execute">Execute — Plan & build from synthesis</option>
          <option value="advisory">Advisory — Analysis & recommendations only</option>
          <option value="document">Document — Save synthesis as documentation</option>
        </select>
      </div>

      {/* Debate Rounds & Time Limit */}
      <div style={s.fieldRowInline}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Debate Rounds</label>
          <select
            style={s.select}
            value={draft.debateRounds}
            onChange={(e) => updateField("debateRounds", parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Time Limit (minutes)</label>
          <div style={s.sliderRow}>
            <input
              type="range"
              min={2}
              max={60}
              value={draft.timeLimitMinutes}
              onChange={(e) => updateField("timeLimitMinutes", parseInt(e.target.value, 10))}
              style={s.slider}
            />
            <span style={s.sliderValue}>{draft.timeLimitMinutes}m</span>
          </div>
        </div>
      </div>

      {/* Default Model */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Default Model (optional)</label>
        <ModelSelect
          value={draft.defaultModel ? `${draft.defaultModel.provider}/${draft.defaultModel.id}` : ""}
          onChange={(v) => {
            if (!v) {
              setDraft((d) => {
                const { defaultModel: _, ...rest } = d;
                return rest as TeamConfig;
              });
            } else {
              const [provider, ...rest] = v.split("/");
              updateField("defaultModel", { provider, id: rest.join("/") });
            }
          }}
        />
      </div>

      {/* Members */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Members ({draft.experts.length})</label>
        <div style={s.memberList}>
          {draft.experts.length === 0 && (
            <span style={s.emptyHint}>No members yet. Add experts below.</span>
          )}
          {draft.experts.map((name) => (
            <div key={name} style={s.memberChip}>
              <span style={s.memberName}>{name}</span>
              <button style={s.chipRemove} onClick={() => removeMember(name)} title="Remove">
                x
              </button>
            </div>
          ))}
        </div>
        <div style={s.addRow}>
          {availableExperts.length > 0 ? (
            <select
              style={{ ...s.select, flex: 1 }}
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
            >
              <option value="">Select expert...</option>
              {availableExperts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              style={{ ...s.input, flex: 1 }}
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder="Expert name..."
              onKeyDown={(e) => e.key === "Enter" && addMember()}
            />
          )}
          <button style={s.btnSmall} onClick={addMember} disabled={!newMember.trim()}>
            Add
          </button>
        </div>
      </div>

      {/* Team Leader note */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Team Leader</label>
        <div style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-size-xs)",
          color: "var(--text-secondary)",
          padding: "6px 8px",
          backgroundColor: "var(--bg-primary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border, rgba(86, 95, 137, 0.2))",
        }}>
          <span style={{ color: "var(--warning)", marginRight: 4 }}>★</span>
          A <strong style={{ color: "var(--text-primary)" }}>Team Leader</strong> agent is automatically added to every session.
          Configure it in the Expert Library above (look for "leader").
        </div>
      </div>

      {/* Actions */}
      <div style={s.editorActions}>
        <button style={s.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{ ...s.btnPrimary, opacity: canSave ? 1 : 0.5 }}
          onClick={() => onSave({ ...draft, updatedAt: nowISO() })}
          disabled={!canSave}
        >
          Save Team
        </button>
      </div>
    </div>
  );
}

// ── Expert Editor ───────────────────────────────────────────

function ExpertEditor({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: ExpertConfigEntry | null; // null = new
  onSave: (name: string, content: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const parsed = entry ? parseExpertContent(entry.content) : { model: "", temperature: 0.7, maxTurns: 5, systemPrompt: "" };

  const [name, setName] = useState(entry?.name ?? "");
  const [model, setModel] = useState(parsed.model);
  const [temperature, setTemperature] = useState(parsed.temperature);
  const [maxTurns, setMaxTurns] = useState(parsed.maxTurns);
  const [systemPrompt, setSystemPrompt] = useState(parsed.systemPrompt);

  const isNew = entry === null;
  const canSave = name.trim().length > 0;

  const handleSave = () => {
    const content = serializeExpertContent({ model, temperature, maxTurns, systemPrompt });
    onSave(name.trim(), content);
  };

  return (
    <div style={s.editorCard}>
      {/* Name */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Name</label>
        <input
          style={s.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. security-expert"
          disabled={!isNew}
        />
        {!isNew && <span style={s.fieldHint}>Expert name cannot be changed after creation.</span>}
      </div>

      {/* Model */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Model</label>
        <ModelSelect
          value={model}
          onChange={setModel}
        />
      </div>

      {/* Temperature & Max Turns */}
      <div style={s.fieldRowInline}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Temperature</label>
          <div style={s.sliderRow}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={s.slider}
            />
            <span style={s.sliderValue}>{temperature.toFixed(2)}</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Max Turns</label>
          <select
            style={s.select}
            value={maxTurns}
            onChange={(e) => setMaxTurns(parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* System Prompt */}
      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>System Prompt</label>
        <textarea
          style={s.textarea}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a security expert focused on identifying vulnerabilities..."
          rows={12}
        />
      </div>

      {/* Actions */}
      <div style={s.editorActions}>
        {onDelete && (
          <button style={s.btnDanger} onClick={onDelete}>
            Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button style={s.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{ ...s.btnPrimary, opacity: canSave ? 1 : 0.5 }}
          onClick={handleSave}
          disabled={!canSave}
        >
          {isNew ? "Create Expert" : "Save Expert"}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────

export function ExpertsSettings() {
  const teams = useExpertsStore((s) => s.teams);
  const experts = useExpertsStore((s) => s.experts);
  const loadTeams = useExpertsStore((s) => s.loadTeams);
  const loadExperts = useExpertsStore((s) => s.loadExperts);
  const saveTeam = useExpertsStore((s) => s.saveTeam);
  const deleteTeam = useExpertsStore((s) => s.deleteTeam);
  const saveExpert = useExpertsStore((s) => s.saveExpert);
  const deleteExpert = useExpertsStore((s) => s.deleteExpert);

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingExpertName, setEditingExpertName] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingExpert, setCreatingExpert] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadTeams(), loadExperts()]).finally(() => setLoading(false));
  }, [loadTeams, loadExperts]);

  // ── Team handlers ───────────────────────────────────────

  const handleSaveTeam = useCallback(
    async (team: TeamConfig) => {
      try {
        await saveTeam(team);
        setEditingTeamId(null);
        setCreatingTeam(false);
      } catch (err) {
        console.error("[experts-settings] Failed to save team:", err);
      }
    },
    [saveTeam],
  );

  const handleDeleteTeam = useCallback(
    async (teamId: string) => {
      try {
        await deleteTeam(teamId);
        if (editingTeamId === teamId) setEditingTeamId(null);
      } catch (err) {
        console.error("[experts-settings] Failed to delete team:", err);
      }
    },
    [deleteTeam, editingTeamId],
  );

  // ── Expert handlers ─────────────────────────────────────

  const handleSaveExpert = useCallback(
    async (name: string, content: string) => {
      try {
        await saveExpert(name, content);
        setEditingExpertName(null);
        setCreatingExpert(false);
      } catch (err) {
        console.error("[experts-settings] Failed to save expert:", err);
      }
    },
    [saveExpert],
  );

  const handleDeleteExpert = useCallback(
    async (name: string) => {
      try {
        await deleteExpert(name);
        if (editingExpertName === name) setEditingExpertName(null);
      } catch (err) {
        console.error("[experts-settings] Failed to delete expert:", err);
      }
    },
    [deleteExpert, editingExpertName],
  );

  // ── Render ──────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <h3 style={s.heading}>Experts</h3>
        <p style={s.desc}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 style={s.heading}>Experts</h3>
      <p style={s.desc}>
        Configure expert agents and assemble them into teams for structured multi-agent debate.
        Experts deliberate on a topic and produce synthesized findings.
      </p>

      {/* ── Expert Library ──────────────────────────────── */}
      <div style={s.sectionLabel}>Expert Library</div>
      <p style={s.descSmall}>
        Individual expert configurations. Each expert has a model, personality (system prompt), and
        behavior settings.
      </p>

      <div style={s.listContainer}>
        {experts.length === 0 && !creatingExpert && (
          <div style={s.emptyState}>
            No experts configured. Create one to get started.
          </div>
        )}

        {experts.map((entry) => {
          const isEditing = editingExpertName === entry.name;
          if (isEditing) {
            return (
              <ExpertEditor
                key={entry.name}
                entry={entry}
                onSave={handleSaveExpert}
                onCancel={() => setEditingExpertName(null)}
                onDelete={() => handleDeleteExpert(entry.name)}
              />
            );
          }

          const parsed = parseExpertContent(entry.content);
          return (
            <div key={entry.name} style={s.listRow}>
              <div style={s.listRowInfo}>
                <div style={s.listRowName}>{entry.name}</div>
                <div style={s.listRowMeta}>
                  {parsed.model || "no model"} &middot; temp {parsed.temperature.toFixed(2)} &middot;{" "}
                  {parsed.maxTurns} turns
                </div>
              </div>
              <div style={s.listRowActions}>
                <button
                  style={s.btnSmall}
                  onClick={() => {
                    setCreatingExpert(false);
                    setEditingExpertName(entry.name);
                  }}
                >
                  Edit
                </button>
                <button
                  style={{ ...s.btnSmall, color: "var(--error)" }}
                  onClick={() => handleDeleteExpert(entry.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {creatingExpert && (
          <ExpertEditor
            entry={null}
            onSave={handleSaveExpert}
            onCancel={() => setCreatingExpert(false)}
          />
        )}
      </div>

      {!creatingExpert && (
        <button
          style={s.btnAdd}
          onClick={() => {
            setEditingExpertName(null);
            setCreatingExpert(true);
          }}
        >
          + New Expert
        </button>
      )}

      {/* ── Teams ───────────────────────────────────────── */}
      <div style={{ ...s.sectionLabel, marginTop: 28 }}>Teams</div>
      <p style={s.descSmall}>
        A team assembles experts for structured debate. Configure the number of rounds, time limits,
        and optionally assign a leader.
      </p>

      <div style={s.listContainer}>
        {teams.length === 0 && !creatingTeam && (
          <div style={s.emptyState}>
            No teams configured. Create a team after adding some experts.
          </div>
        )}

        {teams.map((team) => {
          const isEditing = editingTeamId === team.id;
          if (isEditing) {
            return (
              <TeamEditor
                key={team.id}
                team={team}
                allExperts={experts}
                onSave={handleSaveTeam}
                onCancel={() => setEditingTeamId(null)}
              />
            );
          }

          return (
            <div key={team.id} style={s.listRow}>
              <div style={s.listRowInfo}>
                <div style={s.listRowName}>{team.name || "Untitled Team"}</div>
                <div style={s.listRowMeta}>
                  {team.experts.length} expert{team.experts.length !== 1 ? "s" : ""} &middot;{" "}
                  {team.debateRounds} round{team.debateRounds !== 1 ? "s" : ""} &middot;{" "}
                  {team.timeLimitMinutes}m limit
                  {team.leader ? ` \u00b7 leader: ${team.leader}` : ""}
                </div>
              </div>
              <div style={s.listRowActions}>
                <button
                  style={s.btnSmall}
                  onClick={() => {
                    setCreatingTeam(false);
                    setEditingTeamId(team.id);
                  }}
                >
                  Edit
                </button>
                <button
                  style={{ ...s.btnSmall, color: "var(--error)" }}
                  onClick={() => handleDeleteTeam(team.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {creatingTeam && (
          <TeamEditor
            team={emptyTeam()}
            allExperts={experts}
            onSave={handleSaveTeam}
            onCancel={() => setCreatingTeam(false)}
          />
        )}
      </div>

      {!creatingTeam && (
        <button
          style={s.btnAdd}
          onClick={() => {
            setEditingTeamId(null);
            setCreatingTeam(true);
          }}
        >
          + New Team
        </button>
      )}

      <div style={s.note}>
        Tip: Experts are reusable across teams. Define an expert once in the library, then add them
        to any number of teams.
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  heading: {
    margin: "0 0 8px",
    fontSize: "var(--font-size-md)",
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  desc: {
    margin: "0 0 16px",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  descSmall: {
    margin: "0 0 10px",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  },
  sectionLabel: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 8,
  },
  note: {
    marginTop: 20,
    padding: "10px 12px",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.5,
  },

  // List
  listContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  listRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  listRowName: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--text-bright)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  listRowMeta: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  listRowActions: {
    display: "flex",
    gap: 6,
    flexShrink: 0,
  },
  emptyState: {
    padding: "16px 12px",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    textAlign: "center",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },

  // Editor card
  editorCard: {
    padding: 14,
    background: "var(--bg-primary)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  fieldRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldRowInline: {
    display: "flex",
    gap: 16,
  },
  fieldLabel: {
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  fieldHint: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
  input: {
    padding: "5px 8px",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-bright)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
  },
  inputMono: {
    padding: "5px 8px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-bright)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
  },
  select: {
    padding: "5px 8px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  textarea: {
    padding: "8px 10px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-bright)",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    resize: "vertical" as const,
    minHeight: 160,
    lineHeight: 1.5,
    outline: "none",
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  slider: {
    flex: 1,
    accentColor: "var(--accent)",
  },
  sliderValue: {
    fontSize: "var(--font-size-xs)",
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    minWidth: 36,
    textAlign: "right",
  },

  // Members
  memberList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    minHeight: 28,
  },
  memberChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-bright)",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  memberName: {
    fontFamily: "var(--font-mono)",
  },
  chipRemove: {
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: "var(--font-size-xs)",
    padding: "0 2px",
    lineHeight: 1,
  },
  addRow: {
    display: "flex",
    gap: 6,
    marginTop: 4,
  },
  emptyHint: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },

  // Buttons
  btnSmall: {
    padding: "4px 10px",
    fontSize: "var(--font-size-xs)",
    fontFamily: "var(--font-ui)",
    color: "var(--text-primary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  btnAdd: {
    marginTop: 8,
    padding: "6px 14px",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-ui)",
    color: "var(--accent)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "6px 16px",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-ui)",
    color: "var(--bg-primary)",
    background: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    fontWeight: 600,
  },
  btnSecondary: {
    padding: "6px 16px",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-ui)",
    color: "var(--text-primary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  btnDanger: {
    padding: "6px 16px",
    fontSize: "var(--font-size-sm)",
    fontFamily: "var(--font-ui)",
    color: "var(--error)",
    background: "transparent",
    border: "1px solid var(--error)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  editorActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 4,
  },
};
