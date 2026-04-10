/**
 * Tide Experts Extension
 *
 * Orchestrates multi-agent brainstorming sessions with P2P communication.
 * Manages expert teams, persistent Pi processes, time limits, and synthesis.
 *
 * Tools registered:
 *   tide_experts_brainstorm — Start a brainstorming session
 *   tide_experts_teams      — CRUD for team templates
 *   tide_experts_manage     — CRUD for individual experts
 *   tide_experts_sessions   — Query past sessions
 *   tide_experts_execute    — Feed synthesis into orchestrator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  type PersistentAgent,
  createLogger,
  formatTokens,
  resolveExtensionPath,
  resolveModelFromRegistry,
  resolvePiBinary,
  spawnPersistentAgent,
} from "./tide-agent-utils.js";

const log = createLogger("tide:experts");

// ── Types ──────────────────────────────────────────────

interface ModelRef {
  provider: string;
  id: string;
}

interface ExpertConfig {
  name: string;
  description: string;
  model?: ModelRef;
  temperature?: number;
  maxTurns?: number;
  icon?: string;
  color?: string;
  systemPrompt: string;
}

interface TeamConfig {
  id: string;
  name: string;
  description: string;
  experts: string[];
  leader: string;
  debateRounds: number;
  timeLimitMinutes: number;
  defaultModel?: ModelRef;
  outputMode?: "execute" | "advisory" | "document";
  createdAt: string;
  updatedAt: string;
}

interface SessionState {
  id: string;
  teamId: string;
  topic: string;
  sharedContext?: string;
  phase: "setup" | "exploration" | "discussion" | "synthesis" | "ready" | "complete" | "failed";
  experts: {
    name: string;
    model: string;
    status: "pending" | "running" | "idle" | "done" | "failed";
    messageCount: number;
    findingCount: number;
  }[];
  synthesis: any | null;
  timeLimitReached: boolean;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: string;
  completedAt?: string;
}

// ── File Helpers ────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function expertsDir(cwd: string): string {
  return path.join(cwd, ".tide", "experts");
}

function loadExpertConfig(cwd: string, name: string): ExpertConfig | null {
  const filePath = path.join(expertsDir(cwd), "experts", `${name}.md`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf-8");

  // Try standard frontmatter (---\n...\n---\n)
  let yaml = "";
  let body = content;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    yaml = fmMatch[1];
    body = fmMatch[2].trim();
  } else {
    // No frontmatter delimiters — check if file starts with key:value lines before a --- separator
    const sepIdx = content.indexOf("\n---\n");
    if (sepIdx !== -1) {
      yaml = content.slice(0, sepIdx);
      body = content.slice(sepIdx + 5).trim();
    }
  }

  if (!yaml) {
    return { name, description: "", systemPrompt: content };
  }

  // Parse key:value lines
  const config: any = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      const unquoted = value.replace(/^["']|["']$/g, "");
      if (value === "true" || value === "false") {
        config[key] = value === "true";
      } else if (!isNaN(Number(value)) && value.trim() !== "") {
        config[key] = Number(value);
      } else {
        config[key] = unquoted;
      }
    }
  }

  // Parse model — supports both "provider/id" string and nested {provider, id} object
  let model: { provider: string; id: string } | undefined;
  if (typeof config.model === "string" && config.model.includes("/")) {
    const [provider, ...rest] = config.model.split("/");
    model = { provider, id: rest.join("/") };
  } else if (config.model?.provider && config.model?.id) {
    model = config.model;
  }

  return {
    name: config.name || name,
    description: config.description || "",
    model,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    icon: config.icon,
    color: config.color,
    systemPrompt: body,
  };
}

function loadTeamConfig(cwd: string, teamId: string): TeamConfig | null {
  const filePath = path.join(expertsDir(cwd), "teams", `${teamId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // Backward compat: rename "judge" → "leader"
    if (raw.judge && !raw.leader) raw.leader = raw.judge;
    return raw;
  } catch { return null; }
}

function listTeams(cwd: string): TeamConfig[] {
  const teamsDir = path.join(expertsDir(cwd), "teams");
  if (!fs.existsSync(teamsDir)) return [];
  return fs.readdirSync(teamsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(teamsDir, f), "utf-8")) as TeamConfig;
      } catch { return null; }
    })
    .filter((t): t is TeamConfig => t !== null);
}

function listExpertNames(cwd: string): string[] {
  const dir = path.join(expertsDir(cwd), "experts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => f.replace(/\.md$/, ""));
}

function generateSessionId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `exp-${date}-${rand}`;
}

// ── Session State Management ───────────────────────────

function saveSessionState(sessionDir: string, state: SessionState): void {
  fs.writeFileSync(
    path.join(sessionDir, "state.json"),
    JSON.stringify(state, null, 2),
  );
}

function loadSessionState(sessionDir: string): SessionState | null {
  const statePath = path.join(sessionDir, "state.json");
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch { return null; }
}

function countMessages(sessionDir: string, agentName: string): number {
  const outboxDir = path.join(sessionDir, "mailboxes", agentName, "outbox");
  if (!fs.existsSync(outboxDir)) return 0;
  return fs.readdirSync(outboxDir).filter(f => f.endsWith(".json")).length;
}

function countFindings(sessionDir: string, agentName: string): number {
  const findingsPath = path.join(sessionDir, "shared", "findings.json");
  if (!fs.existsSync(findingsPath)) return 0;
  try {
    const findings = JSON.parse(fs.readFileSync(findingsPath, "utf-8"));
    return findings.filter((f: any) => f.from === agentName).length;
  } catch { return 0; }
}

// ── Brainstorming Engine ───────────────────────────────

function buildSynthesisInstructions(outputMode: string): { sections: string; brief: string } {
  if (outputMode === "advisory") {
    return {
      sections:
        "## Summary\nConcise overview of what was analyzed and key findings.\n\n" +
        "## Analysis\nDetailed analysis organized by topic area. Cite specific files, functions, and line numbers.\n\n" +
        "## Recommendations\nPrioritized recommendations with reasoning and trade-offs for each.\n\n" +
        "## Risks & Concerns\nIdentified risks, their likelihood and severity, and suggested mitigations.\n\n" +
        "## Open Questions\nAnything that needs further investigation or stakeholder input.\n\n",
      brief:
        "Produce a thorough analysis and advisory report. Focus on insights, recommendations, and trade-offs. " +
        "Do NOT include implementation steps or action items for code changes — this is advisory only.",
    };
  }
  if (outputMode === "document") {
    return {
      sections:
        "## Overview\nWhat this document covers and why.\n\n" +
        "## Background\nContext and motivation.\n\n" +
        "## Analysis\nDetailed findings organized by area, with file/code references.\n\n" +
        "## Architecture & Design\nKey patterns, structures, and design decisions found.\n\n" +
        "## Recommendations\nSuggested improvements or next steps.\n\n" +
        "## References\nKey files, external resources, and related documentation.\n\n",
      brief:
        "Produce a well-structured document suitable for saving as project documentation. " +
        "Write in a clear, reference-style tone. Include code references and file paths.",
    };
  }
  // execute (default)
  return {
    sections:
      "## Consensus\nWhat all experts agree on.\n\n" +
      "## Disagreements & Rulings\nFor each disagreement, state who said what and **your ruling** with reasoning. Don't leave anything unresolved.\n\n" +
      "## Final Recommendation\nYour single, clear recommendation. Be specific and actionable — not vague.\n\n" +
      "## Action Items\nNumbered list of concrete next steps, prioritized by impact.\n\n" +
      "## Risk Assessment\nOverall risk level (low/medium/high) with reasoning.\n\n",
    brief:
      "Produce your FINAL VERDICT: consensus, disagreements (with rulings), recommendations, action items, and risk level.",
  };
}

async function runBrainstormSession(opts: {
  topic: string;
  team: TeamConfig;
  expertConfigs: ExpertConfig[];
  cwd: string;
  sharedContext?: string;
  signal?: AbortSignal;
  onPhaseChange?: (phase: string, message: string) => void;
}): Promise<SessionState> {
  const { topic, team, expertConfigs, cwd, sharedContext, signal, onPhaseChange } = opts;
  const sessionId = generateSessionId();
  const sessionsDir = path.join(expertsDir(cwd), "sessions");
  const sessionDir = path.join(sessionsDir, sessionId);

  ensureDir(sessionDir);
  ensureDir(path.join(sessionDir, "shared"));

  // Initialize mailbox directories for each expert
  for (const expert of expertConfigs) {
    ensureDir(path.join(sessionDir, "mailboxes", expert.name, "inbox"));
    ensureDir(path.join(sessionDir, "mailboxes", expert.name, "outbox"));
  }

  // Write shared context
  const contextContent = [
    `# Brainstorming Session: ${topic}`,
    "",
    `Team: ${team.name}`,
    `Experts: ${expertConfigs.map(e => e.name).join(", ")}`,
    `Time Limit: ${team.timeLimitMinutes} minutes`,
    "",
    sharedContext ? `## Additional Context\n\n${sharedContext}` : "",
  ].join("\n");
  fs.writeFileSync(path.join(sessionDir, "shared", "context.md"), contextContent);
  fs.writeFileSync(path.join(sessionDir, "shared", "findings.json"), "[]");

  // Initialize session state
  const state: SessionState = {
    id: sessionId,
    teamId: team.id,
    topic,
    sharedContext,
    phase: "setup",
    experts: expertConfigs.map(e => ({
      name: e.name,
      model: e.model ? `${e.model.provider}/${e.model.id}` : team.defaultModel ? `${team.defaultModel.provider}/${team.defaultModel.id}` : "default",
      status: "pending",
      messageCount: 0,
      findingCount: 0,
    })),
    synthesis: null,
    timeLimitReached: false,
    usage: { inputTokens: 0, outputTokens: 0 },
    createdAt: new Date().toISOString(),
  };
  saveSessionState(sessionDir, state);

  const piBinary = resolvePiBinary();
  const commsExt = resolveExtensionPath("tide-expert-comms.ts");
  const indexExt = resolveExtensionPath("tide-index.ts");

  if (!commsExt) {
    state.phase = "failed";
    saveSessionState(sessionDir, state);
    throw new Error("tide-expert-comms.ts extension not found");
  }

  const extensions = [commsExt];
  if (indexExt) extensions.push(indexExt);

  // ── Phase: Spawn persistent agents ───────────────────

  onPhaseChange?.("setup", "Spawning expert agents...");
  const agents: PersistentAgent[] = [];
  // All agents: domain experts + the team leader (auto-added)
  const allNames = [...expertConfigs.map(e => e.name), "leader"];

  // Add the leader to session state
  state.experts.push({
    name: "leader",
    model: team.defaultModel ? `${team.defaultModel.provider}/${team.defaultModel.id}` : "default",
    status: "pending",
    messageCount: 0,
    findingCount: 0,
  });
  saveSessionState(sessionDir, state);

  // Create leader's mailbox
  ensureDir(path.join(sessionDir, "mailboxes", "leader", "inbox"));
  ensureDir(path.join(sessionDir, "mailboxes", "leader", "outbox"));

  try {
    // Spawn domain experts
    for (const expert of expertConfigs) {
      if (signal?.aborted) throw new Error("Cancelled");

      const model = expert.model
        ? `${expert.model.provider}/${expert.model.id}`
        : team.defaultModel
          ? `${team.defaultModel.provider}/${team.defaultModel.id}`
          : undefined;

      const agent = await spawnPersistentAgent({
        name: expert.name,
        cwd,
        piBinary,
        model,
        systemPrompt: expert.systemPrompt,
        extensions,
        tools: ["read", "grep", "find", "ls"],
        env: {
          TIDE_EXPERTS_SESSION_DIR: sessionDir,
          TIDE_EXPERTS_AGENT_NAME: expert.name,
          TIDE_EXPERTS_TEAMMATES: allNames.filter(n => n !== expert.name).join(","),
        },
      });

      agents.push(agent);
      const expertState = state.experts.find(e => e.name === expert.name)!;
      expertState.status = "running";
      saveSessionState(sessionDir, state);
    }

    // Spawn the Team Leader — a separate orchestrator agent above domain experts
    // Load leader config from expert library (editable by user) with fallback
    const leaderConfig = loadExpertConfig(cwd, "leader");
    const leaderModel = leaderConfig?.model
      ? `${leaderConfig.model.provider}/${leaderConfig.model.id}`
      : team.defaultModel
        ? `${team.defaultModel.provider}/${team.defaultModel.id}`
        : undefined;

    const leaderAgent = await spawnPersistentAgent({
      name: "leader",
      cwd,
      piBinary,
      model: leaderModel,
      systemPrompt: leaderConfig?.systemPrompt ||
        "You are the Team Leader — an impartial orchestrator of a panel of domain experts.\n\n" +
        "Your role:\n" +
        "- You do NOT analyze code yourself. You read what experts produce.\n" +
        "- You ask targeted follow-up questions to specific experts by name.\n" +
        "- You mediate disagreements and push for resolution.\n" +
        "- You identify when consensus has formed and call it out.\n" +
        "- You produce the final synthesis and verdict.\n\n" +
        "Always be concise, fair, and action-oriented. Weigh all expert inputs equally.",
      extensions,
      tools: [],  // Leader doesn't need code tools — only communication
      env: {
        TIDE_EXPERTS_SESSION_DIR: sessionDir,
        TIDE_EXPERTS_AGENT_NAME: "leader",
        TIDE_EXPERTS_TEAMMATES: expertConfigs.map(e => e.name).join(","),
      },
    });

    agents.push(leaderAgent);
    const leaderState = state.experts.find(e => e.name === "leader")!;
    leaderState.status = "running";
    saveSessionState(sessionDir, state);

    // ── Phase: Exploration ─────────────────────────────

    state.phase = "exploration";
    saveSessionState(sessionDir, state);
    onPhaseChange?.("exploration", "Experts analyzing the task...");

    // Build teammate descriptions for the prompt
    const teammateDesc = expertConfigs.map(e =>
      `- **${e.name}**: ${e.description}`
    ).join("\n");

    // Send initial prompts to domain experts in parallel
    const initialPrompts = agents
      .filter(a => a.name !== "leader")
      .map((agent, i) => {
        const expert = expertConfigs[i];
        return agent.prompt(
          `You are the **${expert.name}** on a team of experts analyzing the following topic:\n\n` +
          `## Topic\n\n${topic}\n\n` +
          (sharedContext ? `## Additional Context\n\n${sharedContext}\n\n` : "") +
          `## Your Teammates\n\n${teammateDesc}\n- **★ Team Leader**: Impartial orchestrator — drives discussion and makes the final call\n\n` +
          `## Available Tools\n\n` +
          `- **tide_index_file_tree**: Get the project file tree with symbol counts (FAST — use this first)\n` +
          `- **tide_index_search**: Search symbols by name across the codebase (functions, classes, types)\n` +
          `- **tide_index_file_outline**: Get all symbols in a specific file\n` +
          `- **read, grep, find, ls**: Standard file exploration tools\n` +
          `- **send_message, check_messages, post_finding, read_findings**: Team communication\n\n` +
          `## Instructions\n\n` +
          `1. Start with **tide_index_file_tree** to understand the project structure\n` +
          `2. Use **tide_index_search** to find relevant symbols for your analysis area (${expert.description})\n` +
          `3. Use **read** to examine specific files you identified\n` +
          `4. Use **check_messages** periodically to see what teammates and the Team Leader are finding\n` +
          `5. Use **send_message** to share observations, ask questions, or respond to the Team Leader\n` +
          `6. Use **post_finding** for important discoveries the whole team should know\n` +
          `7. When your initial analysis is complete, broadcast: type="observation", content="[ANALYSIS COMPLETE] {your summary}"\n\n` +
          `Focus on your specialty. Be concise but thorough. Cite specific file paths and line numbers.`
        );
      });

    // Send the leader a monitoring prompt — it observes and asks questions
    const leaderExplorationPrompt = leaderAgent.prompt(
      `You are the **Team Leader** overseeing a brainstorming session on:\n\n` +
      `## Topic\n\n${topic}\n\n` +
      `## Your Expert Panel\n\n${teammateDesc}\n\n` +
      `## Instructions\n\n` +
      `1. Use **check_messages** to monitor what the experts are finding\n` +
      `2. When experts share their analysis, ask **follow-up questions** to specific experts:\n` +
      `   - "Security, what's the risk of X?"\n` +
      `   - "Performance, how would Y scale?"\n` +
      `3. If you see experts missing an angle, point it out\n` +
      `4. Do NOT analyze code yourself — rely on your experts\n` +
      `5. When all experts have reported, broadcast: type="observation", content="[ANALYSIS COMPLETE] All experts reported. Moving to discussion."\n\n` +
      `Be concise and action-oriented. Your job is to steer, not to do the analysis.`
    );

    initialPrompts.push(leaderExplorationPrompt);

    // ── Time limit enforcement ─────────────────────────

    const startTime = Date.now();
    const timeLimitMs = team.timeLimitMinutes * 60 * 1000;
    const warningMs = timeLimitMs * 0.8;
    let warningIssued = false;
    let timeLimitHit = false;

    const timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeLimitMs && !timeLimitHit) {
        timeLimitHit = true;
        state.timeLimitReached = true;
        log(`Time limit reached (${team.timeLimitMinutes}m). Forcing synthesis.`);

        // Kill all domain experts — keep leader alive for synthesis
        for (const agent of agents) {
          if (agent.name !== "leader") {
            agent.kill();
            const es = state.experts.find(e => e.name === agent.name)!;
            es.status = "done";
          }
        }

        // Steer leader to produce final synthesis
        const leaderTimeLimitAgent = agents.find(a => a.name === "leader");
        if (leaderTimeLimitAgent && !leaderTimeLimitAgent.exited) {
          const synth = buildSynthesisInstructions(team.outputMode || "execute");
          leaderTimeLimitAgent.steer(
            "[TIME LIMIT REACHED] The brainstorming time limit has expired. " +
            "Read all messages and the shared findings board. " +
            synth.brief + " Note any unresolved threads. " +
            'Broadcast your synthesis: type="observation", content="[SYNTHESIS] {your synthesis}"'
          );
        }
      } else if (elapsed >= warningMs && !warningIssued) {
        warningIssued = true;
        const remainingMin = Math.ceil((timeLimitMs - elapsed) / 60000);
        log(`Time warning: ${remainingMin}m remaining`);

        for (const agent of agents) {
          if (!agent.exited) {
            agent.steer(
              `[TIME WARNING] ${remainingMin} minute(s) remaining. ` +
              "Wrap up your current analysis and share your most important findings. " +
              "Make sure to check_messages and respond to any unanswered questions."
            );
          }
        }
      }

      // Update expert stats
      for (const es of state.experts) {
        es.messageCount = countMessages(sessionDir, es.name);
        es.findingCount = countFindings(sessionDir, es.name);
      }
      saveSessionState(sessionDir, state);
    }, 5000);

    try {
      // Wait for all exploration prompts to complete
      await Promise.allSettled(initialPrompts);

      // Update statuses
      for (const agent of agents) {
        const es = state.experts.find(e => e.name === agent.name)!;
        es.status = agent.exited ? (es.status === "failed" ? "failed" : "done") : "idle";
      }
      saveSessionState(sessionDir, state);

      // ── Phase: Discussion ───────────────────────────

      if (!timeLimitHit && !signal?.aborted) {
        state.phase = "discussion";
        saveSessionState(sessionDir, state);
        onPhaseChange?.("discussion", "Experts discussing findings...");

        // Domain experts discuss; leader mediates
        const discussionPrompts = agents
          .filter(a => !a.exited && a.name !== "leader")
          .map(agent => {
            const es = state.experts.find(e => e.name === agent.name)!;
            es.status = "running";
            return agent.prompt(
              "All experts have completed their initial analysis. Now engage in discussion:\n\n" +
              "1. Use **check_messages** to read all messages from teammates and the Team Leader\n" +
              "2. Use **read_findings** to see the shared findings board\n" +
              "3. **Respond** to observations and concerns from other experts\n" +
              "4. **Challenge** assumptions you disagree with — be specific\n" +
              "5. **Build** on ideas from teammates with your expertise\n" +
              "6. **Answer any questions** the Team Leader has asked you\n" +
              "7. When discussion is complete, broadcast: " +
              'type="observation", content="[DISCUSSION COMPLETE] {your final position}"'
            );
          });

        // Leader drives the discussion — assertive, directive
        const leaderDiscAgent = agents.find(a => a.name === "leader");
        if (leaderDiscAgent && !leaderDiscAgent.exited) {
          const es = state.experts.find(e => e.name === "leader")!;
          es.status = "running";
          discussionPrompts.push(leaderDiscAgent.prompt(
            "The experts have finished their initial analysis. You are the **Team Leader**. Now **take charge and drive the discussion**:\n\n" +
            "1. Use **check_messages** to read ALL expert analyses thoroughly\n" +
            "2. Use **read_findings** to see the shared findings board\n" +
            "3. Summarize what each expert found and identify **where they agree** and **where they disagree**\n" +
            "4. For each disagreement, directly message the relevant experts and ask them to defend or concede:\n" +
            '   - Example: send_message to="security", type="question", content="Architect says X is fine, but you flagged it. What\'s the concrete risk?"\n' +
            '   - Example: send_message to="performance", type="question", content="Security wants to add Y but you have latency concerns. How much overhead?"\n' +
            "5. Push hard for resolution — don't let experts remain vague or hand-wavy\n" +
            "6. When you've heard enough to make a decision, broadcast:\n" +
            '   type="observation", content="[DISCUSSION COMPLETE] I have enough information to produce the final verdict."'
          ));
        }

        saveSessionState(sessionDir, state);
        await Promise.allSettled(discussionPrompts);

        // Update statuses
        for (const agent of agents) {
          const es = state.experts.find(e => e.name === agent.name)!;
          es.status = agent.exited ? "done" : "idle";
        }
        saveSessionState(sessionDir, state);
      }

      // ── Phase: Synthesis ────────────────────────────

      if (!signal?.aborted) {
        state.phase = "synthesis";
        saveSessionState(sessionDir, state);
        onPhaseChange?.("synthesis", "Team Leader producing final verdict...");

        const leaderSynthAgent = agents.find(a => a.name === "leader");
        if (leaderSynthAgent && !leaderSynthAgent.exited) {
          const es = state.experts.find(e => e.name === "leader")!;
          es.status = "running";
          saveSessionState(sessionDir, state);

          // Only send verdict prompt if the timer didn't already steer the leader
          if (!timeLimitHit) {
            const synth = buildSynthesisInstructions(team.outputMode || "execute");
            await leaderSynthAgent.prompt(
              "The discussion phase is complete. As **Team Leader**, produce your **FINAL SYNTHESIS**.\n\n" +
              "1. Use **check_messages** to read ALL messages from the entire session\n" +
              "2. Use **read_findings** to see all shared findings\n" +
              "3. You have heard from every expert. Now **make the call**.\n\n" +
              synth.brief + "\n\n" +
              "Produce a structured output with these sections:\n\n" +
              synth.sections +
              "Broadcast your synthesis: " +
              'type="observation", content="[SYNTHESIS] {your full synthesis}"'
            );
          }

          // Wait for synthesis message to be written to disk
          await new Promise(r => setTimeout(r, 2000));
          es.status = "done";
        }

        // Collect synthesis from leader's outbox
        const judgeOutbox = path.join(sessionDir, "mailboxes", "leader", "outbox");
        if (fs.existsSync(judgeOutbox)) {
          const files = fs.readdirSync(judgeOutbox).filter(f => f.endsWith(".json")).sort().reverse();
          for (const f of files) {
            try {
              const msg = JSON.parse(fs.readFileSync(path.join(judgeOutbox, f), "utf-8"));
              if (msg.content?.includes("[SYNTHESIS]")) {
                state.synthesis = {
                  raw: msg.content.replace("[SYNTHESIS]", "").trim(),
                  judge: "leader",
                  timestamp: msg.timestamp,
                };
                break;
              }
            } catch { /* skip */ }
          }
        }

        // Fallback: use the judge's last broadcast as synthesis
        if (!state.synthesis) {
          const judgeOutboxFallback = path.join(sessionDir, "mailboxes", "leader", "outbox");
          if (fs.existsSync(judgeOutboxFallback)) {
            const files = fs.readdirSync(judgeOutboxFallback).filter(f => f.endsWith(".json")).sort().reverse();
            if (files.length > 0) {
              try {
                const msg = JSON.parse(fs.readFileSync(path.join(judgeOutboxFallback, files[0]), "utf-8"));
                state.synthesis = {
                  raw: msg.content,
                  judge: "leader",
                  timestamp: msg.timestamp,
                };
              } catch { /* ignore */ }
            }
          }
        }
      }

      // ── Phase: Ready ────────────────────────────────

      state.phase = signal?.aborted ? "failed" : "ready";
      state.completedAt = new Date().toISOString();

      // Aggregate usage from all agents
      for (const agent of agents) {
        state.usage.inputTokens += agent.usage.input;
        state.usage.outputTokens += agent.usage.output;
      }

      // Final stats update
      for (const es of state.experts) {
        es.messageCount = countMessages(sessionDir, es.name);
        es.findingCount = countFindings(sessionDir, es.name);
        const agent = agents.find(a => a.name === es.name);
        if (agent) es.model = agent.model || es.model;
      }

      saveSessionState(sessionDir, state);
      onPhaseChange?.("ready", "Brainstorming complete!");

    } finally {
      clearInterval(timerInterval);
    }

  } finally {
    // Kill all remaining processes
    for (const agent of agents) {
      if (!agent.exited) agent.kill();
    }
  }

  return state;
}

