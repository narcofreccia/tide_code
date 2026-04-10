import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  TeamConfig,
  ExpertConfigEntry,
  ExpertsSessionState,
  ExpertMailboxMessage,
} from "../lib/ipc";
import {
  listExpertTeams,
  listExpertsConfigs,
  listExpertsSessions,
  getExpertsSession,
  getExpertsSessionMessages,
  saveExpertTeam as saveTeamIpc,
  deleteExpertTeam as deleteTeamIpc,
  saveExpertConfig as saveExpertIpc,
  deleteExpertConfig as deleteExpertIpc,
  deleteExpertsSession as deleteSessionIpc,
} from "../lib/ipc";

// ── Types ───────────────────────────────────────────────────

export type ExpertsPhase =
  | "idle"
  | "setup"
  | "exploration"
  | "discussion"
  | "synthesis"
  | "ready"
  | "executing"
  | "complete"
  | "failed";

export type ViewMode = "grid" | "timeline" | "conversation";

interface ExpertsEvent {
  sessionId: string;
  phase: string;
  message: string;
  experts: { name: string; status: string; messageCount: number; findingCount: number }[];
}

interface ExpertMessageEvent {
  sessionId: string;
  message: ExpertMailboxMessage;
}

interface ExpertsState {
  // Active session
  activeSessionId: string | null;
  activeSession: ExpertsSessionState | null;
  phase: ExpertsPhase;
  isActive: boolean;
  startedAt: number | null;
  timeLimitMinutes: number | null;
  timeLimitReached: boolean;

  // P2P messages (live stream)
  messages: ExpertMailboxMessage[];
  _pollTick: number;

  // Configuration
  teams: TeamConfig[];
  experts: ExpertConfigEntry[];
  selectedTeamId: string | null;
  topic: string;

  // UI state
  viewMode: ViewMode;
  selectedExpert: string | null;
  expandedCards: Record<string, boolean>;

  // Session history
  pastSessions: ExpertsSessionState[];

  // Event handlers
  handleExpertsEvent: (event: ExpertsEvent) => void;
  handleExpertMessage: (event: ExpertMessageEvent) => void;

  // Data loading
  loadTeams: () => Promise<void>;
  loadExperts: () => Promise<void>;
  loadPastSessions: () => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;

