// Codebase Tutor backend.
//
// Mirrors the Experts feature: a `notify` watcher forwards events the pi extension
// drops in `.tide/tutor/events/` to the frontend as `tutor_event`, and a handful of
// commands trigger the tutor agent (via [tide:tutor] prompts) and read/write the
// persisted curriculum / lessons / progress / settings under `.tide/tutor/`.

use std::path::{Path, PathBuf};
use tauri::Emitter;

fn tutor_dir(workspace: &str) -> PathBuf {
    PathBuf::from(workspace).join(".tide").join("tutor")
}
fn events_dir(workspace: &str) -> PathBuf {
    tutor_dir(workspace).join("events")
}
fn curriculum_path(workspace: &str) -> PathBuf {
    tutor_dir(workspace).join("curriculum.json")
}
fn lesson_path(workspace: &str, lesson_id: &str) -> PathBuf {
    tutor_dir(workspace).join("lessons").join(format!("{}.md", sanitize_id(lesson_id)))
}
fn quiz_path(workspace: &str, lesson_id: &str) -> PathBuf {
    tutor_dir(workspace).join("lessons").join(format!("{}.quiz.json", sanitize_id(lesson_id)))
}
fn progress_path(workspace: &str) -> PathBuf {
    tutor_dir(workspace).join("progress.json")
}
fn config_path(workspace: &str) -> PathBuf {
    tutor_dir(workspace).join("settings.json")
}

/// Keep lesson ids safe as a single path segment (matches the extension's sanitizer).
fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .take(80)
        .collect()
}

async fn workspace_of(state: &tauri::State<'_, super::AppState>) -> Result<String, String> {
    let root = state.workspace_root.lock().await;
    root.clone().ok_or_else(|| "No workspace open".to_string())
}

/// Watch `.tide/tutor/events/` and forward each new event file to the frontend.
fn start_tutor_watcher(
    workspace: &str,
    app_handle: tauri::AppHandle,
) -> Option<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};

    let dir = events_dir(workspace);
    let _ = std::fs::create_dir_all(&dir);

    let handle = app_handle.clone();
    let watcher_result = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if !matches!(event.kind, notify::EventKind::Create(_)) {
                return;
            }
            for path in &event.paths {
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(content) = std::fs::read_to_string(path) {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&content) {
                        let _ = handle.emit("tutor_event", payload);
                    }
                }
            }
        }
    });

    match watcher_result {
        Ok(mut watcher) => {
            let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
            tracing::info!("Tutor watcher started at {}", dir.display());
            Some(watcher)
        }
        Err(e) => {
            tracing::warn!("Failed to create tutor watcher: {}", e);
            None
        }
    }
}

/// Emit a phase event straight to the UI (no file needed).
fn emit_phase(app: &tauri::AppHandle, phase: &str, message: &str) {
    let _ = app.emit(
        "tutor_event",
        serde_json::json!({ "kind": "phase", "phase": phase, "message": message }),
    );
}

fn model_string(m: &serde_json::Value) -> Option<String> {
    if let Some(s) = m.as_str() {
        return if s.trim().is_empty() { None } else { Some(s.to_string()) };
    }
    m.get("id").and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Resolve the model for a tutor `role` ("curriculum" | "lesson" | "answer") from
/// `.tide/tutor/settings.json`: per-role override (`models.<role>`) → global `model` →
/// None (pi default). Accepts a `"provider/id"` string or `{ provider, id }` object.
fn resolve_tutor_model(workspace: &str, role: &str) -> Option<String> {
    let content = std::fs::read_to_string(config_path(workspace)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    if let Some(role_model) = v.get("models").and_then(|ms| ms.get(role)) {
        if let Some(s) = model_string(role_model) {
            return Some(s);
        }
    }
    v.get("model").and_then(model_string)
}

fn lang_name(code: &str) -> &'static str {
    match code {
        "it" => "Italian",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        "pt" => "Portuguese",
        "hi" => "Hindi",
        "ja" => "Japanese",
        "zh" => "Chinese",
        _ => "English",
    }
}

/// A directive telling the agent which language to author in.
fn lang_directive(code: &str) -> String {
    format!(
        "\nLANGUAGE: Write everything (titles, prose, summaries) in {} (code '{}'). Code identifiers stay as-is.\n",
        lang_name(code),
        code,
    )
}

/// The language the current curriculum was authored in (from curriculum.json), default "en".
fn resolve_curriculum_language(workspace: &str) -> String {
    std::fs::read_to_string(curriculum_path(workspace))
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| v.get("language").and_then(|l| l.as_str()).map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string())
}