// ── Extension Registration ─────────────────────────────

function initializeDefaults(cwd: string): void {
  const baseDir = expertsDir(cwd);
  const expertsSubDir = path.join(baseDir, "experts");
  const teamsSubDir = path.join(baseDir, "teams");
  const alreadyHasExperts = fs.existsSync(expertsSubDir) && fs.readdirSync(expertsSubDir).length > 0;

  // Copy defaults from bundled templates
  const defaultsDir = path.join(__dirname, "expert-defaults");
  if (!fs.existsSync(defaultsDir)) return;

  ensureDir(expertsSubDir);
  ensureDir(teamsSubDir);

  // Copy expert definitions
  const defaultExperts = path.join(defaultsDir, "experts");
  if (fs.existsSync(defaultExperts)) {
    for (const file of fs.readdirSync(defaultExperts)) {
      const dest = path.join(expertsSubDir, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(defaultExperts, file), dest);
      }
    }
  }

  // Copy team templates
  const defaultTeams = path.join(defaultsDir, "teams");
  if (fs.existsSync(defaultTeams)) {
    for (const file of fs.readdirSync(defaultTeams)) {
      const dest = path.join(teamsSubDir, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(defaultTeams, file), dest);
      }
    }
  }

  log(`Initialized default experts and teams in ${baseDir}`);
}

