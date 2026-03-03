use bytes::{Buf, BufMut, BytesMut};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, Mutex};

/// A framed connection to the Tide Engine over UDS.
/// Wire format: [4-byte big-endian u32 length][UTF-8 JSON payload]
pub struct EngineConnection {
    writer: Arc<Mutex<tokio::io::WriteHalf<UnixStream>>>,
    pub receiver: mpsc::Receiver<Value>,
}

impl EngineConnection {
    /// Connect to the engine UDS and start the read loop.
    pub async fn connect(socket_path: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let stream = UnixStream::connect(socket_path).await?;
        let (read_half, write_half) = tokio::io::split(stream);
        let writer = Arc::new(Mutex::new(write_half));

        let (tx, rx) = mpsc::channel::<Value>(256);

        // Spawn read loop
        tokio::spawn(async move {
            if let Err(e) = read_loop(read_half, tx).await {
                tracing::error!("Engine read loop error: {}", e);
            }
        });

        Ok(Self {
            writer,
            receiver: rx,
        })
    }

    /// Send a JSON message to the engine with length-prefix framing.
    pub async fn send(&self, msg: &Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let json = serde_json::to_string(msg)?;
        let payload = json.as_bytes();
        let len = payload.len() as u32;

        let mut buf = BytesMut::with_capacity(4 + payload.len());
        buf.put_u32(len);
        buf.put_slice(payload);

        let mut writer = self.writer.lock().await;
        writer.write_all(&buf).await?;
        writer.flush().await?;
        Ok(())
    }
}

async fn read_loop(
    mut reader: tokio::io::ReadHalf<UnixStream>,
    tx: mpsc::Sender<Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = BytesMut::new();

    loop {
        // Read more data
        let mut tmp = vec![0u8; 4096];
        let n = reader.read(&mut tmp).await?;
        if n == 0 {
            tracing::info!("Engine connection closed");
            break;
        }
        buf.extend_from_slice(&tmp[..n]);

        // Drain complete frames
        while buf.len() >= 4 {
            let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
            if buf.len() < 4 + len {
                break;
            }
            buf.advance(4);
            let payload = buf.split_to(len);
            let json_str = std::str::from_utf8(&payload)?;
            match serde_json::from_str::<Value>(json_str) {
                Ok(val) => {
                    if tx.send(val).await.is_err() {
                        tracing::warn!("Message receiver dropped");
                        return Ok(());
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to parse engine message: {}", e);
                }
            }
        }
    }
    Ok(())
}
