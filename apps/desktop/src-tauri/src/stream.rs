use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;

/// Stream events forwarded from engine to UI via Tauri Channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Start {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "streamId")]
        stream_id: String,
    },
    Delta {
        #[serde(rename = "streamId")]
        stream_id: String,
        seq: u64,
        content: String,
    },
    End {
        #[serde(rename = "streamId")]
        stream_id: String,
        #[serde(rename = "finalSeq")]
        final_seq: u64,
    },
}

impl StreamEvent {
    /// Try to convert a JSON Value from the engine into a StreamEvent.
    pub fn from_engine_message(msg: &Value) -> Option<Self> {
        let msg_type = msg.get("type")?.as_str()?;
        match msg_type {
            "stream_start" => Some(StreamEvent::Start {
                request_id: msg.get("requestId")?.as_str()?.to_string(),
                stream_id: msg.get("streamId")?.as_str()?.to_string(),
            }),
            "stream_delta" => Some(StreamEvent::Delta {
                stream_id: msg.get("streamId")?.as_str()?.to_string(),
                seq: msg.get("seq")?.as_u64()?,
                content: msg.get("content")?.as_str()?.to_string(),
            }),
            "stream_end" => Some(StreamEvent::End {
                stream_id: msg.get("streamId")?.as_str()?.to_string(),
                final_seq: msg.get("finalSeq")?.as_u64()?,
            }),
            _ => None,
        }
    }
}

/// Forward engine stream messages to a Tauri Channel.
pub fn forward_to_channel(msg: &Value, channel: &Channel<StreamEvent>) {
    if let Some(event) = StreamEvent::from_engine_message(msg) {
        if let Err(e) = channel.send(event) {
            tracing::error!("Failed to send stream event to UI: {}", e);
        }
    }
}
