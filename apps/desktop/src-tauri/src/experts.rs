//! Expert Sessions — Rust backend for multi-agent brainstorming.
//!
//! Manages expert session state, watches mailbox directories for real-time
//! P2P message forwarding to the frontend, and provides CRUD for teams/experts.
//! The actual Pi processes are spawned by the `tide-experts.ts` extension;
//! Rust handles file I/O, event forwarding, and Tauri commands.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

// ── Types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExpertsPhase {
    Idle,
    Setup,
    Exploration,
    Discussion,
    Synthesis,
    Ready,
    Executing,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertsEvent {
    pub session_id: String,
    pub phase: String,
    pub message: String,
    pub experts: Vec<ExpertStatusBrief>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertStatusBrief {
    pub name: String,
    pub status: String,
    pub message_count: usize,
    pub finding_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertMessageEvent {
    pub session_id: String,
    pub message: serde_json::Value,
}

// ── File Helpers ───────────────────────────────────────

fn experts_base_dir(workspace: &str) -> PathBuf {
    PathBuf::from(workspace).join(".tide").join("experts")
}

fn teams_dir(workspace: &str) -> PathBuf {
    experts_base_dir(workspace).join("teams")
}

fn experts_dir(workspace: &str) -> PathBuf {
    experts_base_dir(workspace).join("experts")
}

fn sessions_dir(workspace: &str) -> PathBuf {
    experts_base_dir(workspace).join("sessions")
}

// Global (user-level) paths — shared across all projects
fn global_experts_base_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".tide").join("experts")
}

fn global_teams_dir() -> PathBuf {
    global_experts_base_dir().join("teams")
}

fn global_experts_dir() -> PathBuf {
    global_experts_base_dir().join("experts")
}

/// Resolve teams dir based on scope
fn resolve_teams_dir(workspace: &str, scope: &str) -> PathBuf {
    if scope == "global" { global_teams_dir() } else { teams_dir(workspace) }
}

/// Resolve experts dir based on scope
fn resolve_experts_dir(workspace: &str, scope: &str) -> PathBuf {
    if scope == "global" { global_experts_dir() } else { experts_dir(workspace) }
}

// ── Mailbox Watcher ────────────────────────────────────

/// Start watching a session's mailbox directories for new messages.
/// Emits `expert_message` Tauri events when new `.json` files appear.
pub fn start_mailbox_watcher(
    session_dir: PathBuf,
    session_id: String,
    app_handle: tauri::AppHandle,
) -> Option<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};

    if !session_dir.exists() {
        return None;
    }

    let sid = session_id.clone();
    let handle = app_handle.clone();

    let watcher_result = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            // Only react to file creation events
            if !matches!(event.kind, notify::EventKind::Create(_)) {
                return;
            }

            for path in &event.paths {
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }

                // Read and emit the message
                if let Ok(content) = std::fs::read_to_string(path) {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&content) {
                        let _ = handle.emit(
                            "expert_message",
                            ExpertMessageEvent {
                                session_id: sid.clone(),
                                message: msg,
                            },
                        );
                    }
                }
            }
        }
    });

    match watcher_result {
        Ok(mut watcher) => {
            // Watch the entire directory recursively — catches mailboxes and shared dirs
            // from any session the extension creates
            let _ = watcher.watch(&session_dir, RecursiveMode::Recursive);
            tracing::info!("Mailbox watcher started for session {}", session_id);
            Some(watcher)
        }
        Err(e) => {
            tracing::warn!("Failed to create mailbox watcher: {}", e);
            None
        }
    }
}

// ── Session State ──────────────────────────────────────

pub fn load_session_state(session_dir: &Path) -> Result<serde_json::Value, String> {
    let state_path = session_dir.join("state.json");
    let content = std::fs::read_to_string(&state_path)
        .map_err(|e| format!("Failed to read session state: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse session state: {}", e))
}

// ── Tauri Commands: Session Lifecycle ──────────────────

