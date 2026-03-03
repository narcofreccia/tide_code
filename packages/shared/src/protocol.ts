import { z } from "zod";

// ── Base envelope ────────────────────────────────────────
export const MessageEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
});

// ── Handshake ────────────────────────────────────────────
export const HandshakeRequestSchema = MessageEnvelopeSchema.extend({
  type: z.literal("handshake"),
  version: z.string(),
  clientId: z.string(),
});
export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;

export const HandshakeAckSchema = MessageEnvelopeSchema.extend({
  type: z.literal("handshake_ack"),
  version: z.string(),
  engineId: z.string(),
});
export type HandshakeAck = z.infer<typeof HandshakeAckSchema>;

// ── Tool request / response ──────────────────────────────
export const ToolRequestSchema = MessageEnvelopeSchema.extend({
  type: z.literal("tool_request"),
  requestId: z.string(),
  tool: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolResponseSchema = MessageEnvelopeSchema.extend({
  type: z.literal("tool_response"),
  requestId: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type ToolResponse = z.infer<typeof ToolResponseSchema>;

// ── Stream messages ──────────────────────────────────────
export const StreamStartSchema = MessageEnvelopeSchema.extend({
  type: z.literal("stream_start"),
  requestId: z.string(),
  streamId: z.string(),
});
export type StreamStart = z.infer<typeof StreamStartSchema>;

export const StreamDeltaSchema = MessageEnvelopeSchema.extend({
  type: z.literal("stream_delta"),
  streamId: z.string(),
  seq: z.number(),
  content: z.string(),
});
export type StreamDelta = z.infer<typeof StreamDeltaSchema>;

export const StreamEndSchema = MessageEnvelopeSchema.extend({
  type: z.literal("stream_end"),
  streamId: z.string(),
  finalSeq: z.number(),
});
export type StreamEnd = z.infer<typeof StreamEndSchema>;

// ── Discriminated union ──────────────────────────────────
export const IpcMessageSchema = z.discriminatedUnion("type", [
  HandshakeRequestSchema,
  HandshakeAckSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  StreamStartSchema,
  StreamDeltaSchema,
  StreamEndSchema,
]);
export type IpcMessage = z.infer<typeof IpcMessageSchema>;

// ── All message type literals ────────────────────────────
export type MessageType = IpcMessage["type"];
