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
use serde::{Deserialize, Serialize};
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
    pub bot_user_id: u64,
    pub transcriber: Arc<crate::voice::AnyTranscriber>,
    pub speaker: Arc<dyn crate::speech::Speaker>,
}
struct Panel {
    admin: Arc<AdminState>,
    live: Option<Live>,
    processing: std::sync::Mutex<std::collections::HashMap<i64, Arc<tokio::sync::Mutex<()>>>>,
    replies: std::sync::Mutex<std::collections::HashMap<i32, crate::turns::ReplySlot>>,
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
    let state = Arc::new(Panel {
        admin,
        live,
        processing: Default::default(),
        replies: Default::default(),
    });
    if state.live.is_some() {
        let resume = state.clone();
        tokio::spawn(async move {
            match sqlx::query_scalar::<_, i64>("SELECT DISTINCT conversation_id FROM panel_inbox")
                .fetch_all(&resume.admin.pool)
                .await
            {
                Ok(ids) => {
                    for id in ids {
                        let s = resume.clone();
                        tokio::spawn(async move {
                            drain_inbox(s, id).await;
                        });
                    }
                }
                Err(e) => inbox_failure(&resume, None, &e.to_string()).await,
            }
        });
    }
    Router::new()
        .route("/admin/api/conversations/{id}/messages", post(send))
        .route("/admin/api/conversations/{id}/activity", get(activity))
        .route("/admin/api/activity", get(all_activity))
        .route("/admin/api/conversations/{id}/mode", put(mode))
        .route("/admin/api/conversations/{id}/files", get(files))
        .route("/admin/api/files/{*path}", get(file))
        .route("/admin/api/topics", post(new_topic))
        .route("/admin/api/search", get(search))
        .route("/admin/api/connectors", get(connectors))
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            idempotent,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            record_failure,
        ))
        .with_state(state)
}
async fn idempotent(
    State(s): State<Arc<Panel>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path().to_owned();
    if request.method() != axum::http::Method::POST
        || !(path == "/admin/api/topics" || path.ends_with("/messages"))
        || !admin::authorized(request.headers(), &s.admin.token)
        || s.live.is_none()
    {
        return next.run(request).await;
    }
    idempotent_write(State(s), request, next).await
}
async fn idempotent_write(
    State(s): State<Arc<Panel>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = request.uri().path().to_owned();
    let Some(key) = request
        .headers()
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty() && v.len() <= 128)
        .map(str::to_owned)
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "Supply an Idempotency-Key for this action",
        )
        .into_response();
    };
    match sqlx::query("INSERT INTO panel_requests(key,scope) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(&key)
        .bind(&path)
        .execute(&s.admin.pool)
        .await
    {
        Ok(result) if result.rows_affected() == 0 => {
            return match sqlx::query_as::<_, (String, Option<i32>, Option<Value>)>("SELECT scope,status,response FROM panel_requests WHERE key=$1")
                .bind(&key).fetch_one(&s.admin.pool).await {
                Ok((scope, Some(code), Some(body))) if scope == path =>
                    (StatusCode::from_u16(code as u16).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(body)).into_response(),
                Ok(_) => fail(StatusCode::CONFLICT, "Action already pending or key used elsewhere. Check the topic before starting a new action.").into_response(),
                Err(e) => io(e).into_response(),
            };
        }
        Ok(_) => {}
        Err(e) => return io(e).into_response(),
    }
    let response = next.run(request).await;
    let status = response.status();
    let body = match axum::body::to_bytes(response.into_body(), 1024 * 1024).await {
        Ok(body) => body,
        Err(e) => return io(e).into_response(),
    };
    let value: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(e) => return io(e).into_response(),
    };
    if let Err(e) = sqlx::query("UPDATE panel_requests SET status=$2,response=$3 WHERE key=$1")
        .bind(key)
        .bind(i32::from(status.as_u16()))
        .bind(&value)
        .execute(&s.admin.pool)
        .await
    {
        return io(e).into_response();
    }
    (status, Json(value)).into_response()
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
    let bytes = match axum::body::to_bytes(response.into_body(), 64 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::error!(error = %e, "could not read panel failure response");
            axum::body::Bytes::new()
        }
    };
    let message = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "Panel operation failed; check logs".into());
    let error_id = match crate::errors::record(
        &s.admin.pool,
        "panel.request",
        &message,
        json!({"path":path,"status":code.as_u16()}),
    )
    .await
    {
        Ok(id) => id.to_string(),
        Err(e) => {
            tracing::error!(error = %e, "could not record panel failure");
            return fail(code, message).into_response();
        }
    };
    tracing::error!(%error_id,%path,%message,"panel operation failed");
    if let Some(id) = path
        .strip_prefix("/admin/api/conversations/")
        .and_then(|p| p.strip_suffix("/messages"))
        .and_then(|p| p.parse::<i64>().ok())
        && let Some(l) = &s.live
        && let Ok(st) = store::conversation_status_by_id(&s.admin.pool, id).await
        && l.rules.home_chat_id == Some(st.tg_chat_id)
    {
        let text = format!("❌ Failed ({error_id}): panel message failed. Check logs.");
        if let Err(e) = l
            .api
            .send_text(st.tg_chat_id, st.tg_topic_id, None, &text)
            .await
        {
            tracing::error!(%error_id,error = %e,"could not notify Telegram about panel failure");
        }
    }

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
    let queued: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM panel_inbox WHERE conversation_id=$1)")
            .bind(id)
            .fetch_one(&s.admin.pool)
            .await
            .map_err(io)?;
    Ok(Json(
        json!({"in_progress":queued || s.live.as_ref().is_some_and(|l|l.turns.in_progress(id))}),
    ))
}
/// One database read for the whole list; use exactly the per-topic activity rule.
async fn all_activity(State(s): State<Arc<Panel>>, h: HeaderMap) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let rows: Vec<(i64, bool)> = sqlx::query_as(
        "SELECT c.id, EXISTS(SELECT 1 FROM panel_inbox p WHERE p.conversation_id=c.id)
         FROM conversations c ORDER BY c.id",
    )
    .fetch_all(&s.admin.pool)
    .await
    .map_err(io)?;
    Ok(Json(json!(active_conversations(rows, |id| {
        s.live.as_ref().is_some_and(|l| l.turns.in_progress(id))
    }))))
}