  // Config management
  saveTeam: (config: TeamConfig) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  saveExpert: (name: string, content: string) => Promise<void>;
  deleteExpert: (name: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

  // UI actions
  setViewMode: (mode: ViewMode) => void;
  setSelectedExpert: (name: string | null) => void;
  setSelectedTeamId: (teamId: string | null) => void;
  setTopic: (topic: string) => void;
  toggleCardExpanded: (name: string) => void;
  setActiveSession: (sessionId: string) => Promise<void>;
  reset: () => void;
}

// ── Store ───────────────────────────────────────────────────

export const useExpertsStore = create<ExpertsState>((set, get) => ({
  activeSessionId: null,
  activeSession: null,
  phase: "idle",
  isActive: false,
  startedAt: null,
  timeLimitMinutes: null,
  timeLimitReached: false,
  messages: [],
  _pollTick: 0,
  teams: [],
  experts: [],
  selectedTeamId: null,
  topic: "",
  viewMode: "grid",
  selectedExpert: null,
  expandedCards: {},
  pastSessions: [],

  handleExpertsEvent: (event) => {
    set({
      phase: event.phase as ExpertsPhase,
      isActive: !["idle", "ready", "complete", "failed"].includes(event.phase),
    });

    // Update session state from event
    const { activeSession } = get();
    if (activeSession && activeSession.id === event.sessionId) {
      set({
        activeSession: {
          ...activeSession,
          phase: event.phase,
          experts: activeSession.experts.map((e) => {
            const updated = event.experts.find((ue) => ue.name === e.name);
            if (updated) {
              return { ...e, status: updated.status, messageCount: updated.messageCount, findingCount: updated.findingCount };
            }
            return e;
          }),
        },
      });
    }
  },

  handleExpertMessage: (event) => {
    const { isActive, messages } = get();
    if (!isActive) return;
    if (!event.message || !event.message.id) return;

    // Deduplicate
    if (messages.some((m) => m.id === event.message.id)) return;

    set((state) => ({
      messages: [...state.messages, event.message],
    }));
  },

  loadTeams: async () => {
    try {
      const teams = await listExpertTeams();
      set({ teams });
    } catch (err) {
      console.error("[experts] Failed to load teams:", err);
    }
  },

  loadExperts: async () => {
    try {
      const experts = await listExpertsConfigs();
      set({ experts });
    } catch (err) {
      console.error("[experts] Failed to load experts:", err);
    }
  },

  loadPastSessions: async () => {
    try {
      const sessions = await listExpertsSessions();
      set({ pastSessions: sessions });
    } catch (err) {
      console.error("[experts] Failed to load sessions:", err);
    }
  },

  loadSessionMessages: async (sessionId) => {
    try {
      const messages = await getExpertsSessionMessages(sessionId);
      set({ messages });
    } catch (err) {
      console.error("[experts] Failed to load messages:", err);
    }
  },

  saveTeam: async (config) => {
    await saveTeamIpc(config);
    await get().loadTeams();
  },

  deleteTeam: async (teamId) => {
    await deleteTeamIpc(teamId);
    await get().loadTeams();
  },

  saveExpert: async (name, content) => {
    await saveExpertIpc(name, content);
    await get().loadExperts();
  },

  deleteExpert: async (name) => {
    await deleteExpertIpc(name);
    await get().loadExperts();
  },

  deleteSession: async (sessionId) => {
    await deleteSessionIpc(sessionId);
    const { activeSessionId } = get();
    if (activeSessionId === sessionId) {
      set({ activeSessionId: null, activeSession: null, messages: [], phase: "idle" });
    }
    await get().loadPastSessions();
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedExpert: (name) => set({ selectedExpert: name }),
  setSelectedTeamId: (teamId) => set({ selectedTeamId: teamId }),
  setTopic: (topic) => set({ topic }),

  toggleCardExpanded: (name) => set((state) => ({
    expandedCards: { ...state.expandedCards, [name]: !state.expandedCards[name] },
  })),

  setActiveSession: async (sessionId) => {
    try {
      const session = await getExpertsSession(sessionId);
      const messages = await getExpertsSessionMessages(sessionId);
      const team = get().teams.find((t) => t.id === session.teamId);
      set({
        activeSessionId: sessionId,
        activeSession: session,
        messages,
        phase: session.phase as ExpertsPhase,
        isActive: !["idle", "ready", "complete", "failed"].includes(session.phase),
        selectedTeamId: session.teamId,
        topic: session.topic ?? "",
        timeLimitMinutes: team?.timeLimitMinutes ?? null,
        timeLimitReached: session.timeLimitReached,
      });
    } catch (err) {
      console.error("[experts] Failed to load session:", err);
    }
  },

  reset: () =>
    set({
      activeSessionId: null,
      activeSession: null,
      phase: "idle",
      isActive: false,
      startedAt: null,
      timeLimitMinutes: null,
      timeLimitReached: false,
      messages: [],
    }),
}));

// ── Listener ────────────────────────────────────────────────

let listenerInitialized = false;

export function initExpertsListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;

  listen<ExpertsEvent>("experts_event", (event) => {
    useExpertsStore.getState().handleExpertsEvent(event.payload);
  }).catch((err) => {
    console.error("[experts] Failed to set up event listener:", err);
  });

  listen<ExpertMessageEvent>("expert_message", (event) => {
    useExpertsStore.getState().handleExpertMessage(event.payload);
  }).catch((err) => {
    console.error("[experts] Failed to set up message listener:", err);
  });
}
