import { create } from "zustand";
import {
  readRouterConfig,
  writeRouterConfig,
  readOrchestratorConfig,
  writeOrchestratorConfig,
  type OrchestratorConfig,
  type ModelRef,
  type RouterConfig,
} from "../lib/ipc";
import { useWorkspaceStore } from "./workspace";

export const SETTINGS_TAB_PATH = "__settings__";

export type SettingsSection = "general" | "providers" | "routing" | "orchestration" | "experts" | "safety" | "skills" | "shortcuts";

export interface TierModelConfig {
  provider: string;
  id: string;
}

export type OrchestratorModelRole = "codeEditing" | "research" | "validation";
export type SubagentModelRole = "webSearch" | "codebaseExploration";

const DEFAULT_ORC_CONFIG: OrchestratorConfig = {
  reviewMode: "fresh_session",
  maxReviewIterations: 2,
  qaCommands: [],
  clarifyTimeoutSecs: 120,
  lockModelDuringOrchestration: true,
};

interface SettingsState {
  activeSection: SettingsSection;
  autoMode: boolean;
  tierModels: {
    quick?: TierModelConfig;
    standard?: TierModelConfig;
    complex?: TierModelConfig;
  };
  orchestratorModels: {
    codeEditing?: ModelRef;
    research?: ModelRef;
    validation?: ModelRef;
  };
  subagentModels: {
    webSearch?: ModelRef;
    codebaseExploration?: ModelRef;
  };
  orchestratorConfig: OrchestratorConfig;
  terminalTheme: string;
  terminalScrollback: number;

  load: () => Promise<void>;
  open: (section?: SettingsSection) => void;
  close: () => void;
  setSection: (section: SettingsSection) => void;
  setAutoMode: (mode: boolean) => void;
  setTierModel: (tier: "quick" | "standard" | "complex", model: TierModelConfig | undefined) => void;
  setOrchestratorModel: (role: OrchestratorModelRole, model: ModelRef | undefined) => void;
  setSubagentModel: (role: SubagentModelRole, model: ModelRef | undefined) => void;
  updateOrchestratorConfig: (partial: Partial<OrchestratorConfig>) => void;
  setTerminalTheme: (theme: string) => void;
  setTerminalScrollback: (size: number) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  activeSection: "general",
  autoMode: true,
  tierModels: {},
  orchestratorModels: {},
  subagentModels: {},
  orchestratorConfig: { ...DEFAULT_ORC_CONFIG },
  terminalTheme: "Tokyo Night",
  terminalScrollback: 5000,

  load: async () => {
    try {
      const config = await readRouterConfig() as RouterConfig;
      set({ autoMode: config.autoSwitch ?? true });
      if (config.tierModels) set({ tierModels: config.tierModels });
      if (config.orchestratorModels) set({ orchestratorModels: config.orchestratorModels });
      if (config.subagentModels) set({ subagentModels: config.subagentModels });
    } catch {
      // keep defaults
    }
    try {
      const orcConfig = await readOrchestratorConfig();
      set({ orchestratorConfig: { ...DEFAULT_ORC_CONFIG, ...orcConfig } });
    } catch {
      // keep defaults
    }
  },

  open: (section) => {
    if (section) set({ activeSection: section });
    const ws = useWorkspaceStore.getState();
    ws.openFile({
      path: SETTINGS_TAB_PATH,
      name: "Settings",
      content: "",
      isDirty: false,
      language: "",
    });
  },
  close: () => {
    useWorkspaceStore.getState().closeTab(SETTINGS_TAB_PATH);
  },
  setSection: (section) => set({ activeSection: section }),
  setAutoMode: (mode) => {
    set({ autoMode: mode });
    const s = get();
    writeRouterConfig(mode, s.tierModels, s.orchestratorModels, s.subagentModels)
      .catch((e) => console.error("Failed to write router config:", e));
  },
  setTierModel: (tier, model) => {
    const tierModels = { ...get().tierModels };
    if (model) {
      tierModels[tier] = model;
    } else {
      delete tierModels[tier];
    }
    set({ tierModels });
    const s = get();
    writeRouterConfig(s.autoMode, tierModels, s.orchestratorModels, s.subagentModels)
      .catch((e) => console.error("Failed to persist tier models:", e));
  },
  setOrchestratorModel: (role, model) => {
    const orchestratorModels = { ...get().orchestratorModels };
    if (model) {
      orchestratorModels[role] = model;
    } else {
      delete orchestratorModels[role];
    }
    set({ orchestratorModels });
    const s = get();
    writeRouterConfig(s.autoMode, s.tierModels, orchestratorModels, s.subagentModels)
      .catch((e) => console.error("Failed to persist orchestrator models:", e));
  },
  setSubagentModel: (role, model) => {
    const subagentModels = { ...get().subagentModels };
    if (model) {
      subagentModels[role] = model;
    } else {
      delete subagentModels[role];
    }
    set({ subagentModels });
    const s = get();
    writeRouterConfig(s.autoMode, s.tierModels, s.orchestratorModels, subagentModels)
      .catch((e) => console.error("Failed to persist subagent models:", e));
  },
  updateOrchestratorConfig: (partial) => {
    const merged = { ...get().orchestratorConfig, ...partial };
    set({ orchestratorConfig: merged });
    writeOrchestratorConfig(merged).catch((e) =>
      console.error("Failed to write orchestrator config:", e),
    );
  },
  setTerminalTheme: (theme) => set({ terminalTheme: theme }),
  setTerminalScrollback: (size) => set({ terminalScrollback: Math.max(500, Math.min(50000, size)) }),
}));
