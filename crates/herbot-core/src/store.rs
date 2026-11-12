//! Database operations for chats, conversations and messages.

use chrono::{DateTime, Utc};
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
    /// Forwarded without retaining history.
    Private { conversation_id: i64 },
    /// Telegram re-delivered an update we already have.
    Duplicate { conversation_id: i64 },
    /// The admin turned this chat or conversation off in the admin panel.
    Disabled,
}

/// Snapshot used by `/status` and the setup flow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationStatus {
    pub conversation_id: i64,
    pub tg_chat_id: i64,
    pub chat_title: String,
    pub chat_kind: String,
    pub is_forum: bool,
    pub tg_topic_id: Option<i32>,
    pub topic_name: Option<String>,
    /// Switched off in the admin panel: messages there are ignored.
    pub enabled: bool,
    pub voice_replies: bool,
    pub voice: String,
    pub message_count: i64,
    /// When the newest stored message was sent.
    pub last_message_at: Option<DateTime<Utc>>,
    pub bot_name: Option<String>,
    pub thread_id: Option<String>,
    pub purpose: Option<String>,
    pub setup_state: SetupState,
    /// Relative to the agents root, e.g. `chat_-100…/topic_5/AGENTS.md`.
    pub agents_md_path: Option<String>,
    pub agents_md_updated_at: Option<DateTime<Utc>>,
    pub t3_project_registered: bool,
    /// Opens the active thread in the T3 Code app.
    pub thread_link: Option<String>,
    /// Fast, Auto, Expert or Heavy (`/mode`).
    pub mode: crate::modes::Mode,
    /// The language it answers in (`/language`; English by default).
    pub language: String,
    pub private_mode: bool,
    pub panel_unread: i64,
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

