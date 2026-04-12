import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the dependent stores and ipc before importing stream
vi.mock("../../stores/contextStore", () => ({
  useContextStore: {
    getState: () => ({ setContext: vi.fn(), updateFromPiState: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock("../../stores/logStore", () => ({
  useLogStore: { getState: () => ({ addLog: vi.fn() }), setState: vi.fn() },
}));
vi.mock("../../stores/orchestrationStore", () => ({
  useOrchestrationStore: {
    getState: () => ({ phase: null }),
    setState: vi.fn(),
  },
}));
vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: {
    getState: () => ({ reloadTabsFromDisk: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock("../../lib/ipc", () => ({
  followUp: vi.fn(),
  getMessages: vi.fn(),
  getPiState: vi.fn(),
  getSessionStats: vi.fn(),
  setSessionName: vi.fn(),
}));

import { useStreamStore, type ChatMessage } from "../../stores/stream";

describe("useStreamStore", () => {
  beforeEach(() => {
    useStreamStore.setState({
      messages: [],
      isStreaming: false,
      agentActive: false,
      modelName: "",
      modelProvider: "",
      modelId: "",
      availableModels: [],
      thinkingLevel: "medium",
      sessionStats: {},
      isCompacting: false,
      isRetrying: false,
      turnCount: 0,
      sessionId: "",
      sessionName: "",
      sessionDir: "",
      contextWindow: 200000,
      hasAutoTitled: false,
      sessionStatus: "idle",
      piCommands: [],
      _agentStartMsgCount: 0,
      _emptyRetryCount: 0,
    });
  });

  it("starts with empty messages", () => {
    expect(useStreamStore.getState().messages).toHaveLength(0);
  });

  it("adds a user message", () => {
    useStreamStore.getState().addUserMessage("Hello, world!");
    const msgs = useStreamStore.getState().messages;

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect((msgs[0] as Extract<ChatMessage, { role: "user" }>).content).toBe(
      "Hello, world!",
    );
  });

  it("generates unique message IDs", () => {
    useStreamStore.getState().addUserMessage("First");
    useStreamStore.getState().addUserMessage("Second");
    const msgs = useStreamStore.getState().messages;

    expect(msgs[0].id).not.toBe(msgs[1].id);
  });

  it("clears messages", () => {
    useStreamStore.getState().addUserMessage("Hello");
    useStreamStore.getState().clearMessages();

    expect(useStreamStore.getState().messages).toHaveLength(0);
    expect(useStreamStore.getState().hasAutoTitled).toBe(false);
  });

  it("defaults to idle session status", () => {
    expect(useStreamStore.getState().sessionStatus).toBe("idle");
  });

  it("defaults thinking level to medium", () => {
    expect(useStreamStore.getState().thinkingLevel).toBe("medium");
  });
});
