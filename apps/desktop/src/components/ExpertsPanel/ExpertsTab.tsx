import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { useExpertsStore, initExpertsListener } from "../../stores/expertsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { startExpertsSession, resumeExpertsSession, sendExpertMessage, orchestrate, listExpertsSessions, getExpertsSessionMessages, getExpertsSession } from "../../lib/ipc";
import type { ExpertsPhase } from "../../stores/expertsStore";
import type { TeamConfig, ExpertMailboxMessage } from "../../lib/ipc";
import { PhaseIndicator } from "./PhaseIndicator";

// ── Helpers ────────────────────────────────────────────────

const EXPERT_COLORS = ["#7aa2f7","#bb9af7","#9ece6a","#e0af68","#f7768e","#7dcfff","#73daca","#ff9e64"];

function expertColor(name: string | undefined | null): string {
  const n = name || "unknown";
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = ((hash << 5) - hash + n.charCodeAt(i)) | 0;
  return EXPERT_COLORS[Math.abs(hash) % EXPERT_COLORS.length];
}

function relativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isFindingMessage(msg: ExpertMailboxMessage): boolean {
  return msg.type === "finding" || (msg.content ?? "").startsWith("[FINDING");
}

function isSynthesisMessage(msg: ExpertMailboxMessage): boolean {
  return msg.type === "synthesis" || msg.from === "synthesis"
    || (msg.content ?? "").includes("[SYNTHESIS]")
    || (msg.content ?? "").includes("[VERDICT]");
}

function parseFindingSeverity(content: string): { severity: string; category: string; text: string } {
  const match = content.match(/^\[FINDING\]\s*\[([^\]]*)\]\s*/i)
    ?? content.match(/^\[FINDING\s*([^\]]*)\]\s*/i);
  if (match) {
    const parts = match[1].split("/").map((s) => s.trim());
    return {
      severity: parts[0] ?? "info",
      category: parts[1] ?? "",
      text: content.slice(match[0].length),
    };
  }
  return { severity: "info", category: "", text: content };
}

// ── Message Bubble ─────────────────────────────────────────

interface MessageBubbleProps {
  msg: ExpertMailboxMessage;
}

const MessageBubble = memo(function MessageBubble({ msg }: MessageBubbleProps) {
  // Defensive: skip rendering if message is malformed
  if (!msg || typeof msg !== "object") return null;

  const isUser = msg.from === "user";
  const isFinding = isFindingMessage(msg);
  const isSynthesis = isSynthesisMessage(msg);

  if (isSynthesis) {
    return (
      <div style={s.synthesisBubble}>
        <div style={s.synthesisHeader}>SYNTHESIS</div>
        <div style={s.synthesisContent}>{msg.content ?? ""}</div>
      </div>
    );
  }

  if (isFinding) {
    const { severity, category, text } = parseFindingSeverity(msg.content ?? "");
    const isError = severity === "critical" || severity === "high" || severity === "error";
    const borderColor = isError ? "var(--error)" : "var(--warning)";
    return (
      <div style={{ ...s.findingBubble, borderLeftColor: borderColor }}>
        <div style={s.findingHeader}>
          <span style={s.findingIcon}>&#128203;</span>
          <span style={s.findingLabel}>FINDING</span>
          <span style={{
            ...s.severityBadge,
            backgroundColor: isError ? "rgba(247,118,142,0.15)" : "rgba(224,175,104,0.15)",
            color: isError ? "var(--error)" : "var(--warning)",
          }}>
            {severity}{category ? `/${category}` : ""}
          </span>
          <span style={s.msgTimestamp}>{formatTime(msg.timestamp)}</span>
        </div>
        <div style={s.findingText}>{text}</div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div style={s.userBubble}>
        <div style={s.userHeader}>
          <span style={s.userName}>You</span>
          <span style={s.msgTimestamp}>{formatTime(msg.timestamp)}</span>
        </div>
        <div style={s.userContent}>{msg.content ?? ""}</div>
      </div>
    );
  }

  // Expert message
  const isLeader = msg.from === "leader";
  const color = isLeader ? "var(--warning)" : expertColor(msg.from || "unknown");
  const hasRecipient = msg.to && msg.to !== "*" && msg.to !== "all" && msg.to !== "broadcast";
  return (
    <div style={{ ...s.expertBubble, borderLeftColor: color, ...(isLeader ? { borderLeftWidth: 3 } : {}) }}>
      <div style={s.expertHeader}>
        <span style={{ ...s.expertBadge, backgroundColor: `${color}22`, color }}>
          {isLeader ? "★ Team Leader" : msg.from}
        </span>
        {hasRecipient && (
          <>
            <span style={s.arrowTo}>&rarr;</span>
            <span style={{ ...s.recipientBadge, color: expertColor(msg.to) }}>
              {msg.to}
            </span>
          </>
        )}
        <span style={s.msgTimestamp}>{formatTime(msg.timestamp)}</span>
      </div>
      <div style={s.expertContent}>{msg.content ?? ""}</div>
    </div>
  );
});

