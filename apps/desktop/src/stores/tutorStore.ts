import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "./workspace";
import { getVoiceEngine } from "../lib/voice/VoiceEngine";
import { startRecording, type Recording } from "../lib/voice/micRecorder";
import { markdownToSpeech } from "../lib/voice/speechText";
import { kokoroReady, kokoroSupportsLang, onKokoroProgress } from "../lib/voice/KokoroTts";
import {
  tutorBuildCurriculum,
  requestTutorLesson,
  regenerateTutorLesson,
  writeTutorCurriculum,
  tutorAsk,
  readTutorCurriculum,
  readTutorLesson,
  readTutorQuiz,
  readTutorProgress,
  writeTutorProgress,
  readTutorConfig,
  writeTutorConfig,
  type TutorCurriculum,
  type TutorProgress,
  type TutorQuizQuestion,
  type TutorConfig,
} from "../lib/ipc";

/** Special editor-tab path for the Learn panel (mirrors SETTINGS_TAB_PATH). */
export const LEARN_TAB_PATH = "__learn__";

/** Open the Learn panel as a special editor tab. */
export function openLearnTab(): void {
  useWorkspaceStore.getState().openFile({
    path: LEARN_TAB_PATH,
    name: "Learn",
    content: "",
    isDirty: false,
    language: "",
  });
}

export type TutorPhase = "idle" | "analyzing" | "ready" | "authoring" | "answering";

export interface TutorChatMessage {
  role: "user" | "tutor";
  content: string;
  ts: number;
}

/** Payloads dropped by the pi extension and forwarded by Rust as `tutor_event`. */
type TutorEvent =
  | { kind: "phase"; phase: TutorPhase; message?: string }
  | { kind: "curriculum_ready" }
  | { kind: "lesson_ready"; lessonId: string }
  | { kind: "answer"; lessonId: string | null; question: string; answer: string }
  | { kind: "stream"; target: string; chunk: string }
  | { kind: "activity"; target: string; tool: string }
  | { kind: "stream_end"; target: string };

interface TutorState {
  curriculum: TutorCurriculum | null;
  currentLessonId: string | null;
  lessonContent: string | null;
  lessonLoading: boolean;
  quiz: TutorQuizQuestion[] | null;
  progress: TutorProgress;
  chat: TutorChatMessage[];
  phase: TutorPhase;
  statusMessage: string;
  /** Live text streamed from the isolated tutor process (analysis log / lesson in progress). */
  liveStream: string;
  liveTarget: string | null;
  config: TutorConfig | null;
  regenerating: boolean;
  // Voice (Phase 2)
  listening: boolean;
  transcribing: boolean;
  speaking: boolean;
  voiceError: string | null;
  voiceStatus: string;

  load: () => Promise<void>;
  buildCurriculum: (language?: string) => Promise<void>;
  openLesson: (lessonId: string) => Promise<void>;
  regenerate: (note?: string) => Promise<void>;
  markComplete: (lessonId: string, score?: number, total?: number) => Promise<void>;
  ask: (question: string) => Promise<void>;
  explainSelection: (path: string, startLine: number, endLine: number, code: string) => Promise<void>;
  updateConfig: (patch: Partial<TutorConfig>) => Promise<void>;
  saveCurriculum: (curriculum: TutorCurriculum) => Promise<void>;
  startVoiceInput: () => Promise<void>;
  stopVoiceInput: () => Promise<void>;
  speakText: (markdown: string) => Promise<void>;
  stopSpeaking: () => void;
  handleEvent: (event: TutorEvent) => void;
}

function lessonOrder(c: TutorCurriculum | null): string[] {
  if (!c) return [];
  return c.chapters.flatMap((ch) => ch.lessons.map((l) => l.id));
}

