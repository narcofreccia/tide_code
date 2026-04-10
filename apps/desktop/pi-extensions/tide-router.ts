import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { classifyPrompt, type Tier } from "./tide-classify.js";

// Re-export for any extensions that imported from here
export { classifyPrompt, type Tier };

// ── Logging ─────────────────────────────────────────────────

function log(msg: string) {
  process.stderr.write(`[tide:router] ${msg}\n`);
}

// ── Non-chat model exclusion (API-based, not pattern-based) ─

const EXCLUDED_API_PATTERNS = ["embedding", "tts", "whisper", "moderation", "image", "dall-e"];

function isChatModel(m: { id: string; api?: string }): boolean {
  const lower = (m.id + " " + (m.api || "")).toLowerCase();
  return !EXCLUDED_API_PATTERNS.some((p) => lower.includes(p));
}

// ── Cost-based model derivation ─────────────────────────────
// Instead of hardcoded model name patterns, derive tier defaults
// from model metadata (cost as proxy for capability).

interface ModelWithMeta {
  id: string;
  name: string;
  provider: string;
  cost?: { input?: number; output?: number };
  contextWindow?: number;
}

function deriveDefaults(models: ModelWithMeta[]): { quick?: ModelWithMeta; standard?: ModelWithMeta; complex?: ModelWithMeta } {
  if (models.length === 0) return {};
  if (models.length === 1) return { quick: models[0], standard: models[0], complex: models[0] };

  // Sort by output cost (highest = most capable). Fall back to contextWindow, then name.
  const sorted = [...models].sort((a, b) => {
    const costA = a.cost?.output ?? 0;
    const costB = b.cost?.output ?? 0;
    if (costA !== costB) return costB - costA; // most expensive first
    const ctxA = a.contextWindow ?? 0;
    const ctxB = b.contextWindow ?? 0;
    if (ctxA !== ctxB) return ctxB - ctxA; // larger context first
    return a.id.localeCompare(b.id);
  });

  const complex = sorted[0];
  const quick = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const standard = sorted[mid] || complex;

  return { quick, standard, complex };
}

// ── Router Config ───────────────────────────────────────────

interface ModelRef {
  provider: string;
  id: string;
}

interface RouterConfig {
  enabled: boolean;
  autoSwitch?: boolean;
  tierModels?: {
    quick?: ModelRef;
    standard?: ModelRef;
    complex?: ModelRef;
  };
  orchestratorModels?: {
    codeEditing?: ModelRef;
    research?: ModelRef;
    validation?: ModelRef;
  };
  subagentModels?: {
    webSearch?: ModelRef;
    codebaseExploration?: ModelRef;
  };
}

