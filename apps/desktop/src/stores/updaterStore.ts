import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch as processRelaunch } from "@tauri-apps/plugin-process";

export type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  state: UpdateState;
  version: string;
  notes: string;
  contentLength: number;
  downloaded: number;
  progress: number;
  errorMsg: string;
  dismissed: boolean;
  updateRef: Update | null;

  triggerCheck: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
  dismiss: () => void;
  reset: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  state: "idle",
  version: "",
  notes: "",
  contentLength: 0,
  downloaded: 0,
  progress: 0,
  errorMsg: "",
  dismissed: false,
  updateRef: null,

  triggerCheck: async () => {
    if (get().state === "checking" || get().state === "downloading") return;
    set({ state: "checking", errorMsg: "" });
    try {
      const update = await check();
      if (!update) {
        set({ state: "idle", updateRef: null });
        return;
      }
      set({
        state: "available",
        updateRef: update,
        version: update.version,
        notes: update.body ?? "",
      });
    } catch (err) {
      set({
        state: "error",
        errorMsg: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  },

  downloadAndInstall: async () => {
    const update = get().updateRef;
    if (!update) return;
    set({ state: "downloading", downloaded: 0, contentLength: 0, progress: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({ contentLength: event.data.contentLength ?? 0 });
        } else if (event.event === "Progress") {
          const next = get().downloaded + event.data.chunkLength;
          const total = get().contentLength;
          set({
            downloaded: next,
            progress: total > 0 ? Math.min((next / total) * 100, 100) : 0,
          });
        } else if (event.event === "Finished") {
          set({ progress: 100 });
        }
      });
      set({ state: "ready" });
    } catch (err) {
      set({
        state: "error",
        errorMsg: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  },

  relaunch: async () => {
    await processRelaunch();
  },

  dismiss: () => set({ dismissed: true }),

  reset: async () => {
    set({ dismissed: false, state: "idle", errorMsg: "", updateRef: null });
    await get().triggerCheck();
  },
}));
