/**
 * Tide Agent Utilities
 *
 * Shared utilities for spawning and managing Pi agent processes.
 * Used by tide-subagent.ts (one-shot agents) and tide-experts.ts (persistent agents).
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Logging ────────────────────────────────────────────

export function createLogger(prefix: string) {
  return (msg: string) => process.stderr.write(`[${prefix}] ${msg}\n`);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

// ── Binary & Extension Resolution ──────────────────────

export function resolvePiBinary(): string {
  if (process.env.TIDE_PI_BINARY) return process.env.TIDE_PI_BINARY;
  return "pi";
}

export function resolveExtensionPath(extName: string): string | null {
  const candidates = [
    path.join(__dirname, extName),
    path.join(process.cwd(), "pi-extensions", extName),
    path.join(process.cwd(), "..", "pi-extensions", extName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Temp File Management ───────────────────────────────

export function writePromptToTempFile(name: string, content: string): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-agent-"));
  const safeName = name.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

export function cleanupTempFile(filePath: string | null, dir: string | null): void {
  if (filePath) try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  if (dir) try { fs.rmdirSync(dir); } catch { /* ignore */ }
}

// ── Concurrency Limiter ────────────────────────────────

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Agent System Prompt Loading ────────────────────────

export function loadAgentPrompt(cwd: string, agentName: string): string | null {
  const candidates = [
    path.join(cwd, ".pi", "agents", `${agentName}.md`),
    path.join(cwd, "..", ".pi", "agents", `${agentName}.md`),
    path.join(cwd, "..", "..", ".pi", "agents", `${agentName}.md`),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        return match ? match[1].trim() : content;
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ── Model Resolution ───────────────────────────────────

export interface ModelRef {
  provider: string;
  id: string;
}

export function resolveModelFromRegistry(ctx: any, configuredModel: ModelRef | undefined, fallbackLabel: string): string | undefined {
  // 1. Check explicit config
  if (configuredModel) return `${configuredModel.provider}/${configuredModel.id}`;

  // 2. Fallback: cheapest available chat model
  try {
    const models = ctx.modelRegistry?.getAvailable?.() || [];
    const chat = models.filter((m: any) => {
      const lower = (m.id + " " + (m.api || "")).toLowerCase();
      return !["embedding", "tts", "whisper", "moderation", "image", "dall-e"].some(p => lower.includes(p));
    });
    if (chat.length === 0) return undefined;

    const sorted = [...chat].sort((a: any, b: any) =>
      (a.cost?.output ?? Infinity) - (b.cost?.output ?? Infinity)
    );
    const cheapest = sorted[0];
    if (cheapest) {
      process.stderr.write(`[tide:agent-utils] No configured model for ${fallbackLabel}, falling back to cheapest: ${cheapest.provider}/${cheapest.id}\n`);
      return `${cheapest.provider}/${cheapest.id}`;
    }
  } catch { /* ignore registry errors */ }
  return undefined;
}

// ── One-Shot Agent Runner ──────────────────────────────

export interface AgentMessage {
  role: "system" | "assistant" | "tool_call" | "tool_result";
  content: string;
  timestamp: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: string;
}

export interface AgentResult {
  type: string;
  task: string;
  output: string;
  exitCode: number;
  error?: string;
  usage: { input: number; output: number; turns: number };
  model?: string;
  messages?: AgentMessage[];
}

/**
 * Spawn a one-shot Pi agent process in JSON mode.
 * The process runs to completion and returns the final output.
 */
export async function runAgent(opts: {
  type: string;
  task: string;
  cwd: string;
  piBinary: string;
  model?: string;
  systemPrompt?: string;
  extensions?: string[];
  tools?: string[];
  signal?: AbortSignal;
  summaryMaxChars: number;
  maxTurns: number;
  env?: Record<string, string>;
  onMessage?: (msg: AgentMessage) => void;
}): Promise<AgentResult> {
  const log = createLogger(`tide:agent:${opts.type}`);
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  if (opts.model) args.push("--model", opts.model);
  if (opts.tools && opts.tools.length > 0) args.push("--tools", opts.tools.join(","));
  if (opts.extensions) {
    for (const ext of opts.extensions) {
      args.push("-e", ext);
    }
  }

  let tmpDir: string | null = null;
  let tmpPath: string | null = null;

  const result: AgentResult = {
    type: opts.type,
    task: opts.task,
    output: "",
    exitCode: 0,
    usage: { input: 0, output: 0, turns: 0 },
    messages: opts.onMessage ? [] : undefined,
  };

  try {
    if (opts.systemPrompt) {
      const tmp = writePromptToTempFile(opts.type, opts.systemPrompt);
      tmpDir = tmp.dir;
      tmpPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPath);
    }

    args.push(`Task: ${opts.task}`);

    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(opts.piBinary, args, {
        cwd: opts.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...opts.env },
      });

      let buffer = "";
      let lastAssistantText = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        // Track tool calls for message log
        if (event.type === "tool_execution_start" && opts.onMessage) {
          const msg: AgentMessage = {
            role: "tool_call",
            content: "",
            toolName: event.toolName || event.name,
            toolArgs: event.args || event.input,
            timestamp: new Date().toISOString(),
          };
          opts.onMessage(msg);
          result.messages?.push(msg);
        }

        if (event.type === "tool_execution_end" && opts.onMessage) {
          const msg: AgentMessage = {
            role: "tool_result",
            content: "",
            toolName: event.toolName || event.name,
            toolResult: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            timestamp: new Date().toISOString(),
          };
          opts.onMessage(msg);
          result.messages?.push(msg);
        }

        if (event.type === "message_end" && event.message) {
          const msg = event.message;
          if (msg.role === "assistant") {
            const hasText = (msg.content || []).some((p: any) => p.type === "text" && p.text?.trim());
            if (hasText) {
              result.usage.turns++;
              for (const part of msg.content || []) {
                if (part.type === "text") lastAssistantText = part.text;
              }

              if (opts.onMessage) {
                const agentMsg: AgentMessage = {
                  role: "assistant",
                  content: lastAssistantText,
                  timestamp: new Date().toISOString(),
                };
                opts.onMessage(agentMsg);
                result.messages?.push(agentMsg);
              }
            }
            const usage = msg.usage;
            if (usage) {
              result.usage.input += usage.input || 0;
              result.usage.output += usage.output || 0;
            }
            if (!result.model && msg.model) result.model = msg.model;

            if (hasText && result.usage.turns >= opts.maxTurns) {
              log(`Max text turns (${opts.maxTurns}) reached, terminating`);
              proc.kill("SIGTERM");
              setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
            }
          }
        }
      };

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr!.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) log(text.split("\n")[0]);
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        result.output = lastAssistantText.slice(0, opts.summaryMaxChars);
        resolve(code ?? 0);
      });

      proc.on("error", (err) => {
        result.error = err.message;
        resolve(1);
      });

      if (opts.signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (opts.signal.aborted) killProc();
        else opts.signal.addEventListener("abort", killProc, { once: true });
      }
    });

    result.exitCode = exitCode;
    if (wasAborted) {
      result.error = "Agent was aborted";
      result.exitCode = 1;
    }
  } finally {
    cleanupTempFile(tmpPath, tmpDir);
  }

  return result;
}

