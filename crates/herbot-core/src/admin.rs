//! The admin panel's API: JSON under `/admin/api`, protected by
//! `HERBOT_ADMIN_TOKEN` (the panel's server holds it; browsers never see it).
//!
//! - `GET    /admin/api/overview`
//! - `GET    /admin/api/conversations`                (purposes cut to 300 chars)
//! - `GET    /admin/api/conversations/{id}`           (detail, AGENTS.md)
//! - `GET    /admin/api/conversations/{id}/messages?before=&after=&limit=`
//! - `PUT    /admin/api/conversations/{id}/purpose`   `{purpose}`
//! - `PUT    /admin/api/conversations/{id}/enabled`   `{enabled}`
//! - `POST   /admin/api/conversations/{id}/wipe`      `{kind: "new" | "forget"}`
//! - `GET    /admin/api/errors?q=&before=&limit=`           (`q` can be an `E-1042` id)
//! - `GET    /admin/api/errors/{id}`

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::agent::ProjectCleaner;
use crate::agents_md;
use crate::errors::ErrorId;
use crate::setup;
use crate::store;
use crate::wipe::{self, WipeKind};

pub struct AdminState {
    pub pool: PgPool,
    pub projects: Arc<dyn ProjectCleaner>,
    /// Absolute root of the conversation folders.
    pub agents_dir: PathBuf,
    pub token: String,
    /// e.g. "gpt-6.1-terra · medium"
    pub agent_label: String,
    pub bot_username: Option<String>,
}

pub fn router(state: Arc<AdminState>) -> Router {
    Router::new()
        .route(
            "/admin/api/memories",
            get(list_memories).post(add_memory).delete(delete_memories),
        )
        .route(
            "/admin/api/memories/{id}",
            put(edit_memory).delete(delete_memory),
        )
        .route(
            "/admin/api/preferences",
            get(get_preferences).put(save_preferences),
        )
        .route("/admin/api/overview", get(overview))
        .route("/admin/api/conversations", get(conversations))
        .route("/admin/api/conversations/{id}", get(conversation))
        .route("/admin/api/conversations/{id}/messages", get(messages))
        .route("/admin/api/conversations/{id}/purpose", put(set_purpose))
        .route("/admin/api/conversations/{id}/enabled", put(set_enabled))
        .route(
            "/admin/api/conversations/{id}/wipe",
            post(wipe_conversation),
        )
        .route("/admin/api/errors", get(errors))
        .route("/admin/api/errors/{id}", get(error))
        .with_state(state)
}

type Reply = (StatusCode, Json<Value>);

fn ok<T: Serialize>(value: T) -> Reply {
    (StatusCode::OK, Json(json!(value)))
}

fn fail(status: StatusCode, message: impl Into<String>) -> Reply {
    (status, Json(json!({ "error": message.into() })))
}

fn db_fail(err: impl std::fmt::Display) -> Reply {
    tracing::error!(error = %err, "admin API database error");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "database error")
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(given) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

macro_rules! guard {
    ($headers:expr, $state:expr) => {
        if !authorized(&$headers, &$state.token) {
            return fail(StatusCode::UNAUTHORIZED, "bad admin token");
        }
    };
}

#[derive(Debug, Serialize)]
struct Overview {
    bot: Option<String>,
    agent: String,
    conversations: i64,
    enabled_conversations: i64,
    messages: i64,
    active_threads: i64,
    errors_last_24h: i64,
    /// Like a list row: no context, message capped.
    last_error: Option<ErrorSummary>,
}