/// Start an expert brainstorming session.
/// Sends a [tide:experts] prompt to Pi (which triggers the tide_experts_brainstorm extension tool),
/// starts a mailbox watcher for real-time message forwarding, and returns immediately.
#[tauri::command]
pub async fn start_experts_session(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    team_id: String,
    topic: String,
) -> Result<String, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    // Don't create session dir here — the extension creates its own.
    // Instead, watch the entire sessions directory for new files from any session.
    let all_sessions_dir = sessions_dir(&workspace);
    std::fs::create_dir_all(&all_sessions_dir).map_err(|e| e.to_string())?;

    // Start a recursive watcher on the sessions directory.
    // This catches files from whatever session the extension creates.
    let watcher = start_mailbox_watcher(
        all_sessions_dir.clone(),
        "active".to_string(),
        app_handle.clone(),
    );
    {
        let mut watcher_guard = state.experts_watcher.lock().await;
        *watcher_guard = watcher;
    }

    // Store sessions dir so send_expert_message can find active session
    {
        let mut dir_guard = state.experts_session_dir.lock().await;
        *dir_guard = Some(all_sessions_dir.to_string_lossy().to_string());
    }

    // Send a specially-marked prompt to Pi that triggers the brainstorm tool
    let prompt = format!(
        "[tide:experts]\n\
         Call the tide_experts_brainstorm tool with these exact parameters:\n\
         - team: \"{}\"\n\
         - topic: \"{}\"\n\n\
         Call the tool immediately. Do not explain, discuss, search the web, or do anything else.",
        team_id, topic,
    );

    let pi_handle = {
        let guard = state.pi.lock().await;
        guard.as_ref().ok_or("Pi not connected")?.handle()
    };

    let cmd = serde_json::json!({
        "type": "prompt",
        "message": prompt,
    });
    pi_handle.send(&cmd).await.map_err(|e| format!("Failed to send prompt: {}", e))?;

    tracing::info!("Expert session started: team={}, topic={}", team_id, &topic[..topic.len().min(60)]);
    Ok(team_id)
}

/// Resume an interrupted expert brainstorming session.
/// Re-starts the mailbox watcher and sends a prompt to Pi to continue the session.
#[tauri::command]
pub async fn resume_experts_session(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let session_dir = sessions_dir(&workspace).join(&session_id);
    if !session_dir.exists() {
        return Err(format!("Session directory not found: {}", session_id));
    }

    // Load session state to get team and topic
    let session_state = load_session_state(&session_dir)?;
    let team_id = session_state.get("teamId").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let topic = session_state.get("topic").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // Re-start mailbox watcher on the sessions directory
    let all_sessions_dir = sessions_dir(&workspace);
    let watcher = start_mailbox_watcher(
        all_sessions_dir.clone(),
        session_id.clone(),
        app_handle.clone(),
    );
    {
        let mut watcher_guard = state.experts_watcher.lock().await;
        *watcher_guard = watcher;
    }
    {
        let mut dir_guard = state.experts_session_dir.lock().await;
        *dir_guard = Some(all_sessions_dir.to_string_lossy().to_string());
    }

    // Send a resume prompt to Pi — tells the extension to re-spawn agents
    // and continue from where the session left off (reading existing messages/findings)
    let prompt = format!(
        "[tide:experts]\n\
         Resume the expert brainstorming session by calling tide_experts_brainstorm with:\n\
         - team: \"{}\"\n\
         - topic: \"{}\"\n\
         - context: \"RESUME SESSION: Agents should read existing messages and findings in the session \
         directory before continuing. Previous discussion exists — build on it, don't restart.\"\n\n\
         Call the tool immediately.",
        team_id, topic,
    );

    let pi_handle = {
        let guard = state.pi.lock().await;
        guard.as_ref().ok_or("Pi not connected")?.handle()
    };

    let cmd = serde_json::json!({
        "type": "prompt",
        "message": prompt,
    });
    pi_handle.send(&cmd).await.map_err(|e| format!("Failed to send resume prompt: {}", e))?;

    tracing::info!("Expert session resumed: id={}, team={}", session_id, team_id);
    Ok(session_state)
}

