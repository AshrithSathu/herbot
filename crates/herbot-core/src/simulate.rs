//! Simulated admin messages, for running Herbot end to end while Ashrith is
//! away from Telegram. Off unless `HERBOT_SIMULATE=1`, and protected by
//! `HERBOT_INTERNAL_TOKEN` like the rest of `/internal`.
//!
//! `POST /internal/simulate` `{topic_id?, text?, file?, kind?}`:
//! 1. Herbot posts the message into the real topic as itself, marked
//!    "🧪 simulated" (uploading the file, if any), so there's a real message
//!    to reply to and a real Telegram file to download;
//! 2. it builds the update Telegram would have sent if Ashrith had written
//!    it (his id, the home group, that message and file), and
//! 3. hands it to the poller, which treats it exactly like a real one
//!    (policy, inbox, lanes, setup, agent, reply).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use teloxide::types::Update;
use tokio::sync::mpsc;

use crate::media::{FileKind, OutFile};
use crate::poller::{BotApi, TelegramApi};

pub struct SimulateState {
    pub api: Arc<BotApi>,
    pub inject: mpsc::UnboundedSender<Update>,
    pub token: String,
    pub admin_user_id: u64,
    pub admin_name: String,
    pub home_chat_id: i64,
    pub home_title: String,
    /// Update ids for simulated updates, far above Telegram's.
    pub next_update_id: AtomicU32,
}

pub fn router(state: Arc<SimulateState>) -> Router {
    Router::new()
        .route("/internal/simulate", post(simulate))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
pub struct SimulateRequest {
    /// Forum topic id; omit for General.
    pub topic_id: Option<i32>,
    /// The message text, a command like `/mode`, or a file's caption.
    #[serde(default)]
    pub text: String,
    /// A file on this machine to send with it.
    pub file: Option<PathBuf>,
    /// photo, document, video, audio or voice (default: from the extension).
    pub kind: Option<String>,
    /// Edit an earlier (simulated) message of Ashrith's to `text`.
    pub edit_of: Option<i32>,
    /// React to a bot message with this emoji (e.g. 👎), on `message_id`.
    pub reaction: Option<String>,
    pub message_id: Option<i32>,
}

type Reply = (StatusCode, Json<Value>);

fn fail(status: StatusCode, message: impl Into<String>) -> Reply {
    (status, Json(json!({ "error": message.into() })))
}

async fn simulate(
    State(state): State<Arc<SimulateState>>,
    headers: HeaderMap,
    Json(req): Json<SimulateRequest>,
) -> Reply {
    let authorized = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|given| given == state.token);
    if !authorized {
        return fail(StatusCode::UNAUTHORIZED, "bad internal token");
    }
    if let Some(update) = edit_or_reaction(&state, &req) {
        return match update {
            Ok(update) => {
                let id = update.id.0;
                if state.inject.send(update).is_err() {
                    return fail(StatusCode::SERVICE_UNAVAILABLE, "the poller isn't running");
                }
                tracing::info!(update_id = id, "simulated an edit or reaction");
                (StatusCode::OK, Json(json!({ "update_id": id })))
            }
            Err(e) => fail(StatusCode::BAD_REQUEST, e),
        };
    }
    if req.text.trim().is_empty() && req.file.is_none() {
        return fail(StatusCode::BAD_REQUEST, "send text, a file, or both");
    }

    // 1. A real message in the topic (and a real file id).
    let shown = format!("🧪 simulated · {}: {}", state.admin_name, req.text);
    let (message_id, file) = match &req.file {
        None => match state
            .api
            .send_text(state.home_chat_id, req.topic_id, None, &shown)
            .await
        {
            Ok(id) => (id, None),
            Err(e) => return fail(StatusCode::BAD_GATEWAY, e.to_string()),
        },
        Some(path) => {
            let mut out = OutFile::new(path.clone());
            out.caption = Some(shown.chars().take(1000).collect());
            if let Some(kind) = req.kind.as_deref() {
                out.kind = match kind {
                    "photo" => FileKind::Photo,
                    "video" => FileKind::Video,
                    "audio" => FileKind::Audio,
                    "voice" => FileKind::Voice,
                    _ => FileKind::Document,
                };
            }
            match state
                .api
                .upload(state.home_chat_id, req.topic_id, &out)
                .await
            {
                Ok((id, file_id, size)) => (id, Some((out.kind, file_id, size, path.clone()))),
                Err(e) => return fail(StatusCode::BAD_GATEWAY, e.to_string()),
            }
        }
    };

    // 2. The update Telegram would have sent.
    let update_id = state.next_update_id.fetch_add(1, Ordering::Relaxed);
    let mut message = json!({
        "message_id": message_id,
        "from": { "id": state.admin_user_id, "is_bot": false, "first_name": state.admin_name },
        "chat": { "id": state.home_chat_id, "type": "supergroup", "title": state.home_title, "is_forum": true },
        "date": Utc::now().timestamp(),
    });
    if let Some(topic) = req.topic_id {
        message["message_thread_id"] = json!(topic);
        message["is_topic_message"] = json!(true);
    }
    match &file {
        None => message["text"] = json!(req.text),
        Some((kind, file_id, size, path)) => {
            if !req.text.is_empty() {
                message["caption"] = json!(req.text);
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".into());
            let mime = crate::outbound_files::mime_of(path).unwrap_or("application/octet-stream");
            let base = json!({ "file_id": file_id, "file_unique_id": format!("sim{update_id}"), "file_size": size });
            let with = |extra: Value| {
                let mut v = base.clone();
                for (k, val) in extra.as_object().expect("object") {
                    v[k] = val.clone();
                }
                v
            };
            match kind {
                FileKind::Sticker => {
                    message["sticker"] = with(
                        json!({ "width": 512, "height": 512, "type": "regular", "is_animated": false, "is_video": false }),
                    );
                }
                FileKind::Photo => {
                    message["photo"] = json!([with(json!({ "width": 1280, "height": 1280 }))])
                }
                FileKind::Video => {
                    message["video"] = with(
                        json!({ "width": 1280, "height": 720, "duration": 0, "file_name": name, "mime_type": mime }),
                    )
                }
                FileKind::Audio => {
                    message["audio"] =
                        with(json!({ "duration": 0, "file_name": name, "mime_type": mime }))
                }
                FileKind::Voice => {
                    message["voice"] = with(json!({ "duration": 5, "mime_type": "audio/ogg" }))
                }
                FileKind::Animation | FileKind::Document => {
                    message["document"] = with(json!({ "file_name": name, "mime_type": mime }))
                }
            }
        }
    }
    let raw = json!({ "update_id": update_id, "message": message });
    // teloxide's Update parses only from text, not from a JSON value.
    let update: Update = match serde_json::from_str(&raw.to_string()) {
        Ok(u) => u,
        Err(e) => {
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("built an update Telegram's types don't accept: {e}"),
            );
        }
    };

    // 3. Into the poller, like any real update.
    if state.inject.send(update).is_err() {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "the poller isn't running");
    }
    tracing::info!(update_id, message_id, topic = ?req.topic_id, "simulated an admin message");
    (
        StatusCode::OK,
        Json(json!({ "update_id": update_id, "message_id": message_id })),
    )
}

