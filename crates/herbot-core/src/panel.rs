//! Panel chat and workspace endpoints. Credentials stay on the panel server.
use crate::{
    admin::{self, AdminState},
    agents_md,
    media::{OutFile, SavedFile},
    modes::{Mode, Style},
    poller::{self, BotApi, TelegramApi},
    store,
    telegram::{ChatKind, ChatRef, InboundMessage},
    turns::TurnQueue,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use teloxide::prelude::*;
use tower_http::services::ServeFile;

pub struct Live {
    pub api: Arc<BotApi>,
    pub turns: Arc<dyn TurnQueue>,
    pub rules: crate::policy::Rules,
    pub username: String,
    pub transcriber: Arc<crate::voice::AnyTranscriber>,
}
struct Panel {
    admin: Arc<AdminState>,
    live: Option<Live>,
}
type Failure = (StatusCode, Json<Value>);
type Result<T> = std::result::Result<T, Failure>;
fn fail(code: StatusCode, message: impl ToString) -> Failure {
    (code, Json(json!({"error": message.to_string()})))
}
fn io(e: impl std::fmt::Display) -> Failure {
    tracing::error!(error = %e, "panel request failed");
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Panel operation failed; check logs",
    )
}
fn auth(s: &Panel, h: &HeaderMap) -> Result<()> {
    if admin::authorized(h, &s.admin.token) {
        Ok(())
    } else {
        Err(fail(StatusCode::UNAUTHORIZED, "bad admin token"))
    }
}
fn live(s: &Panel) -> Result<&Live> {
    s.live.as_ref().ok_or_else(|| {
        fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Telegram is disabled; chat and topic creation need the running bot",
        )
    })
}
pub fn router(admin: Arc<AdminState>, live: Option<Live>) -> Router {
    let state = Arc::new(Panel { admin, live });
    Router::new()
        .route("/admin/api/conversations/{id}/messages", post(send))
        .route("/admin/api/conversations/{id}/activity", get(activity))
        .route("/admin/api/conversations/{id}/mode", put(mode))
        .route("/admin/api/conversations/{id}/files", get(files))
        .route("/admin/api/files/{*path}", get(file))
        .route("/admin/api/topics", post(new_topic))
        .route("/admin/api/search", get(search))
        .route("/admin/api/connectors", get(connectors))
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            record_failure,
        ))
        .with_state(state)
}
async fn record_failure(
    State(s): State<Arc<Panel>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path().to_string();
    let response = next.run(request).await;
    if !response.status().is_server_error() {
        return response;
    }
    let code = response.status();
    let error_id = match crate::errors::record(
        &s.admin.pool,
        "panel.request",
        "Panel operation failed",
        json!({"path":path,"status":code.as_u16()}),
    )
    .await
    {
        Ok(id) => id.to_string(),
        Err(e) => {
            tracing::error!(error = %e, "could not record panel failure");
            return response;
        }
    };
    tracing::error!(%error_id,%path,"panel operation failed");
    // Preserve the useful explanation (for example, Telegram permissions), adding its log id.
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .unwrap_or_default();
    let message = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "Panel operation failed; check logs".into());
    fail(code, format!("{error_id}: {message}")).into_response()
}

