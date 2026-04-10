import { useSettingsStore, type TierModelConfig, type OrchestratorModelRole, type SubagentModelRole } from "../../stores/settingsStore";
import { useStreamStore, type AvailableModel } from "../../stores/stream";
import type { ModelRef } from "../../lib/ipc";

const TIERS = [
  { id: "quick" as const, label: "Quick", desc: "Short questions, typos, renames" },
  { id: "standard" as const, label: "Standard", desc: "General coding tasks" },
  { id: "complex" as const, label: "Complex", desc: "Refactors, multi-file features" },
];

const ORC_ROLES = [
  { id: "codeEditing" as OrchestratorModelRole, label: "Code Editing", desc: "Refactoring, bug fixes, implementation" },
  { id: "research" as OrchestratorModelRole, label: "Research / Analysis", desc: "Planning, architecture exploration" },
  { id: "validation" as OrchestratorModelRole, label: "Validation", desc: "Build checks, simple verification" },
];

const SUBAGENT_ROLES = [
  { id: "webSearch" as SubagentModelRole, label: "Web Search", desc: "Documentation lookup, API research" },
  { id: "codebaseExploration" as SubagentModelRole, label: "Codebase Exploration", desc: "Symbol search, architecture discovery" },
];

// ── Shared Model Dropdown ─────────────────────────────────

function ModelDropdown({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (value: string) => void;
  models: AvailableModel[];
}) {
  const grouped = groupByProvider(models);
  return (
    <select style={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="auto">Auto-detect</option>
      {Object.entries(grouped).map(([provider, providerModels]) => (
        <optgroup key={provider} label={provider}>
          {providerModels.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
              {m.name || m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ── Main Component ────────────────────────────────────────

export function RoutingSettings() {
  const autoMode = useSettingsStore((s) => s.autoMode);
  const setAutoMode = useSettingsStore((s) => s.setAutoMode);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const setTierModel = useSettingsStore((s) => s.setTierModel);
  const orchestratorModels = useSettingsStore((s) => s.orchestratorModels);
  const setOrchestratorModel = useSettingsStore((s) => s.setOrchestratorModel);
  const subagentModels = useSettingsStore((s) => s.subagentModels);
  const setSubagentModel = useSettingsStore((s) => s.setSubagentModel);
  const availableModels = useStreamStore((s) => s.availableModels);

  const handleModelChange = (setter: (v: string) => void) => (value: string) => setter(value);

  const toValue = (ref?: ModelRef): string => ref ? `${ref.provider}/${ref.id}` : "auto";
  const fromValue = (value: string): ModelRef | undefined => {
    if (value === "auto") return undefined;
    const [provider, ...rest] = value.split("/");
    return { provider, id: rest.join("/") };
  };

  return (
    <div>
      <h3 style={s.heading}>Model Routing</h3>
      <p style={s.desc}>
        When auto-routing is enabled, Tide classifies each prompt and picks a model based on task
        complexity. Models are ranked by cost when set to "Auto-detect".
      </p>

      {/* Auto-switch toggle */}
      <label style={s.toggleRow}>
        <input
          type="checkbox"
          checked={autoMode}
          onChange={(e) => setAutoMode(e.target.checked)}
          style={s.checkbox}
        />
        <span>Enable auto-routing</span>
      </label>

      {/* Task Routing */}
      <div style={{ opacity: autoMode ? 1 : 0.5, pointerEvents: autoMode ? "auto" : "none" }}>
        <div style={s.sectionLabel}>Task Routing</div>
        <div style={s.tierGrid}>
          {TIERS.map((tier) => (
            <div key={tier.id} style={s.tierRow}>
              <div>
                <div style={s.tierLabel}>{tier.label}</div>
                <div style={s.tierDesc}>{tier.desc}</div>
              </div>
              <ModelDropdown
                value={toValue(tierModels[tier.id])}
                onChange={(v) => setTierModel(tier.id, fromValue(v) as TierModelConfig | undefined)}
                models={availableModels}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Orchestrator Step Models */}
      <div style={{ marginTop: 24 }}>
        <div style={s.sectionLabel}>Orchestrator Step Models</div>
        <p style={s.descSmall}>
          Which model to use for different types of orchestrated build steps.
        </p>
        <div style={s.tierGrid}>
          {ORC_ROLES.map((role) => (
            <div key={role.id} style={s.tierRow}>
              <div>
                <div style={s.tierLabel}>{role.label}</div>
                <div style={s.tierDesc}>{role.desc}</div>
              </div>
              <ModelDropdown
                value={toValue(orchestratorModels[role.id])}
                onChange={(v) => setOrchestratorModel(role.id, fromValue(v))}
                models={availableModels}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Subagent Models */}
      <div style={{ marginTop: 24 }}>
        <div style={s.sectionLabel}>Subagent Models</div>
        <p style={s.descSmall}>
          Subagents run in isolated processes with their own context. Use cheaper models to save costs.
        </p>
        <div style={s.tierGrid}>
          {SUBAGENT_ROLES.map((role) => (
            <div key={role.id} style={s.tierRow}>
              <div>
                <div style={s.tierLabel}>{role.label}</div>
                <div style={s.tierDesc}>{role.desc}</div>
              </div>
              <ModelDropdown
                value={toValue(subagentModels[role.id])}
                onChange={(v) => setSubagentModel(role.id, fromValue(v))}
                models={availableModels}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={s.note}>
        Tip: The router only switches models on the first message of a new chat.
        Use the model picker in the status bar for manual overrides. "Auto-detect" ranks
        models by cost (most expensive = most capable).
      </div>
    </div>
  );
}

function groupByProvider(models: AvailableModel[]): Record<string, AvailableModel[]> {
  const groups: Record<string, AvailableModel[]> = {};
  for (const m of models) {
    const p = m.provider || "other";
    if (!groups[p]) groups[p] = [];
    groups[p].push(m);
  }
  return groups;
}

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
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  checkbox: {
    accentColor: "var(--accent)",
  },
  tierGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  tierRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  tierLabel: {
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  tierDesc: {
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    marginTop: 2,
  },
  select: {
    flexShrink: 0,
    minWidth: 180,
    padding: "5px 8px",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
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
};
