import { useEffect, useState } from "react";
import { readTutorConfig, writeTutorConfig, type TutorConfig } from "../../lib/ipc";
import { useStreamStore } from "../../stores/stream";
import { useTutorStore } from "../../stores/tutorStore";
import { getVoiceEngine } from "../../lib/voice/VoiceEngine";
import { KOKORO_VOICES, kokoroSupportsLang } from "../../lib/voice/KokoroTts";

const SAMPLE_BY_LANG: Record<string, string> = {
  en: "Hi! I'm your codebase tutor. This is how I'll sound when I read your lessons.",
  it: "Ciao! Sono il tuo tutor del codice. Ecco come suonerò quando leggo le lezioni.",
  es: "¡Hola! Soy tu tutor de código. Así sonaré cuando lea tus lecciones.",
  fr: "Salut ! Je suis ton tuteur de code. Voici comment je sonnerai en lisant tes leçons.",
};

const DEFAULT_CONFIG: TutorConfig = {
  difficulty: "intermediate",
  includeCritique: true,
  language: "en",
  voiceEnabled: false,
};

export function TutorSettings() {
  const [config, setConfig] = useState<TutorConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const availableModels = useStreamStore((s) => s.availableModels);
  const curriculumLang = (useTutorStore((s) => s.curriculum?.language) || "en").slice(0, 2);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    readTutorConfig()
      .then((c) => setConfig({ ...DEFAULT_CONFIG, ...c }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const update = (patch: Partial<TutorConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    writeTutorConfig(next).catch((e) => console.error("[tutor] save config failed:", e));
  };

  // Kokoro covers this language → list its (curated) voices; otherwise filter system voices.
  const useKokoro = (config.ttsEngine ?? "system") === "kokoro" && kokoroSupportsLang(curriculumLang);
  const kokoroOptions = KOKORO_VOICES.filter((v) => v.lang === curriculumLang);
  const systemOptions = voices.filter((v) => v.lang?.toLowerCase().startsWith(curriculumLang.toLowerCase()));

  const previewVoice = () => {
    const sample = SAMPLE_BY_LANG[curriculumLang] || SAMPLE_BY_LANG.en;
    getVoiceEngine()
      .speak(sample, { engine: config.ttsEngine, lang: curriculumLang, voiceName: config.voiceName })
      .catch((e) => console.error("[tutor] voice preview failed:", e));
  };

  if (!loaded) return <div style={s.loading}>Loading…</div>;

  const ROLES: { role: "curriculum" | "lesson" | "answer"; label: string }[] = [
    { role: "curriculum", label: "Curriculum" },
    { role: "lesson", label: "Lessons" },
    { role: "answer", label: "Answers" },
  ];

  return (
    <div>
      <h3 style={s.heading}>Codebase Tutor</h3>
      <p style={s.description}>
        Controls how the tutor analyzes this workspace and authors lessons. The tutor runs in its own
        isolated process — separate from the main chat and its context window. Changes apply to the next
        lesson generated.
      </p>

      <div style={s.field}>
        <label style={s.label}>Models — which LLM does each job</label>
        {ROLES.map(({ role, label }) => {
          const cur = config.models?.[role];
          const val = cur ? `${cur.provider}/${cur.id}` : "auto";
          return (
            <div key={role} style={s.roleRow}>
              <span style={s.roleLabel}>{label}</span>
              <select
                style={s.select}
                value={val}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = { ...(config.models ?? {}) };
                  if (v === "auto") next[role] = null;
                  else {
                    const [provider, ...rest] = v.split("/");
                    const id = rest.join("/");
                    const m = availableModels.find((x) => x.provider === provider && x.id === id);
                    next[role] = { provider, id, name: m?.name || id };
                  }
                  update({ models: next });
                }}
              >
                <option value="auto">Default (router subagent / pi default)</option>
                {availableModels.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {(m.name || m.id)} · {m.provider}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div style={s.field}>
        <label style={s.label}>Depth &amp; length</label>
        <div style={s.roleRow}>
          <span style={s.roleLabel}>Depth</span>
          <select style={s.select} value={config.depth ?? "balanced"} onChange={(e) => update({ depth: e.target.value as TutorConfig["depth"] })}>
            <option value="concise">Concise</option>
            <option value="balanced">Balanced</option>
            <option value="deep">Deep dive</option>
          </select>
        </div>
        <div style={s.roleRow}>
          <span style={s.roleLabel}>Length</span>
          <select style={s.select} value={config.length ?? "standard"} onChange={(e) => update({ length: e.target.value as TutorConfig["length"] })}>
            <option value="short">Short</option>
            <option value="standard">Standard</option>
            <option value="long">Long</option>
          </select>
        </div>
      </div>

      <div style={s.field}>
        <label style={s.label}>Custom instructions</label>
        <textarea
          style={{ ...s.select, minHeight: 60, resize: "vertical", fontFamily: "var(--font-ui)" }}
          placeholder="e.g. focus on the Rust side, lots of runnable examples, explain like I'm new to Tauri"
          defaultValue={config.customInstructions ?? ""}
          onBlur={(e) => update({ customInstructions: e.target.value })}
        />
      </div>

      <div style={s.field}>
        <label style={s.label}>Lesson difficulty</label>
        <select
          style={s.select}
          value={config.difficulty}
          onChange={(e) => update({ difficulty: e.target.value as TutorConfig["difficulty"] })}
        >
          <option value="beginner">Beginner — assume little prior knowledge</option>
          <option value="intermediate">Intermediate — assume general dev experience</option>
          <option value="advanced">Advanced — terse, deep, fast</option>
        </select>
      </div>

      <label style={s.checkRow}>
        <input
          type="checkbox"
          checked={config.includeCritique}
          onChange={(e) => update({ includeCritique: e.target.checked })}
        />
        <span>
          <span style={s.checkTitle}>Include critique</span>
          <span style={s.checkSub}>Let lessons flag weak design choices with "Critique &amp; Improvements" sections.</span>
        </span>
      </label>

      <div style={s.phase2}>
        <div style={s.phase2Title}>Voice</div>
        <p style={s.phase2Text}>
          Hear lessons read aloud and ask questions out loud. Speech recognition runs locally in-app
          (the model downloads once on first use); speech uses your system voices.
        </p>
        <label style={s.checkRow}>
          <input type="checkbox" checked={!!config.voiceEnabled} onChange={(e) => update({ voiceEnabled: e.target.checked })} />
          <span>
            <span style={s.checkTitle}>Enable voice</span>
            <span style={s.checkSub}>Show the microphone and "Read aloud" controls in the tutor.</span>
          </span>
        </label>
        <label style={s.checkRow}>
          <input type="checkbox" checked={!!config.autoSpeak} onChange={(e) => update({ autoSpeak: e.target.checked })} />
          <span>
            <span style={s.checkTitle}>Auto-speak answers</span>
            <span style={s.checkSub}>Read the tutor's answers aloud automatically.</span>
          </span>
        </label>
        <div style={s.roleRow}>
          <span style={s.roleLabel}>Reader</span>
          <select
            style={s.select}
            value={config.ttsEngine ?? "system"}
            onChange={(e) => update({ ttsEngine: e.target.value as TutorConfig["ttsEngine"], voiceName: undefined })}
          >
            <option value="system">System voices (instant)</option>
            <option value="kokoro">Kokoro — neural, English (downloads a model on first use)</option>
          </select>
        </div>
        <div style={s.roleRow}>
          <span style={s.roleLabel}>Voice</span>
          <select style={s.select} value={config.voiceName ?? ""} onChange={(e) => update({ voiceName: e.target.value || undefined })}>
            <option value="">Auto — best for {curriculumLang.toUpperCase()}</option>
            {useKokoro
              ? kokoroOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)
              : systemOptions.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
          <button style={s.previewBtn} onClick={previewVoice} title="Hear this voice">▶ Preview</button>
        </div>
        {(config.ttsEngine ?? "system") === "kokoro" && !kokoroSupportsLang(curriculumLang) && (
          <div style={s.phase2Text}>
            Kokoro has no {curriculumLang.toUpperCase()} voice yet — a system voice is used for this language.
          </div>
        )}
        <div style={s.roleRow}>
          <span style={s.roleLabel}>Speech model</span>
          <select style={s.select} value={config.sttModel ?? "Xenova/whisper-base"} onChange={(e) => update({ sttModel: e.target.value })}>
            <option value="Xenova/whisper-tiny">Tiny — fastest, less accurate</option>
            <option value="Xenova/whisper-base">Base — balanced (default)</option>
            <option value="Xenova/whisper-small">Small — slower, more accurate</option>
          </select>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  loading: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" },
  heading: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-md)", fontWeight: 600, color: "var(--text-bright)", margin: "0 0 4px" },
  description: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", margin: "0 0 16px", lineHeight: 1.5 },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 },
  label: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" },
  select: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-primary)", color: "var(--text-primary)", maxWidth: 380, width: "100%", boxSizing: "border-box" },
  roleRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, maxWidth: 380 },
  roleLabel: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", width: 90, flexShrink: 0 },
  previewBtn: { flexShrink: 0, fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border, rgba(86,95,137,0.3))", background: "var(--bg-tertiary)", color: "var(--text-primary)", cursor: "pointer" },
  checkRow: { display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 16, cursor: "pointer" },
  checkTitle: { display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", color: "var(--text-primary)" },
  checkSub: { display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", lineHeight: 1.4 },
  phase2: { marginTop: 8, padding: 12, borderRadius: 8, border: "1px dashed var(--border, rgba(86,95,137,0.3))" },
  phase2Title: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--text-bright)", marginBottom: 4 },
  phase2Text: { fontFamily: "var(--font-ui)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.5 },
};