// ── Persistent Agent (RPC Mode) ────────────────────────

export interface PersistentAgent {
  name: string;
  proc: ChildProcess;
  /** Send a JSON-line RPC command and wait for its response (matched by id). */
  send: (command: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Inject a follow-up/steering message into the agent's current session. */
  steer: (message: string) => Promise<void>;
  /** Send a prompt and wait for agent_end. */
  prompt: (message: string) => Promise<void>;
  /** Kill the process. */
  kill: () => void;
  /** Register a handler for all JSONL events from stdout. */
  onEvent: (handler: (event: any) => void) => void;
  /** True if the process has exited. */
  exited: boolean;
  /** Collected usage stats. */
  usage: { input: number; output: number; turns: number };
  /** Model used (detected from first response). */
  model?: string;
}

/**
 * Spawn a persistent Pi agent process in RPC mode.
 * The process stays alive for multiple prompts and supports steering.
 */
export async function spawnPersistentAgent(opts: {
  name: string;
  cwd: string;
  piBinary: string;
  model?: string;
  systemPrompt?: string;
  extensions?: string[];
  tools?: string[];
  env?: Record<string, string>;
}): Promise<PersistentAgent> {
  const log = createLogger(`tide:expert:${opts.name}`);
  const args: string[] = ["--mode", "rpc", "--no-session"];

  if (opts.model) args.push("--model", opts.model);
  if (opts.tools && opts.tools.length > 0) args.push("--tools", opts.tools.join(","));
  if (opts.extensions) {
    for (const ext of opts.extensions) {
      args.push("-e", ext);
    }
  }

  // Append system prompt via temp file
  let tmpDir: string | null = null;
  let tmpPath: string | null = null;
  if (opts.systemPrompt) {
    const tmp = writePromptToTempFile(opts.name, opts.systemPrompt);
    tmpDir = tmp.dir;
    tmpPath = tmp.filePath;
    args.push("--append-system-prompt", tmpPath);
  }

  const proc = spawn(opts.piBinary, args, {
    cwd: opts.cwd,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
  });

  let exited = false;
  const eventHandlers: Array<(event: any) => void> = [];
  const pendingRequests = new Map<string, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  // Queue of resolvers for sequential prompt() → agent_end correlation
  const agentEndResolvers: Array<() => void> = [];
  const usage = { input: 0, output: 0, turns: 0 };
  let detectedModel: string | undefined;

  // JSONL read loop
  let buffer = "";
  proc.stdout!.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      // Response correlation — clear timeout on success
      if (event.type === "response" && event.id && pendingRequests.has(event.id)) {
        const pending = pendingRequests.get(event.id)!;
        clearTimeout(pending.timeoutId);
        pendingRequests.delete(event.id);
        pending.resolve(event);
      }

      // Track agent_end for prompt completion — use FIFO queue
      if (event.type === "agent_end") {
        const resolver = agentEndResolvers.shift();
        if (resolver) resolver();
      }

      // Track usage
      if (event.type === "message_end" && event.message) {
        const msg = event.message;
        if (msg.role === "assistant") {
          const hasText = (msg.content || []).some((p: any) => p.type === "text" && p.text?.trim());
          if (hasText) usage.turns++;
          if (msg.usage) {
            usage.input += msg.usage.input || 0;
            usage.output += msg.usage.output || 0;
          }
          if (!detectedModel && msg.model) detectedModel = msg.model;
        }
      }

      // Forward to event handlers
      for (const handler of eventHandlers) {
        try { handler(event); } catch { /* ignore handler errors */ }
      }
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) log(text.split("\n")[0]);
  });

  proc.on("close", (code) => {
    exited = true;
    log(`Process exited with code ${code}`);
    // Clean up temp files
    cleanupTempFile(tmpPath, tmpDir);
    // Reject any pending requests and clear their timeouts
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Agent process exited"));
      pendingRequests.delete(id);
    }
    // Resolve all pending prompt waiters so they don't hang
    for (const resolver of agentEndResolvers) resolver();
    agentEndResolvers.length = 0;
  });

  proc.on("error", (err) => {
    exited = true;
    log(`Process error: ${err.message}`);
  });

  let idCounter = 0;

  const agent: PersistentAgent = {
    name: opts.name,
    proc,
    get exited() { return exited; },
    get usage() { return usage; },
    get model() { return detectedModel; },

    async send(command) {
      if (exited) throw new Error(`Agent ${opts.name} has exited`);
      const id = `${opts.name}-${++idCounter}`;
      const cmd = { ...command, id };

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Request ${id} timed out`));
          }
        }, 60000);

        pendingRequests.set(id, { resolve, reject, timeoutId });
        const line = JSON.stringify(cmd) + "\n";
        proc.stdin!.write(line, (err) => {
          if (err) {
            clearTimeout(timeoutId);
            pendingRequests.delete(id);
            reject(err);
          }
        });
      });
    },

    async steer(message) {
      if (exited) throw new Error(`Agent ${opts.name} has exited`);
      const cmd = { type: "follow_up", message };
      const line = JSON.stringify(cmd) + "\n";
      proc.stdin!.write(line, (err) => {
        if (err) log(`Steer failed for ${opts.name}: ${err.message}`);
      });
    },

    async prompt(message) {
      if (exited) throw new Error(`Agent ${opts.name} has exited`);

      // Wait for agent_end after sending prompt — uses FIFO queue for concurrency safety
      const waitForEnd = new Promise<void>((resolve) => {
        agentEndResolvers.push(resolve);
      });

      const cmd = { type: "prompt", message };
      const id = `${opts.name}-${++idCounter}`;
      const cmdWithId = { ...cmd, id };
      const line = JSON.stringify(cmdWithId) + "\n";

      await new Promise<void>((resolve, reject) => {
        proc.stdin!.write(line, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Wait for agent_end (with timeout)
      await Promise.race([
        waitForEnd,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Prompt timed out for ${opts.name}`)), 300000) // 5 min
        ),
      ]);
    },

    kill() {
      if (!exited) {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      }
    },

    onEvent(handler) {
      eventHandlers.push(handler);
    },
  };

  // Wait for Pi to be ready (it sends a ready event on startup)
  await new Promise<void>((resolve) => {
    const readyHandler = (event: any) => {
      if (event.type === "ready" || event.type === "session_start") {
        const idx = eventHandlers.indexOf(readyHandler);
        if (idx !== -1) eventHandlers.splice(idx, 1);
        resolve();
      }
    };
    eventHandlers.push(readyHandler);

    // Timeout: if no ready event in 3s, proceed anyway (Pi RPC mode may not send ready)
    setTimeout(() => {
      const idx = eventHandlers.indexOf(readyHandler);
      if (idx !== -1) {
        eventHandlers.splice(idx, 1);
        log("No ready event received, proceeding anyway");
        resolve();
      }
    }, 3000);
  });

  log(`Persistent agent spawned: model=${opts.model || "default"}`);
  return agent;
}