export const useTutorStore = create<TutorState>((set, get) => ({
  curriculum: null,
  currentLessonId: null,
  lessonContent: null,
  lessonLoading: false,
  quiz: null,
  progress: { lessonsCompleted: {} },
  chat: [],
  phase: "idle",
  statusMessage: "",
  liveStream: "",
  liveTarget: null,
  config: null,
  regenerating: false,
  listening: false,
  transcribing: false,
  speaking: false,
  voiceError: null,
  voiceStatus: "",

  load: async () => {
    try {
      const [curriculum, progress, config] = await Promise.all([
        readTutorCurriculum(),
        readTutorProgress().catch(() => ({ lessonsCompleted: {} } as TutorProgress)),
        readTutorConfig().catch(() => null),
      ]);
      set({
        curriculum,
        progress: progress ?? { lessonsCompleted: {} },
        config,
        phase: curriculum ? "ready" : "idle",
      });
    } catch (e) {
      console.error("[tutor] load failed:", e);
    }
  },

  buildCurriculum: async (language) => {
    set({ phase: "analyzing", statusMessage: "Analyzing the codebase…", liveStream: "", liveTarget: "curriculum" });
    try {
      await tutorBuildCurriculum(language);
      void pollCurriculum();
    } catch (e) {
      console.error("[tutor] buildCurriculum failed:", e);
      set({ phase: "idle", statusMessage: "Analysis failed — check the agent connection." });
    }
  },

  openLesson: async (lessonId) => {
    set({
      currentLessonId: lessonId,
      lessonLoading: true,
      lessonContent: null,
      quiz: null,
      liveStream: "",
      liveTarget: lessonId,
    });
    // Persist current position.
    const progress = { ...get().progress, currentLessonId: lessonId };
    set({ progress });
    writeTutorProgress(progress).catch(() => {});
    const token = ++lessonPollToken;
    try {
      const cached = await readTutorLesson(lessonId);
      if (cached) {
        const quiz = await readTutorQuiz(lessonId).catch(() => null);
        set({ lessonContent: cached, quiz, lessonLoading: false });
      } else {
        // Not authored yet — trigger authoring. The lesson_ready event is the fast path,
        // but we also POLL the file as a fallback (the watcher can miss atomic-write events),
        // so the lesson appears as soon as it's written — no need to exit and re-enter.
        await requestTutorLesson(lessonId);
        void pollLesson(lessonId, token);
      }
    } catch (e) {
      console.error("[tutor] openLesson failed:", e);
      set({ lessonLoading: false });
    }
  },

  regenerate: async (note) => {
    const lessonId = get().currentLessonId;
    if (!lessonId) return;
    set({ regenerating: true, lessonContent: null, lessonLoading: true, quiz: null, liveStream: "", liveTarget: lessonId, phase: "authoring" });
    const token = ++lessonPollToken;
    try {
      await regenerateTutorLesson(lessonId, note);
      void pollLesson(lessonId, token);
    } catch (e) {
      console.error("[tutor] regenerate failed:", e);
      set({ lessonLoading: false });
    } finally {
      set({ regenerating: false });
    }
  },

  updateConfig: async (patch) => {
    const next = { ...(get().config ?? {}), ...patch } as TutorConfig;
    set({ config: next });
    try {
      await writeTutorConfig(next);
    } catch (e) {
      console.error("[tutor] updateConfig failed:", e);
    }
  },

  saveCurriculum: async (curriculum) => {
    set({ curriculum });
    try {
      await writeTutorCurriculum(curriculum);
    } catch (e) {
      console.error("[tutor] saveCurriculum failed:", e);
    }
  },

  startVoiceInput: async () => {
    if (get().listening || get().transcribing) return;
    set({ voiceError: null });
    get().stopSpeaking(); // don't record over our own speech
    try {
      activeRecording = await startRecording();
      set({ listening: true });
    } catch (e) {
      console.error("[tutor] mic start failed:", e);
      set({ voiceError: "Microphone unavailable or permission denied.", listening: false });
    }
  },

  stopVoiceInput: async () => {
    const rec = activeRecording;
    activeRecording = null;
    if (!rec || !get().listening) {
      set({ listening: false });
      return;
    }
    set({ listening: false, transcribing: true });
    try {
      const pcm = await rec.stop();
      const model = get().config?.sttModel || undefined;
      const lang = get().curriculum?.language || get().config?.language;
      const text = await getVoiceEngine().transcribe(pcm, { model, lang });
      set({ transcribing: false });
      if (text.trim()) await get().ask(text.trim());
    } catch (e) {
      console.error("[tutor] transcribe failed:", e);
      set({ transcribing: false, voiceError: "Could not transcribe — the speech model may still be downloading." });
    }
  },

  speakText: async (markdown) => {
    const spoken = markdownToSpeech(markdown);
    if (!spoken) return;
    const cfg = get().config;
    const lang = (get().curriculum?.language || cfg?.language || "en").slice(0, 2);
    const engine = cfg?.ttsEngine ?? "system";
    // First Kokoro use downloads a model — show progress so it isn't a silent wait.
    const firstKokoro = engine === "kokoro" && kokoroSupportsLang(lang) && !kokoroReady();
    if (firstKokoro) {
      set({ voiceStatus: "Preparing voice model (first use)…" });
      onKokoroProgress((pct) => set({ voiceStatus: `Downloading voice model… ${pct}%` }));
    }
    set({ speaking: true, voiceError: null });
    try {
      await getVoiceEngine().speak(spoken, { voiceName: cfg?.voiceName, lang, engine });
    } catch (e) {
      console.error("[tutor] speak failed:", e);
      set({ voiceError: `Couldn't play audio: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      onKokoroProgress(null);
      set({ speaking: false, voiceStatus: "" });
    }
  },

  stopSpeaking: () => {
    getVoiceEngine().stopSpeaking();
    set({ speaking: false });
  },

  markComplete: async (lessonId, score, total) => {
    const progress: TutorProgress = {
      ...get().progress,
      lessonsCompleted: {
        ...get().progress.lessonsCompleted,
        [lessonId]: { completedAt: new Date().toISOString(), score, total },
      },
    };
    set({ progress });
    try {
      await writeTutorProgress(progress);
    } catch (e) {
      console.error("[tutor] markComplete failed:", e);
    }
  },

  explainSelection: async (path, startLine, endLine, code) => {
    // Open the Learn panel and ask the tutor about the selected code.
    openLearnTab();
    const range = startLine === endLine ? `${path}:${startLine}` : `${path}:${startLine}-${endLine}`;
    const question =
      `Explain this code from \`${range}\`. What does it do, why is it written this way, and how does it fit the larger picture?\n\n` +
      "```\n" + code.slice(0, 4000) + "\n```";
    set({
      chat: [...get().chat, { role: "user", content: `Explain \`${range}\``, ts: Date.now() }],
      phase: "answering",
      statusMessage: "Thinking…",
    });
    try {
      await tutorAsk(get().currentLessonId, question);
    } catch (e) {
      console.error("[tutor] explainSelection failed:", e);
      set({ phase: "ready", statusMessage: "" });
    }
  },

  ask: async (question) => {
    const q = question.trim();
    if (!q) return;
    const lessonId = get().currentLessonId;
    set({
      chat: [...get().chat, { role: "user", content: q, ts: Date.now() }],
      phase: "answering",
      statusMessage: "Thinking…",
    });
    try {
      await tutorAsk(lessonId, q);
    } catch (e) {
      console.error("[tutor] ask failed:", e);
      set({ phase: "ready", statusMessage: "" });
    }
  },

  handleEvent: (event) => {
    switch (event.kind) {
      case "phase":
        set({ phase: event.phase, statusMessage: event.message ?? "" });
        break;
      case "stream": {
        // Append live text; reset the buffer when the streaming target changes.
        const sameTarget = get().liveTarget === event.target;
        set({
          liveTarget: event.target,
          liveStream: (sameTarget ? get().liveStream : "") + event.chunk,
        });
        break;
      }
      case "activity": {
        // Tool step → "▸ tool" line in the live feed.
        const sameTarget = get().liveTarget === event.target;
        const prefix = sameTarget && get().liveStream && !get().liveStream.endsWith("\n") ? "\n" : "";
        set({
          liveTarget: event.target,
          liveStream: (sameTarget ? get().liveStream : "") + `${prefix}▸ ${event.tool}\n`,
        });
        break;
      }
      case "stream_end":
        break;
      case "curriculum_ready":
        readTutorCurriculum()
          .then((curriculum) => set({ curriculum, phase: "ready", statusMessage: "", liveStream: "", liveTarget: null }))
          .catch(() => {});
        break;
      case "lesson_ready":
        // Load it (+ quiz) if it's the lesson the user is viewing.
        if (event.lessonId === get().currentLessonId) {
          Promise.all([readTutorLesson(event.lessonId), readTutorQuiz(event.lessonId).catch(() => null)])
            .then(([content, quiz]) =>
              set({ lessonContent: content, quiz, lessonLoading: false, phase: "ready", liveStream: "" }),
            )
            .catch(() => set({ lessonLoading: false }));
        }
        break;
      case "answer":
        set({
          chat: [...get().chat, { role: "tutor", content: event.answer, ts: Date.now() }],
          phase: "ready",
          statusMessage: "",
        });
        if (get().config?.autoSpeak) {
          void get().speakText(event.answer);
        }
        break;
    }
  },
}));

/** Convenience selectors used by the UI. */
export function tutorLessonOrder(): string[] {
  return lessonOrder(useTutorStore.getState().curriculum);
}

// ── Polling fallbacks (the file-watcher can miss events on atomic writes) ────

let lessonPollToken = 0;
let activeRecording: Recording | null = null;

async function pollLesson(lessonId: string, token: number): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (token !== lessonPollToken) return; // user opened a different lesson
    const st = useTutorStore.getState();
    if (st.currentLessonId !== lessonId || st.lessonContent) return; // done / superseded
    try {
      const content = await readTutorLesson(lessonId);
      if (content && token === lessonPollToken) {
        const quiz = await readTutorQuiz(lessonId).catch(() => null);
        useTutorStore.setState({ lessonContent: content, quiz, lessonLoading: false, phase: "ready", liveStream: "" });
        return;
      }
    } catch { /* keep polling */ }
  }
  // Gave up — stop the spinner so the UI isn't stuck.
  if (token === lessonPollToken && !useTutorStore.getState().lessonContent) {
    useTutorStore.setState({ lessonLoading: false });
  }
}

async function pollCurriculum(): Promise<void> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = useTutorStore.getState();
    if (st.curriculum || st.phase !== "analyzing") return;
    try {
      const c = await readTutorCurriculum();
      if (c) {
        useTutorStore.setState({ curriculum: c, phase: "ready", statusMessage: "", liveStream: "", liveTarget: null });
        return;
      }
    } catch { /* keep polling */ }
  }
}

let listenerInitialized = false;
export function initTutorListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;
  listen<TutorEvent>("tutor_event", (event) => {
    useTutorStore.getState().handleEvent(event.payload);
  }).catch((err) => {
    console.error("[tutor] Failed to set up event listener:", err);
  });
}
