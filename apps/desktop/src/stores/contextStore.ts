import { create } from "zustand";
import { getContextBreakdown, getContextExclusions, excludeContextMessage, includeContextMessage } from "../lib/ipc";

export type ThresholdColor = "green" | "yellow" | "red";

export interface CategoryBreakdown {
  category: string;
  tokens: number;
  percentage: number;
}

export interface BudgetBreakdown {
  totalTokens: number;
  budgetTokens: number;
  usagePercent: number;
  thresholdColor: ThresholdColor;
  categories: CategoryBreakdown[];
}

export interface ContextItem {
  id: string;
  type: string;
  source: string;
  content: string;
  tokenEstimate: number;
  pinned: boolean;
  priority: number;
  trimmable: boolean;
}

export interface ContextPack {
  items: ContextItem[];
  totalTokens: number;
  budgetTokens: number;
  usagePercent: number;
  trimmedItems: ContextItem[];
}

function computeThreshold(percent: number): ThresholdColor {
  if (percent >= 0.85) return "red";
  if (percent >= 0.6) return "yellow";
  return "green";
}

interface ContextState {
  breakdown: BudgetBreakdown | null;
  contextPack: ContextPack | null;
  inspectorOpen: boolean;
  excludedIds: Set<string>;
  warningDismissedAt: number;
  preCompactTokens: number | null;
  postCompactTokens: number | null;
  autoCompactEnabled: boolean;
  autoCompactThreshold: number;

  refreshFromSnapshot: () => Promise<void>;
  updateBudget: (budgetTokens: number) => void;
  refreshItems: () => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  openInspector: () => void;
  closeInspector: () => void;
  loadExclusions: () => Promise<void>;
  toggleExclusion: (messageId: string) => Promise<void>;
  dismissWarning: () => void;
  setAutoCompact: (enabled: boolean, threshold?: number) => void;
  setPreCompactTokens: (tokens: number) => void;
  setPostCompactTokens: (tokens: number) => void;
}

export const useContextStore = create<ContextState>((set, get) => ({
  breakdown: null,
  contextPack: null,
  inspectorOpen: false,
  excludedIds: new Set(),
  warningDismissedAt: 0,
  preCompactTokens: null,
  postCompactTokens: null,
  autoCompactEnabled: localStorage.getItem("tide:autoCompact") === "true",
  autoCompactThreshold: parseFloat(localStorage.getItem("tide:autoCompactThreshold") || "0.80"),

  refreshFromSnapshot: async () => {
    try {
      const snapshot = await getContextBreakdown();
      const totalTokens = snapshot?.totalTokens ?? 0;
      const categories = snapshot?.categories ?? [];
      const existing = get().breakdown;
      // Use existing budgetTokens, or fall back to stream store's contextWindow
      let budgetTokens = existing?.budgetTokens ?? 0;
      if (budgetTokens === 0) {
        try {
          // Lazy import to avoid circular dependency
          const { useStreamStore } = await import("./stream");
          budgetTokens = useStreamStore.getState().contextWindow || 0;
        } catch { /* ignore */ }
      }
      const usagePercent = budgetTokens > 0 ? totalTokens / budgetTokens : 0;
      set({
        breakdown: {
          totalTokens,
          budgetTokens,
          usagePercent,
          thresholdColor: computeThreshold(usagePercent),
          categories,
        },
      });
    } catch {
      // Snapshot not available yet
    }
  },

  updateBudget: (budgetTokens: number) => {
    const existing = get().breakdown;
    const totalTokens = existing?.totalTokens ?? 0;
    const usagePercent = budgetTokens > 0 ? totalTokens / budgetTokens : 0;
    set({
      breakdown: {
        totalTokens,
        budgetTokens,
        usagePercent,
        thresholdColor: computeThreshold(usagePercent),
        categories: existing?.categories ?? [],
      },
    });
  },

  refreshItems: async () => {
    try {
      await getContextBreakdown();
    } catch {
      // Snapshot not available yet
    }
  },

  togglePin: async (id: string) => {
    const { useRegionTagStore } = await import("./regionTagStore");
    const tagStore = useRegionTagStore.getState();
    const tag = tagStore.tags.get(id);
    if (tag) {
      tagStore.togglePin(id);
    }
  },

  openInspector: () => set({ inspectorOpen: true }),
  closeInspector: () => set({ inspectorOpen: false }),

  loadExclusions: async () => {
    try {
      const ids = await getContextExclusions();
      set({ excludedIds: new Set(ids) });
    } catch {
      // No exclusions yet
    }
  },

  toggleExclusion: async (messageId: string) => {
    const { excludedIds } = get();
    const isExcluded = excludedIds.has(messageId);
    try {
      if (isExcluded) {
        await includeContextMessage(messageId);
        const next = new Set(excludedIds);
        next.delete(messageId);
        set({ excludedIds: next });
      } else {
        await excludeContextMessage(messageId);
        const next = new Set(excludedIds);
        next.add(messageId);
        set({ excludedIds: next });
      }
    } catch {
      // Failed to persist — ignore
    }
  },

  dismissWarning: () => {
    const usage = get().breakdown?.usagePercent ?? 0;
    set({ warningDismissedAt: Math.round(usage * 100) });
  },

  setAutoCompact: (enabled: boolean, threshold?: number) => {
    localStorage.setItem("tide:autoCompact", String(enabled));
    if (threshold !== undefined) {
      localStorage.setItem("tide:autoCompactThreshold", String(threshold));
    }
    set({
      autoCompactEnabled: enabled,
      ...(threshold !== undefined ? { autoCompactThreshold: threshold } : {}),
    });
  },

  setPreCompactTokens: (tokens: number) => set({ preCompactTokens: tokens }),
  setPostCompactTokens: (tokens: number) => set({ postCompactTokens: tokens }),
}));
