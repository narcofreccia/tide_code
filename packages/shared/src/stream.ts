/** Stream event types for the UI layer (Rust → WebView). */

export interface StreamEventStart {
  type: "start";
  requestId: string;
  streamId: string;
}

export interface StreamEventDelta {
  type: "delta";
  streamId: string;
  seq: number;
  content: string;
}

export interface StreamEventEnd {
  type: "end";
  streamId: string;
  finalSeq: number;
}

export type StreamEvent = StreamEventStart | StreamEventDelta | StreamEventEnd;
