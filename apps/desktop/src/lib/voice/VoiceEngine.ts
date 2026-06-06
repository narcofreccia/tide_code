// A swappable voice engine for the Codebase Tutor. The default LocalVoiceEngine runs
// entirely in the webview (Whisper via transformers.js for STT, speechSynthesis for TTS) —
// local-first and free. Cloud / Kokoro engines can implement the same interface later.

import { LocalVoiceEngine } from "./LocalVoiceEngine";

export interface SpeakOptions {
  voiceName?: string;
  /** Language code (e.g. "en", "it") — used to pick a matching voice / TTS path. */
  lang?: string;
  /** Preferred TTS backend; falls back to system voices when unavailable for the language. */
  engine?: "kokoro" | "system";
  onEnd?: () => void;
}

export interface VoiceEngine {
  /** Transcribe a 16 kHz mono PCM buffer to text. `lang` is a code like "en"/"it". */
  transcribe(pcm16k: Float32Array, opts?: { model?: string; lang?: string }): Promise<string>;
  /** Speak text aloud (best-effort; resolves when finished or interrupted). */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Stop any in-progress speech immediately. */
  stopSpeaking(): void;
  isSpeaking(): boolean;
}

let engine: VoiceEngine | null = null;

/**
 * Get the configured voice engine (currently always the local in-webview engine).
 * LocalVoiceEngine is cheap to construct; the heavy transformers.js model is only
 * loaded the first time `transcribe()` runs.
 */
export function getVoiceEngine(): VoiceEngine {
  if (!engine) engine = new LocalVoiceEngine();
  return engine;
}