function loadRouterConfig(cwd: string): RouterConfig {
  const configPath = path.join(cwd, ".tide", "router-config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return { enabled: true, autoSwitch: true };
}

// ── Session-Based Routing State ─────────────────────────────

interface RouterState {
  sessionId: string;
  routedModel: { provider: string; id: string };
  tier: Tier;
}

let currentRouterState: RouterState | null = null;

function routerStatePath(cwd: string): string {
  return path.join(cwd, ".tide", "router-state.json");
}

function persistRouterState(cwd: string, state: RouterState): void {
  try {
    const dir = path.join(cwd, ".tide");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(routerStatePath(cwd), JSON.stringify(state), "utf-8");
  } catch (err) {
    log(`Failed to persist router state: ${err}`);
  }
}

function loadPersistedRouterState(cwd: string): RouterState | null {
  try {
    const p = routerStatePath(cwd);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch { /* ignore corrupt state */ }
  return null;
}

// ── Dynamic Tool Loading ────────────────────────────────────
// Scope active tools by task complexity to reduce context overhead.

const QUICK_TOOLS = [
  // Pi built-ins
  "read", "bash", "edit", "write", "grep", "find", "ls",
  // Essential Tide tools
  "web_search", "web_extract",
];

const STANDARD_TOOLS = [
  ...QUICK_TOOLS,
  // Index tools for codebase navigation
  "tide_index_file_tree", "tide_index_file_outline", "tide_index_get_symbol",
  "tide_index_search", "tide_index_repo_outline",
  // Subagent tools
  "tide_explore", "tide_research", "tide_dispatch",
];

// complex/orchestrated: all tools (no filtering)

function scopeToolsForTier(pi: ExtensionAPI, tier: Tier, isOrchestrated: boolean): void {
  if (isOrchestrated) {
    // Orchestrated prompts get all tools
    return;
  }

  try {
    if (tier === "quick") {
      const allTools = pi.getAllTools().map((t: any) => t.name || t);
      const activeSet = QUICK_TOOLS.filter((t) => allTools.includes(t));
      pi.setActiveTools(activeSet);
      log(`Scoped tools for quick tier: ${activeSet.length} tools`);
    } else if (tier === "standard") {
      const allTools = pi.getAllTools().map((t: any) => t.name || t);
      const activeSet = STANDARD_TOOLS.filter((t) => allTools.includes(t));
      pi.setActiveTools(activeSet);
      log(`Scoped tools for standard tier: ${activeSet.length} tools`);
    }
    // complex: don't filter, use all tools
  } catch (err) {
    log(`Failed to scope tools: ${err}`);
  }
}

// ── Extension ───────────────────────────────────────────────

export default function tideRouter(pi: ExtensionAPI) {
  log("Extension registered (first-message routing + cost-based derivation)");

  // Restore persisted state on session start (survives Pi restarts)
  pi.on("session_start", async (_event, ctx) => {
    if (!currentRouterState) {
      currentRouterState = loadPersistedRouterState(ctx.cwd);
      if (currentRouterState) {
        log(`Restored persisted router state: ${currentRouterState.tier} → ${currentRouterState.routedModel.provider}/${currentRouterState.routedModel.id}`);
      }
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const config = loadRouterConfig(ctx.cwd);
    if (!config.enabled) {
      log("Router disabled by config");
      return;
    }

    const prompt = event.prompt || "";
    if (!prompt.trim()) {
      log("Empty prompt, skipping routing");
      return;
    }

    // Skip routing for orchestrated prompts — the orchestrator manages model selection.
    // The [tide:orchestrated] marker is prepended by the Rust orchestrator.
    const isOrchestrated = prompt.trimStart().startsWith("[tide:orchestrated]");
    if (isOrchestrated) {
      log("Orchestrated prompt detected, skipping routing");
      return;
    }

    // Skip routing for expert brainstorming prompts — needs full toolset available.
    const isExperts = prompt.trimStart().startsWith("[tide:experts]");
    if (isExperts) {
      log("Expert brainstorming prompt detected, skipping routing");
      return;
    }

    const { tier, reason } = classifyPrompt(prompt, ctx.cwd);
    log(`Classified as ${tier}: ${reason}`);

    // Dynamic tool scoping based on tier
    scopeToolsForTier(pi, tier, isOrchestrated);

    if (!config.autoSwitch) {
      log(`Auto-switch disabled, using current model (tier: ${tier})`);
      return;
    }

    // ── First-message-only check ──────────────────────────
    const sessionId = (ctx as any).sessionFile || (ctx as any).sessionId || "";

    if (currentRouterState) {
      if (sessionId && currentRouterState.sessionId === sessionId) {
        log(`Skip: already routed this session (${currentRouterState.tier} → ${currentRouterState.routedModel.provider}/${currentRouterState.routedModel.id})`);
        return;
      }
      if (!sessionId) {
        const current = ctx.model;
        if (current && current.provider === currentRouterState.routedModel.provider
            && current.id === currentRouterState.routedModel.id) {
          log(`Skip: already on routed model ${current.provider}/${current.id}`);
          return;
        }
      }
    }

    // ── Find target model ─────────────────────────────────
    const available = ctx.modelRegistry.getAvailable();
    log(`Model registry: ${available.length} available models`);
    const chatModels = available.filter(isChatModel);

    if (chatModels.length === 0) {
      log("No available chat models, skipping routing");
      return;
    }
    log(`Chat models: ${chatModels.map(m => `${m.provider}/${m.id}`).join(", ")}`);

    // Check for explicit tier→model mapping in config
    const explicitMapping = config.tierModels?.[tier];
    let target = explicitMapping
      ? ctx.modelRegistry.find(explicitMapping.provider, explicitMapping.id)
      : undefined;

    // Auto-resolve using cost-based derivation if no explicit mapping
    if (!target) {
      const defaults = deriveDefaults(chatModels as ModelWithMeta[]);
      const derived = defaults[tier];
      if (derived) {
        target = ctx.modelRegistry.find(derived.provider, derived.id);
        log(`Cost-derived ${tier} model: ${derived.provider}/${derived.id}`);
      }
    }

    if (!target) {
      log("No target model found for tier " + tier);
      return;
    }

    // Don't switch if already on the target model
    const current = ctx.model;
    if (current && current.provider === target.provider && current.id === target.id) {
      log(`Already on ${target.provider}/${target.id}, skipping switch`);
      currentRouterState = { sessionId, routedModel: { provider: target.provider, id: target.id }, tier };
      persistRouterState(ctx.cwd, currentRouterState);
      return;
    }

    // ── Switch model with fallback chain ──────────────────
    const currentModel = ctx.model;
    log(`Switching: ${currentModel?.provider}/${currentModel?.id} → ${target.provider}/${target.id} (tier: ${tier})`);
    const success = await trySetModel(pi, target);
    if (success) {
      log(`Switched to ${target.provider}/${target.id} for ${tier} tier`);
      currentRouterState = { sessionId, routedModel: { provider: target.provider, id: target.id }, tier };
      persistRouterState(ctx.cwd, currentRouterState);
    } else {
      // Fallback chain: try other tiers' models
      log(`Failed to switch to ${target.provider}/${target.id}, trying fallback chain...`);
      const fallbackModels = chatModels.filter(
        (m) => m.provider !== target!.provider || m.id !== target!.id
      );

      let fallbackSuccess = false;
      for (const fallback of fallbackModels) {
        log(`Trying fallback: ${fallback.provider}/${fallback.id}`);
        if (await trySetModel(pi, fallback)) {
          log(`Fallback succeeded: ${fallback.provider}/${fallback.id}`);
          currentRouterState = { sessionId, routedModel: { provider: fallback.provider, id: fallback.id }, tier };
          persistRouterState(ctx.cwd, currentRouterState);
          fallbackSuccess = true;
          break;
        }
      }

      if (!fallbackSuccess) {
        log(`All fallbacks failed, staying on current model`);
        if (current) {
          currentRouterState = { sessionId, routedModel: { provider: current.provider, id: current.id }, tier };
          persistRouterState(ctx.cwd, currentRouterState);
        }
      }
    }
  });
}

async function trySetModel(pi: ExtensionAPI, model: { provider: string; id: string }): Promise<boolean> {
  try {
    return await pi.setModel(model);
  } catch (err) {
    log(`Error switching to ${model.provider}/${model.id}: ${err}`);
    return false;
  }
}