async fn overview(State(state): State<Arc<AdminState>>, headers: HeaderMap) -> Reply {
    guard!(headers, state);
    let counts: Result<(i64, i64, i64, i64, i64), _> = sqlx::query_as(
        "SELECT (SELECT count(*) FROM conversations),
                (SELECT count(*) FROM conversations WHERE enabled),
                (SELECT coalesce(sum(message_count), 0)::bigint FROM conversations),
                (SELECT count(*) FROM agent_threads),
                (SELECT count(*) FROM errors WHERE created_at > now() - interval '24 hours')",
    )
    .fetch_one(&state.pool)
    .await;
    let counts = match counts {
        Ok(c) => c,
        Err(e) => return db_fail(e),
    };
    let last_error = match error_summaries(&state.pool, None, None, 1).await {
        Ok(mut rows) => rows.pop(),
        Err(e) => return db_fail(e),
    };
    ok(Overview {
        bot: state.bot_username.as_ref().map(|u| format!("@{u}")),
        agent: state.agent_label.clone(),
        conversations: counts.0,
        enabled_conversations: counts.1,
        messages: counts.2,
        active_threads: counts.3,
        errors_last_24h: counts.4,
        last_error,
    })
}

#[derive(Debug, Serialize)]
struct ConversationSummary {
    id: i64,
    place: String,
    is_general: bool,
    purpose: Option<String>,
    setup_state: &'static str,
    enabled: bool,
    messages: i64,
    last_activity: Option<DateTime<Utc>>,
    thread_link: Option<String>,
}

impl ConversationSummary {
    /// With the full purpose (detail and edits), or a short one (the list,
    /// which shows two lines and is polled).
    fn of(status: &store::ConversationStatus, purpose_chars: Option<usize>) -> Self {
        ConversationSummary {
            id: status.conversation_id,
            place: status.place(),
            is_general: status.tg_topic_id.is_none(),
            purpose: status.purpose.as_deref().map(|p| match purpose_chars {
                Some(n) => shorten(p, n),
                None => p.to_string(),
            }),
            setup_state: status.setup_state.as_str(),
            enabled: status.enabled,
            messages: status.message_count,
            last_activity: status.last_message_at,
            thread_link: status.thread_link.clone(),
        }
    }
}

/// How much of each purpose the list carries.
const LIST_PURPOSE_CHARS: usize = 300;

/// The first `limit` characters, with "…" if anything was cut.
fn shorten(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        None => text.to_string(),
        Some((cut, _)) => format!("{}…", text[..cut].trim_end()),
    }
}

async fn summary(
    pool: &PgPool,
    id: i64,
) -> Result<(ConversationSummary, store::ConversationStatus), sqlx::Error> {
    let status = store::conversation_status_by_id(pool, id).await?;
    Ok((ConversationSummary::of(&status, None), status))
}