/// Send a message from the user into the active expert session.
/// Writes a JSON message file to expert inboxes (picked up by the mailbox watcher).
#[tauri::command]
pub async fn send_expert_message(
    state: tauri::State<'_, super::AppState>,
    content: String,
    to: Option<String>,
    msg_id: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let sessions_root = {
        let guard = state.experts_session_dir.lock().await;
        guard.clone().ok_or("No active expert session")?
    };

    let sessions_path = PathBuf::from(&sessions_root);

    // Use explicit session_id if provided, otherwise fall back to latest by mtime
    let session_dir = if let Some(ref sid) = session_id {
        let dir = sessions_path.join(sid);
        if dir.is_dir() {
            dir
        } else {
            return Err(format!("Session directory not found: {}", sid));
        }
    } else {
        let latest = std::fs::read_dir(&sessions_path)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| e.path().is_dir())
            .max_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH))
            .ok_or("No session directories found")?;
        latest.path()
    };

    let mailboxes_dir = session_dir.join("mailboxes");
    if !mailboxes_dir.exists() {
        return Err("Session mailboxes directory not found".to_string());
    }

    let msg_id = msg_id.unwrap_or_else(|| format!("msg-user-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)));

    let timestamp = {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        format!("{}Z", now.as_secs())
    };

    let message = serde_json::json!({
        "id": msg_id,
        "from": "user",
        "to": to.as_deref().unwrap_or("*"),
        "type": "observation",
        "content": content,
        "references": [],
        "inReplyTo": null,
        "timestamp": timestamp,
    });

    let msg_json = serde_json::to_string_pretty(&message).map_err(|e| e.to_string())?;

    // Write to target inbox(es)
    let targets: Vec<String> = if to.is_some() {
        vec![to.unwrap()]
    } else {
        // Broadcast: find all agent mailboxes
        std::fs::read_dir(&mailboxes_dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect()
    };

    for target in &targets {
        let inbox_dir = mailboxes_dir.join(target).join("inbox");
        std::fs::create_dir_all(&inbox_dir).map_err(|e| e.to_string())?;
        let file_path = inbox_dir.join(format!("{}.json", msg_id));
        std::fs::write(&file_path, &msg_json).map_err(|e| e.to_string())?;
    }

    tracing::debug!("User message sent to {} target(s)", targets.len());
    Ok(())
}

// ── Tauri Commands: Team CRUD ──────────────────────────

/// Read teams from a directory, adding scope + backward compat fields
fn read_teams_from_dir(dir: &PathBuf, scope: &str) -> Vec<serde_json::Value> {
    let mut teams = Vec::new();
    if !dir.exists() { return teams; }
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return teams };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(mut team) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Backward compat: rename "judge" → "leader"
                    if team.get("leader").is_none() {
                        if let Some(judge) = team.get("judge").cloned() {
                            team.as_object_mut().map(|o| o.insert("leader".to_string(), judge));
                        }
                    }
                    if team.get("outputMode").is_none() {
                        team.as_object_mut().map(|o| o.insert("outputMode".to_string(), serde_json::json!("execute")));
                    }
                    team.as_object_mut().map(|o| o.insert("scope".to_string(), serde_json::json!(scope)));
                    teams.push(team);
                }
            }
        }
    }
    teams
}

#[tauri::command]
pub async fn list_expert_teams(
    state: tauri::State<'_, super::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    // Load global first, then local overrides by id
    let mut teams_map = std::collections::HashMap::new();
    for team in read_teams_from_dir(&global_teams_dir(), "global") {
        if let Some(id) = team.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            teams_map.insert(id, team);
        }
    }
    for team in read_teams_from_dir(&teams_dir(&workspace), "local") {
        if let Some(id) = team.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            teams_map.insert(id, team); // local overrides global
        }
    }

    Ok(teams_map.into_values().collect())
}

#[tauri::command]
pub async fn save_expert_team(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    config: serde_json::Value,
    scope: Option<String>,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let team_id = config
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Team config must have an 'id' field")?;

    let dir = resolve_teams_dir(&workspace, scope.as_deref().unwrap_or("local"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(format!("{}.json", team_id));
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;

    let _ = app_handle.emit("experts_changed", "teams");
    Ok(())
}

#[tauri::command]
pub async fn delete_expert_team(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    team_id: String,
    scope: Option<String>,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let file_path = resolve_teams_dir(&workspace, scope.as_deref().unwrap_or("local")).join(format!("{}.json", team_id));
    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    let _ = app_handle.emit("experts_changed", "teams");
    Ok(())
}

// ── Tauri Commands: Expert CRUD ────────────────────────

/// Read expert configs from a directory, adding scope field
fn read_experts_from_dir(dir: &PathBuf, scope: &str) -> Vec<serde_json::Value> {
    let mut experts = Vec::new();
    if !dir.exists() { return experts; }
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return experts };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if let Ok(content) = std::fs::read_to_string(&path) {
                experts.push(serde_json::json!({
                    "name": name,
                    "content": content,
                    "scope": scope,
                }));
            }
        }
    }
    experts
}

