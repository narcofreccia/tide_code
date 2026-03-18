import { create } from "zustand";
import { gitChangedFiles, type ChangedFile } from "../lib/ipc";
import { useWorkspaceStore } from "./workspace";

interface GitFileStatusState {
  statusMap: Map<string, string>; // relative path → status
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useGitFileStatusStore = create<GitFileStatusState>((set) => ({
  statusMap: new Map(),

  refresh: async () => {
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;
    try {
      const files = await gitChangedFiles();
      const map = new Map<string, string>();
      for (const f of files) {
        map.set(f.path, f.status);
      }
      set({ statusMap: map });
    } catch {
      // Git not available or not a repo — clear status
      set({ statusMap: new Map() });
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    const { refresh } = useGitFileStatusStore.getState();
    refresh();
    pollTimer = setInterval(refresh, 3000);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ statusMap: new Map() });
  },
}));
