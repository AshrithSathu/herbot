//! herbot-core's internal API, used only by herbot-mcp for General's action
//! tools. Bound with the rest of the HTTP server (localhost) and protected by
//! `HERBOT_INTERNAL_TOKEN`.
//!
//! - `POST /internal/post` `{caller, topic, text}`: post into a topic
//! - `POST /internal/ask` `{caller, topic, message}`: ask a topic's agent and
//!   wait for its answer

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::errors;
use crate::hub::{self, HubError};
use crate::outgoing;
use crate::poller::TelegramApi;
use crate::store;
use crate::turns::{ReplySlot, TurnJob, TurnQueue};

pub struct InternalState<A: TelegramApi> {
    pub pool: PgPool,
    pub api: Arc<A>,
    pub turns: Arc<dyn TurnQueue>,
    /// Shared secret with herbot-mcp.
    pub token: String,
    pub bot_user_id: u64,
    pub admin_user_id: u64,
    /// How long `ask` waits for the other agent (a bit over the turn timeout).
    pub ask_timeout: Duration,
}

pub fn router<A: TelegramApi + 'static>(state: Arc<InternalState<A>>) -> Router {
    Router::new()
        .route("/internal/post", post(post_to_topic::<A>))
        .route("/internal/ask", post(ask_topic::<A>))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
pub struct PostRequest {
    pub caller: String,
    pub topic: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct AskRequest {
    pub caller: String,
    pub topic: String,
    pub message: String,
}

type Reply = (StatusCode, Json<Value>);

fn fail(status: StatusCode, message: impl Into<String>) -> Reply {
    (status, Json(json!({ "error": message.into() })))
}

fn hub_fail(err: HubError) -> Reply {
    let status = match &err {
        HubError::UnknownCaller => StatusCode::UNAUTHORIZED,
        HubError::Forbidden(_) => StatusCode::FORBIDDEN,
        HubError::NotFound(_) => StatusCode::NOT_FOUND,
        HubError::BadRequest(_) => StatusCode::BAD_REQUEST,
        HubError::Personal(_) => StatusCode::BAD_REQUEST,
        HubError::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    fail(status, err.to_string())
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(given) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    // Constant-time compare.
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

/// Posts `text` into the target topic as the bot (scrubbed and split).
async fn post_to_topic<A: TelegramApi + 'static>(
    State(state): State<Arc<InternalState<A>>>,
    headers: HeaderMap,
    Json(req): Json<PostRequest>,
) -> Reply {
    if !authorized(&headers, &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "bad internal token");
    }
    if req.text.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "nothing to post");
    }
    let target = match target(&state.pool, &req.caller, &req.topic).await {
        Ok(t) => t,
        Err(reply) => return reply,
    };
    let text = format!("📨 From General:\n\n{}", outgoing::scrub(req.text.trim()));
    let mut posted = 0;
    for part in outgoing::split(&text, outgoing::MAX_MESSAGE_CHARS) {
        match say(&state, &target, None, &part).await {
            Ok(_) => posted += 1,
            Err(reply) => return reply,
        }
    }
    tracing::info!(
        conversation_id = target.conversation_id,
        posted,
        "General posted to a topic"
    );
    (
        StatusCode::OK,
        Json(json!({ "posted_messages": posted, "topic": target.place })),
    )
}