async fn status(s: &Panel, id: i64) -> Result<store::ConversationStatus> {
    store::conversation_status_by_id(&s.admin.pool, id)
        .await
        .map_err(|e| {
            if matches!(e, sqlx::Error::RowNotFound) {
                fail(StatusCode::NOT_FOUND, "No such topic")
            } else {
                io(e)
            }
        })
}
async fn activity(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    status(&s, id).await?;
    Ok(Json(
        json!({"in_progress": s.live.as_ref().is_some_and(|l| l.turns.in_progress(id))}),
    ))
}
#[derive(Deserialize)]
struct ModeBody {
    mode: String,
}
async fn mode(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Json(b): Json<ModeBody>,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    status(&s, id).await?;
    let mode = Mode::parse(&b.mode).ok_or_else(|| {
        fail(
            StatusCode::BAD_REQUEST,
            "Choose fast, auto, expert or heavy",
        )
    })?;
    store::set_mode(&s.admin.pool, id, mode).await.map_err(io)?;
    Ok(Json(json!({"mode":mode.as_str()})))
}
async fn send(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(id): Path<i64>,
    mut form: Multipart,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let l = live(&s)?;
    let st = status(&s, id).await?;
    if !st.enabled || l.rules.home_chat_id != Some(st.tg_chat_id) {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "Topic is off or outside the home group",
        ));
    }
    let mut text = String::new();
    let mut style = None;
    let mut uploads = Vec::new();
    while let Some(field) = form
        .next_field()
        .await
        .map_err(|e| fail(StatusCode::BAD_REQUEST, e))?
    {
        match field.name().unwrap_or("") {
            "text" => text = field.text().await.map_err(io)?,
            "style" => {
                let value = field.text().await.map_err(io)?;
                style = match value.as_str() {
                    "auto" => Some(Style::Auto),
                    "" => None,
                    "fast" => Some(Style::Fast),
                    "think" => Some(Style::Think),
                    "heavy" => Some(Style::Heavy),
                    "deepsearch" => Some(Style::DeepSearch),
                    _ => return Err(fail(StatusCode::BAD_REQUEST, "Unknown message mode")),
                };
            }
            "files" => {
                let name = field
                    .file_name()
                    .unwrap_or("file")
                    .chars()
                    .map(|c| {
                        if c.is_alphanumeric() || "._-".contains(c) {
                            c
                        } else {
                            '_'
                        }
                    })
                    .take(120)
                    .collect::<String>();
                let bytes = field.bytes().await.map_err(io)?;
                if uploads.len() >= 10 || bytes.len() > 20 * 1024 * 1024 {
                    return Err(fail(
                        StatusCode::BAD_REQUEST,
                        "At most 10 files, each under 20 MB",
                    ));
                }
                uploads.push((name, bytes));
            }
            _ => return Err(fail(StatusCode::BAD_REQUEST, "Unknown form field")),
        }
    }
    if text.chars().count() > 3500 || (text.trim().is_empty() && uploads.is_empty()) {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Send text (up to 3,500 characters), files, or both",
        ));
    }
    // Scrubbing applies to the Telegram copy; the turn's trusted header is built by turns.rs.
    let shown = format!("🖥️ from the panel\n\n{}", crate::outgoing::scrub(&text));
    let message_id = l
        .api
        .send_text(st.tg_chat_id, st.tg_topic_id, None, &shown)
        .await
        .map_err(io)?;
    let folder = agents_md::relative_dir(st.tg_chat_id, st.tg_topic_id);
    let mut saved = Vec::new();
    for (i, (name, bytes)) in uploads.into_iter().enumerate() {
        let relative = folder
            .join("files")
            .join(format!("{message_id}-{i}-{name}"));
        let absolute = s.admin.agents_dir.join(&relative);
        tokio::fs::create_dir_all(absolute.parent().expect("file parent"))
            .await
            .map_err(io)?;
        tokio::fs::write(&absolute, &bytes).await.map_err(io)?;
        let mut file = OutFile::new(absolute);
        file.caption = Some("🖥️ from the panel".into());
        let file_message_id = l
            .api
            .send_file(st.tg_chat_id, st.tg_topic_id, Some(message_id), &file)
            .await
            .map_err(io)?;
        let mime = mime_guess::from_path(&file.path)
            .first_or_octet_stream()
            .to_string();
        let kind = match file.kind {
            crate::media::FileKind::Photo => crate::telegram::AttachmentKind::Photo,
            crate::media::FileKind::Video => crate::telegram::AttachmentKind::Video,
            crate::media::FileKind::Animation => crate::telegram::AttachmentKind::Animation,
            crate::media::FileKind::Audio | crate::media::FileKind::Voice => {
                crate::telegram::AttachmentKind::Audio
            }
            _ => crate::telegram::AttachmentKind::Document,
        };
        let attachment = crate::telegram::Attachment {
            kind,
            file_id: String::new(),
            file_name: Some(name.clone()),
            mime: Some(mime),
            size: Some(bytes.len() as u32),
            duration_secs: None,
            emoji: None,
        };
        let shown = format!("files/{message_id}-{i}-{name}");
        let note = crate::inbound_files::describe_saved(
            &l.transcriber,
            &file.path,
            &shown,
            file_message_id,
            &attachment,
        )
        .await
        .map_err(io)?;
        text.push_str(&format!("\n\n{note}"));
        saved.push(SavedFile {
            kind: file.kind.as_str().into(),
            path: relative.to_string_lossy().into(),
            name,
            mime: Some(
                mime_guess::from_path(&file.path)
                    .first_or_octet_stream()
                    .to_string(),
            ),
            size: bytes.len() as u64,
        });
    }
    let msg = InboundMessage {
        chat: ChatRef {
            tg_chat_id: st.tg_chat_id,
            kind: ChatKind::Supergroup,
            title: st.chat_title,
            is_forum: true,
        },
        topic_id: st.tg_topic_id,
        message_id,
        from_user_id: l.rules.admin_user_id,
        from_name: "Ashrith".into(),
        from_is_bot: false,
        text,
        voice: None,
        attachment: None,
        files: saved,
        reply_to_message_id: None,
        sent_at: Utc::now(),
        command: None,
    };
    let ctx = poller::Ctx {
        pool: &s.admin.pool,
        api: &*l.api,
        transcriber: &l.transcriber,
        rules: l.rules,
        bot_username: &l.username,
        agents_dir: &s.admin.agents_dir,
        agent_label: &s.admin.agent_label,
        turns: &*l.turns,
        projects: &*s.admin.projects,
    };
    if let Err(e) = poller::store_and_continue(&ctx, &msg, style).await {
        let eid = crate::errors::record(
            &s.admin.pool,
            "panel.send",
            &e.to_string(),
            json!({"conversation_id":id}),
        )
        .await
        .map_err(io)?;
        let reason = format!("❌ Failed ({eid}): panel message failed. Check logs.");
        let _ = l
            .api
            .send_text(msg.chat.tg_chat_id, msg.topic_id, Some(message_id), &reason)
            .await;
        return Err(fail(StatusCode::BAD_GATEWAY, reason));
    }
    Ok(Json(json!({"message_id":message_id})))
}
#[derive(Deserialize)]
struct NewTopic {
    name: String,
    purpose: String,
}
async fn new_topic(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Json(b): Json<NewTopic>,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let l = live(&s)?;
    let home = l
        .rules
        .home_chat_id
        .ok_or_else(|| fail(StatusCode::BAD_REQUEST, "Set HERBOT_HOME_CHAT_ID first"))?;
    let name = b.name.trim();
    if name.is_empty() || name.chars().count() > 128 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Name must be 1–128 characters",
        ));
    }
    let purpose =
        crate::setup::validate_purpose(&b.purpose).map_err(|e| fail(StatusCode::BAD_REQUEST, e))?;
    let chat_row: i64 = sqlx::query_scalar(
        "SELECT id FROM chats WHERE tg_chat_id=$1 AND is_forum AND status='active'",
    )
    .bind(home)
    .fetch_one(&s.admin.pool)
    .await
    .map_err(io)?;
    let topic=l.api.0.create_forum_topic(ChatId(home),name).await.map_err(|e|fail(StatusCode::BAD_GATEWAY,format!("Could not create topic. Herbot needs administrator permission to manage topics: {e}")))?;
    let id = store::upsert_conversation(&s.admin.pool, chat_row, Some(topic.thread_id.0.0), name)
        .await
        .map_err(io)?;
    let path = agents_md::write(
        &s.admin.agents_dir,
        home,
        Some(topic.thread_id.0.0),
        name,
        &purpose,
        Utc::now(),
    )
    .await
    .map_err(io)?;
    store::set_purpose(&s.admin.pool, id, &purpose, &path.to_string_lossy())
        .await
        .map_err(io)?;
    Ok(Json(json!({"id":id})))
}
// Only workspace files are downloadable; configs, caller tokens and AGENTS.md aren't.
async fn safe_path(root: &FsPath, path: &str) -> Result<PathBuf> {
    let p = FsPath::new(path);
    if p.is_absolute()
        || !p
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
        || !p.components().any(|c| c.as_os_str() == "files")
    {
        return Err(fail(StatusCode::FORBIDDEN, "Invalid file path"));
    }
    let root = tokio::fs::canonicalize(root).await.map_err(io)?;
    let path = tokio::fs::canonicalize(root.join(p))
        .await
        .map_err(|_| fail(StatusCode::NOT_FOUND, "File not found"))?;
    if !path.starts_with(&root) {
        return Err(fail(StatusCode::FORBIDDEN, "File leaves workspace"));
    }
    Ok(path)
}
async fn file(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(path): Path<String>,
    request: axum::extract::Request,
) -> Result<Response> {
    auth(&s, &h)?;
    let path = safe_path(&s.admin.agents_dir, &path).await?;
    let mut service = ServeFile::new(&path);
    let mut response = service.try_call(request).await.map_err(io)?.into_response();
    response.headers_mut().insert(
        "cache-control",
        "private, max-age=60".parse().expect("header"),
    );
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().expect("header"));
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let inline = matches!(mime.type_().as_str(), "image" | "video" | "audio")
        && mime.subtype().as_str() != "svg+xml";
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .replace(['"', '\r', '\n', '\\'], "_");
    response.headers_mut().insert(
        "content-disposition",
        format!(
            "{}; filename=\"{}\"",
            if inline { "inline" } else { "attachment" },
            name
        )
        .parse()
        .map_err(io)?,
    );
    response.headers_mut().insert(
        "content-security-policy",
        "sandbox; default-src 'none'".parse().expect("header"),
    );
    Ok(response)
}
async fn files(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let st = status(&s, id).await?;
    let folder = agents_md::relative_dir(st.tg_chat_id, st.tg_topic_id).join("files");
    let mut queue = vec![folder];
    let mut found = Vec::new();
    while let Some(dir) = queue.pop() {
        let mut entries = match tokio::fs::read_dir(s.admin.agents_dir.join(&dir)).await {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(io(e)),
        };
        while let Some(entry) = entries.next_entry().await.map_err(io)? {
            let ty = entry.file_type().await.map_err(io)?;
            if ty.is_symlink() {
                continue;
            }
            let relative = dir.join(entry.file_name());
            if ty.is_dir() {
                queue.push(relative);
            } else if ty.is_file() {
                let path = relative.to_string_lossy().to_string();
                safe_path(&s.admin.agents_dir, &path).await?;
                found.push(SavedFile {
                    kind: crate::media::FileKind::for_path(&relative).as_str().into(),
                    path,
                    name: entry.file_name().to_string_lossy().into(),
                    mime: Some(
                        mime_guess::from_path(&relative)
                            .first_or_octet_stream()
                            .to_string(),
                    ),
                    size: entry.metadata().await.map_err(io)?.len(),
                });
            }
        }
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Json(json!(found)))
}
#[derive(Deserialize)]
struct Search {
    q: String,
    before: Option<i64>,
}
async fn search(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Query(q): Query<Search>,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    if q.q.len() > 500 {
        return Err(fail(StatusCode::BAD_REQUEST, "Search is too long"));
    }
    let rows:Vec<(i64,i64,String,String)>=sqlx::query_as("SELECT m.id,m.conversation_id,c.name,ts_headline('simple',m.body,websearch_to_tsquery('simple',$1),'StartSel=⟦, StopSel=⟧, MaxWords=40, MinWords=15') FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.search @@ websearch_to_tsquery('simple',$1) AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 30").bind(q.q.trim()).bind(q.before).fetch_all(&s.admin.pool).await.map_err(io)?;
    Ok(Json(json!(rows.into_iter().map(|(id,conversation_id,name,snippet)|json!({"id":id,"conversation_id":conversation_id,"name":name,"snippet":snippet})).collect::<Vec<_>>())))
}
async fn connectors(State(s): State<Arc<Panel>>, h: HeaderMap) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let mut found = Vec::new();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| io("HOME missing"))?;
    for (source, path) in [
        ("Codex", home.join(".codex/config.toml")),
        ("Herbot", s.admin.agents_dir.join(".codex/config.toml")),
    ] {
        let text = match tokio::fs::read_to_string(path).await {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(io(e)),
        };
        let config: toml::Value =
            toml::from_str(&text).map_err(|_| io("Could not parse MCP configuration"))?;
        if let Some(servers) = config.get("mcp_servers").and_then(|v| v.as_table()) {
            for (name, value) in servers {
                let command = value
                    .get("command")
                    .and_then(|v| v.as_str())
                    .and_then(|c| FsPath::new(c).file_name())
                    .map(|c| c.to_string_lossy().to_string());
                let url = value
                    .get("url")
                    .and_then(|v| v.as_str())
                    .and_then(|u| reqwest::Url::parse(u).ok())
                    .filter(|u| matches!(u.scheme(), "http" | "https"))
                    .map(|mut u| {
                        let _ = u.set_username("");
                        let _ = u.set_password(None);
                        u.set_query(None);
                        u.set_fragment(None);
                        u.set_path("");
                        u.to_string()
                    });
                found.push(json!({"name":name,"source":source,"command":command,"url":url}));
            }
        }
    }
    Ok(Json(
        json!({"servers":found,"tools":["list_topics","search_messages","read_topic","ask_topic (General only)","post_to_topic (General only)"]}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn file_paths_reject_traversal_absolute_paths_and_symlink_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let folder = root.path().join("topic/files");
        tokio::fs::create_dir_all(&folder).await.unwrap();
        tokio::fs::write(folder.join("notes.txt"), "notes")
            .await
            .unwrap();
        tokio::fs::write(outside.path().join("secret.txt"), "private")
            .await
            .unwrap();
        assert!(
            safe_path(root.path(), "topic/files/notes.txt")
                .await
                .is_ok()
        );
        for path in [
            "../secret.txt",
            "/etc/passwd",
            "topic/AGENTS.md",
            "topic/files/../../secret.txt",
        ] {
            assert!(safe_path(root.path(), path).await.is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("secret.txt"),
                folder.join("escape.txt"),
            )
            .unwrap();
            assert!(
                safe_path(root.path(), "topic/files/escape.txt")
                    .await
                    .is_err()
            );
        }
    }
}