/// Build a "GENERATION PREFERENCES" directive block from settings (difficulty, depth,
/// length, custom instructions) to append to authoring prompts. Empty if nothing is set.
fn gen_directives(workspace: &str) -> String {
    let content = match std::fs::read_to_string(config_path(workspace)) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let v: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let mut parts: Vec<String> = Vec::new();
    if let Some(diff) = v.get("difficulty").and_then(|x| x.as_str()) {
        parts.push(format!("Target the learner's level: {}.", diff));
    }
    match v.get("depth").and_then(|x| x.as_str()) {
        Some("concise") => parts.push("Be concise — hit the key points without over-explaining.".into()),
        Some("deep") => parts.push("Go deep — thorough explanations, edge cases, and rationale.".into()),
        _ => {}
    }
    match v.get("length").and_then(|x| x.as_str()) {
        Some("short") => parts.push("Keep the lesson short.".into()),
        Some("long") => parts.push("A longer, comprehensive lesson is welcome.".into()),
        _ => {}
    }
    if let Some(ci) = v.get("customInstructions").and_then(|x| x.as_str()) {
        if !ci.trim().is_empty() {
            parts.push(format!("Custom instructions from the learner: {}", ci.trim()));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("\nGENERATION PREFERENCES: {}\n", parts.join(" "))
    }
}

/// Run the tutor agent for `prompt` in an ISOLATED one-shot pi process (own context +
/// model), streaming its stdout to the UI as `tutor_event {kind:"stream", target, chunk}`.
/// Cancels any previous tutor run first.
async fn run_tutor_agent(
    state: &tauri::State<'_, super::AppState>,
    app_handle: &tauri::AppHandle,
    workspace: &str,
    prompt: String,
    role: &str,
    stream_target: String,
) -> Result<(), String> {
    let model = resolve_tutor_model(workspace, role);
    let exts = super::resolve_named_extension_paths(&["tide-tutor", "tide-index", "tide-subagent"]);

    let mut child = super::sidecar::spawn_oneshot_pi(workspace, &exts, model.as_deref(), &prompt)
        .await
        .map_err(|e| format!("Failed to spawn tutor: {}", e))?;

    let stdout = child.stdout.take();
    {
        let mut guard = state.tutor_child.lock().await;
        *guard = Some(child);
    }

    if let Some(stdout) = stdout {
        let handle = app_handle.clone();
        let target = stream_target;
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let v: serde_json::Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // pi --mode json event stream (see docs/json.md).
                match v.get("type").and_then(|t| t.as_str()) {
                    // Live narration: assistantMessageEvent text deltas.
                    Some("message_update") => {
                        let ame = v.get("assistantMessageEvent");
                        let is_text = ame.and_then(|a| a.get("type")).and_then(|t| t.as_str()) == Some("text_delta");
                        if is_text {
                            if let Some(delta) = ame.and_then(|a| a.get("delta")).and_then(|d| d.as_str()) {
                                if !delta.is_empty() {
                                    let _ = handle.emit(
                                        "tutor_event",
                                        serde_json::json!({ "kind": "stream", "target": target, "chunk": delta }),
                                    );
                                }
                            }
                        }
                    }
                    // Tool activity: "▸ {tool}" lines so the learner sees what it's doing.
                    Some("tool_execution_start") => {
                        if let Some(tool) = v.get("toolName").and_then(|t| t.as_str()) {
                            let _ = handle.emit(
                                "tutor_event",
                                serde_json::json!({ "kind": "activity", "target": target, "tool": tool }),
                            );
                        }
                    }
                    _ => {}
                }
            }
            let _ = handle.emit(
                "tutor_event",
                serde_json::json!({ "kind": "stream_end", "target": target }),
            );
        });
    }
    Ok(())
}

fn include_critique(workspace: &str) -> bool {
    let path = config_path(workspace);
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            return v.get("includeCritique").and_then(|b| b.as_bool()).unwrap_or(true);
        }
    }
    true
}

// ── Commands: trigger the tutor agent ───────────────────────

/// Kick off a deep analysis of the workspace and build the learning curriculum.
#[tauri::command]
pub async fn tutor_build_curriculum(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    language: Option<String>,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    let lang = language.filter(|s| !s.is_empty()).unwrap_or_else(|| "en".to_string());

    let watcher = start_tutor_watcher(&workspace, app_handle.clone());
    {
        let mut guard = state.tutor_watcher.lock().await;
        *guard = watcher;
    }
    emit_phase(&app_handle, "analyzing", "Analyzing the codebase…");

    let prompt = "[tide:orchestrated]\n[tide:tutor]\n\
        You are the Codebase Tutor. Design a learning curriculum for THIS workspace so a developer \
        new to it can understand it from scratch.\n\
        1. Map the structure with tide_index_repo_outline and tide_index_file_tree.\n\
        2. Use tide_dispatch to explore the main subsystems in parallel (entry points, state \
        management, backend/IPC, build/tooling).\n\
        3. Detect the tech stack.\n\
        4. Design ordered chapters and lessons, FIRST CONCEPTS FIRST: a high-level overview and the \
        tech stack before any subsystem deep-dive. Each lesson should name the concrete files/symbols \
        it teaches (as targets).\n\
        5. Call tide_tutor_build_curriculum with the full ordered curriculum, setting its `language` field.\n\
        Use tide_tutor_progress to report each analysis step. Do NOT modify any files. Be efficient."
        .to_string();
    let prompt = format!("{}{}", prompt, lang_directive(&lang));

    run_tutor_agent(&state, &app_handle, &workspace, prompt + &gen_directives(&workspace), "curriculum", "curriculum".to_string()).await
}