/// Shows General's question in the target topic, runs that topic's agent on
/// it, and returns the agent's answer.
async fn ask_topic<A: TelegramApi + 'static>(
    State(state): State<Arc<InternalState<A>>>,
    headers: HeaderMap,
    Json(req): Json<AskRequest>,
) -> Reply {
    if !authorized(&headers, &state.token) {
        return fail(StatusCode::UNAUTHORIZED, "bad internal token");
    }
    let message = req.message.trim();
    if message.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "nothing to ask");
    }
    let target = match target(&state.pool, &req.caller, &req.topic).await {
        Ok(t) => t,
        Err(reply) => return reply,
    };

    // Only a set-up, switched-on topic has an agent to ask; anything else
    // would skip its purpose setup or wake a disabled topic.
    if let Err(why) = &target.askable {
        return fail(StatusCode::CONFLICT, why.clone());
    }

    let shown = format!("📨 General asks:\n\n{}", outgoing::scrub(message));
    let asked_in = match say(&state, &target, None, &shown).await {
        Ok(id) => id,
        Err(reply) => return reply,
    };
    let (slot, answer) = ReplySlot::new();
    state.turns.submit(TurnJob {
        conversation_id: target.conversation_id,
        tg_chat_id: target.tg_chat_id,
        topic_id: target.topic_id,
        reply_to: asked_in,
        text: message.to_string(),
        is_voice: false,
        sender_name: "General (asking for Ashrith)".into(),
        sender_id: state.admin_user_id,
        sent_at: Utc::now(),
        reply: Some(slot),
        style: None,
        album: None,
    });
    tracing::info!(
        conversation_id = target.conversation_id,
        "General asked a topic"
    );

    match tokio::time::timeout(state.ask_timeout, answer).await {
        Ok(Ok(Ok(reply))) => (
            StatusCode::OK,
            Json(json!({ "topic": target.place, "reply": reply })),
        ),
        Ok(Ok(Err(failure))) => fail(
            StatusCode::BAD_GATEWAY,
            format!("{} failed: {failure}", target.place),
        ),
        Ok(Err(_)) => fail(StatusCode::BAD_GATEWAY, "the turn ended without an answer"),
        Err(_) => fail(
            StatusCode::GATEWAY_TIMEOUT,
            format!(
                "{} is still working; its answer will show up in that topic",
                target.place
            ),
        ),
    }
}

struct Target {
    conversation_id: i64,
    tg_chat_id: i64,
    topic_id: Option<i32>,
    place: String,
    /// Switched on and set up (has a purpose), so its agent can be asked.
    askable: Result<(), String>,
}

async fn target(pool: &PgPool, caller: &str, topic: &str) -> Result<Target, Reply> {
    let caller = hub::resolve_caller(pool, caller).await.map_err(hub_fail)?;
    let conversation_id = hub::action_target(pool, &caller, topic)
        .await
        .map_err(hub_fail)?;
    let status = store::conversation_status_by_id(pool, conversation_id)
        .await
        .map_err(|e| hub_fail(e.into()))?;
    let place = status.place();
    let askable = if !status.enabled {
        Err(format!("{place} is switched off in the admin panel"))
    } else if status.setup_state != store::SetupState::Ready {
        Err(format!(
            "{place} isn't set up yet (it has no purpose); Ashrith sets it up by messaging that topic first"
        ))
    } else {
        Ok(())
    };
    Ok(Target {
        conversation_id,
        tg_chat_id: status.tg_chat_id,
        topic_id: status.tg_topic_id,
        place,
        askable,
    })
}

/// Sends one message into the target and stores it as the bot's.
async fn say<A: TelegramApi>(
    state: &InternalState<A>,
    target: &Target,
    reply_to: Option<i32>,
    text: &str,
) -> Result<i32, Reply> {
    let id = match state
        .api
        .send_text(target.tg_chat_id, target.topic_id, reply_to, text)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            return Err(failed(
                state,
                target,
                "internal.send",
                &format!("couldn't send to {}: {e}", target.place),
            )
            .await);
        }
    };
    if let Err(e) = store::store_bot_message(
        &state.pool,
        target.conversation_id,
        id,
        state.bot_user_id,
        text,
    )
    .await
    {
        return Err(failed(
            state,
            target,
            "internal.store",
            &format!("sent to {} but couldn't save it: {e}", target.place),
        )
        .await);
    }
    Ok(id)
}

/// Fail loud: records the failure, logs it with its E-id, and returns the
/// reason with that id so General's agent can tell Ashrith.
async fn failed<A: TelegramApi>(
    state: &InternalState<A>,
    target: &Target,
    kind: &str,
    reason: &str,
) -> Reply {
    let context = json!({ "conversation_id": target.conversation_id });
    match errors::record(&state.pool, kind, reason, context).await {
        Ok(id) => {
            tracing::error!(error_id = %id, reason, "General's action failed");
            fail(StatusCode::BAD_GATEWAY, format!("Failed ({id}): {reason}"))
        }
        Err(db) => {
            tracing::error!(reason, %db, "General's action failed and couldn't be recorded");
            fail(StatusCode::BAD_GATEWAY, reason.to_string())
        }
    }
}
