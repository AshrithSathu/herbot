//! What agents can see and do through herbot-mcp, with the permission rules
//! in one place:
//!
//! - **General** is the hub: it can list, search and read every topic in
//!   its group, and (through herbot-core) post to or ask other topics.
//! - **A topic** can list the topics and search or read only its own history.
//!
//! Callers are identified by the secret token in their `<herbot-meta>` header.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::store;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub conversation_id: i64,
    pub chat_row_id: i64,
    pub is_general: bool,
    pub place: String,
}

#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error("unknown caller token; pass the `caller` value from your <herbot-meta> header")]
    UnknownCaller,
    #[error(transparent)]
    Personal(#[from] crate::personal::PersonalError),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

pub const MAX_SEARCH_RESULTS: i64 = 50;
pub const MAX_READ_MESSAGES: i64 = 100;

/// The conversation's caller token (created by migration 0006 for every row).
pub async fn caller_token(pool: &PgPool, conversation_id: i64) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT caller_token FROM conversations WHERE id = $1")
        .bind(conversation_id)
        .fetch_one(pool)
        .await
}

pub async fn resolve_caller(pool: &PgPool, token: &str) -> Result<Caller, HubError> {
    let row: Option<(i64, i64, Option<i32>)> = sqlx::query_as(
        "SELECT id, chat_id, tg_topic_id FROM conversations WHERE caller_token = $1",
    )
    .bind(token.trim())
    .fetch_optional(pool)
    .await?;
    let (conversation_id, chat_row_id, topic) = row.ok_or(HubError::UnknownCaller)?;
    let place = store::conversation_status_by_id(pool, conversation_id)
        .await?
        .place();
    Ok(Caller {
        conversation_id,
        chat_row_id,
        is_general: topic.is_none(),
        place,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TopicSummary {
    pub id: i64,
    pub name: String,
    pub is_general: bool,
    pub purpose: Option<String>,
    pub messages: i64,
    pub last_activity: Option<DateTime<Utc>>,
    /// True for the conversation that asked.
    pub is_you: bool,
}

/// Every conversation in the caller's group: General first, then the most
/// recently active topics.
pub async fn list_topics(pool: &PgPool, caller: &Caller) -> Result<Vec<TopicSummary>, HubError> {
    let topics = store::group_conversations(pool, caller.chat_row_id)
        .await?
        .into_iter()
        .map(|s| TopicSummary {
            id: s.conversation_id,
            name: s.place(),
            is_general: s.tg_topic_id.is_none(),
            purpose: s.purpose.as_deref().map(|p| crate::setup::clip(p, 300)),
            messages: s.message_count,
            last_activity: s.last_message_at,
            is_you: s.conversation_id == caller.conversation_id,
        })
        .collect();
    Ok(topics)
}

/// Finds a conversation in the caller's group by id or by name (the topic
/// name or the full "Group › Topic" place, case-insensitive).
pub async fn resolve_topic(
    pool: &PgPool,
    caller: &Caller,
    reference: &str,
) -> Result<i64, HubError> {
    let wanted = reference.trim();
    if wanted.is_empty() {
        return Err(HubError::BadRequest(
            "say which topic (a name or id from list_topics)".into(),
        ));
    }
    let topics = list_topics(pool, caller).await?;
    let by_id = wanted
        .parse::<i64>()
        .ok()
        .and_then(|id| topics.iter().find(|t| t.id == id));
    let by_name = || {
        topics.iter().find(|t| {
            t.name.eq_ignore_ascii_case(wanted)
                || t.name
                    .rsplit(" › ")
                    .next()
                    .is_some_and(|leaf| leaf.eq_ignore_ascii_case(wanted))
        })
    };
    by_id.or_else(by_name).map(|t| t.id).ok_or_else(|| {
        HubError::NotFound(format!(
            "no topic called {wanted:?}; call list_topics to see them"
        ))
    })
}

/// Which conversation a read or search may look at.
async fn allowed_target(
    pool: &PgPool,
    caller: &Caller,
    topic: Option<&str>,
) -> Result<Option<i64>, HubError> {
    match (caller.is_general, topic) {
        (true, None) => Ok(None), // General: everything
        (true, Some(reference)) => Ok(Some(resolve_topic(pool, caller, reference).await?)),
        (false, None) => Ok(Some(caller.conversation_id)),
        (false, Some(reference)) => {
            let target = resolve_topic(pool, caller, reference).await?;
            if target == caller.conversation_id {
                Ok(Some(target))
            } else {
                Err(HubError::Forbidden(
                    "topic agents can only search and read their own history; ask in General for other topics".into(),
                ))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Line {
    pub topic: String,
    pub sent_at: DateTime<Utc>,
    /// "Ashrith" or "bot".
    pub from: String,
    pub text: String,
}

fn speaker(from_bot: bool) -> String {
    if from_bot {
        "bot".into()
    } else {
        "Ashrith".into()
    }
}

/// Full-text search (falls back to a substring match when the words are too
/// short for the index), newest first.
pub async fn search(
    pool: &PgPool,
    caller: &Caller,
    query: &str,
    topic: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<Line>, HubError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(HubError::BadRequest("search needs some words".into()));
    }
    let target = allowed_target(pool, caller, topic).await?;
    let limit = limit.unwrap_or(20).clamp(1, MAX_SEARCH_RESULTS);
    let rows: Vec<(i64, DateTime<Utc>, bool, String)> = sqlx::query_as(
        "SELECT m.conversation_id, m.sent_at, m.from_bot, m.body
         FROM messages m JOIN conversations v ON v.id = m.conversation_id
         WHERE v.chat_id = $1
           AND ($2::bigint IS NULL OR m.conversation_id = $2)
           AND (m.search @@ websearch_to_tsquery('simple', $3) OR m.body ILIKE '%' || $3 || '%')
         ORDER BY m.sent_at DESC, m.id DESC
         LIMIT $4",
    )
    .bind(caller.chat_row_id)
    .bind(target)
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    lines(pool, rows).await
}

/// The latest messages of one conversation (oldest first), optionally before
/// a time. Without `topic`, the caller's own conversation.
pub async fn read(
    pool: &PgPool,
    caller: &Caller,
    topic: Option<&str>,
    limit: Option<i64>,
    before: Option<DateTime<Utc>>,
) -> Result<Vec<Line>, HubError> {
    let target = allowed_target(pool, caller, topic)
        .await?
        .unwrap_or(caller.conversation_id);
    let limit = limit.unwrap_or(30).clamp(1, MAX_READ_MESSAGES);
    let mut rows: Vec<(i64, DateTime<Utc>, bool, String)> = sqlx::query_as(
        "SELECT conversation_id, sent_at, from_bot, body FROM messages
         WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR sent_at < $2)
         ORDER BY sent_at DESC, id DESC
         LIMIT $3",
    )
    .bind(target)
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.reverse();
    lines(pool, rows).await
}

async fn lines(
    pool: &PgPool,
    rows: Vec<(i64, DateTime<Utc>, bool, String)>,
) -> Result<Vec<Line>, HubError> {
    let mut names = std::collections::HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for (conversation_id, sent_at, from_bot, body) in rows {
        if let std::collections::hash_map::Entry::Vacant(e) = names.entry(conversation_id) {
            e.insert(
                store::conversation_status_by_id(pool, conversation_id)
                    .await?
                    .place(),
            );
        }
        out.push(Line {
            topic: names[&conversation_id].clone(),
            sent_at,
            from: speaker(from_bot),
            text: body,
        });
    }
    Ok(out)
}

/// Checks an action (post or ask) and returns the target conversation.
/// Only General may act, and not on itself.
pub async fn action_target(pool: &PgPool, caller: &Caller, topic: &str) -> Result<i64, HubError> {
    if !caller.is_general {
        return Err(HubError::Forbidden(
            "only General can post to or ask other topics".into(),
        ));
    }
    let target = resolve_topic(pool, caller, topic).await?;
    if target == caller.conversation_id {
        return Err(HubError::BadRequest(
            "that's General itself; pick another topic".into(),
        ));
    }
    Ok(target)
}

/// Global personal data is available to every authenticated conversation.
pub async fn remember(
    pool: &PgPool,
    caller_token: &str,
    dir: &std::path::Path,
    content: &str,
) -> Result<crate::personal::Memory, HubError> {
    let caller = resolve_caller(pool, caller_token).await?;
    Ok(crate::personal::remember(pool, dir, content, Some(caller.conversation_id), None).await?)
}
pub async fn forget(
    pool: &PgPool,
    caller_token: &str,
    dir: &std::path::Path,
    id: i64,
) -> Result<u64, HubError> {
    resolve_caller(pool, caller_token).await?;
    Ok(crate::personal::forget(pool, dir, Some(id)).await?)
}
pub async fn recall(
    pool: &PgPool,
    caller_token: &str,
    query: Option<&str>,
) -> Result<Vec<crate::personal::Memory>, HubError> {
    resolve_caller(pool, caller_token).await?;
    Ok(crate::personal::recall(pool, query).await?)
}
