mod ipc;
mod sidecar;
mod stream;

use ipc::EngineConnection;
use stream::StreamEvent;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub engine: Arc<Mutex<Option<EngineConnection>>>,
}

#[tauri::command]
async fn send_message(
    state: tauri::State<'_, AppState>,
    message: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let engine_arc = state.engine.clone();
    let mut engine_guard = engine_arc.lock().await;

    let conn = engine_guard.as_mut().ok_or("Engine not connected")?;

    // Build a tool_request to trigger streaming
    let request_id = uuid::Uuid::new_v4().to_string();
    let msg = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "type": "tool_request",
        "timestamp": timestamp_ms(),
        "requestId": request_id,
        "tool": "chat",
        "arguments": { "message": message },
    });

    conn.send(&msg).await.map_err(|e| e.to_string())?;

    // Read stream messages from the engine and forward to UI
    loop {
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            conn.receiver.recv(),
        )
        .await
        {
            Ok(Some(engine_msg)) => {
                let msg_type = engine_msg
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");

                stream::forward_to_channel(&engine_msg, &on_event);

                if msg_type == "stream_end" {
                    break;
                }
            }
            Ok(None) => {
                return Err("Engine connection lost".to_string());
            }
            Err(_) => {
                return Err("Stream timed out".to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_engine_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let engine = state.engine.lock().await;
    if engine.is_some() {
        Ok("connected".to_string())
    } else {
        Ok("disconnected".to_string())
    }
}

fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tide_desktop=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            engine: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            let state = app.state::<AppState>().inner().engine.clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::start_engine().await {
                    Ok(conn) => {
                        tracing::info!("Engine sidecar started successfully");
                        let mut engine = state.lock().await;
                        *engine = Some(conn);
                    }
                    Err(e) => {
                        tracing::error!("Failed to start engine sidecar: {}", e);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_message, get_engine_status])
        .run(tauri::generate_context!())
        .expect("error while running Tide");
}