/// Ensure a lesson exists: return immediately if cached, otherwise author it.
#[tauri::command]
pub async fn request_tutor_lesson(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    lesson_id: String,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;

    if lesson_path(&workspace, &lesson_id).exists() {
        let _ = app_handle.emit(
            "tutor_event",
            serde_json::json!({ "kind": "lesson_ready", "lessonId": lesson_id }),
        );
        return Ok(());
    }

    // Make sure the watcher is live so the lesson_ready event is delivered.
    {
        let mut guard = state.tutor_watcher.lock().await;
        if guard.is_none() {
            *guard = start_tutor_watcher(&workspace, app_handle.clone());
        }
    }
    emit_phase(&app_handle, "authoring", "Writing the lesson…");

    let critique_clause = if include_critique(&workspace) {
        "If the code shows a weak or questionable design choice, add a section titled \
         '## Critique & Improvements' explaining what could be better and why."
    } else {
        "Do not include critique sections."
    };

    let prompt = format!(
        "[tide:orchestrated]\n[tide:tutor]\n\
        Author the lesson with id \"{id}\" for the Codebase Tutor.\n\
        1. Read .tide/tutor/curriculum.json and find the lesson with id \"{id}\" and its targets.\n\
        2. Fetch the REAL code for its targets with tide_index_get_symbol (or by reading the files).\n\
        3. Write a concept-first lesson in GitHub-flavored markdown — explain the why/how/what, \
        starting from first principles. Embed short real code snippets, and reference concrete \
        locations as `path:startLine-endLine` in backticks so the learner can click to the exact line. \
        You MAY include a Mermaid diagram in a ```mermaid code fence for architecture/data-flow. {critique}\n\
        4. Call tide_tutor_author_lesson with {{ lessonId: \"{id}\", markdown, quiz }} — include a short \
        `quiz` of 2-3 multiple-choice questions that check understanding of this lesson.\n\
        Do NOT modify any project files.",
        id = lesson_id,
        critique = critique_clause,
    );

    run_tutor_agent(&state, &app_handle, &workspace, prompt + &gen_directives(&workspace) + &lang_directive(&resolve_curriculum_language(&workspace)), "lesson", lesson_id.clone()).await
}

/// Ask the tutor a free-form question about the codebase.
#[tauri::command]
pub async fn tutor_ask(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    lesson_id: Option<String>,
    question: String,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    {
        let mut guard = state.tutor_watcher.lock().await;
        if guard.is_none() {
            *guard = start_tutor_watcher(&workspace, app_handle.clone());
        }
    }
    emit_phase(&app_handle, "answering", "Thinking…");

    let lesson_line = match &lesson_id {
        Some(id) => format!("The learner is currently on lesson \"{}\".\n", id),
        None => String::new(),
    };
    let lesson_arg = match &lesson_id {
        Some(id) => format!("\"{}\"", id),
        None => "null".to_string(),
    };

    let prompt = format!(
        "[tide:orchestrated]\n[tide:tutor]\n\
        {lesson_line}The learner asks: \"{question}\"\n\
        Answer clearly and accurately using the actual codebase (use the tide_index_* tools as needed). \
        Reference concrete `path:line` locations in backticks. Teach, don't just describe.\n\
        Then call tide_tutor_answer with {{ lessonId: {lesson_arg}, question: <the question>, answer: <your full markdown answer> }}.",
        lesson_line = lesson_line,
        question = question.replace('"', "'"),
        lesson_arg = lesson_arg,
    );

    run_tutor_agent(&state, &app_handle, &workspace, prompt + &gen_directives(&workspace) + &lang_directive(&resolve_curriculum_language(&workspace)), "answer", "answer".to_string()).await
}