/// An `edited_message` or `message_reaction` update from Ashrith, when the
/// request asks for one.
fn edit_or_reaction(
    state: &SimulateState,
    req: &SimulateRequest,
) -> Option<Result<Update, String>> {
    let update_id = state.next_update_id.fetch_add(1, Ordering::Relaxed);
    let from =
        json!({ "id": state.admin_user_id, "is_bot": false, "first_name": state.admin_name });
    let chat = json!({ "id": state.home_chat_id, "type": "supergroup", "title": state.home_title, "is_forum": true });
    let now = Utc::now().timestamp();
    let raw = if let Some(id) = req.edit_of {
        let mut message = json!({
            "message_id": id, "from": from, "chat": chat, "date": now - 60,
            "edit_date": now, "text": req.text,
        });
        if let Some(topic) = req.topic_id {
            message["message_thread_id"] = json!(topic);
            message["is_topic_message"] = json!(true);
        }
        json!({ "update_id": update_id, "edited_message": message })
    } else if let Some(emoji) = &req.reaction {
        let Some(id) = req.message_id else {
            return Some(Err("a reaction needs message_id".into()));
        };
        json!({ "update_id": update_id, "message_reaction": {
            "chat": chat, "message_id": id, "user": from, "date": now,
            "old_reaction": [], "new_reaction": [{ "type": "emoji", "emoji": emoji }],
        }})
    } else {
        return None;
    };
    // teloxide's Update parses only from text, not from a JSON value.
    Some(serde_json::from_str(&raw.to_string()).map_err(|e| e.to_string()))
}