#[tauri::command]
pub async fn list_experts_configs(
    state: tauri::State<'_, super::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    // Global first, local overrides by name
    let mut experts_map = std::collections::HashMap::new();
    for expert in read_experts_from_dir(&global_experts_dir(), "global") {
        if let Some(name) = expert.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            experts_map.insert(name, expert);
        }
    }
    for expert in read_experts_from_dir(&experts_dir(&workspace), "local") {
        if let Some(name) = expert.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()) {
            experts_map.insert(name, expert); // local overrides global
        }
    }

    Ok(experts_map.into_values().collect())
}

#[tauri::command]
pub async fn save_expert_config(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    name: String,
    content: String,
    scope: Option<String>,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let dir = resolve_experts_dir(&workspace, scope.as_deref().unwrap_or("local"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(format!("{}.md", name));
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;

    let _ = app_handle.emit("experts_changed", "experts");
    Ok(())
}

#[tauri::command]
pub async fn delete_expert_config(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    name: String,
    scope: Option<String>,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let file_path = resolve_experts_dir(&workspace, scope.as_deref().unwrap_or("local")).join(format!("{}.md", name));
    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    let _ = app_handle.emit("experts_changed", "experts");
    Ok(())
}

/// Promote a local team (and its member experts) to global scope, or demote global to local
#[tauri::command]
pub async fn promote_expert_team(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    team_id: String,
    to_scope: String,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let (from_scope, from_teams, to_teams, from_experts, to_experts) = if to_scope == "global" {
        ("local", teams_dir(&workspace), global_teams_dir(), experts_dir(&workspace), global_experts_dir())
    } else {
        ("global", global_teams_dir(), teams_dir(&workspace), global_experts_dir(), experts_dir(&workspace))
    };

    // Read team config
    let from_file = from_teams.join(format!("{}.json", team_id));
    if !from_file.exists() {
        return Err(format!("Team '{}' not found in {} scope", team_id, from_scope));
    }
    let team_content = std::fs::read_to_string(&from_file).map_err(|e| e.to_string())?;
    let team: serde_json::Value = serde_json::from_str(&team_content).map_err(|e| e.to_string())?;

    // Move member experts
    if let Some(members) = team.get("experts").and_then(|v| v.as_array()) {
        std::fs::create_dir_all(&to_experts).map_err(|e| e.to_string())?;
        for member in members {
            if let Some(name) = member.as_str() {
                let src = from_experts.join(format!("{}.md", name));
                if src.exists() {
                    let dst = to_experts.join(format!("{}.md", name));
                    let content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
                    std::fs::write(&dst, &content).map_err(|e| e.to_string())?;
                    let _ = std::fs::remove_file(&src);
                }
            }
        }
    }

    // Move team file
    std::fs::create_dir_all(&to_teams).map_err(|e| e.to_string())?;
    let to_file = to_teams.join(format!("{}.json", team_id));
    std::fs::write(&to_file, &team_content).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&from_file);

    let _ = app_handle.emit("experts_changed", "all");
    tracing::info!("Team '{}' promoted to {} scope", team_id, to_scope);
    Ok(())
}

// ── Tauri Commands: Session Management ─────────────────

#[tauri::command]
pub async fn list_experts_sessions(
    state: tauri::State<'_, super::AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let dir = sessions_dir(&workspace);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(state) = load_session_state(&path) {
                sessions.push(state);
            }
        }
    }

    // Sort by createdAt descending
    sessions.sort_by(|a, b| {
        let a_time = a.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let b_time = b.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        b_time.cmp(a_time)
    });

    Ok(sessions)
}

#[tauri::command]
pub async fn get_experts_session(
    state: tauri::State<'_, super::AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let session_dir = sessions_dir(&workspace).join(&session_id);
    load_session_state(&session_dir)
}

