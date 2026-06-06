import type { VoiceEngine, SpeakOptions } from "./VoiceEngine";
import { kokoroSpeak, stopKokoro, kokoroSpeaking, kokoroSupportsLang, kokoroVoicesForLang } from "./KokoroTts";

const DEFAULT_STT_MODEL = "Xenova/whisper-base";

// Whisper takes a language NAME; map the curriculum's code to it.
const WHISPER_LANG: Record<string, string> = {
  en: "english", it: "italian", es: "spanish", fr: "french",
  de: "german", pt: "portuguese", hi: "hindi", ja: "japanese", zh: "chinese",
};

// Cache the ASR pipeline per model so the (~80 MB) weights load only once.
const pipelines = new Map<string, Promise<any>>();
async function getAsrPipeline(model: string): Promise<any> {
  let p = pipelines.get(model);
  if (!p) {
    p = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("automatic-speech-recognition", model);
    })();
    pipelines.set(model, p);
  }
  return p;
}

/**
 * Local, in-webview voice engine:
 *  - STT: Whisper via transformers.js (WASM/WebGPU), language-aware.
 *  - TTS: Kokoro neural voice (kokoro-js) when available for the language, else the
 *    system SpeechSynthesis voice (filtered to the language).
 */
export class LocalVoiceEngine implements VoiceEngine {
  private utterance: SpeechSynthesisUtterance | null = null;

  async transcribe(pcm16k: Float32Array, opts?: { model?: string; lang?: string }): Promise<string> {
    const asr = await getAsrPipeline(opts?.model || DEFAULT_STT_MODEL);
    const language = WHISPER_LANG[(opts?.lang || "en").slice(0, 2).toLowerCase()] || "english";
    const out = await asr(pcm16k, { chunk_length_s: 30, language, task: "transcribe" });
    const text = Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : out?.text;
    return (text || "").trim();
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (!text.trim()) return;
    const lang = opts?.lang || "en";
    const wantKokoro = (opts?.engine ?? "system") === "kokoro";

    if (wantKokoro && kokoroSupportsLang(lang)) {
      const voices = kokoroVoicesForLang(lang);
      const voiceId =
        opts?.voiceName && voices.some((v) => v.id === opts.voiceName) ? opts.voiceName : voices[0]?.id || "af_heart";
      try {
        await kokoroSpeak(text, voiceId);
        opts?.onEnd?.();
        return;
      } catch (e) {
        console.warn("[voice] Kokoro TTS failed, falling back to system voice:", e);
        // fall through
      }
    }
    return this.speakSystem(text, lang, opts);
  }

  private speakSystem(text: string, lang: string, opts?: SpeakOptions): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const bcp = lang.length === 2 ? lang : lang.slice(0, 2);
      u.lang = bcp;
      const voices = window.speechSynthesis.getVoices();
      let voice = opts?.voiceName ? voices.find((x) => x.name === opts.voiceName) : undefined;
      if (!voice) voice = voices.find((x) => x.lang?.toLowerCase().startsWith(bcp.toLowerCase()));
      if (voice) u.voice = voice;
      u.rate = 1.0;
      const done = () => {
        if (this.utterance === u) this.utterance = null;
        opts?.onEnd?.();
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.utterance = u;
      window.speechSynthesis.speak(u);
    });
  }

  stopSpeaking(): void {
    stopKokoro();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.utterance = null;
  }

  isSpeaking(): boolean {
    const sys = typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.speaking;
    return kokoroSpeaking() || sys;
  }
}