/// Regenerate a lesson from scratch, optionally with a tweak note ("simpler", "more on X").
#[tauri::command]
pub async fn regenerate_tutor_lesson(
    state: tauri::State<'_, super::AppState>,
    app_handle: tauri::AppHandle,
    lesson_id: String,
    note: Option<String>,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    // Drop the cached lesson + quiz so they're rewritten.
    let _ = std::fs::remove_file(lesson_path(&workspace, &lesson_id));
    let _ = std::fs::remove_file(quiz_path(&workspace, &lesson_id));
    {
        let mut guard = state.tutor_watcher.lock().await;
        if guard.is_none() {
            *guard = start_tutor_watcher(&workspace, app_handle.clone());
        }
    }
    emit_phase(&app_handle, "authoring", "Regenerating the lesson…");

    let critique_clause = if include_critique(&workspace) {
        "If the code shows a weak or questionable design choice, add a section titled '## Critique & Improvements'."
    } else {
        "Do not include critique sections."
    };
    let note_clause = match note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => format!("The learner asked for this change: \"{}\". Apply it.\n", n.replace('"', "'")),
        None => String::new(),
    };
    let prompt = format!(
        "[tide:orchestrated]\n[tide:tutor]\n\
        Re-author the lesson with id \"{id}\" for the Codebase Tutor.\n\
        {note}1. Read .tide/tutor/curriculum.json and find the lesson with id \"{id}\" and its targets.\n\
        2. Fetch the REAL code for its targets with tide_index_get_symbol (or by reading the files).\n\
        3. Write a concept-first lesson in GitHub-flavored markdown with real `path:startLine-endLine` refs in backticks. \
        You MAY include a ```mermaid diagram. {critique}\n\
        4. Call tide_tutor_author_lesson with {{ lessonId: \"{id}\", markdown, quiz }} (2-3 multiple-choice questions).",
        id = lesson_id,
        note = note_clause,
        critique = critique_clause,
    );
    run_tutor_agent(&state, &app_handle, &workspace, prompt + &gen_directives(&workspace) + &lang_directive(&resolve_curriculum_language(&workspace)), "lesson", lesson_id.clone()).await
}

/// Overwrite the curriculum (after the user edits chapters/lessons in the sidebar).
#[tauri::command]
pub async fn write_tutor_curriculum(
    state: tauri::State<'_, super::AppState>,
    curriculum: serde_json::Value,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    write_json(&curriculum_path(&workspace), &curriculum)
}

/// Cancel any in-flight tutor run.
#[tauri::command]
pub async fn tutor_cancel(state: tauri::State<'_, super::AppState>) -> Result<(), String> {
    let mut guard = state.tutor_child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
    }
    Ok(())
}

// ── Commands: read/write persisted state ────────────────────

#[tauri::command]
pub async fn read_tutor_curriculum(
    state: tauri::State<'_, super::AppState>,
) -> Result<serde_json::Value, String> {
    let workspace = workspace_of(&state).await?;
    let path = curriculum_path(&workspace);
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_tutor_lesson(
    state: tauri::State<'_, super::AppState>,
    lesson_id: String,
) -> Result<Option<String>, String> {
    let workspace = workspace_of(&state).await?;
    let path = lesson_path(&workspace, &lesson_id);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_tutor_quiz(
    state: tauri::State<'_, super::AppState>,
    lesson_id: String,
) -> Result<serde_json::Value, String> {
    let workspace = workspace_of(&state).await?;
    let path = quiz_path(&workspace, &lesson_id);
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_tutor_progress(
    state: tauri::State<'_, super::AppState>,
) -> Result<serde_json::Value, String> {
    let workspace = workspace_of(&state).await?;
    let path = progress_path(&workspace);
    if !path.exists() {
        return Ok(serde_json::json!({ "lessonsCompleted": {}, "currentLessonId": null }));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_tutor_progress(
    state: tauri::State<'_, super::AppState>,
    progress: serde_json::Value,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    write_json(&progress_path(&workspace), &progress)
}

#[tauri::command]
pub async fn read_tutor_config(
    state: tauri::State<'_, super::AppState>,
) -> Result<serde_json::Value, String> {
    let workspace = workspace_of(&state).await?;
    let path = config_path(&workspace);
    if !path.exists() {
        return Ok(serde_json::json!({
            "difficulty": "intermediate",
            "includeCritique": true,
            "language": "en",
            "voiceEnabled": false,
            "autoSpeak": false,
            "sttModel": "Xenova/whisper-base",
            "ttsEngine": "system"
        }));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_tutor_config(
    state: tauri::State<'_, super::AppState>,
    config: serde_json::Value,
) -> Result<(), String> {
    let workspace = workspace_of(&state).await?;
    // Merge over any existing config so unknown keys are preserved.
    let path = config_path(&workspace);
    let mut merged = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let (Some(base), Some(incoming)) = (merged.as_object_mut(), config.as_object()) {
        for (k, v) in incoming {
            base.insert(k.clone(), v.clone());
        }
    } else {
        merged = config;
    }
    write_json(&path, &merged)
}

fn write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(value).unwrap()).map_err(|e| e.to_string())
}