/// Where a conversation is in "what should I be here?" setup
/// (`conversations.setup_state`). Every transition, and what triggers it:
///
/// | from | to | trigger | where |
/// |---|---|---|---|
/// | New | Ready | General's first message (default purpose) | `poller::continue_setup` |
/// | New | AwaitingPurpose | a topic's first message (greeting) | `poller::send_greeting` |
/// | any | AwaitingPurpose | `/setup` | `poller::send_greeting`, [`begin_setup`] |
/// | AwaitingPurpose | Ready | a message of 3+ words becomes the purpose | [`set_purpose`] |
/// | AwaitingPurpose (had a purpose) | Ready | "Keep the current purpose" button | [`keep_purpose`] |
/// | any | Ready | the admin panel saves a purpose | [`set_purpose`] |
/// | any | New | `/forget` | [`reset_setup`] |
///
/// Ready always has a purpose (`conversations_ready_has_purpose`). Only
/// Ready hands messages to the agent; while AwaitingPurpose, the next
/// message is the purpose. See docs/STATE_MACHINES.md for every other one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupState {
    /// Nobody has asked yet.
    New,
    /// The greeting was sent; the next admin message becomes the purpose.
    /// After `/setup`, the old purpose is still there until it's replaced.
    AwaitingPurpose,
    /// Has a purpose; messages go to the agent.
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

    /// The stored name (`conversations.setup_state`, the admin API).
    pub fn as_str(self) -> &'static str {
        match self {
            SetupState::New => "new",
            SetupState::AwaitingPurpose => "awaiting_purpose",
            SetupState::Ready => "ready",
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

    sqlx::query("UPDATE conversations SET last_inbound_message_id=GREATEST(last_inbound_message_id,$2) WHERE id=$1")
        .bind(conversation_id).bind(msg.message_id).execute(pool).await?;
    if is_private(pool, conversation_id).await? {
        return Ok(StoreOutcome::Private { conversation_id });
    }
    let inserted: Option<i64> = sqlx::query_scalar(
        "INSERT INTO messages
             (conversation_id, tg_message_id, from_tg_user_id, body, reply_to_tg_message_id, sent_at, is_voice, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    .bind(json!(msg.files))
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

/// One row of `status_select!`; the count and last activity are kept on the
/// conversation by triggers (migration 0008), so only the capped panel unread count visits message index entries.
#[derive(sqlx::FromRow)]
struct StatusRow {
    id: i64,
    tg_chat_id: i64,
    title: String,
    kind: String,
    is_forum: bool,
    tg_topic_id: Option<i32>,
    name: String,
    enabled: bool,
    voice_replies: bool,
    voice: String,
    message_count: i64,
    last_message_at: Option<DateTime<Utc>>,
    bot_name: Option<String>,
    t3_thread_id: Option<String>,
    t3_link: Option<String>,
    purpose: Option<String>,
    setup_state: String,
    agents_md_path: Option<String>,
    agents_md_updated_at: Option<DateTime<Utc>>,
    t3_project_registered: bool,
    mode: String,
    language: String,
    private_mode: bool,
    panel_unread: i64,
}

/// The status query with `$rest` (a WHERE / ORDER BY literal) appended, as
/// one static string. A conversation has at most one thread
/// (`agent_threads_one_per_conversation`), so the join adds no rows.
macro_rules! status_select {
    ($rest:literal) => {
        concat!(
            "SELECT v.id, c.tg_chat_id, c.title, c.kind, c.is_forum, v.tg_topic_id,
            v.name, v.enabled, v.voice_replies, v.voice, v.message_count, v.last_message_at, b.name AS bot_name,
            t.t3_thread_id, t.t3_link, v.purpose, v.setup_state, v.agents_md_path,
            v.agents_md_updated_at, v.t3_project_registered, v.mode, v.language, v.private_mode,
            (SELECT count(*) FROM (SELECT m.id FROM messages m
                WHERE m.conversation_id = v.id AND m.from_bot
                  AND m.id > v.panel_read_through_message_id
                ORDER BY m.id LIMIT 99) unread) AS panel_unread
     FROM conversations v
     JOIN chats c ON c.id = v.chat_id
     LEFT JOIN bots b ON b.id = v.bot_id
     LEFT JOIN agent_threads t ON t.conversation_id = v.id ",
            $rest
        )
    };
}

impl From<StatusRow> for ConversationStatus {
    fn from(row: StatusRow) -> Self {
        ConversationStatus {
            conversation_id: row.id,
            tg_chat_id: row.tg_chat_id,
            chat_title: row.title,
            chat_kind: row.kind,
            is_forum: row.is_forum,
            tg_topic_id: row.tg_topic_id,
            topic_name: row.tg_topic_id.map(|_| row.name).filter(|n| !n.is_empty()),
            enabled: row.enabled,
            voice_replies: row.voice_replies,
            voice: row.voice,
            message_count: row.message_count,
            last_message_at: row.last_message_at,
            bot_name: row.bot_name,
            thread_id: row.t3_thread_id,
            purpose: row.purpose,
            setup_state: SetupState::parse(&row.setup_state),
            agents_md_path: row.agents_md_path,
            agents_md_updated_at: row.agents_md_updated_at,
            t3_project_registered: row.t3_project_registered,
            thread_link: row.t3_link,
            mode: crate::modes::Mode::parse(&row.mode).unwrap_or(crate::modes::Mode::Auto),
            language: row.language,
            private_mode: row.private_mode,
            panel_unread: row.panel_unread,
        }
    }
}

pub async fn conversation_status_by_id(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<ConversationStatus, sqlx::Error> {
    let row: StatusRow = sqlx::query_as(status_select!("WHERE v.id = $1"))
        .bind(conversation_id)
        .fetch_one(pool)
        .await?;
    Ok(row.into())
}

/// Statuses for a bounded set of history results, including disabled topics.
pub async fn conversation_statuses_by_id(
    pool: &PgPool,
    ids: &[i64],
) -> Result<Vec<ConversationStatus>, sqlx::Error> {
    let rows: Vec<StatusRow> = sqlx::query_as(status_select!("WHERE v.id = ANY($1)"))
        .bind(ids)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Every conversation the admin panel lists (chats the bot hasn't left), in
/// one query: each chat's General first, then its topics in order.
pub async fn listed_conversations(pool: &PgPool) -> Result<Vec<ConversationStatus>, sqlx::Error> {
    let rows: Vec<StatusRow> = sqlx::query_as(status_select!(
        "WHERE c.status <> 'left'
         ORDER BY c.id, (v.tg_topic_id IS NOT NULL), v.tg_topic_id"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// A group's enabled conversations in one query: General first, then the
/// most recently active topics.
pub async fn group_conversations(
    pool: &PgPool,
    chat_row_id: i64,
) -> Result<Vec<ConversationStatus>, sqlx::Error> {
    let rows: Vec<StatusRow> = sqlx::query_as(status_select!(
        "WHERE v.chat_id = $1 AND v.enabled
         ORDER BY (v.tg_topic_id IS NOT NULL), v.last_message_at DESC NULLS LAST, v.id"
    ))
    .bind(chat_row_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
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

/// Marks setup as started (→ AwaitingPurpose) and remembers the prompt
/// message, if it has a button. Returns the previous prompt's message id, if
/// it had one, so its button can be removed.
pub async fn begin_setup(
    pool: &PgPool,
    conversation_id: i64,
    prompt_message_id: Option<i32>,
) -> Result<Option<i32>, sqlx::Error> {
    let old: Option<Option<i32>> = sqlx::query_scalar(
        "UPDATE conversations c
         SET setup_state = 'awaiting_purpose', setup_prompt_tg_message_id = $2
         FROM (SELECT id, setup_prompt_tg_message_id AS old FROM conversations WHERE id = $1) o
         WHERE c.id = o.id
         RETURNING o.old",
    )
    .bind(conversation_id)
    .bind(prompt_message_id)
    .fetch_optional(pool)
    .await?;
    Ok(old.flatten())
}

/// Sets the language a conversation answers in (`/language`).
pub async fn set_language(
    pool: &PgPool,
    conversation_id: i64,
    language: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE conversations SET language = $2 WHERE id = $1")
        .bind(conversation_id)
        .bind(language)
        .execute(pool)
        .await
        .map(|_| ())
}

/// The language of the conversation at (chat, topic), English if it doesn't
/// exist yet: voice notes are transcribed in it.
pub async fn language_at(
    pool: &PgPool,
    tg_chat_id: i64,
    topic_id: Option<i32>,
) -> Result<String, sqlx::Error> {
    let found: Option<String> = sqlx::query_scalar(
        "SELECT v.language FROM conversations v JOIN chats c ON c.id = v.chat_id
         WHERE c.tg_chat_id = $1 AND v.tg_topic_id IS NOT DISTINCT FROM $2",
    )
    .bind(tg_chat_id)
    .bind(topic_id)
    .fetch_optional(pool)
    .await?;
    Ok(found.unwrap_or_else(|| "English".into()))
}

/// Sets a conversation's mode (`/mode`, the admin panel).
pub async fn set_mode(
    pool: &PgPool,
    conversation_id: i64,
    mode: crate::modes::Mode,
) -> Result<bool, sqlx::Error> {
    sqlx::query("UPDATE conversations SET mode = $2 WHERE id = $1")
        .bind(conversation_id)
        .bind(mode.as_str())
        .execute(pool)
        .await
        .map(|r| r.rows_affected() == 1)
}

/// "Keep the current purpose" after `/setup`: back to Ready with the purpose
/// unchanged. Only from AwaitingPurpose with a purpose to keep; returns the
/// prompt's message id (to remove its button), or `None` if the move isn't
/// allowed any more (already replaced, kept, or forgotten).
pub async fn keep_purpose(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Option<Option<i32>>, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE conversations c
         SET setup_state = 'ready', setup_prompt_tg_message_id = NULL
         FROM (SELECT id, setup_prompt_tg_message_id AS old FROM conversations WHERE id = $1) o
         WHERE c.id = o.id AND c.setup_state = 'awaiting_purpose' AND c.purpose IS NOT NULL
         RETURNING o.old",
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await
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
             agents_md_path = $3, agents_md_updated_at = now(), agents_md_version = $4
         FROM (SELECT id, setup_prompt_tg_message_id AS old FROM conversations WHERE id = $1) o
         WHERE c.id = o.id
         RETURNING o.old",
    )
    .bind(conversation_id)
    .bind(purpose)
    .bind(agents_md_path)
    .bind(crate::agents_md::TEMPLATE_VERSION)
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

/// Saves admin updates to the inbox and moves the poll offset past the whole
/// batch, in one transaction: an update is either acknowledged and saved, or
/// neither (and Telegram sends it again).
pub async fn inbox_save(
    pool: &PgPool,
    updates: &[(i64, serde_json::Value)],
    next_offset: i32,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (update_id, body) in updates {
        sqlx::query("INSERT INTO inbox (update_id, body) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(update_id)
            .bind(body)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "INSERT INTO kv (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(OFFSET_KEY)
    .bind(json!(next_offset))
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

/// Saves one update without moving the poll offset (simulated messages).
pub async fn inbox_insert(
    pool: &PgPool,
    update_id: i64,
    body: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inbox (update_id, body) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(update_id)
        .bind(body)
        .execute(pool)
        .await
        .map(|_| ())
}

/// Updates saved but not yet handled, oldest first.
pub async fn inbox_pending(pool: &PgPool) -> Result<Vec<(i64, serde_json::Value)>, sqlx::Error> {
    sqlx::query_as("SELECT update_id, body FROM inbox ORDER BY update_id")
        .fetch_all(pool)
        .await
}

/// An update has been handled (successfully or with its error recorded).
pub async fn inbox_done(pool: &PgPool, update_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM inbox WHERE update_id = $1")
        .bind(update_id)
        .execute(pool)
        .await
        .map(|_| ())
}

/// The conversation's current T3 thread.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct ActiveThread {
    pub id: i64,
    pub t3_thread_id: String,
    pub created_at: DateTime<Utc>,
    pub last_turn_at: Option<DateTime<Utc>>,
}

pub async fn active_thread(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Option<ActiveThread>, sqlx::Error> {
    sqlx::query_as::<_, ActiveThread>(
        "SELECT id, t3_thread_id, created_at, last_turn_at FROM agent_threads
         WHERE conversation_id = $1",
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await
}

/// Records a newly started thread as the conversation's thread (it has at
/// most one; `/new` and `/forget` delete it).
pub async fn insert_thread(
    pool: &PgPool,
    conversation_id: i64,
    t3_thread_id: &str,
    t3_link: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO agent_threads (conversation_id, bot_id, t3_thread_id, t3_link, last_turn_at)
         SELECT $1, bot_id, $2, $3, now() FROM conversations WHERE id = $1
         ON CONFLICT (t3_thread_id) DO NOTHING",
    )
    .bind(conversation_id)
    .bind(t3_thread_id)
    .bind(t3_link)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn touch_thread(pool: &PgPool, thread_row_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE agent_threads SET last_turn_at = now() WHERE id = $1")
        .bind(thread_row_id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn mark_project_registered(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE conversations SET t3_project_registered = true WHERE id = $1")
        .bind(conversation_id)
        .execute(pool)
        .await
        .map(|_| ())
}

/// Stores one of the bot's own replies, so history search sees both sides.
/// Stores a file the bot sent (an agent's image, document, voice reply…).
pub async fn store_bot_file(
    pool: &PgPool,
    conversation_id: i64,
    tg_message_id: i32,
    bot_user_id: u64,
    body: &str,
    file: &crate::media::SavedFile,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at, attachments)
         VALUES ($1, $2, $3, true, $4, now(), $5)
         ON CONFLICT (conversation_id, tg_message_id) DO NOTHING",
    )
    .bind(conversation_id)
    .bind(tg_message_id)
    .bind(bot_user_id as i64)
    .bind(body)
    .bind(json!([file]))
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn store_bot_message(
    pool: &PgPool,
    conversation_id: i64,
    tg_message_id: i32,
    bot_user_id: u64,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at)
         VALUES ($1, $2, $3, true, $4, now())
         ON CONFLICT (conversation_id, tg_message_id) DO NOTHING",
    )
    .bind(conversation_id)
    .bind(tg_message_id)
    .bind(bot_user_id as i64)
    .bind(body)
    .execute(pool)
    .await
    .map(|_| ())
}

/// Conversations whose AGENTS.md was written by an older template.
pub async fn outdated_agents_md(pool: &PgPool, version: i32) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM conversations
         WHERE agents_md_path IS NOT NULL AND purpose IS NOT NULL AND agents_md_version < $1
         ORDER BY id",
    )
    .bind(version)
    .fetch_all(pool)
    .await
}

/// Records that AGENTS.md was regenerated (threads are told to reread it).
pub async fn mark_agents_md_rewritten(
    pool: &PgPool,
    conversation_id: i64,
    version: i32,
    path: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE conversations
         SET agents_md_version = $2, agents_md_path = $3, agents_md_updated_at = now()
         WHERE id = $1",
    )
    .bind(conversation_id)
    .bind(version)
    .bind(path)
    .execute(pool)
    .await
    .map(|_| ())
}

/// Opens a button question for an agent reply; returns its id (used in the
/// buttons' callback data).
pub async fn create_question(
    pool: &PgPool,
    thread_row_id: i64,
    question: &str,
    options: &[String],
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO pending_questions (thread_id, question, options)
         VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(thread_row_id)
    .bind(question)
    .bind(json!(options))
    .fetch_one(pool)
    .await
}

pub async fn set_question_message(
    pool: &PgPool,
    question_id: i64,
    tg_message_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE pending_questions SET tg_message_id = $2 WHERE id = $1")
        .bind(question_id)
        .bind(tg_message_id)
        .execute(pool)
        .await
        .map(|_| ())
}

/// A tapped answer, once claimed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedAnswer {
    pub conversation_id: i64,
    pub question: String,
    pub answer: String,
}

/// Atomically marks a question answered with option `index`, but only if it
/// is still open and belongs to this chat and topic. `None` means it was
/// already answered, is someone else's, or the index is out of range.
pub async fn claim_answer(
    pool: &PgPool,
    question_id: i64,
    index: usize,
    tg_chat_id: i64,
    topic_id: Option<i32>,
) -> Result<Option<ClaimedAnswer>, sqlx::Error> {
    let row: Option<(i64, String, String)> = sqlx::query_as(
        "UPDATE pending_questions q
         SET status = 'answered', answer = q.options ->> $2::int, answered_at = now()
         FROM agent_threads t
         JOIN conversations v ON v.id = t.conversation_id
         JOIN chats c ON c.id = v.chat_id
         WHERE q.id = $1 AND q.status = 'open' AND t.id = q.thread_id
           AND c.tg_chat_id = $3 AND v.tg_topic_id IS NOT DISTINCT FROM $4
           AND $2::int < jsonb_array_length(q.options)
         RETURNING v.id, q.question, q.answer",
    )
    .bind(question_id)
    .bind(index as i32)
    .bind(tg_chat_id)
    .bind(topic_id)
    .fetch_optional(pool)
    .await?;
    Ok(
        row.map(|(conversation_id, question, answer)| ClaimedAnswer {
            conversation_id,
            question,
            answer,
        }),
    )
}

/// A typed message answers any open button question in the conversation:
/// closes them and returns their Telegram message ids (to remove the buttons).
pub async fn supersede_open_questions(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Vec<i32>, sqlx::Error> {
    let ids: Vec<Option<i32>> = sqlx::query_scalar(
        "UPDATE pending_questions q
         SET status = 'superseded', answered_at = now()
         FROM agent_threads t
         WHERE t.id = q.thread_id AND t.conversation_id = $1 AND q.status = 'open'
         RETURNING q.tg_message_id",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await?;
    Ok(ids.into_iter().flatten().collect())
}

/// What a clean sweep removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Wiped {
    pub messages: u64,
    pub threads: u64,
}

/// `/new` and `/forget`: deletes the conversation's stored messages, its
/// threads (already deleted in T3 by then) and their open questions. The
/// folder must be re-added to T3 on the next turn.
pub async fn wipe_conversation(pool: &PgPool, conversation_id: i64) -> Result<Wiped, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE conversations c SET wiped_at=clock_timestamp(),
        wiped_through_inbound_id=last_inbound_message_id,
        wiped_through_message_id=GREATEST(last_inbound_message_id,
            COALESCE((SELECT max(tg_message_id) FROM messages WHERE conversation_id=c.id),0),
            COALESCE((SELECT max(tg_message_id) FROM panel_inbox WHERE conversation_id=c.id),0))
        WHERE c.id=$1",
    )
    .bind(conversation_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE task_runs SET completed_at=clock_timestamp() WHERE conversation_id=$1 AND completed_at IS NULL").bind(conversation_id).execute(&mut *tx).await?;

    sqlx::query("DELETE FROM panel_inbox WHERE conversation_id=$1")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await?;
    let messages = sqlx::query("DELETE FROM messages WHERE conversation_id = $1")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    sqlx::query(
        "UPDATE conversations SET retry_message_id=NULL,negative_feedback=false WHERE id=$1",
    )
    .bind(conversation_id)
    .execute(&mut *tx)
    .await?;
    // pending_questions go with their threads (ON DELETE CASCADE).
    let threads = sqlx::query("DELETE FROM agent_threads WHERE conversation_id = $1")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    sqlx::query("UPDATE conversations SET t3_project_registered = false WHERE id = $1")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Wiped { messages, threads })
}

/// `/forget`: clears the purpose so the conversation sets up again.
/// Returns the old AGENTS.md path (relative), to delete the file.
pub async fn reset_setup(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Option<String>, sqlx::Error> {
    let old: Option<Option<String>> = sqlx::query_scalar(
        "UPDATE conversations c
         SET purpose = NULL, setup_state = 'new', setup_prompt_tg_message_id = NULL,
             agents_md_path = NULL, agents_md_updated_at = NULL
         FROM (SELECT id, agents_md_path AS old FROM conversations WHERE id = $1) o
         WHERE c.id = o.id
         RETURNING o.old",
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await?;
    Ok(old.flatten())
}

/// Every T3 thread Herbot started for a conversation (at most one).
pub async fn all_thread_ids(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT t3_thread_id FROM agent_threads WHERE conversation_id = $1 ORDER BY id",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
}

/// Shared privacy gate for memory/history tools. Database failures must propagate.
pub async fn is_private(pool: &PgPool, conversation_id: i64) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT private_mode FROM conversations WHERE id=$1")
        .bind(conversation_id)
        .fetch_one(pool)
        .await
}
