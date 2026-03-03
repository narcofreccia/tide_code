import { create } from "zustand";
import type { StreamEvent } from "@tide/shared/stream";

interface StreamState {
  streamId: string | null;
  content: string;
  isStreaming: boolean;
  seq: number;

  startStream: (streamId: string) => void;
  appendDelta: (content: string, seq: number) => void;
  endStream: () => void;
  reset: () => void;
  handleEvent: (event: StreamEvent) => void;
}

export const useStreamStore = create<StreamState>((set) => ({
  streamId: null,
  content: "",
  isStreaming: false,
  seq: 0,

  startStream: (streamId) =>
    set({ streamId, content: "", isStreaming: true, seq: 0 }),

  appendDelta: (content, seq) =>
    set((state) => ({
      content: state.content + content,
      seq,
    })),

  endStream: () =>
    set({ isStreaming: false }),

  reset: () =>
    set({ streamId: null, content: "", isStreaming: false, seq: 0 }),

  handleEvent: (event) => {
    switch (event.type) {
      case "start":
        set({ streamId: event.streamId, content: "", isStreaming: true, seq: 0 });
        break;
      case "delta":
        set((state) => ({
          content: state.content + event.content,
          seq: event.seq,
        }));
        break;
      case "end":
        set({ isStreaming: false });
        break;
    }
  },
}));
