import { IpcMessageSchema } from "@tide/shared";
import type { IpcMessage } from "@tide/shared";
import { Transport } from "./transport.js";
import { StreamManager } from "../stream/manager.js";
import { randomUUID } from "node:crypto";

const ENGINE_VERSION = "0.1.0";
const ENGINE_ID = randomUUID();
const streamManager = new StreamManager();

export type MessageHandler = (msg: IpcMessage, transport: Transport) => void;

const handlers = new Map<string, MessageHandler>();

/** Register a handler for a specific message type. */
export function registerHandler(type: string, handler: MessageHandler): void {
  handlers.set(type, handler);
}

/** Dispatch an incoming raw message through the handler pipeline. */
export function handleMessage(raw: unknown, transport: Transport): void {
  const parsed = IpcMessageSchema.safeParse(raw);

  if (!parsed.success) {
    console.error("[handler] Invalid message:", parsed.error.format());
    return;
  }

  const msg = parsed.data;

  // Built-in handshake handler
  if (msg.type === "handshake") {
    console.log(`[handler] Handshake from client v${msg.version}`);
    transport.send({
      id: randomUUID(),
      type: "handshake_ack",
      timestamp: Date.now(),
      version: ENGINE_VERSION,
      engineId: ENGINE_ID,
    });
    return;
  }

  // Built-in tool_request handler: simulate streaming for now
  if (msg.type === "tool_request") {
    console.log(`[handler] Tool request: ${msg.tool} (${msg.requestId})`);
    streamManager.simulateStream(msg.requestId, transport).catch((err) => {
      console.error("[handler] Stream error:", err);
    });
    return;
  }

  const handler = handlers.get(msg.type);
  if (handler) {
    handler(msg, transport);
  } else {
    console.warn(`[handler] No handler for message type: ${msg.type}`);
  }
}
