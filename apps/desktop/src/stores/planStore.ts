import { create } from "zustand";
import { useApprovalStore } from "./approvalStore";
import { plansList, planDelete, fsWriteFile } from "../lib/ipc";
import { useWorkspaceStore } from "./workspace";

// ── Types ───────────────────────────────────────────────────

export interface ModelRef {
  provider: string;
  id: string;
  name: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  files?: string[];
  dependencies?: string[];
  expectedOutcome?: string;
  summary?: string;
  completedAt?: string;
  assignedModel?: ModelRef;
}

export interface Plan {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: "planning" | "in_progress" | "completed" | "failed";
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
  initialModel?: ModelRef;
  context?: string;
}

interface PlanState {
  activePlan: Plan | null;
  plans: Plan[];
  loading: boolean;

  updateFromPiStatus: (raw: string) => void;
  loadPlans: () => Promise<void>;
  deletePlan: (slug: string) => Promise<void>;
  clearActivePlan: () => void;
  updateStep: (planSlug: string, stepId: string, patch: Partial<PlanStep>) => void;
}

// ── Debounced save helper ───────────────────────────────────

let _saveTimeout: ReturnType<typeof setTimeout> | null = null;

async function savePlanToDisk(plan: Plan) {
  const rootPath = useWorkspaceStore.getState().rootPath;
  if (!rootPath || !plan.slug) return;
  const path = `${rootPath}/.tide/plans/${plan.slug}.json`;
  const json = JSON.stringify(plan, null, 2);
  try {
    await fsWriteFile(path, json);
  } catch (e) {
    console.error("[plan] Failed to save plan:", e);
  }
}

function debouncedSave(plan: Plan) {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    savePlanToDisk(plan);
  }, 500);
}

// ── Store ───────────────────────────────────────────────────

export const usePlanStore = create<PlanState>((set, get) => ({
  activePlan: null,
  plans: [],
  loading: false,

  updateFromPiStatus: (raw: string) => {
    try {
      const plan = JSON.parse(raw) as Plan;
      set({ activePlan: plan });
    } catch { /* ignore */ }
  },

  loadPlans: async () => {
    set({ loading: true });
    try {
      const raw = await plansList();
      const plans = (raw as Plan[]).sort(
        (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""),
      );
      set({ plans, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  deletePlan: async (slug: string) => {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    try {
      await planDelete(slug);
      set((state) => {
        const plans = state.plans.filter((p) => p.slug !== slug);
        const activePlan = state.activePlan?.slug === slug ? null : state.activePlan;
        return { plans, activePlan };
      });
    } catch (e) {
      console.error("Failed to delete plan:", e);
    }
  },

  clearActivePlan: () => {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    set({ activePlan: null });
  },

  updateStep: (planSlug: string, stepId: string, patch: Partial<PlanStep>) => {
    const { plans, activePlan } = get();

    const patchPlan = (plan: Plan): Plan => {
      const steps = plan.steps.map((st) =>
        st.id === stepId ? { ...st, ...patch } : st,
      );
      return { ...plan, steps, updatedAt: new Date().toISOString() };
    };

    const updatedPlans = plans.map((p) =>
      p.slug === planSlug ? patchPlan(p) : p,
    );
    const updatedActive =
      activePlan?.slug === planSlug ? patchPlan(activePlan) : activePlan;

    set({ plans: updatedPlans, activePlan: updatedActive });

    const targetPlan = updatedPlans.find((p) => p.slug === planSlug);
    if (targetPlan) debouncedSave(targetPlan);
  },
}));

// ── Auto-subscribe to piStatus["planner"] ───────────────────

let lastPlannerStatus = "";
useApprovalStore.subscribe((state) => {
  const raw = state.piStatus["planner"];
  if (raw && raw !== lastPlannerStatus) {
    lastPlannerStatus = raw;
    usePlanStore.getState().updateFromPiStatus(raw);
  }
});