// ── Main Component ─────────────────────────────────────────

export function ExpertsTab() {
  const teams = useExpertsStore((s) => s.teams);
  const selectedTeamId = useExpertsStore((s) => s.selectedTeamId);
  const setSelectedTeamId = useExpertsStore((s) => s.setSelectedTeamId);
  const topic = useExpertsStore((s) => s.topic);
  const setTopic = useExpertsStore((s) => s.setTopic);
  const phase = useExpertsStore((s) => s.phase);
  const isActive = useExpertsStore((s) => s.isActive);
  const activeSession = useExpertsStore((s) => s.activeSession);
  const messages = useExpertsStore((s) => s.messages);
  const pastSessions = useExpertsStore((s) => s.pastSessions);
  const setActiveSession = useExpertsStore((s) => s.setActiveSession);
  const deleteSession = useExpertsStore((s) => s.deleteSession);
  const loadTeams = useExpertsStore((s) => s.loadTeams);
  const loadExperts = useExpertsStore((s) => s.loadExperts);
  const loadPastSessions = useExpertsStore((s) => s.loadPastSessions);
  const startedAt = useExpertsStore((s) => s.startedAt);
  const timeLimitMinutes = useExpertsStore((s) => s.timeLimitMinutes);
  // Subscribe to _pollTick to force re-render when poll finds new messages
  useExpertsStore((s) => s._pollTick);
  const reset = useExpertsStore((s) => s.reset);

  const [starting, setStarting] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [sendTarget, setSendTarget] = useState<string | null>(null);
  const [showTargetMenu, setShowTargetMenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("0:00");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const targetMenuRef = useRef<HTMLDivElement>(null);

  // Initialize listeners and load data
  useEffect(() => {
    initExpertsListener();
    loadTeams();
    loadExperts();
    loadPastSessions();
  }, [loadTeams, loadExperts, loadPastSessions]);

  // Default to first team
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId, setSelectedTeamId]);

  // Elapsed timer
  useEffect(() => {
    if (!isActive || !startedAt) return;
    const update = () => setElapsed(formatElapsed(startedAt));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [isActive, startedAt]);

  // Auto-scroll
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (wasAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Poll for new messages — primary mechanism for live updates
  useEffect(() => {
    if (!isActive) return;

    const poll = async () => {
      try {
        const sessions = await listExpertsSessions();
        if (!sessions?.length) return;
        const recent = sessions[0]; // Already sorted by createdAt desc from Rust
        if (!recent?.id) return;

        // Fetch messages from outboxes
        const msgs = await getExpertsSessionMessages(recent.id);
        const validMsgs = (msgs || []).filter((m: any) => m?.id && m?.from);

        const currentIds = new Set(useExpertsStore.getState().messages.map(m => m.id));
        const newMsgs = validMsgs.filter(m => !currentIds.has(m.id));

        if (newMsgs.length > 0) {
          console.debug(`[experts-poll] +${newMsgs.length} new messages from session ${recent.id}`);
          useExpertsStore.setState(state => ({
            messages: [...state.messages, ...newMsgs],
            _pollTick: (state._pollTick ?? 0) + 1,
          }));
        }

        // Refresh session state (phase, synthesis, expert statuses)
        const sessionState = await getExpertsSession(recent.id);
        if (sessionState) {
          useExpertsStore.setState({
            activeSession: sessionState,
            activeSessionId: recent.id,
            phase: (sessionState.phase || "exploration") as ExpertsPhase,
            timeLimitReached: sessionState.timeLimitReached ?? false,
          });
        }
      } catch (err) {
        console.debug("[experts-poll] error:", err);
      }
    };

    // Start polling immediately, repeat every 2s
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [isActive]);

  // Close target menu on outside click
  useEffect(() => {
    if (!showTargetMenu) return;
    const handler = (e: MouseEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(e.target as Node)) {
        setShowTargetMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTargetMenu]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const expertNames = useMemo(
    () => activeSession?.experts.map((e) => e.name) ?? [],
    [activeSession],
  );

  const sortedPastSessions = useMemo(
    () => [...pastSessions].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    ),
    [pastSessions],
  );

  // Separate synthesis messages from regular chat
  const { chatMessages, synthesisMsg } = useMemo(() => {
    const chat: ExpertMailboxMessage[] = [];
    let synth: ExpertMailboxMessage | null = null;
    for (const m of messages) {
      if (isSynthesisMessage(m)) {
        synth = m;
      } else {
        chat.push(m);
      }
    }
    // Fallback: use activeSession.synthesis if no synthesis message found in chat
    if (!synth && activeSession?.synthesis?.raw) {
      synth = {
        id: "synthesis-fallback",
        from: activeSession.synthesis.judge || "judge",
        to: "*",
        type: "synthesis",
        content: activeSession.synthesis.raw,
        references: [],
        inReplyTo: null,
        timestamp: activeSession.synthesis.timestamp || new Date().toISOString(),
      };
    }
    return { chatMessages: chat, synthesisMsg: synth };
  }, [messages, activeSession]);

  const canStart = !isActive && selectedTeamId && topic.trim().length > 0;
  const hasActiveSession = isActive || (activeSession !== null && phase !== "idle");

  const handleStart = useCallback(async () => {
    if (!selectedTeamId || !topic.trim()) return;
    // Switch to chat view immediately — don't wait for the backend
    useExpertsStore.setState({
      isActive: true,
      phase: "setup" as const,
      startedAt: Date.now(),
      timeLimitMinutes: selectedTeam?.timeLimitMinutes ?? 10,
      messages: [],
    });
    try {
      await startExpertsSession(selectedTeamId, topic.trim());
    } catch (err) {
      console.error("[experts] Failed to start session:", err);
      // Revert to setup view on failure
      useExpertsStore.setState({ isActive: false, phase: "idle" as const });
    }
  }, [selectedTeamId, topic, selectedTeam]);

  const handleSend = useCallback(async () => {
    const text = composerText.trim();
    if (!text) return;
    setComposerText("");

    // Optimistic local insert so the user sees their message immediately
    const userMsg: ExpertMailboxMessage = {
      id: `msg-user-${Date.now()}`,
      from: "user",
      to: sendTarget ?? "*",
      type: "observation",
      content: text,
      references: [],
      inReplyTo: null,
      timestamp: new Date().toISOString(),
    };
    useExpertsStore.setState((state) => ({
      messages: [...state.messages, userMsg],
    }));

    try {
      await sendExpertMessage(text, sendTarget ?? undefined);
    } catch (err) {
      console.error("[experts] Failed to send message:", err);
    }
  }, [composerText, sendTarget]);

  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleNewSession = useCallback(() => {
    reset();
  }, [reset]);

  const [resuming, setResuming] = useState(false);
  const canResume = activeSession && !isActive &&
    activeSession.phase !== "complete" && activeSession.phase !== "failed";

  const handleResume = useCallback(async () => {
    if (!activeSession) return;
    setResuming(true);
    try {
      await resumeExpertsSession(activeSession.id);
      useExpertsStore.setState({
        isActive: true,
        phase: "exploration" as const,
        startedAt: Date.now(),
        timeLimitMinutes: selectedTeam?.timeLimitMinutes ?? 10,
      });
    } catch (err) {
      console.error("[experts] Failed to resume session:", err);
    } finally {
      setResuming(false);
    }
  }, [activeSession, selectedTeam]);

  const [executing, setExecuting] = useState(false);

  const handleExecuteViaOrchestrator = useCallback(async () => {
    if (!synthesisMsg?.content) return;
    setExecuting(true);
    try {
      // Use the orchestrator's existing pipeline with expert synthesis as context.
      // The orchestrator will: Plan (using expert synthesis as pre-research) →
      // Wait for user confirmation → Execute steps → Review
      const prompt =
        `Implement the following expert recommendations.\n\n` +
        `## Original Topic\n\n${topic}\n\n` +
        `The expert team has already analyzed the codebase thoroughly. ` +
        `Use their findings and action items to create and execute the plan. ` +
        `Do NOT re-explore the codebase — the expert analysis below is your research.`;

      // Switch to Chat tab to show orchestration progress
      window.dispatchEvent(new CustomEvent("tide:switch-tab", { detail: "chat" }));

      // Start orchestration — expert_context feeds the synthesis into the planning prompt
      await orchestrate(prompt, activeSession?.id);
    } catch (err) {
      console.error("[experts] Failed to start orchestration:", err);
    } finally {
      setExecuting(false);
    }
  }, [synthesisMsg, topic, activeSession]);

  // ── Render: Active Session (Group Chat) ────────────────

  if (hasActiveSession) {
    const teamName = selectedTeam?.name ?? "Experts";
    const totalSec = timeLimitMinutes ? timeLimitMinutes * 60 : null;
    const totalFormatted = totalSec
      ? `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;

    return (
      <div style={s.container}>
        {/* Header */}
        <div style={s.sessionHeader}>
          <div style={s.sessionTitleRow}>
            <button
              style={s.backBtn}
              onClick={handleNewSession}
              title="Back to session list"
            >
              ← Back
            </button>
            <span style={s.sessionTitle}>{teamName}</span>
            {canResume && (
              <button
                style={{
                  ...s.resumeBtn,
                  opacity: resuming ? 0.6 : 1,
                }}
                onClick={handleResume}
                disabled={resuming}
              >
                {resuming ? "Resuming..." : "Resume"}
              </button>
            )}
            {startedAt && isActive && (
              <span style={s.timerBadge}>
                {elapsed}{totalFormatted ? `/${totalFormatted}` : ""}
              </span>
            )}
          </div>
          <PhaseIndicator />

          {/* Expert status badges */}
          {activeSession?.experts && activeSession.experts.length > 0 && (
            <div style={s.expertStatusBar}>
              {activeSession.experts.map((e) => {
                const statusColor = e.status === "running" ? "var(--warning)"
                  : e.status === "done" ? "var(--success)"
                  : e.status === "failed" ? "var(--error)"
                  : "var(--text-secondary)";
                const statusIcon = e.status === "running" ? "●"
                  : e.status === "done" ? "✓"
                  : e.status === "failed" ? "✗"
                  : "○";
                return (
                  <span key={e.name} style={s.expertStatusBadge} title={`${e.name}: ${e.status} (${e.messageCount} msgs, ${e.findingCount} findings)${e.name === selectedTeam?.leader ? " — Team Leader" : ""}`}>
                    <span style={{ color: statusColor, marginRight: 3 }}>{statusIcon}</span>
                    <span style={{ color: expertColor(e.name) }}>{e.name}</span>
                    {e.name === selectedTeam?.leader && (
                      <span style={s.leaderBadge}>★</span>
                    )}
                    {e.messageCount > 0 && (
                      <span style={s.expertMsgCount}>{e.messageCount}</span>
                    )}
                  </span>
                );
              })}
              {phase === "ready" || phase === "complete" ? (
                <span style={{ ...s.sessionStatusLabel, color: "var(--success)" }}>Session complete</span>
              ) : phase === "failed" ? (
                <span style={{ ...s.sessionStatusLabel, color: "var(--error)" }}>Session failed</span>
              ) : isActive ? (
                <span style={{ ...s.sessionStatusLabel, color: "var(--text-secondary)" }}>{phase}...</span>
              ) : null}
            </div>
          )}
        </div>

        <div style={s.divider} />

        {/* Chat area */}
        <div style={s.chatContainer} ref={chatContainerRef}>
          {chatMessages.length === 0 && (
            <div style={s.emptyChat}>
              Waiting for experts to begin discussing...
            </div>
          )}
          {chatMessages.map((msg, i) => (
            <MessageBubble key={msg.id || `msg-${i}`} msg={msg} />
          ))}

          {/* Synthesis card */}
          {synthesisMsg && (
            <>
              <div style={s.synthesisDivider}>
                <span style={s.synthesisDividerLine} />
                <span style={s.synthesisDividerLabel}>SYNTHESIS</span>
                <span style={s.synthesisDividerLine} />
              </div>
              <div style={s.synthesisBubble}>
                <div style={s.synthesisContent}>{synthesisMsg.content}</div>
                <div style={s.synthesisActions}>
                  <button
                    style={{ ...s.orchestrateBtn, opacity: executing ? 0.6 : 1 }}
                    onClick={handleExecuteViaOrchestrator}
                    disabled={executing}
                  >
                    {executing ? "Starting..." : "▶ Plan & Execute"}
                  </button>
                  <button style={s.newSessionBtn} onClick={handleNewSession}>
                    New Session
                  </button>
                </div>
              </div>
            </>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div style={s.divider} />

        {/* Composer */}
        <div style={s.composerRow}>
          <textarea
            style={s.composerInput}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Type a message..."
            rows={1}
          />
          <button
            style={{
              ...s.sendBtn,
              opacity: composerText.trim() ? 1 : 0.4,
            }}
            onClick={handleSend}
            disabled={!composerText.trim()}
          >
            Send
          </button>
          <div style={{ position: "relative" as const }} ref={targetMenuRef}>
            <button
              style={s.targetBtn}
              onClick={() => setShowTargetMenu(!showTargetMenu)}
              title={sendTarget ? `Sending to ${sendTarget}` : "Broadcast to all"}
            >
              @{sendTarget ? sendTarget.slice(0, 8) : "all"} &#9662;
            </button>
            {showTargetMenu && (
              <div style={s.targetMenu}>
                <button
                  style={{
                    ...s.targetMenuItem,
                    ...(sendTarget === null ? s.targetMenuItemActive : {}),
                  }}
                  onClick={() => { setSendTarget(null); setShowTargetMenu(false); }}
                >
                  @all (broadcast)
                </button>
                {expertNames.map((name) => (
                  <button
                    key={name}
                    style={{
                      ...s.targetMenuItem,
                      ...(sendTarget === name ? s.targetMenuItemActive : {}),
                    }}
                    onClick={() => { setSendTarget(name); setShowTargetMenu(false); }}
                  >
                    <span style={{ color: expertColor(name) }}>@{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Setup (No Active Session) ──────────────────

  return (
    <div style={s.container}>
      {/* Team selector */}
      <div style={s.fieldGroup}>
        <label style={s.label}>TEAM</label>
        <div style={s.selectRow}>
          <select
            style={s.select}
            value={selectedTeamId ?? ""}
            onChange={(e) => setSelectedTeamId(e.target.value || null)}
          >
            {teams.length === 0 && <option value="">No teams configured</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            style={s.manageBtn}
            onClick={() => useSettingsStore.getState().open("experts")}
          >
            Manage
          </button>
        </div>
        {selectedTeam && (
          <div style={s.teamMeta}>
            <span style={s.teamDesc}>{selectedTeam.description}</span>
            <span style={s.teamStats}>
              {selectedTeam.experts.length} expert{selectedTeam.experts.length !== 1 ? "s" : ""}
              {" \u00B7 "}
              {selectedTeam.timeLimitMinutes}m limit
            </span>
          </div>
        )}
      </div>

      {/* Topic input */}
      <div style={s.fieldGroup}>
        <label style={s.label}>TOPIC</label>
        <textarea
          style={s.textarea}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Describe the problem or topic for expert brainstorming..."
          rows={3}
        />
      </div>

      {/* Start button */}
      <button
        style={{
          ...s.startBtn,
          opacity: canStart && !starting ? 1 : 0.5,
          cursor: canStart && !starting ? "pointer" : "not-allowed",
        }}
        onClick={handleStart}
        disabled={!canStart || starting}
      >
        {starting ? "Starting..." : "\u25B6 Start Brainstorming"}
      </button>

      {/* Past sessions */}
      {sortedPastSessions.length > 0 && (
        <>
          <div style={s.pastDivider}>
            <span style={s.pastDividerLine} />
            <span style={s.pastDividerLabel}>Past Sessions</span>
            <span style={s.pastDividerLine} />
          </div>
          <div style={s.pastList}>
            {sortedPastSessions.map((session) => {
              const isConfirming = confirmDeleteId === session.id;
              const phaseColor = session.phase === "complete"
                ? "var(--success)"
                : session.phase === "failed"
                  ? "var(--error)"
                  : "var(--text-secondary)";

              return (
                <div key={session.id} style={{ position: "relative" as const }}>
                  {isConfirming && (
                    <div style={s.confirmOverlay}>
                      <span style={s.confirmText}>Delete?</span>
                      <button
                        style={s.confirmYes}
                        onClick={() => { deleteSession(session.id); setConfirmDeleteId(null); }}
                      >
                        Delete
                      </button>
                      <button
                        style={s.confirmNo}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <button
                    style={s.pastRow}
                    onClick={() => setActiveSession(session.id)}
                  >
                    <span style={{ ...s.statusDot, backgroundColor: phaseColor }} />
                    <span style={s.pastTopic}>
                      {session.topic.length > 40 ? session.topic.slice(0, 40) + "\u2026" : session.topic}
                    </span>
                    <span style={s.pastMeta}>
                      {session.experts.length} experts
                    </span>
                    <span style={s.pastDate}>{relativeTime(session.createdAt)}</span>
                    <span
                      style={s.deleteBtn}
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id); }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      &times;
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  // Layout
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    padding: "12px 16px",
    gap: 10,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(86,95,137,0.2)",
    flexShrink: 0,
  },

  // ── Setup state ────────────────────────────────────────
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  selectRow: {
    display: "flex",
    gap: 6,
  },
  select: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "5px 8px",
    outline: "none",
    flex: 1,
  },
  manageBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    backgroundColor: "transparent",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "4px 8px",
    cursor: "pointer",
    flexShrink: 0,
  },
  teamMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingLeft: 2,
  },
  teamDesc: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    lineHeight: 1.4,
  },
  teamStats: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
  },
  textarea: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 8px",
    outline: "none",
    resize: "vertical" as const,
    lineHeight: 1.4,
    minHeight: 48,
  },
  startBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "8px 16px",
    cursor: "pointer",
    transition: "opacity 0.15s",
    alignSelf: "stretch",
  },

  // ── Past sessions ──────────────────────────────────────
  pastDivider: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  pastDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(86,95,137,0.2)",
  },
  pastDividerLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    fontWeight: 500,
    flexShrink: 0,
  },
  pastList: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    maxHeight: 200,
    overflow: "auto",
  },
  pastRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "5px 8px",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.1s",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  pastTopic: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pastMeta: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  pastDate: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    opacity: 0.7,
    flexShrink: 0,
  },
  deleteBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    color: "var(--text-secondary)",
    opacity: 0.3,
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
    flexShrink: 0,
  },
  confirmOverlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--bg-tertiary)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(86,95,137,0.3)",
  },
  confirmText: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  confirmYes: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "#fff",
    background: "var(--error)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "2px 8px",
    cursor: "pointer",
  },
  confirmNo: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "var(--text-secondary)",
    background: "transparent",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "2px 8px",
    cursor: "pointer",
  },

  // ── Active session header ──────────────────────────────
  sessionHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  },
  sessionTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  expertStatusBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    alignItems: "center",
    padding: "4px 0",
    marginTop: 4,
  },
  expertStatusBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--bg-tertiary)",
  },
  leaderBadge: {
    fontSize: 9,
    color: "var(--warning)",
    marginLeft: 2,
  },
  expertMsgCount: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-secondary)",
    marginLeft: 3,
    opacity: 0.7,
  },
  sessionStatusLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontStyle: "italic" as const,
    marginLeft: "auto",
  },
  backBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
    opacity: 0.8,
  },
  resumeBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "var(--accent)",
    border: "none",
    cursor: "pointer",
    padding: "3px 10px",
    borderRadius: "var(--radius-sm)",
  },
  sessionTitle: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--text-bright)",
  },
  timerBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-tertiary)",
    borderRadius: "var(--radius-sm)",
    padding: "2px 8px",
  },

  // ── Chat area ──────────────────────────────────────────
  chatContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "auto",
    gap: 8,
    paddingTop: 4,
    paddingBottom: 4,
    minHeight: 0,
  },
  emptyChat: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-secondary)",
    textAlign: "center",
    padding: "40px 16px",
    fontStyle: "italic",
  },

  // ── Expert message bubble ──────────────────────────────
  expertBubble: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderLeft: "3px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "rgba(30,31,46,0.5)",
    maxWidth: "92%",
  },
  expertHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap" as const,
  },
  expertBadge: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: "var(--radius-sm)",
  },
  arrowTo: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
  },
  recipientBadge: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
  },
  msgTimestamp: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
    opacity: 0.6,
    marginLeft: "auto",
    flexShrink: 0,
  },
  expertContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },

  // ── User message bubble ────────────────────────────────
  userBubble: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRight: "3px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "rgba(122,162,247,0.08)",
    maxWidth: "92%",
    alignSelf: "flex-end",
  },
  userHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  userName: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "var(--accent)",
  },
  userContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-bright)",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },

  // ── Finding bubble ─────────────────────────────────────
  findingBubble: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderLeft: "3px solid var(--warning)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "rgba(224,175,104,0.06)",
  },
  findingHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  findingIcon: {
    fontSize: 12,
  },
  findingLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 700,
    color: "var(--warning)",
    letterSpacing: "0.5px",
  },
  severityBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 5px",
    borderRadius: "var(--radius-sm)",
  },
  findingText: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },

  // ── Synthesis ──────────────────────────────────────────
  synthesisDivider: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "8px 0 4px",
  },
  synthesisDividerLine: {
    flex: 1,
    height: 2,
    backgroundColor: "rgba(122,162,247,0.3)",
  },
  synthesisDividerLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 700,
    color: "var(--accent)",
    letterSpacing: "1px",
    flexShrink: 0,
  },
  synthesisBubble: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "rgba(122,162,247,0.08)",
    border: "1px solid rgba(122,162,247,0.2)",
  },
  synthesisHeader: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 700,
    color: "var(--accent)",
    letterSpacing: "1px",
  },
  synthesisContent: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  synthesisActions: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  orchestrateBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "5px 12px",
    cursor: "pointer",
  },
  newSessionBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    color: "var(--text-secondary)",
    backgroundColor: "transparent",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "5px 12px",
    cursor: "pointer",
  },

  // ── Composer ───────────────────────────────────────────
  composerRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
  },
  composerInput: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 8px",
    outline: "none",
    flex: 1,
    resize: "none" as const,
    lineHeight: 1.4,
    minHeight: 32,
    maxHeight: 80,
  },
  sendBtn: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "6px 12px",
    cursor: "pointer",
    flexShrink: 0,
    height: 32,
  },
  targetBtn: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 8px",
    cursor: "pointer",
    flexShrink: 0,
    height: 32,
    whiteSpace: "nowrap" as const,
  },
  targetMenu: {
    position: "absolute" as const,
    bottom: "100%",
    right: 0,
    marginBottom: 4,
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid rgba(86,95,137,0.3)",
    borderRadius: "var(--radius-sm)",
    padding: 4,
    zIndex: 10,
    minWidth: 140,
    maxHeight: 200,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  targetMenuItem: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "4px 8px",
    cursor: "pointer",
    textAlign: "left" as const,
    whiteSpace: "nowrap" as const,
  },
  targetMenuItemActive: {
    backgroundColor: "var(--bg-tertiary)",
    color: "var(--text-bright)",
  },
};
