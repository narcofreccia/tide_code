import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTutorStore } from "../../stores/tutorStore";
import { useStreamStore, type AvailableModel } from "../../stores/stream";
import type { TutorCurriculum, TutorQuizQuestion, TutorModelRef, TutorRole } from "../../lib/ipc";
import { MessageRenderer } from "../AgentPanel/MessageRenderer";

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "hi", label: "हिन्दी" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];
const langLabel = (code?: string) => LANGUAGES.find((l) => l.code === code)?.label || (code || "English");

// ── Panel ───────────────────────────────────────────────────

export function LearnPanel() {
  const load = useTutorStore((s) => s.load);
  const curriculum = useTutorStore((s) => s.curriculum);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={s.container}>
      <LearnHeader />
      <div style={s.body}>
        <CurriculumSidebar />
        {curriculum && (
          <>
            <div style={s.readerCol}>
              <LessonReader />
            </div>
            <div style={s.chatCol}>
              <TutorChat />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────

function LearnHeader() {
  const curriculum = useTutorStore((s) => s.curriculum);
  const progress = useTutorStore((s) => s.progress);
  const config = useTutorStore((s) => s.config);
  const phase = useTutorStore((s) => s.phase);
  const buildCurriculum = useTutorStore((s) => s.buildCurriculum);
  const { total, done } = useMemo(() => countProgress(curriculum, progress.lessonsCompleted), [curriculum, progress]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const lessonModel = config?.models?.lesson?.name || config?.model?.name || "default model";

  return (
    <div style={s.header}>
      <div style={s.headerLeft}>
        <span style={s.headerTitle}>{curriculum?.title || "Codebase Tutor"}</span>
        {curriculum && <span style={s.headerPct}>{pct}% complete</span>}
        {curriculum && <span style={s.headerPct}>· {langLabel(curriculum.language)}</span>}
      </div>
      <div style={s.headerRight}>
        <span style={s.modelBadge} title="Model authoring lessons">lessons: {lessonModel}</span>
        <GenerationPopover />
        {curriculum && (
          <button style={s.headerBtn} onClick={() => buildCurriculum(curriculum.language)} disabled={phase === "analyzing"}>
            {phase === "analyzing" ? "Analyzing…" : "↻ Re-analyze"}
          </button>
        )}
      </div>
    </div>
  );
}

function GenerationPopover() {
  const [open, setOpen] = useState(false);
  const config = useTutorStore((s) => s.config);
  const updateConfig = useTutorStore((s) => s.updateConfig);
  const models = useStreamStore((s) => s.availableModels);
  const roleModel = (r: TutorRole) => config?.models?.[r] ?? null;
  const setRoleModel = (r: TutorRole, m: TutorModelRef | null) =>
    updateConfig({ models: { ...(config?.models ?? {}), [r]: m } });

  return (
    <div style={{ position: "relative" }}>
      <button style={s.headerBtn} onClick={() => setOpen((o) => !o)}>⚙ Generation ▾</button>
      {open && (
        <>
          <div style={s.popoverBackdrop} onClick={() => setOpen(false)} />
          <div style={s.popover}>
            <div style={s.popSection}>Models</div>
            <ModelSelect label="Curriculum" value={roleModel("curriculum")} onChange={(m) => setRoleModel("curriculum", m)} models={models} />
            <ModelSelect label="Lessons" value={roleModel("lesson")} onChange={(m) => setRoleModel("lesson", m)} models={models} />
            <ModelSelect label="Answers" value={roleModel("answer")} onChange={(m) => setRoleModel("answer", m)} models={models} />

            <div style={s.popSection}>Style</div>
            <label style={s.modelRow}>
              <span style={s.modelLabel}>Depth</span>
              <select style={s.modelSelect} value={config?.depth ?? "balanced"} onChange={(e) => updateConfig({ depth: e.target.value as any })}>
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="deep">Deep dive</option>
              </select>
            </label>
            <label style={s.modelRow}>
              <span style={s.modelLabel}>Length</span>
              <select style={s.modelSelect} value={config?.length ?? "standard"} onChange={(e) => updateConfig({ length: e.target.value as any })}>
                <option value="short">Short</option>
                <option value="standard">Standard</option>
                <option value="long">Long</option>
              </select>
            </label>

            <div style={s.popSection}>Custom instructions</div>
            <textarea
              style={s.popTextarea}
              placeholder="e.g. focus on the Rust side, lots of examples, explain like I'm new to Tauri"
              defaultValue={config?.customInstructions ?? ""}
              onBlur={(e) => updateConfig({ customInstructions: e.target.value })}
            />
            <div style={s.popHint}>Applies to the next lesson/answer generated.</div>
          </div>
        </>
      )}
    </div>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  models,
}: {
  label: string;
  value: TutorModelRef | null;
  onChange: (m: TutorModelRef | null) => void;
  models: AvailableModel[];
}) {
  const val = value ? `${value.provider}/${value.id}` : "auto";
  const grouped = useMemo(() => groupByProvider(models), [models]);
  return (
    <label style={s.modelRow}>
      <span style={s.modelLabel}>{label}</span>
      <select
        style={s.modelSelect}
        value={val}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") return onChange(null);
          const [provider, ...rest] = v.split("/");
          const id = rest.join("/");
          const m = models.find((x) => x.provider === provider && x.id === id);
          onChange({ provider, id, name: m?.name || id });
        }}
      >
        <option value="auto">Default</option>
        {Object.entries(grouped).map(([prov, ms]) => (
          <optgroup key={prov} label={prov}>
            {ms.map((m) => (
              <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name || m.id}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// ── Curriculum sidebar ──────────────────────────────────────

function CurriculumSidebar() {
  const curriculum = useTutorStore((s) => s.curriculum);
  const currentLessonId = useTutorStore((s) => s.currentLessonId);
  const progress = useTutorStore((s) => s.progress);
  const phase = useTutorStore((s) => s.phase);
  const liveStream = useTutorStore((s) => s.liveStream);
  const statusMessage = useTutorStore((s) => s.statusMessage);
  const buildCurriculum = useTutorStore((s) => s.buildCurriculum);
  const openLesson = useTutorStore((s) => s.openLesson);
  const saveCurriculum = useTutorStore((s) => s.saveCurriculum);
  const [editing, setEditing] = useState(false);
  const [lang, setLang] = useState("en");

  const { total, done } = useMemo(() => countProgress(curriculum, progress.lessonsCompleted), [curriculum, progress]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (!curriculum) {
    return (
      <div style={s.sidebar}>
        <div style={s.emptyState}>
          <h3 style={s.emptyTitle}>Codebase Tutor</h3>
          <p style={s.emptyText}>
            Let the tutor analyze this workspace and build a guided, first-concepts-first course —
            with real, clickable code.
          </p>
          <label style={s.langRow}>
            <span style={s.langLabel}>Course language</span>
            <select style={s.langSelect} value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <button style={s.primaryBtn} onClick={() => buildCurriculum(lang)} disabled={phase === "analyzing"}>
            {phase === "analyzing" ? "Analyzing…" : "Analyze this codebase"}
          </button>
          {phase === "analyzing" && (
            <>
              <p style={s.hint}>{statusMessage || "Deep multi-area analysis — this can take a couple of minutes."}</p>
              {liveStream && <pre style={s.liveStream}>{liveStream.slice(-4000)}</pre>}
            </>
          )}
        </div>
      </div>
    );
  }

  if (editing) {
    return <CurriculumEditor curriculum={curriculum} onSave={(c) => { saveCurriculum(c); setEditing(false); }} onCancel={() => setEditing(false)} />;
  }

  function mark(lessonId: string) {
    const entry = progress.lessonsCompleted[lessonId];
    if (!entry) return lessonId === currentLessonId ? "●" : "○";
    if (entry.score !== undefined && entry.total) return entry.score / entry.total >= 0.6 ? "✓" : "◐";
    return "✓";
  }

  return (
    <div style={s.sidebar}>
      <div style={s.sidebarHeader}>
        <div style={s.progressRow}>
          <div style={s.progressTrack}><div style={{ ...s.progressFill, width: `${pct}%` }} /></div>
          <span style={s.progressLabel}>{pct}%</span>
        </div>
        <button style={s.editLink} onClick={() => setEditing(true)} title="Edit curriculum">Edit</button>
      </div>

      <div style={s.chapters}>
        {curriculum.chapters.map((ch, ci) => (
          <div key={ch.id} style={s.chapter}>
            <div style={s.chapterTitle}>{ci + 1}. {ch.title}</div>
            {ch.lessons.map((l) => {
              const isCurrent = l.id === currentLessonId;
              return (
                <button
                  key={l.id}
                  style={{ ...s.lessonRow, ...(isCurrent ? s.lessonRowActive : {}) }}
                  onClick={() => openLesson(l.id)}
                  title={l.summary}
                >
                  <span style={s.lessonMark}>{mark(l.id)}</span>
                  <span style={s.lessonTitle}>{l.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Curriculum editor ───────────────────────────────────────

function CurriculumEditor({
  curriculum,
  onSave,
  onCancel,
}: {
  curriculum: TutorCurriculum;
  onSave: (c: TutorCurriculum) => void;
  onCancel: () => void;
}) {
  // Deep clone so edits are local until saved.
  const [draft, setDraft] = useState<TutorCurriculum>(() => JSON.parse(JSON.stringify(curriculum)));

  const update = (mut: (d: TutorCurriculum) => void) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as TutorCurriculum;
      mut(next);
      return next;
    });
  };
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";

  return (
    <div style={s.sidebar}>
      <div style={s.sidebarHeader}>
        <span style={s.editTitle}>Edit curriculum</span>
        <div>
          <button style={s.editLink} onClick={() => onSave(draft)}>Save</button>
          <button style={s.editLink} onClick={onCancel}>Cancel</button>
        </div>
      </div>
      <div style={s.chapters}>
        {draft.chapters.map((ch, ci) => (
          <div key={ci} style={s.chapter}>
            <div style={s.editRow}>
              <input style={s.editInput} value={ch.title} onChange={(e) => update((d) => { d.chapters[ci].title = e.target.value; })} />
              <button style={s.iconBtn} onClick={() => update((d) => { if (ci > 0) [d.chapters[ci - 1], d.chapters[ci]] = [d.chapters[ci], d.chapters[ci - 1]]; })}>↑</button>
              <button style={s.iconBtn} onClick={() => update((d) => { d.chapters.splice(ci, 1); })}>×</button>
            </div>
            {ch.lessons.map((l, li) => (
              <div key={li} style={{ ...s.editRow, paddingLeft: 10 }}>
                <input style={s.editInput} value={l.title} onChange={(e) => update((d) => { d.chapters[ci].lessons[li].title = e.target.value; })} />
                <button style={s.iconBtn} onClick={() => update((d) => { const ls = d.chapters[ci].lessons; if (li > 0) [ls[li - 1], ls[li]] = [ls[li], ls[li - 1]]; })}>↑</button>
                <button style={s.iconBtn} onClick={() => update((d) => { d.chapters[ci].lessons.splice(li, 1); })}>×</button>
              </div>
            ))}
            <button style={s.addBtn} onClick={() => update((d) => { d.chapters[ci].lessons.push({ id: `${slug(ch.title)}-${slug("new lesson")}-${d.chapters[ci].lessons.length + 1}`, title: "New lesson", summary: "" }); })}>+ lesson</button>
          </div>
        ))}
        <button style={s.addBtn} onClick={() => update((d) => { d.chapters.push({ id: `chapter-${d.chapters.length + 1}`, title: "New chapter", summary: "", lessons: [] }); })}>+ chapter</button>
      </div>
    </div>
  );
}

// ── Lesson reader ───────────────────────────────────────────

function LessonReader() {
  const curriculum = useTutorStore((s) => s.curriculum);
  const currentLessonId = useTutorStore((s) => s.currentLessonId);
  const lessonContent = useTutorStore((s) => s.lessonContent);
  const lessonLoading = useTutorStore((s) => s.lessonLoading);
  const quiz = useTutorStore((s) => s.quiz);
  const liveStream = useTutorStore((s) => s.liveStream);
  const progress = useTutorStore((s) => s.progress);
  const phase = useTutorStore((s) => s.phase);
  const markComplete = useTutorStore((s) => s.markComplete);
  const openLesson = useTutorStore((s) => s.openLesson);
  const regenerate = useTutorStore((s) => s.regenerate);
  const config = useTutorStore((s) => s.config);
  const speaking = useTutorStore((s) => s.speaking);
  const voiceStatus = useTutorStore((s) => s.voiceStatus);
  const speakText = useTutorStore((s) => s.speakText);
  const stopSpeaking = useTutorStore((s) => s.stopSpeaking);

  const order = useMemo(() => lessonOrder(curriculum), [curriculum]);
  const lessonMeta = useMemo(() => findLesson(curriculum, currentLessonId), [curriculum, currentLessonId]);

  if (!currentLessonId) {
    return (
      <div style={s.readerEmpty}>
        <span style={s.readerEmptyText}>Pick a lesson from the left to begin.</span>
      </div>
    );
  }

  const isDone = !!progress.lessonsCompleted[currentLessonId];
  const idx = order.indexOf(currentLessonId);
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  const doRegenerate = () => {
    const note = window.prompt("Regenerate this lesson — any tweak? (optional)\ne.g. 'simpler', 'more detail on the Rust side'") ?? undefined;
    regenerate(note || undefined);
  };

  return (
    <div style={s.reader}>
      <div style={s.readerHeader}>
        <h2 style={s.readerTitle}>{lessonMeta?.title ?? currentLessonId}</h2>
        <div style={s.readerActions}>
          <button style={{ ...s.smallBtn, ...(isDone ? s.smallBtnDone : {}) }} onClick={() => markComplete(currentLessonId)} disabled={isDone}>
            {isDone ? "✓ Completed" : "Mark complete"}
          </button>
          <button style={s.smallBtn} onClick={doRegenerate} title="Regenerate this lesson">↻ Regenerate</button>
          {config?.voiceEnabled && lessonContent && (
            <button style={s.smallBtn} onClick={() => (speaking ? stopSpeaking() : speakText(lessonContent))}>
              {voiceStatus ? "⏳ Preparing…" : speaking ? "⏹ Stop" : "🔊 Read aloud"}
            </button>
          )}
          {nextId && <button style={s.smallBtn} onClick={() => openLesson(nextId)}>Next →</button>}
        </div>
      </div>
      <div style={s.readerBody}>
        <div style={s.readerContent}>
        {lessonContent ? (
          <>
            <MessageRenderer content={lessonContent} />
            {quiz && quiz.length > 0 && <Quiz lessonId={currentLessonId} questions={quiz} onComplete={markComplete} />}
          </>
        ) : lessonLoading || phase === "authoring" ? (
          <div>
            <div style={s.authoring}>Writing this lesson from the real code…</div>
            {liveStream && <pre style={s.liveStream}>{liveStream.slice(-6000)}</pre>}
          </div>
        ) : (
          <div style={s.authoring}>Lesson not available.</div>
        )}
        </div>
      </div>
    </div>
  );
}

// ── Quiz ────────────────────────────────────────────────────

function Quiz({
  lessonId,
  questions,
  onComplete,
}: {
  lessonId: string | null;
  questions: TutorQuizQuestion[];
  onComplete: (lessonId: string, score: number, total: number) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const score = questions.reduce((n, q, i) => n + (answers[i] === q.answerIndex ? 1 : 0), 0);

  return (
    <div style={s.quiz}>
      <div style={s.quizTitle}>Check your understanding</div>
      {questions.map((q, qi) => (
        <div key={qi} style={s.quizQ}>
          <div style={s.quizQuestion}>{qi + 1}. {q.question}</div>
          {q.options.map((opt, oi) => {
            const picked = answers[qi] === oi;
            const correct = submitted && oi === q.answerIndex;
            const wrong = submitted && picked && oi !== q.answerIndex;
            return (
              <button
                key={oi}
                disabled={submitted}
                style={{ ...s.quizOption, ...(picked ? s.quizPicked : {}), ...(correct ? s.quizCorrect : {}), ...(wrong ? s.quizWrong : {}) }}
                onClick={() => setAnswers({ ...answers, [qi]: oi })}
              >
                {opt}
              </button>
            );
          })}
          {submitted && q.explanation && <div style={s.quizExplain}>{q.explanation}</div>}
        </div>
      ))}
      {!submitted ? (
        <button
          style={s.quizSubmit}
          disabled={Object.keys(answers).length < questions.length}
          onClick={() => { setSubmitted(true); if (lessonId) onComplete(lessonId, score, questions.length); }}
        >
          Submit answers
        </button>
      ) : (
        <div style={s.quizScore}>You scored {score}/{questions.length}.</div>
      )}
    </div>
  );
}

// ── Tutor chat ──────────────────────────────────────────────

function TutorChat() {
  const chat = useTutorStore((s) => s.chat);
  const phase = useTutorStore((s) => s.phase);
  const ask = useTutorStore((s) => s.ask);
  const config = useTutorStore((s) => s.config);
  const listening = useTutorStore((s) => s.listening);
  const transcribing = useTutorStore((s) => s.transcribing);
  const speaking = useTutorStore((s) => s.speaking);
  const voiceError = useTutorStore((s) => s.voiceError);
  const voiceStatus = useTutorStore((s) => s.voiceStatus);
  const startVoiceInput = useTutorStore((s) => s.startVoiceInput);
  const stopVoiceInput = useTutorStore((s) => s.stopVoiceInput);
  const stopSpeaking = useTutorStore((s) => s.stopSpeaking);
  const speakText = useTutorStore((s) => s.speakText);
  const updateConfig = useTutorStore((s) => s.updateConfig);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceOn = !!config?.voiceEnabled;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, phase]);

  const submit = () => {
    if (!input.trim()) return;
    ask(input);
    setInput("");
  };

  return (
    <div style={s.chat}>
      <div style={s.chatHeaderRow}>
        <span style={s.chatHeaderLabel}>Ask the tutor</span>
        {voiceOn && (
          <div style={s.voiceControls}>
            {speaking && <button style={s.voiceMini} onClick={stopSpeaking} title="Stop speaking">⏹</button>}
            <button
              style={{ ...s.voiceMini, ...(config?.autoSpeak ? s.voiceMiniOn : {}) }}
              onClick={() => updateConfig({ autoSpeak: !config?.autoSpeak })}
              title="Auto-speak answers"
            >
              🔊
            </button>
          </div>
        )}
      </div>
      <div ref={scrollRef} style={s.chatLog}>
        {chat.length === 0 && (
          <div style={s.chatHint}>Ask anything about this codebase — or select code in the editor and choose "Ask the tutor about this".</div>
        )}
        {chat.map((m, i) => (
          <div key={i} style={m.role === "user" ? s.userMsg : s.tutorMsg}>
            {m.role === "user" ? (
              <span>{m.content}</span>
            ) : (
              <div>
                <MessageRenderer content={m.content} />
                {voiceOn && <button style={s.readAloudInline} onClick={() => speakText(m.content)} title="Read aloud">🔊</button>}
              </div>
            )}
          </div>
        ))}
        {phase === "answering" && <div style={s.chatHint}>Thinking…</div>}
        {voiceStatus && <div style={s.chatHint}>{voiceStatus}</div>}
      </div>
      {voiceError && <div style={s.voiceError}>{voiceError}</div>}
      <div style={s.chatInputRow}>
        {voiceOn && (
          <button
            style={{ ...s.micBtn, ...(listening ? s.micBtnActive : {}) }}
            title="Hold to talk"
            onPointerDown={(e) => { e.preventDefault(); startVoiceInput(); }}
            onPointerUp={() => stopVoiceInput()}
            onPointerLeave={() => { if (listening) stopVoiceInput(); }}
          >
            {transcribing ? "…" : "🎙"}
          </button>
        )}
        <input
          style={s.chatInput}
          placeholder={listening ? "Listening… release to send" : transcribing ? "Transcribing…" : "Ask a question…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <button style={s.sendBtn} onClick={submit} disabled={!input.trim()}>Send</button>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function lessonOrder(c: TutorCurriculum | null): string[] {
  if (!c) return [];
  return c.chapters.flatMap((ch) => ch.lessons.map((l) => l.id));
}
function findLesson(c: TutorCurriculum | null, id: string | null) {
  if (!c || !id) return null;
  for (const ch of c.chapters) {
    const l = ch.lessons.find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}
function countProgress(c: TutorCurriculum | null, completed: Record<string, unknown>) {
  const all = lessonOrder(c);
  return { total: all.length, done: all.filter((id) => completed[id]).length };
}
function groupByProvider(models: AvailableModel[]): Record<string, AvailableModel[]> {
  const g: Record<string, AvailableModel[]> = {};
  for (const m of models) (g[m.provider] ||= []).push(m);
  return g;
}

// ── Styles ──────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-primary)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--border, rgba(86,95,137,0.2))", flexShrink: 0 },
  headerLeft: { display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 },
  headerTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 700, color: "var(--text-bright)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  headerPct: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" },
  headerRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  modelBadge: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)", background: "var(--bg-tertiary)", padding: "2px 8px", borderRadius: 4, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  headerBtn: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", color: "var(--text-primary)", cursor: "pointer" },
  popoverBackdrop: { position: "fixed", inset: 0, zIndex: 50 },
  popover: { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 51, width: 300, padding: 12, background: "var(--bg-secondary)", border: "1px solid var(--border, rgba(86,95,137,0.3))", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", gap: 6 },
  popSection: { fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-secondary)", marginTop: 4 },
  popTextarea: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: 8, borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)", minHeight: 56, resize: "vertical" },
  popHint: { fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--text-secondary)" },
  modelRow: { display: "flex", alignItems: "center", gap: 8 },
  modelLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", width: 80, flexShrink: 0 },
  modelSelect: { flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)" },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  sidebar: { width: 260, flexShrink: 0, borderRight: "1px solid var(--border, rgba(86,95,137,0.2))", display: "flex", flexDirection: "column", overflow: "hidden" },
  sidebarHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border, rgba(86,95,137,0.2))" },
  progressRow: { display: "flex", alignItems: "center", gap: 8, flex: 1 },
  progressTrack: { flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: "var(--accent)", borderRadius: 3, transition: "width 0.3s" },
  progressLabel: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)" },
  editLink: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: "2px 8px", marginLeft: 4, border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer" },
  editTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--text-bright)" },
  chapters: { flex: 1, overflowY: "auto", padding: "8px 6px" },
  chapter: { marginBottom: 10 },
  chapterTitle: { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, padding: "4px 8px" },
  lessonRow: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "5px 8px", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", color: "var(--text-primary)" },
  lessonRowActive: { background: "var(--bg-tertiary)" },
  lessonMark: { width: 14, color: "var(--accent)", fontSize: 12, flexShrink: 0, textAlign: "center" },
  lessonTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", lineHeight: 1.3 },
  editRow: { display: "flex", alignItems: "center", gap: 4, marginBottom: 4 },
  editInput: { flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)" },
  iconBtn: { width: 22, height: 22, flexShrink: 0, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", color: "var(--text-secondary)", borderRadius: 4, cursor: "pointer", fontSize: 11 },
  addBtn: { fontFamily: "var(--font-ui)", fontSize: 11, padding: "3px 8px", border: "1px dashed var(--border, rgba(86,95,137,0.4))", background: "transparent", color: "var(--text-secondary)", borderRadius: 6, cursor: "pointer", marginTop: 2 },
  emptyState: { padding: 18, display: "flex", flexDirection: "column", gap: 10 },
  emptyTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-md)", fontWeight: 700, color: "var(--text-bright)", margin: 0 },
  emptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 },
  primaryBtn: { padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 500, borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" },
  hint: { fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-secondary)", margin: 0 },
  langRow: { display: "flex", flexDirection: "column", gap: 4 },
  langLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" },
  langSelect: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)" },
  readerCol: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatCol: { width: 340, flexShrink: 0, borderLeft: "1px solid var(--border, rgba(86,95,137,0.2))", display: "flex", flexDirection: "column", overflow: "hidden" },
  reader: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  readerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 18px", borderBottom: "1px solid var(--border, rgba(86,95,137,0.2))" },
  readerTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-md)", fontWeight: 700, color: "var(--text-bright)", margin: 0 },
  readerActions: { display: "flex", gap: 8, flexShrink: 0 },
  smallBtn: { padding: "4px 10px", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", color: "var(--text-primary)", cursor: "pointer" },
  smallBtnDone: { color: "var(--success)", borderColor: "var(--success)", cursor: "default" },
  readerBody: { flex: 1, overflowY: "auto", padding: "16px 0" },
  readerContent: { maxWidth: 820, margin: "0 auto", padding: "0 28px" },
  authoring: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", padding: "8px 0" },
  readerEmpty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  readerEmptyText: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" },
  chat: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatHeader: { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, padding: "10px 14px", borderBottom: "1px solid var(--border, rgba(86,95,137,0.2))" },
  chatHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border, rgba(86,95,137,0.2))" },
  chatHeaderLabel: { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 },
  voiceControls: { display: "flex", gap: 4 },
  voiceMini: { width: 26, height: 22, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" },
  voiceMiniOn: { borderColor: "var(--accent)", background: "rgba(122,162,247,0.15)" },
  readAloudInline: { marginTop: 2, border: "none", background: "transparent", cursor: "pointer", fontSize: 12, opacity: 0.6 },
  voiceError: { fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--error, #e06c75)", padding: "4px 14px" },
  micBtn: { width: 34, flexShrink: 0, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", borderRadius: 6, cursor: "pointer", fontSize: 15, userSelect: "none", touchAction: "none" },
  micBtnActive: { borderColor: "var(--error, #e06c75)", background: "rgba(224,108,117,0.18)" },
  chatLog: { flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 },
  chatHint: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", fontStyle: "italic", padding: "4px 0" },
  userMsg: { alignSelf: "flex-end", maxWidth: "90%", background: "var(--bg-tertiary)", color: "var(--text-primary)", padding: "6px 10px", borderRadius: 8, fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)" },
  tutorMsg: { alignSelf: "flex-start", maxWidth: "100%" },
  chatInputRow: { display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border, rgba(86,95,137,0.2))" },
  chatInput: { flex: 1, padding: "6px 10px", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)" },
  sendBtn: { padding: "6px 14px", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", fontWeight: 500, borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" },
  liveStream: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, maxHeight: 360, overflowY: "auto", margin: "8px 0 0", padding: 8, background: "var(--bg-secondary)", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.2))" },
  quiz: { marginTop: 20, padding: 14, borderRadius: 8, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-secondary)" },
  quizTitle: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 700, color: "var(--text-bright)", marginBottom: 10 },
  quizQ: { marginBottom: 14 },
  quizQuestion: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", color: "var(--text-primary)", marginBottom: 6 },
  quizOption: { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", marginBottom: 4, borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", cursor: "pointer" },
  quizPicked: { borderColor: "var(--accent)" },
  quizCorrect: { borderColor: "var(--success)", background: "rgba(126,200,80,0.12)" },
  quizWrong: { borderColor: "var(--error, #e06c75)", background: "rgba(224,108,117,0.12)" },
  quizExplain: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", marginTop: 4, fontStyle: "italic" },
  quizSubmit: { padding: "6px 14px", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", fontWeight: 500, borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" },
  quizScore: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--text-bright)" },
};
