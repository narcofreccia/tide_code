import { create } from "zustand";

type EngineStatus = "disconnected" | "connecting" | "connected" | "error";

interface EngineState {
  status: EngineStatus;
  errorMessage: string | null;

  setStatus: (status: EngineStatus, error?: string) => void;
}

export const useEngineStore = create<EngineState>((set) => ({
  status: "disconnected",
  errorMessage: null,

  setStatus: (status, error) =>
    set({
      status,
      errorMessage: error ?? null,
    }),
}));
