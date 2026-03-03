import { randomUUID } from "node:crypto";
import { Transport } from "../ipc/transport.js";

const SIMULATED_TOKENS = [
  "Hello",  "!", " I'm", " Tide", ",", " your", " agentic",
  " coding", " environment", ".", " I", " can", " help",
  " you", " plan", ",", " build", ",", " and", " validate",
  " features", " step", " by", " step", ".",
];

export class StreamManager {
  /**
   * Simulate a streaming LLM response.
   * Sends stream_start, N stream_deltas, then stream_end.
   */
  async simulateStream(requestId: string, transport: Transport): Promise<void> {
    const streamId = randomUUID();

    // stream_start
    transport.send({
      id: randomUUID(),
      type: "stream_start",
      timestamp: Date.now(),
      requestId,
      streamId,
    });

    // stream_deltas with simulated delay
    for (let i = 0; i < SIMULATED_TOKENS.length; i++) {
      await delay(30 + Math.random() * 50);
      transport.send({
        id: randomUUID(),
        type: "stream_delta",
        timestamp: Date.now(),
        streamId,
        seq: i,
        content: SIMULATED_TOKENS[i],
      });
    }

    // stream_end
    transport.send({
      id: randomUUID(),
      type: "stream_end",
      timestamp: Date.now(),
      streamId,
      finalSeq: SIMULATED_TOKENS.length - 1,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
