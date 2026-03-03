import type { Socket } from "node:net";

/**
 * Length-prefixed framed transport over a net.Socket.
 * Wire format: [4-byte big-endian u32 length] [UTF-8 JSON payload]
 */
export class Transport {
  private buffer = Buffer.alloc(0);
  private messageHandler: ((msg: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(private socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("close", () => this.closeHandler?.());
    socket.on("error", (err) => {
      console.error("[transport] Socket error:", err.message);
    });
  }

  /** Register a handler for incoming messages. */
  onMessage(handler: (msg: unknown) => void): void {
    this.messageHandler = handler;
  }

  /** Register a handler for socket close. */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /** Send a JSON message with length-prefix framing. */
  send(msg: unknown): void {
    const json = JSON.stringify(msg);
    const payload = Buffer.from(json, "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
  }

  /** Close the underlying socket. */
  close(): void {
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) {
        break; // incomplete frame
      }
      const payload = this.buffer.subarray(4, 4 + length).toString("utf-8");
      this.buffer = this.buffer.subarray(4 + length);

      try {
        const msg = JSON.parse(payload);
        this.messageHandler?.(msg);
      } catch (err) {
        console.error("[transport] Failed to parse message:", err);
      }
    }
  }
}
