import { invoke, Channel } from "@tauri-apps/api/core";
import type { StreamEvent } from "@tide/shared/stream";

/**
 * Send a message to the engine via Tauri invoke, receiving streaming responses.
 */
export async function sendMessage(
  message: string,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;

  await invoke("send_message", {
    message,
    onEvent: channel,
  });
}