#[tauri::command]
pub async fn get_experts_session_messages(
    state: tauri::State<'_, super::AppState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let session_dir = sessions_dir(&workspace).join(&session_id);
    let mailboxes_dir = session_dir.join("mailboxes");

    if !mailboxes_dir.exists() {
        return Ok(vec![]);
    }

    let mut messages = Vec::new();

    // Collect all messages from all agents' inboxes and outboxes
    let entries = std::fs::read_dir(&mailboxes_dir).map_err(|e| e.to_string())?;
    for agent_entry in entries.flatten() {
        let outbox = agent_entry.path().join("outbox");
        if !outbox.exists() {
            continue;
        }

        let files = std::fs::read_dir(&outbox).map_err(|e| e.to_string())?;
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&content) {
                        messages.push(msg);
                    }
                }
            }
        }
    }

    // Sort by timestamp
    messages.sort_by(|a, b| {
        let a_time = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let b_time = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        a_time.cmp(b_time)
    });

    Ok(messages)
}

#[tauri::command]
pub async fn get_experts_session_findings(
    state: tauri::State<'_, super::AppState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let findings_path = sessions_dir(&workspace)
        .join(&session_id)
        .join("shared")
        .join("findings.json");

    if !findings_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&findings_path).map_err(|e| e.to_string())?;
    let findings: Vec<serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(findings)
}

#[tauri::command]
pub async fn delete_experts_session(
    state: tauri::State<'_, super::AppState>,
    session_id: String,
) -> Result<(), String> {
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone().ok_or("No workspace open")?
    };

    let session_dir = sessions_dir(&workspace).join(&session_id);
    if session_dir.exists() {
        std::fs::remove_dir_all(&session_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Force-stop the active expert brainstorming session.
///
/// 1. Sends Pi an `abort` command — cancels the in-flight tool call, which fires the
///    `AbortSignal` that `tide_experts_brainstorm.execute()` is awaiting. The
///    extension's `runBrainstormSession` then kills every spawned expert subprocess
///    in its `finally` block.
/// 2. Drops the mailbox watcher so we stop forwarding stale file events.
/// 3. Marks the latest (or named) session's `state.json` as `phase: "failed"` so the
///    Past Sessions list shows it correctly.
/// 4. Emits `experts_changed` so the frontend reloads.
///
/// Best-effort throughout — Pi may already be idle, the session dir may not exist
/// yet (e.g. brainstorm tool was never called). All steps are independent and
/// non-fatal individually.
#[tauri::command]
pub async fn abort_experts_session(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<(), String> {
    // 1. Tell Pi to abort the running tool call.
    if let Some(conn) = state.pi.lock().await.as_ref() {
        let cmd = serde_json::json!({ "type": "abort" });
        let _ = conn.send(&cmd).await;
    }

    // 2. Drop the watcher so we stop forwarding file events.
    *state.experts_watcher.lock().await = None;

    // 3. Mark the latest (or named) session as failed on disk.
    let workspace = {
        let root = state.workspace_root.lock().await;
        root.clone()
    };
    if let Some(workspace) = workspace {
        let sessions_root = sessions_dir(&workspace);
        let session_dir = if let Some(sid) = session_id {
            let dir = sessions_root.join(sid);
            if dir.is_dir() { Some(dir) } else { None }
        } else if sessions_root.exists() {
            std::fs::read_dir(&sessions_root)
                .ok()
                .and_then(|rd| rd
                    .flatten()
                    .filter(|e| e.path().is_dir())
                    .max_by_key(|e| e.metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH))
                    .map(|e| e.path()))
        } else {
            None
        };

        if let Some(dir) = session_dir {
            if let Ok(mut state_json) = load_session_state(&dir) {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default();
                let timestamp = format!("{}Z", now.as_secs());
                if let Some(obj) = state_json.as_object_mut() {
                    obj.insert("phase".into(), serde_json::json!("failed"));
                    obj.insert("completedAt".into(), serde_json::json!(timestamp));
                }
                if let Ok(content) = serde_json::to_string_pretty(&state_json) {
                    let _ = std::fs::write(dir.join("state.json"), content);
                }
            }
        }
    }

    // 4. Notify frontend so it reloads the session list.
    let _ = app_handle.emit("experts_changed", "all");
    tracing::info!("Expert session aborted by user");
    Ok(())
}
