// Kokoro neural TTS (kokoro-js) running in-webview via WASM. Lazy-loaded; the model
// (~80-300 MB) downloads once and is cached. Audio plays through the Web Audio API.
// The default Kokoro model ships English voices only — callers fall back to a system
// voice for other languages.

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export interface KokoroVoice {
  id: string;
  label: string;
  lang: string; // language code, e.g. "en"
}

// Curated subset of Kokoro's (English) voices so the picker stays short and high-quality.
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: "af_heart", label: "Heart — US, female", lang: "en" },
  { id: "af_bella", label: "Bella — US, female", lang: "en" },
  { id: "am_michael", label: "Michael — US, male", lang: "en" },
  { id: "am_fenrir", label: "Fenrir — US, male", lang: "en" },
  { id: "bf_emma", label: "Emma — UK, female", lang: "en" },
  { id: "bm_george", label: "George — UK, male", lang: "en" },
];

/** Whether Kokoro has a voice for the given language code. */
export function kokoroSupportsLang(lang: string): boolean {
  const code = (lang || "en").slice(0, 2).toLowerCase();
  return KOKORO_VOICES.some((v) => v.lang === code);
}

export function kokoroVoicesForLang(lang: string): KokoroVoice[] {
  const code = (lang || "en").slice(0, 2).toLowerCase();
  return KOKORO_VOICES.filter((v) => v.lang === code);
}

let ttsPromise: Promise<any> | null = null;
let ready = false;
let progressHandler: ((pct: number) => void) | null = null;

/** True once the Kokoro model has finished loading (so the UI can show a one-time prep state). */
export function kokoroReady(): boolean {
  return ready;
}
/** Register a callback for the one-time model download progress (0-100). */
export function onKokoroProgress(cb: ((pct: number) => void) | null): void {
  progressHandler = cb;
}

function loadTTS(): Promise<any> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: any) => {
          if (p && typeof p.progress === "number") progressHandler?.(Math.round(p.progress));
        },
      });
      ready = true;
      return tts;
    })();
  }
  return ttsPromise;
}

let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

/** Synthesize + play `text` with the given Kokoro voice id. Resolves when playback ends. */
export async function kokoroSpeak(text: string, voiceId: string): Promise<void> {
  const tts = await loadTTS();
  const raw = await tts.generate(text, { voice: voiceId || "af_heart" });
  // raw: { audio: Float32Array, sampling_rate: number }
  stopKokoro();
  audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
  // The context may be suspended (autoplay policy) after the long model-load await — resume it.
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch { /* ignore */ }
  }
  const buf = audioCtx.createBuffer(1, raw.audio.length, raw.sampling_rate);
  buf.getChannelData(0).set(raw.audio);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  return new Promise<void>((resolve) => {
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      resolve();
    };
    currentSource = src;
    src.start();
  });
}

export function stopKokoro(): void {
  try {
    currentSource?.stop();
  } catch {
    /* already stopped */
  }
  currentSource = null;
}

export function kokoroSpeaking(): boolean {
  return currentSource !== null;
}