export default function tideExperts(pi: ExtensionAPI) {
  log("Extension registered");

  // Initialize defaults on first use
  pi.on("session_start", async () => {
    try {
      const cwd = process.cwd();
      initializeDefaults(cwd);
    } catch { /* ignore initialization errors */ }
    return {};
  });

  // ── tide_experts_brainstorm ──────────────────────────

  pi.registerTool({
    name: "tide_experts_brainstorm",
    label: "Expert Brainstorm",
    description:
      "Start a multi-agent brainstorming session. Multiple expert agents with different roles " +
      "analyze the topic, communicate with each other via P2P messaging, and produce a synthesis.",
    promptSnippet:
      "tide_experts_brainstorm spawns a team of expert agents that brainstorm together. " +
      "They explore code, share findings, discuss, and produce a synthesized recommendation. " +
      "Configure teams in Settings > Experts.",
    parameters: Type.Object({
      topic: Type.String({ description: "The question or task to brainstorm about" }),
      team: Type.String({ description: "Team template ID (e.g. 'code-review')" }),
      context: Type.Optional(Type.String({ description: "Additional context to share with all experts" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const teamConfig = loadTeamConfig(ctx.cwd, params.team);
      if (!teamConfig) {
        const available = listTeams(ctx.cwd).map(t => t.id).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Team '${params.team}' not found. Available teams: ${available || "(none — create one in Settings > Experts)"}`,
          }],
          isError: true,
        };
      }

      // Load expert configs
      const expertConfigs: ExpertConfig[] = [];
      for (const name of teamConfig.experts) {
        const config = loadExpertConfig(ctx.cwd, name);
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: `Expert '${name}' not found. Create it in Settings > Experts.`,
            }],
            isError: true,
          };
        }
        expertConfigs.push(config);
      }

      log(`Starting brainstorm: team=${params.team}, experts=${expertConfigs.map(e => e.name).join(",")}, topic="${params.topic.slice(0, 60)}..."`);

      if (onUpdate) {
        onUpdate({
          content: [{
            type: "text",
            text: `Starting brainstorming with ${expertConfigs.length} experts (${teamConfig.name})...`,
          }],
        });
      }

      try {
        const state = await runBrainstormSession({
          topic: params.topic,
          team: teamConfig,
          expertConfigs,
          cwd: ctx.cwd,
          sharedContext: params.context,
          signal,
          onPhaseChange(phase, message) {
            if (onUpdate) {
              onUpdate({ content: [{ type: "text", text: `[${phase}] ${message}` }] });
            }
          },
        });

        const totalTokens = state.usage.inputTokens + state.usage.outputTokens;
        const expertSummaries = state.experts.map(e =>
          `- **${e.name}** (${e.model}): ${e.messageCount} messages, ${e.findingCount} findings`
        ).join("\n");

        const synthesisText = state.synthesis?.raw || "(no synthesis produced)";
        const timeLimitBadge = state.timeLimitReached ? "\n\n⚠️ *Time limit reached — some discussions may be incomplete*" : "";

        const output = [
          `## Expert Brainstorm: ${params.topic.slice(0, 80)}`,
          "",
          `**Team**: ${teamConfig.name} | **Experts**: ${expertConfigs.length} | **Tokens**: ${formatTokens(totalTokens)}`,
          timeLimitBadge,
          "",
          "### Expert Activity",
          expertSummaries,
          "",
          "### Synthesis",
          synthesisText,
          "",
          `*Session: ${state.id} — view full discussion in the Experts tab*`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            sessionId: state.id,
            phase: state.phase,
            totalTokens,
            timeLimitReached: state.timeLimitReached,
          },
        };

      } catch (err: any) {
        return {
          content: [{
            type: "text" as const,
            text: `Brainstorming failed: ${err.message || err}`,
          }],
          isError: true,
        };
      }
    },
  });

  // ── tide_experts_teams ───────────────────────────────

  pi.registerTool({
    name: "tide_experts_teams",
    label: "Expert Teams",
    description: "List, create, update, or delete expert team templates.",
    promptSnippet: "tide_experts_teams manages team templates. Use action='list' to see available teams.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("get"),
        Type.Literal("create"),
        Type.Literal("update"),
        Type.Literal("delete"),
      ], { description: "CRUD action" }),
      teamId: Type.Optional(Type.String({ description: "Team ID (required for get/update/delete)" })),
      config: Type.Optional(Type.String({ description: "JSON team config (for create/update)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const teamsDir = path.join(expertsDir(ctx.cwd), "teams");
      ensureDir(teamsDir);

      switch (params.action) {
        case "list": {
          const teams = listTeams(ctx.cwd);
          if (teams.length === 0) {
            return { content: [{ type: "text" as const, text: "No teams configured. Create one in Settings > Experts." }] };
          }
          const list = teams.map(t =>
            `- **${t.name}** (${t.id}): ${t.experts.length} experts, leader: ${t.leader}, ${t.timeLimitMinutes}m limit`
          ).join("\n");
          return { content: [{ type: "text" as const, text: `## Expert Teams\n\n${list}` }] };
        }

        case "get": {
          if (!params.teamId) return { content: [{ type: "text" as const, text: "teamId required" }], isError: true };
          const team = loadTeamConfig(ctx.cwd, params.teamId);
          if (!team) return { content: [{ type: "text" as const, text: `Team '${params.teamId}' not found` }], isError: true };
          return { content: [{ type: "text" as const, text: JSON.stringify(team, null, 2) }] };
        }

        case "create":
        case "update": {
          if (!params.config) return { content: [{ type: "text" as const, text: "config required" }], isError: true };
          const config: TeamConfig = JSON.parse(params.config);
          config.updatedAt = new Date().toISOString();
          if (params.action === "create") config.createdAt = config.updatedAt;
          fs.writeFileSync(path.join(teamsDir, `${config.id}.json`), JSON.stringify(config, null, 2));
          return { content: [{ type: "text" as const, text: `Team '${config.id}' ${params.action}d` }] };
        }

        case "delete": {
          if (!params.teamId) return { content: [{ type: "text" as const, text: "teamId required" }], isError: true };
          const filePath = path.join(teamsDir, `${params.teamId}.json`);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return { content: [{ type: "text" as const, text: `Team '${params.teamId}' deleted` }] };
        }
      }
    },
  });

  // ── tide_experts_manage ──────────────────────────────

  pi.registerTool({
    name: "tide_experts_manage",
    label: "Manage Experts",
    description: "List, create, update, or delete individual expert definitions.",
    promptSnippet: "tide_experts_manage handles individual expert configs. Each expert has a role, model, and system prompt.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("get"),
        Type.Literal("create"),
        Type.Literal("update"),
        Type.Literal("delete"),
      ], { description: "CRUD action" }),
      name: Type.Optional(Type.String({ description: "Expert name (required for get/update/delete)" })),
      content: Type.Optional(Type.String({ description: "Markdown with YAML frontmatter (for create/update)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const dir = path.join(expertsDir(ctx.cwd), "experts");
      ensureDir(dir);

      switch (params.action) {
        case "list": {
          const names = listExpertNames(ctx.cwd);
          if (names.length === 0) {
            return { content: [{ type: "text" as const, text: "No experts configured." }] };
          }
          const list = names.map(name => {
            const config = loadExpertConfig(ctx.cwd, name);
            return config
              ? `- **${config.name}**: ${config.description || "(no description)"} — model: ${config.model ? `${config.model.provider}/${config.model.id}` : "default"}`
              : `- **${name}**: (error loading config)`;
          }).join("\n");
          return { content: [{ type: "text" as const, text: `## Experts\n\n${list}` }] };
        }

        case "get": {
          if (!params.name) return { content: [{ type: "text" as const, text: "name required" }], isError: true };
          const filePath = path.join(dir, `${params.name}.md`);
          if (!fs.existsSync(filePath)) return { content: [{ type: "text" as const, text: `Expert '${params.name}' not found` }], isError: true };
          const content = fs.readFileSync(filePath, "utf-8");
          return { content: [{ type: "text" as const, text: content }] };
        }

        case "create":
        case "update": {
          if (!params.name || !params.content) return { content: [{ type: "text" as const, text: "name and content required" }], isError: true };
          fs.writeFileSync(path.join(dir, `${params.name}.md`), params.content);
          return { content: [{ type: "text" as const, text: `Expert '${params.name}' ${params.action}d` }] };
        }

        case "delete": {
          if (!params.name) return { content: [{ type: "text" as const, text: "name required" }], isError: true };
          const filePath = path.join(dir, `${params.name}.md`);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return { content: [{ type: "text" as const, text: `Expert '${params.name}' deleted` }] };
        }
      }
    },
  });

  // ── tide_experts_sessions ────────────────────────────

  pi.registerTool({
    name: "tide_experts_sessions",
    label: "Expert Sessions",
    description: "List or view past brainstorming sessions.",
    promptSnippet: "tide_experts_sessions shows past brainstorming sessions and their results.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("get"),
        Type.Literal("delete"),
      ], { description: "Action" }),
      sessionId: Type.Optional(Type.String({ description: "Session ID (for get/delete)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionsDir = path.join(expertsDir(ctx.cwd), "sessions");
      if (!fs.existsSync(sessionsDir)) {
        return { content: [{ type: "text" as const, text: "No sessions yet." }] };
      }

      switch (params.action) {
        case "list": {
          const dirs = fs.readdirSync(sessionsDir).filter(d => {
            return fs.statSync(path.join(sessionsDir, d)).isDirectory();
          }).sort().reverse();

          if (dirs.length === 0) {
            return { content: [{ type: "text" as const, text: "No sessions yet." }] };
          }

          const list = dirs.map(d => {
            const state = loadSessionState(path.join(sessionsDir, d));
            if (!state) return `- **${d}**: (error reading state)`;
            return `- **${state.id}** [${state.phase}]: ${state.topic.slice(0, 60)} (${state.experts.length} experts, ${state.createdAt})`;
          }).join("\n");

          return { content: [{ type: "text" as const, text: `## Past Sessions\n\n${list}` }] };
        }

        case "get": {
          if (!params.sessionId) return { content: [{ type: "text" as const, text: "sessionId required" }], isError: true };
          const sessionDir = path.join(sessionsDir, params.sessionId);
          const state = loadSessionState(sessionDir);
          if (!state) return { content: [{ type: "text" as const, text: `Session '${params.sessionId}' not found` }], isError: true };

          return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
        }

        case "delete": {
          if (!params.sessionId) return { content: [{ type: "text" as const, text: "sessionId required" }], isError: true };
          const sessionDir = path.join(sessionsDir, params.sessionId);
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
          return { content: [{ type: "text" as const, text: `Session '${params.sessionId}' deleted` }] };
        }
      }
    },
  });
}
