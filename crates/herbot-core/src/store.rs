//! Database operations for chats, conversations and messages.

use serde_json::json;
use sqlx::PgPool;

use crate::telegram::{ChatRef, InboundMessage};

/// What happened when storing a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreOutcome {
    Stored {
        conversation_id: i64,
        message_row_id: i64,
    },
    /// Telegram re-delivered an update we already have.
    Duplicate { conversation_id: i64 },
    /// The admin turned this chat or conversation off in the admin panel.
    Disabled,
}

/// Snapshot used by `/status` and the setup flow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationStatus {
    pub conversation_id: i64,
    pub chat_title: String,
    pub chat_kind: String,
    pub is_forum: bool,
    pub tg_topic_id: Option<i32>,
    pub topic_name: Option<String>,
    pub message_count: i64,
    pub bot_name: Option<String>,
    pub thread_id: Option<String>,
    pub purpose: Option<String>,
    pub setup_state: SetupState,
    /// Relative to the agents root, e.g. `chat_-100…/topic_5/AGENTS.md`.
    pub agents_md_path: Option<String>,
}

impl ConversationStatus {
    /// Human name for where this conversation lives, e.g. "HQ › Research".
    pub fn place(&self) -> String {
        match (self.chat_kind.as_str(), self.tg_topic_id, &self.topic_name) {
            ("private", _, _) => "Direct messages".to_string(),
            (_, Some(_), Some(name)) => format!("{} › {}", self.chat_title, name),
            (_, Some(id), None) => format!("{} › topic {}", self.chat_title, id),
            (_, None, _) if self.is_forum => format!("{} › General", self.chat_title),
            _ => self.chat_title.clone(),
        }
    }
}

/// Where a conversation is in "what should I be here?" setup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupState {
    /// Nobody has asked yet.
    New,
    /// The greeting was sent; the next admin message becomes the purpose.
    AwaitingPurpose,
    /// Has a purpose.
    Ready,
}

impl SetupState {
    fn parse(s: &str) -> Self {
        match s {
            "awaiting_purpose" => SetupState::AwaitingPurpose,
            "ready" => SetupState::Ready,
            _ => SetupState::New,
        }
    }
}

/// Inserts or refreshes a chat and returns its row ID. A chat the bot had
/// left becomes active again; a chat the admin disabled stays disabled.
pub async fn upsert_chat(
    pool: &PgPool,
    chat: &ChatRef,
    added_by: Option<u64>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO chats (tg_chat_id, kind, title, is_forum, added_by_tg_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tg_chat_id) DO UPDATE SET
             kind = EXCLUDED.kind,
             title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE chats.title END,
             is_forum = EXCLUDED.is_forum,
             added_by_tg_user_id = COALESCE(EXCLUDED.added_by_tg_user_id, chats.added_by_tg_user_id),
             status = CASE WHEN chats.status = 'left' THEN 'active' ELSE chats.status END,
             updated_at = now()
         RETURNING id",
    )
    .bind(chat.tg_chat_id)
    .bind(chat.kind.as_str())
    .bind(&chat.title)
    .bind(chat.is_forum)
    .bind(added_by.map(|id| id as i64))
    .fetch_one(pool)
    .await
}

pub async fn mark_chat_left(pool: &PgPool, tg_chat_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE chats SET status = 'left', updated_at = now() WHERE tg_chat_id = $1")
        .bind(tg_chat_id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn rename_chat(pool: &PgPool, tg_chat_id: i64, title: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE chats SET title = $2, updated_at = now() WHERE tg_chat_id = $1")
        .bind(tg_chat_id)
        .bind(title)
        .execute(pool)
        .await
        .map(|_| ())
}

/// Returns the conversation for (chat, topic), creating it with the default
/// persona if needed. A non-empty `name` replaces the stored one.
pub async fn upsert_conversation(
    pool: &PgPool,
    chat_row_id: i64,
    topic_id: Option<i32>,
    name: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO conversations (chat_id, tg_topic_id, name, bot_id)
         VALUES ($1, $2, $3, (SELECT id FROM bots WHERE is_default AND enabled))
         ON CONFLICT (chat_id, tg_topic_id) DO UPDATE SET
             name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE conversations.name END
         RETURNING id",
    )
    .bind(chat_row_id)
    .bind(topic_id)
    .bind(name)
    .fetch_one(pool)
    .await
}

/// Names a forum topic's conversation (from the "topic created" event).
pub async fn name_topic(
    pool: &PgPool,
    chat: &ChatRef,
    topic_id: i32,
    name: &str,
) -> Result<i64, sqlx::Error> {
    let chat_row_id = upsert_chat(pool, chat, None).await?;
    upsert_conversation(pool, chat_row_id, Some(topic_id), name).await
}

/// Stores an admin message under its conversation.
pub async fn store_message(
    pool: &PgPool,
    msg: &InboundMessage,
) -> Result<StoreOutcome, sqlx::Error> {
    let chat_row_id = upsert_chat(pool, &msg.chat, None).await?;
    let conversation_id = upsert_conversation(pool, chat_row_id, msg.topic_id, "").await?;

    let enabled: bool = sqlx::query_scalar(
        "SELECT c.status = 'active' AND v.enabled
         FROM conversations v JOIN chats c ON c.id = v.chat_id WHERE v.id = $1",
    )
    .bind(conversation_id)
    .fetch_one(pool)
    .await?;
    if !enabled {
        return Ok(StoreOutcome::Disabled);
    }

    let inserted: Option<i64> = sqlx::query_scalar(
        "INSERT INTO messages
             (conversation_id, tg_message_id, from_tg_user_id, body, reply_to_tg_message_id, sent_at, is_voice)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conversation_id, tg_message_id) DO NOTHING
         RETURNING id",
    )
    .bind(conversation_id)
    .bind(msg.message_id)
    .bind(msg.from_user_id as i64)
    .bind(&msg.text)
    .bind(msg.reply_to_message_id)
    .bind(msg.sent_at)
    .bind(msg.voice.is_some())
    .fetch_optional(pool)
    .await?;

    Ok(match inserted {
        Some(message_row_id) => StoreOutcome::Stored {
            conversation_id,
            message_row_id,
        },
        None => StoreOutcome::Duplicate { conversation_id },
    })
}