async fn conversations(State(state): State<Arc<AdminState>>, headers: HeaderMap) -> Reply {
    guard!(headers, state);
    match store::listed_conversations(&state.pool).await {
        Ok(all) => ok(all
            .iter()
            .map(|s| ConversationSummary::of(s, Some(LIST_PURPOSE_CHARS)))
            .collect::<Vec<_>>()),
        Err(e) => db_fail(e),
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MessageRow {
    id: i64,
    sent_at: DateTime<Utc>,
    from_bot: bool,
    is_voice: bool,
    body: String,
}

async fn conversation(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Reply {
    guard!(headers, state);
    let (summary, status) = match summary(&state.pool, id).await {
        Ok(found) => found,
        Err(sqlx::Error::RowNotFound) => {
            return fail(StatusCode::NOT_FOUND, "no such conversation");
        }
        Err(e) => return db_fail(e),
    };
    let agents_md = match &status.agents_md_path {
        Some(path) => tokio::fs::read_to_string(state.agents_dir.join(path))
            .await
            .ok(),
        None => None,
    };
    ok(json!({
        "conversation": summary,
        "agents_md_path": status.agents_md_path,
        "agents_md": agents_md,
        "thread_id": status.thread_id,
    }))
}

#[derive(Debug, Deserialize)]
struct MessagesQuery {
    /// Older than this message id (to load earlier history).
    before: Option<i64>,
    /// Newer than this message id (to pick up what arrived since).
    after: Option<i64>,
    limit: Option<i64>,
}

/// One page of a conversation's messages, oldest first. Without `after`, the
/// newest `limit` (before `before`, if given); with `after`, the next `limit`
/// after it. `has_more` says whether another page exists in that direction.
async fn messages(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(query): Query<MessagesQuery>,
) -> Reply {
    guard!(headers, state);
    let limit = query.limit.unwrap_or(30).clamp(1, 100);
    match sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM conversations WHERE id = $1)")
        .bind(id)
        .fetch_one(&state.pool)
        .await
    {
        Ok(true) => {}
        Ok(false) => return fail(StatusCode::NOT_FOUND, "no such conversation"),
        Err(e) => return db_fail(e),
    }
    let rows: Result<Vec<MessageRow>, _> = match query.after {
        Some(after) => {
            sqlx::query_as(
                "SELECT id, sent_at, from_bot, is_voice, body FROM messages
                 WHERE conversation_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3",
            )
            .bind(id)
            .bind(after)
            .bind(limit + 1)
            .fetch_all(&state.pool)
            .await
        }
        None => {
            sqlx::query_as(
                "SELECT id, sent_at, from_bot, is_voice, body FROM messages
                 WHERE conversation_id = $1 AND ($2::bigint IS NULL OR id < $2)
                 ORDER BY id DESC LIMIT $3",
            )
            .bind(id)
            .bind(query.before)
            .bind(limit + 1)
            .fetch_all(&state.pool)
            .await
        }
    };
    let mut rows = match rows {
        Ok(rows) => rows,
        Err(e) => return db_fail(e),
    };
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    if query.after.is_none() {
        rows.reverse(); // fetched newest first; pages read oldest first
    }
    ok(json!({ "messages": rows, "has_more": has_more }))
}

#[derive(Debug, Deserialize)]
struct PurposeBody {
    purpose: String,
}

/// Same as `/setup` in Telegram: rewrites AGENTS.md and marks it changed,
/// so the topic's thread rereads it on its next turn.
async fn set_purpose(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<PurposeBody>,
) -> Reply {
    guard!(headers, state);
    let purpose = match setup::validate_purpose(&body.purpose) {
        Ok(p) => p,
        Err(problem) => return fail(StatusCode::BAD_REQUEST, problem.to_string()),
    };
    let status = match store::conversation_status_by_id(&state.pool, id).await {
        Ok(s) => s,
        Err(sqlx::Error::RowNotFound) => {
            return fail(StatusCode::NOT_FOUND, "no such conversation");
        }
        Err(e) => return db_fail(e),
    };
    let path = match agents_md::write(
        &state.agents_dir,
        status.tg_chat_id,
        status.tg_topic_id,
        &status.place(),
        &purpose,
        Utc::now(),
    )
    .await
    {
        Ok(path) => path,
        Err(e) => {
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("could not write AGENTS.md: {e}"),
            );
        }
    };
    if let Err(e) = store::set_purpose(&state.pool, id, &purpose, &path.to_string_lossy()).await {
        return db_fail(e);
    }
    tracing::info!(conversation_id = id, "purpose changed from the admin panel");
    match summary(&state.pool, id).await {
        Ok((s, _)) => ok(s),
        Err(e) => db_fail(e),
    }
}

#[derive(Debug, Deserialize)]
struct EnabledBody {
    enabled: bool,
}

async fn set_enabled(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<EnabledBody>,
) -> Reply {
    guard!(headers, state);
    let updated = sqlx::query("UPDATE conversations SET enabled = $2 WHERE id = $1")
        .bind(id)
        .bind(body.enabled)
        .execute(&state.pool)
        .await;
    match updated {
        Ok(r) if r.rows_affected() == 0 => fail(StatusCode::NOT_FOUND, "no such conversation"),
        Ok(_) => {
            tracing::info!(
                conversation_id = id,
                enabled = body.enabled,
                "conversation toggled from the admin panel"
            );
            match summary(&state.pool, id).await {
                Ok((s, _)) => ok(s),
                Err(e) => db_fail(e),
            }
        }
        Err(e) => db_fail(e),
    }
}

#[derive(Debug, Deserialize)]
struct WipeBody {
    kind: String,
}

/// The same clean sweep as `/new` and `/forget` (T3 first, by verified id).
async fn wipe_conversation(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<WipeBody>,
) -> Reply {
    guard!(headers, state);
    let kind = match body.kind.as_str() {
        "new" => WipeKind::New,
        "forget" => WipeKind::Forget,
        other => {
            return fail(
                StatusCode::BAD_REQUEST,
                format!("kind must be new or forget, not {other:?}"),
            );
        }
    };
    let status = match store::conversation_status_by_id(&state.pool, id).await {
        Ok(s) => s,
        Err(sqlx::Error::RowNotFound) => {
            return fail(StatusCode::NOT_FOUND, "no such conversation");
        }
        Err(e) => return db_fail(e),
    };
    match wipe::run(
        &state.pool,
        &*state.projects,
        &state.agents_dir,
        &status,
        kind,
    )
    .await
    {
        Ok(wiped) => ok(
            json!({ "threads": wiped.threads, "messages": wiped.messages, "message": wipe::done(kind, wiped) }),
        ),
        Err(err) => {
            let context =
                json!({ "conversation_id": id, "error": err.to_string(), "from": "admin panel" });
            let error_id =
                crate::errors::record(&state.pool, "admin.wipe", &err.to_string(), context)
                    .await
                    .map(|id| id.to_string())
                    .unwrap_or_else(|_| "unrecorded".into());
            fail(
                StatusCode::BAD_GATEWAY,
                format!("{error_id}: nothing was wiped ({err})"),
            )
        }
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ErrorRow {
    #[sqlx(skip)]
    error_id: String,
    id: i64,
    kind: String,
    message: String,
    context: Value,
    created_at: DateTime<Utc>,
}

async fn error_rows(
    pool: &PgPool,
    q: Option<&str>,
    limit: i64,
) -> Result<Vec<ErrorRow>, sqlx::Error> {
    let q = q.map(str::trim).filter(|q| !q.is_empty());
    let by_id = q.and_then(|q| q.parse::<ErrorId>().ok()).map(|id| id.0);
    let mut rows: Vec<ErrorRow> = sqlx::query_as(
        "SELECT id, kind, message, context, created_at FROM errors
         WHERE ($1::bigint IS NOT NULL AND id = $1)
            OR ($1::bigint IS NULL AND ($2::text IS NULL
                OR kind ILIKE '%' || $2 || '%' OR message ILIKE '%' || $2 || '%'))
         ORDER BY id DESC LIMIT $3",
    )
    .bind(by_id)
    .bind(q)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    for row in &mut rows {
        row.error_id = ErrorId(row.id).to_string();
    }
    Ok(rows)
}

#[derive(Debug, Deserialize)]
struct ErrorQuery {
    q: Option<String>,
    /// Older than this numeric error id (the page before).
    before: Option<i64>,
    limit: Option<i64>,
}

/// A list row: no context, and the message capped, since the detail page
/// has both in full.
#[derive(Debug, Serialize, sqlx::FromRow)]
struct ErrorSummary {
    #[sqlx(skip)]
    error_id: String,
    id: i64,
    kind: String,
    message: String,
    created_at: DateTime<Utc>,
}

/// Escapes `%`, `_` and `\` so a search is literal text, not a pattern.
fn like_literal(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

async fn error_summaries(
    pool: &PgPool,
    q: Option<&str>,
    before: Option<i64>,
    limit: i64,
) -> Result<Vec<ErrorSummary>, sqlx::Error> {
    let q = q.map(str::trim).filter(|q| !q.is_empty());
    let by_id = q.and_then(|q| q.parse::<ErrorId>().ok()).map(|id| id.0);
    let pattern = q.map(like_literal);
    let mut rows: Vec<ErrorSummary> = sqlx::query_as(
        "SELECT id, kind, left(message, 300) AS message, created_at FROM errors
         WHERE (($1::bigint IS NOT NULL AND id = $1)
             OR ($1::bigint IS NULL AND ($2::text IS NULL
                 OR kind ILIKE '%' || $2 || '%' OR message ILIKE '%' || $2 || '%')))
           AND ($4::bigint IS NULL OR id < $4)
         ORDER BY id DESC LIMIT $3",
    )
    .bind(by_id)
    .bind(pattern)
    .bind(limit)
    .bind(before)
    .fetch_all(pool)
    .await?;
    for row in &mut rows {
        row.error_id = ErrorId(row.id).to_string();
    }
    Ok(rows)
}

async fn errors(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Query(query): Query<ErrorQuery>,
) -> Reply {
    guard!(headers, state);
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    match error_summaries(&state.pool, query.q.as_deref(), query.before, limit).await {
        Ok(rows) => ok(rows),
        Err(e) => db_fail(e),
    }
}

async fn error(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Reply {
    guard!(headers, state);
    let Some(error_id) = id
        .parse::<ErrorId>()
        .ok()
        .or_else(|| id.parse::<i64>().ok().map(ErrorId))
    else {
        return fail(StatusCode::BAD_REQUEST, "use an error id like E-1042");
    };
    match error_rows(&state.pool, Some(&error_id.to_string()), 1).await {
        Ok(mut rows) => match rows.pop() {
            Some(row) => ok(row),
            None => fail(StatusCode::NOT_FOUND, format!("no error {error_id}")),
        },
        Err(e) => db_fail(e),
    }
}

async fn personal_fail(state: &AdminState, err: crate::personal::PersonalError) -> Reply {
    use crate::personal::PersonalError;
    match err {
        PersonalError::Invalid(message) => fail(StatusCode::BAD_REQUEST, message),
        PersonalError::NotFound => fail(StatusCode::NOT_FOUND, "memory not found"),
        err => {
            let id =
                crate::errors::record(&state.pool, "personal.admin", &err.to_string(), json!({}))
                    .await;
            tracing::error!(error = %err, error_id = ?id, "personalisation failed");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Personalisation failed ({}); check logs",
                    id.map(|id| id.to_string())
                        .unwrap_or_else(|_| "unrecorded".into())
                ),
            )
        }
    }
}
#[derive(Deserialize)]
struct MemoryBody {
    content: String,
}
#[derive(Deserialize)]
struct MemoryQuery {
    q: Option<String>,
}
async fn list_memories(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Query(query): Query<MemoryQuery>,
) -> Reply {
    guard!(headers, state);
    match crate::personal::recall(&state.pool, query.q.as_deref()).await {
        Ok(rows) => ok(rows),
        Err(e) => personal_fail(&state, e.into()).await,
    }
}
async fn add_memory(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Json(body): Json<MemoryBody>,
) -> Reply {
    guard!(headers, state);
    match crate::personal::remember(&state.pool, &state.agents_dir, &body.content, None, None).await
    {
        Ok(row) => ok(row),
        Err(e) => personal_fail(&state, e).await,
    }
}
async fn edit_memory(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<MemoryBody>,
) -> Reply {
    guard!(headers, state);
    match crate::personal::remember(
        &state.pool,
        &state.agents_dir,
        &body.content,
        None,
        Some(id),
    )
    .await
    {
        Ok(row) => ok(row),
        Err(e) => personal_fail(&state, e).await,
    }
}
async fn delete_memory(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Reply {
    guard!(headers, state);
    match crate::personal::forget(&state.pool, &state.agents_dir, Some(id)).await {
        Ok(count) => ok(json!({"deleted": count})),
        Err(e) => personal_fail(&state, e).await,
    }
}
async fn delete_memories(State(state): State<Arc<AdminState>>, headers: HeaderMap) -> Reply {
    guard!(headers, state);
    match crate::personal::forget(&state.pool, &state.agents_dir, None).await {
        Ok(count) => ok(json!({"deleted": count})),
        Err(e) => personal_fail(&state, e).await,
    }
}
async fn get_preferences(State(state): State<Arc<AdminState>>, headers: HeaderMap) -> Reply {
    guard!(headers, state);
    match crate::personal::preferences(&state.pool).await {
        Ok(prefs) => ok(prefs),
        Err(e) => personal_fail(&state, e.into()).await,
    }
}
async fn save_preferences(
    State(state): State<Arc<AdminState>>,
    headers: HeaderMap,
    Json(prefs): Json<crate::personal::Preferences>,
) -> Reply {
    guard!(headers, state);
    match crate::personal::set_preferences(&state.pool, &state.agents_dir, &prefs).await {
        Ok(()) => ok(prefs),
        Err(e) => personal_fail(&state, e).await,
    }
}
