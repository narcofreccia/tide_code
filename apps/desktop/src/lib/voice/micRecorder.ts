// Push-to-talk mic capture. Records from the default input until `stop()` is called,
// then decodes + resamples to 16 kHz mono Float32 (what Whisper expects).

export interface Recording {
  /** Stop recording and resolve the captured 16 kHz mono PCM. */
  stop: () => Promise<Float32Array>;
  /** Abandon the recording (releases the mic) without transcribing. */
  cancel: () => void;
}

/** Start a push-to-talk recording. Throws if mic access is denied/unavailable. */
export async function startRecording(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this environment.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<Float32Array>((resolve, reject) => {
        recorder.onstop = async () => {
          release();
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            resolve(await blobToPcm16k(blob));
          } catch (e) {
            reject(e);
          }
        };
        recorder.stop();
      }),
    cancel: () => {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      release();
    },
  };
}

/** Decode an audio blob and resample its first channel to 16 kHz mono Float32. */
async function blobToPcm16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const decodeCtx = new AudioCtx();
  const decoded = await decodeCtx.decodeAudioData(arrayBuf);
  decodeCtx.close();

  const targetRate = 16000;
  const duration = decoded.duration;
  const frames = Math.ceil(duration * targetRate);
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
