import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  sendPrompt,
  getPiStatus,
  setPiModel,
  setThinkingLevel,
  newSession,
  listSessions,
  abortAgent,
  compactContext,
  fsListDir,
  fsReadFile,
  fsWriteFile,
} from "../../lib/ipc";

// invoke is already mocked globally in setup.ts
const mockInvoke = vi.mocked(invoke);

describe("IPC layer", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("Pi Agent: Prompting", () => {
    it("sendPrompt passes text and images to invoke", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await sendPrompt("hello", [{ mediaType: "image/png", base64: "abc" }]);
      expect(mockInvoke).toHaveBeenCalledWith("send_prompt", {
        text: "hello",
        images: [{ mediaType: "image/png", base64: "abc" }],
      });
    });

    it("sendPrompt defaults images to null", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await sendPrompt("hello");
      expect(mockInvoke).toHaveBeenCalledWith("send_prompt", {
        text: "hello",
        images: null,
      });
    });

    it("abortAgent calls invoke correctly", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await abortAgent();
      expect(mockInvoke).toHaveBeenCalledWith("abort_agent");
    });
  });

  describe("Pi Agent: State & Config", () => {
    it("getPiStatus returns status string", async () => {
      mockInvoke.mockResolvedValueOnce("connected");
      const status = await getPiStatus();
      expect(status).toBe("connected");
      expect(mockInvoke).toHaveBeenCalledWith("get_pi_status");
    });

    it("setPiModel passes provider and modelId", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await setPiModel("anthropic", "claude-sonnet-4-6");
      expect(mockInvoke).toHaveBeenCalledWith("set_pi_model", {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
      });
    });

    it("setThinkingLevel passes level string", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await setThinkingLevel("high");
      expect(mockInvoke).toHaveBeenCalledWith("set_thinking_level", {
        level: "high",
      });
    });
  });

  describe("Session Management", () => {
    it("newSession calls invoke", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await newSession();
      expect(mockInvoke).toHaveBeenCalledWith("new_session");
    });

    it("listSessions passes sessionDir", async () => {
      mockInvoke.mockResolvedValueOnce([]);
      const result = await listSessions("/tmp/sessions");
      expect(result).toEqual([]);
      expect(mockInvoke).toHaveBeenCalledWith("list_sessions", {
        sessionDir: "/tmp/sessions",
      });
    });

    it("listSessions defaults to null sessionDir", async () => {
      mockInvoke.mockResolvedValueOnce([]);
      await listSessions();
      expect(mockInvoke).toHaveBeenCalledWith("list_sessions", {
        sessionDir: null,
      });
    });
  });

  describe("Context Management", () => {
    it("compactContext calls invoke", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await compactContext();
      expect(mockInvoke).toHaveBeenCalledWith("compact_context");
    });
  });

  describe("Filesystem", () => {
    it("fsListDir calls invoke with path", async () => {
      const entries = [{ name: "file.ts", path: "/src/file.ts", type: "file" }];
      mockInvoke.mockResolvedValueOnce(entries);
      const result = await fsListDir("/src");
      expect(result).toEqual(entries);
    });

    it("fsReadFile returns content", async () => {
      mockInvoke.mockResolvedValueOnce({ content: "hello world" });
      const result = await fsReadFile("/src/file.ts");
      expect(result).toEqual({ content: "hello world" });
    });

    it("fsWriteFile passes path and content", async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await fsWriteFile("/src/file.ts", "new content");
      expect(mockInvoke).toHaveBeenCalledWith("fs_write_file", {
        path: "/src/file.ts",
        content: "new content",
      });
    });
  });
});