fn active_conversations(rows: Vec<(i64, bool)>, running: impl Fn(i64) -> bool) -> Vec<Value> {
    rows.into_iter()
        .filter(|(id, queued)| *queued || running(*id))
        .map(|(id, _)| json!({"conversation_id": id, "in_progress": true}))
        .collect()
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
#[derive(Deserialize)]
struct SendOptions {
    #[serde(default)]
    wait: bool,
}
async fn send(
    State(s): State<Arc<Panel>>,
    h: HeaderMap,
    Path(id): Path<i64>,
    Query(options): Query<SendOptions>,
    mut form: Multipart,
) -> Result<Json<Value>> {
    auth(&s, &h)?;
    let l = live(&s)?;
    let lock = processing_lock(&s, id);
    let processing = lock.lock().await;
    let wipe_guard = crate::wipe::lock(&s.admin.pool, id).await;
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
            crate::voice::iso_code(&st.language),
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
    sqlx::query("UPDATE conversations SET last_inbound_message_id=GREATEST(last_inbound_message_id,$2) WHERE id=$1")
        .bind(id).bind(message_id).execute(&s.admin.pool).await.map_err(io)?;
    let queued = QueuedMessage {
        text,
        files: saved,
        style: style.map(|s| s.as_str().to_string()),
        sent_at: Utc::now(),
    };
    sqlx::query(
        "INSERT INTO panel_inbox (conversation_id,tg_message_id,payload) VALUES ($1,$2,$3)",
    )
    .bind(id)
    .bind(message_id)
    .bind(serde_json::to_value(queued).map_err(io)?)
    .execute(&s.admin.pool)
    .await
    .map_err(io)?;
    let answer = if options.wait {
        let (slot, answer) = crate::turns::ReplySlot::new();
        s.replies
            .lock()
            .expect("panel replies")
            .insert(message_id, slot);
        Some(answer)
    } else {
        None
    };
    drop(wipe_guard);
    drop(processing);
    let pending = s.clone();
    tokio::spawn(async move {
        drain_inbox(pending, id).await;
    });
    if let Some(answer) = answer {
        let outcome = tokio::time::timeout(std::time::Duration::from_secs(180), answer).await;
        s.replies.lock().expect("panel replies").remove(&message_id);
        return match outcome {
            Ok(Ok(Ok(reply))) => Ok(Json(json!({"message_id":message_id,"reply":reply}))),
            Ok(Ok(Err(reason))) => Err(fail(StatusCode::BAD_GATEWAY, reason)),
            Ok(Err(_)) => Err(fail(
                StatusCode::CONFLICT,
                "No agent reply; check the topic setup before sending again",
            )),
            Err(_) => Err(fail(
                StatusCode::GATEWAY_TIMEOUT,
                "Reply timed out; the turn may still finish in Telegram. Do not resend automatically",
            )),
        };
    }
    Ok(Json(json!({"message_id":message_id})))
}

#[derive(Serialize, Deserialize)]
struct QueuedMessage {
    text: String,
    files: Vec<SavedFile>,
    style: Option<String>,
    sent_at: chrono::DateTime<Utc>,
}

fn processing_lock(s: &Panel, id: i64) -> Arc<tokio::sync::Mutex<()>> {
    s.processing
        .lock()
        .expect("panel lanes")
        .entry(id)
        .or_default()
        .clone()
}
async fn drain_inbox(s: Arc<Panel>, conversation_id: i64) {
    let lock = processing_lock(&s, conversation_id);
    let _guard = lock.lock().await;
    let Some(l) = &s.live else {
        return;
    };
    loop {
        let row: std::result::Result<Option<(i64, i64, i32, Value)>, _> = sqlx::query_as(
            "SELECT id,conversation_id,tg_message_id,payload FROM panel_inbox WHERE conversation_id=$1 ORDER BY id LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_optional(&s.admin.pool)
        .await;
        let (row_id, id, message_id, payload) = match row {
            Ok(Some(row)) => row,
            Ok(None) => return,
            Err(e) => {
                inbox_failure(&s, None, &e.to_string()).await;
                return;
            }
        };
        if let Err(e) = deliver_queued(&s, l, id, message_id, payload).await {
            inbox_failure(&s, Some((id, message_id)), &e).await;
        }
        // Failed turns are reported and consumed too: replay is for crashes, never an automatic retry.
        if let Err(e) = sqlx::query("DELETE FROM panel_inbox WHERE id=$1")
            .bind(row_id)
            .execute(&s.admin.pool)
            .await
        {
            inbox_failure(&s, None, &e.to_string()).await;
            return;
        }
    }
}

async fn inbox_failure(s: &Panel, target: Option<(i64, i32)>, reason: &str) {
    let error_id = match crate::errors::record(
        &s.admin.pool,
        "panel.inbox",
        reason,
        json!({"target":target}),
    )
    .await
    {
        Ok(id) => id.to_string(),
        Err(e) => {
            tracing::error!(error = %e, "could not record panel inbox failure");
            return;
        }
    };
    tracing::error!(%error_id,error=reason,"panel inbox failed");
    if let Some((id, message_id)) = target
        && let Some(l) = &s.live
        && let Ok(st) = store::conversation_status_by_id(&s.admin.pool, id).await
        && l.rules.home_chat_id == Some(st.tg_chat_id)
    {
        let text = format!("❌ Failed ({error_id}): panel message failed. Check logs.");
        match l
            .api
            .send_text(st.tg_chat_id, st.tg_topic_id, Some(message_id), &text)
            .await
        {
            Ok(sent) => {
                if let Err(e) =
                    store::store_bot_message(&s.admin.pool, id, sent, l.bot_user_id, &text).await
                {
                    tracing::error!(%error_id,error=%e,"could not store failure reply");
                }
            }
            Err(e) => tracing::error!(%error_id,error=%e,"could not send failure reply"),
        }
    }
}

async fn deliver_queued(
    s: &Panel,
    l: &Live,
    id: i64,
    message_id: i32,
    payload: Value,
) -> std::result::Result<(), String> {
    let queued: QueuedMessage = serde_json::from_value(payload).map_err(|e| e.to_string())?;
    let st = store::conversation_status_by_id(&s.admin.pool, id)
        .await
        .map_err(|e| e.to_string())?;
    if !st.enabled {
        return Ok(());
    }
    if l.rules.home_chat_id != Some(st.tg_chat_id) {
        return Err("Topic is outside the home group".into());
    }
    let style = match queued.style.as_deref() {
        None => None,
        Some("auto") => Some(Style::Auto),
        Some("fast") => Some(Style::Fast),
        Some("think") => Some(Style::Think),
        Some("heavy") => Some(Style::Heavy),
        Some("deepsearch") => Some(Style::DeepSearch),
        _ => return Err("Invalid queued message mode".into()),
    };
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
        text: queued.text,
        voice: None,
        attachment: None,
        files: queued.files,
        media_group_id: None,
        replied_bot_text: None,
        reply_to_message_id: None,
        sent_at: queued.sent_at,
        command: None,
    };
    let turns = WaitingTurns {
        inner: &*l.turns,
        reply: s.replies.lock().expect("panel replies").remove(&message_id),
    };
    let ctx = poller::Ctx {
        pool: &s.admin.pool,
        speaker: &*l.speaker,
        api: &*l.api,
        transcriber: &l.transcriber,
        rules: l.rules,
        bot_username: &l.username,
        agents_dir: &s.admin.agents_dir,
        agent_label: &s.admin.agent_label,
        turns: &turns,
        projects: &*s.admin.projects,
    };
    poller::store_and_continue(&ctx, &msg, style)
        .await
        .map_err(|e| e.to_string())
}

struct WaitingTurns<'a> {
    inner: &'a dyn TurnQueue,
    reply: Option<crate::turns::ReplySlot>,
}
impl TurnQueue for WaitingTurns<'_> {
    fn submit(&self, mut job: crate::turns::TurnJob) {
        job.reply = self.reply.clone();
        self.inner.submit(job);
    }
    fn in_progress(&self, id: i64) -> bool {
        self.inner.in_progress(id)
    }
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
    let mut files_root = root.clone();
    for component in p.components() {
        files_root.push(component.as_os_str());
        if component.as_os_str() == "files" {
            break;
        }
    }
    if !path.starts_with(&root) || !path.starts_with(&files_root) {
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
    let rows:Vec<(i64,i64,String,String,chrono::DateTime<Utc>,bool)>=sqlx::query_as("SELECT m.id,m.conversation_id,c.name,ts_headline('simple',m.body,websearch_to_tsquery('simple',$1),'StartSel=⟦, StopSel=⟧, MaxWords=40, MinWords=15'),m.sent_at,m.from_bot FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.search @@ websearch_to_tsquery('simple',$1) AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 30").bind(q.q.trim()).bind(q.before).fetch_all(&s.admin.pool).await.map_err(io)?;
    Ok(Json(json!(rows.into_iter().map(|(id,conversation_id,name,snippet,sent_at,from_bot)|json!({"id":id,"conversation_id":conversation_id,"name":name,"snippet":snippet,"sent_at":sent_at,"from_bot":from_bot})).collect::<Vec<_>>())))
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
        json!({"servers":found,"tools":crate::hub::TOOLS.iter().map(|(name, scope)| json!({"name":name,"scope":scope})).collect::<Vec<_>>()}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn waiting_turns_returns_the_submitted_turn_outcome() {
        struct ReplyQueue;
        impl TurnQueue for ReplyQueue {
            fn submit(&self, job: crate::turns::TurnJob) {
                job.reply.unwrap().deliver(Ok(job.text));
            }
        }
        let (slot, answer) = crate::turns::ReplySlot::new();
        let queue = WaitingTurns {
            inner: &ReplyQueue,
            reply: Some(slot),
        };
        queue.submit(crate::turns::TurnJob {
            conversation_id: 1,
            tg_chat_id: -1,
            topic_id: Some(2),
            reply_to: 3,
            text: "this turn only".into(),
            is_voice: false,
            sender_name: "Ashrith".into(),
            sender_id: 1,
            sent_at: Utc::now(),
            reply: None,
            style: None,
            album: None,
        });
        assert_eq!(answer.await.unwrap().unwrap(), "this turn only");
    }

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

#[cfg(test)]
mod hardening_tests {
    use super::*;
    use crate::agent::{AgentError, BoxFuture, ProjectCleaner};
    use tower::ServiceExt;
    struct Cleaner;
    impl ProjectCleaner for Cleaner {
        fn project_of_thread<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, std::result::Result<Option<String>, AgentError>> {
            Box::pin(async { Ok(None) })
        }
        fn threads_in_project<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, std::result::Result<Vec<String>, AgentError>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn remove_project<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, std::result::Result<(), AgentError>> {
            Box::pin(async { Ok(()) })
        }
    }
    fn state(pool: sqlx::PgPool) -> Arc<Panel> {
        Arc::new(Panel {
            admin: Arc::new(AdminState {
                pool,
                projects: Arc::new(Cleaner),
                agents_dir: PathBuf::new(),
                token: "test".into(),
                agent_label: "test".into(),
                bot_username: None,
            }),
            live: None,
            processing: Default::default(),
            replies: Default::default(),
        })
    }
    #[test]
    fn batch_activity_includes_running_and_queued_once() {
        assert_eq!(
            active_conversations(vec![(1, false), (2, true), (3, false), (4, true)], |id| id
                == 3
                || id == 4),
            vec![
                json!({"conversation_id":2,"in_progress":true}),
                json!({"conversation_id":3,"in_progress":true}),
                json!({"conversation_id":4,"in_progress":true})
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn batch_activity_matches_individual_activity_and_requires_auth(pool: sqlx::PgPool) {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        sqlx::raw_sql("INSERT INTO chats(tg_chat_id,kind) VALUES (-100,'supergroup');
            INSERT INTO conversations(chat_id,tg_topic_id) VALUES (1,NULL),(1,7);
            INSERT INTO panel_inbox(conversation_id,tg_message_id,payload) VALUES (2,1,'{}'),(2,2,'{}');")
            .execute(&pool).await.unwrap();
        let s = state(pool.clone());
        let app = router(s.admin.clone(), None);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/admin/api/activity")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer test".parse().unwrap());
        let Json(batch) = all_activity(State(s.clone()), headers.clone())
            .await
            .unwrap();
        assert_eq!(batch, json!([{"conversation_id":2,"in_progress":true}]));
        for id in [1, 2] {
            let Json(single) = activity(State(s.clone()), headers.clone(), Path(id))
                .await
                .unwrap();
            assert_eq!(single["in_progress"], id == 2);
        }
        sqlx::query("DELETE FROM panel_inbox")
            .execute(&pool)
            .await
            .unwrap();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/admin/api/activity")
                    .header("authorization", "Bearer test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), json!([]));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn topic_locks_preserve_order_without_blocking_other_topics(pool: sqlx::PgPool) {
        let s = state(pool);
        let first = processing_lock(&s, 1);
        let _guard = first.lock().await;
        let same = processing_lock(&s, 1);
        let other = processing_lock(&s, 2);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), same.lock())
                .await
                .is_err()
        );
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), other.lock())
                .await
                .is_ok()
        );
    }
    #[sqlx::test(migrations = "./migrations")]
    async fn retries_and_double_submits_have_one_effect(pool: sqlx::PgPool) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let s = state(pool.clone());
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let app = Router::new()
            .route(
                "/admin/api/topics",
                post(move || {
                    let counter = counter.clone();
                    async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        Json(json!({"id":42}))
                    }
                }),
            )
            .route(
                "/admin/api/conversations/1/messages",
                post(|| async { Json(json!({"message_id":7})) }),
            )
            .layer(axum::middleware::from_fn_with_state(s, idempotent_write));
        let request = |path: &str, key: &str| {
            axum::http::Request::builder()
                .method("POST")
                .uri(path)
                .header("idempotency-key", key)
                .body(axum::body::Body::empty())
                .unwrap()
        };
        let (a, b) = tokio::join!(
            app.clone().oneshot(request("/admin/api/topics", "one")),
            app.clone().oneshot(request("/admin/api/topics", "one"))
        );
        assert!(a.unwrap().status().is_success());
        assert!(matches!(
            b.unwrap().status(),
            StatusCode::OK | StatusCode::CONFLICT
        ));
        let replay = app
            .clone()
            .oneshot(request("/admin/api/topics", "one"))
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::OK);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            app.clone()
                .oneshot(request("/admin/api/conversations/1/messages", "one"))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        for _ in 0..2 {
            assert_eq!(
                app.clone()
                    .oneshot(request("/admin/api/conversations/1/messages", "send"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        // A crash leaves an uncertain action pending; retry cannot repeat it.
        sqlx::query("INSERT INTO panel_requests(key,scope) VALUES('crashed','/admin/api/topics')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            app.oneshot(request("/admin/api/topics", "crashed"))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