/// Everything `/status` shows for one conversation. Creates the conversation
/// if this is the first thing the admin sends there.
pub async fn conversation_status(
    pool: &PgPool,
    chat: &ChatRef,
    topic_id: Option<i32>,
) -> Result<ConversationStatus, sqlx::Error> {
    let chat_row_id = upsert_chat(pool, chat, None).await?;
    let conversation_id = upsert_conversation(pool, chat_row_id, topic_id, "").await?;
    conversation_status_by_id(pool, conversation_id).await
}

pub async fn conversation_status_by_id(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<ConversationStatus, sqlx::Error> {
    #[allow(clippy::type_complexity)]
    let row: (
        String,
        String,
        bool,
        Option<i32>,
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT c.title, c.kind, c.is_forum, v.tg_topic_id, v.name,
                (SELECT count(*) FROM messages m WHERE m.conversation_id = v.id),
                b.name,
                (SELECT t.t3_thread_id FROM agent_threads t
                  WHERE t.conversation_id = v.id AND t.status = 'active'),
                v.purpose, v.setup_state, v.agents_md_path
         FROM conversations v
         JOIN chats c ON c.id = v.chat_id
         LEFT JOIN bots b ON b.id = v.bot_id
         WHERE v.id = $1",
    )
    .bind(conversation_id)
    .fetch_one(pool)
    .await?;
    Ok(ConversationStatus {
        conversation_id,
        chat_title: row.0,
        chat_kind: row.1,
        is_forum: row.2,
        tg_topic_id: row.3,
        topic_name: row.3.map(|_| row.4).filter(|n| !n.is_empty()),
        message_count: row.5,
        bot_name: row.6,
        thread_id: row.7,
        purpose: row.8,
        setup_state: SetupState::parse(&row.9),
        agents_md_path: row.10,
    })
}

/// The conversation for (chat, topic), if it exists. Used for button taps,
/// which must never create conversations.
pub async fn find_conversation(
    pool: &PgPool,
    tg_chat_id: i64,
    topic_id: Option<i32>,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT v.id FROM conversations v JOIN chats c ON c.id = v.chat_id
         WHERE c.tg_chat_id = $1 AND v.tg_topic_id IS NOT DISTINCT FROM $2",
    )
    .bind(tg_chat_id)
    .bind(topic_id)
    .fetch_optional(pool)
    .await
}

/// Marks setup as started and remembers the greeting message (for removing
/// its buttons later).
pub async fn begin_setup(
    pool: &PgPool,
    conversation_id: i64,
    prompt_message_id: Option<i32>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE conversations
         SET setup_state = 'awaiting_purpose', setup_prompt_tg_message_id = $2
         WHERE id = $1",
    )
    .bind(conversation_id)
    .bind(prompt_message_id)
    .execute(pool)
    .await
    .map(|_| ())
}

/// Saves the purpose and finishes setup. Returns the greeting message ID, if
/// there was one, so its buttons can be removed.
pub async fn set_purpose(
    pool: &PgPool,
    conversation_id: i64,
    purpose: &str,
    agents_md_path: &str,
) -> Result<Option<i32>, sqlx::Error> {
    let prompt: Option<Option<i32>> = sqlx::query_scalar(
        "UPDATE conversations c
         SET purpose = $2, setup_state = 'ready', setup_prompt_tg_message_id = NULL,
             agents_md_path = $3
         FROM (SELECT id, setup_prompt_tg_message_id AS old FROM conversations WHERE id = $1) o
         WHERE c.id = o.id
         RETURNING o.old",
    )
    .bind(conversation_id)
    .bind(purpose)
    .bind(agents_md_path)
    .fetch_optional(pool)
    .await?;
    Ok(prompt.flatten())
}

/// Records something the bot did on its own (left a chat, ignored someone).
pub async fn audit(
    pool: &PgPool,
    action: &str,
    target: &str,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_log (actor, action, target, payload) VALUES ('herbot', $1, $2, $3)",
    )
    .bind(action)
    .bind(target)
    .bind(payload)
    .execute(pool)
    .await
    .map(|_| ())
}

const OFFSET_KEY: &str = "telegram.offset";

/// The next update ID to ask Telegram for. Persisted so a restart neither
/// replays nor skips updates.
pub async fn load_offset(pool: &PgPool) -> Result<Option<i32>, sqlx::Error> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM kv WHERE key = $1")
            .bind(OFFSET_KEY)
            .fetch_optional(pool)
            .await?;
    Ok(value.and_then(|v| v.as_i64()).map(|n| n as i32))
}

pub async fn save_offset(pool: &PgPool, offset: i32) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO kv (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(OFFSET_KEY)
    .bind(json!(offset))
    .execute(pool)
    .await
    .map(|_| ())
}
