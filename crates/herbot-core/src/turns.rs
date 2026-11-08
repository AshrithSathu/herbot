//! Agent turns: a message from Ashrith goes to the conversation's T3 thread
//! and the reply comes back to the same topic.
//!
//! Each conversation has a lane: turns in one conversation run one at a time,
//! in order, while different conversations run in parallel. The poller only
//! queues work, so a slow agent never blocks other topics or the 👀 receipts.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::agent::{AgentError, AgentRunner, TurnOutcome, TurnResult};
use crate::agents_md;
use crate::errors;
use crate::meta::{self, Meta};
use crate::outgoing;
use crate::poller::{ApiError, TelegramApi};
use crate::store;

/// One message for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnJob {
    pub conversation_id: i64,
    pub tg_chat_id: i64,
    pub topic_id: Option<i32>,
    /// The admin's message; the reply quotes it.
    pub reply_to: i32,
    /// Typed text, or the voice note's transcript.
    pub text: String,
    pub is_voice: bool,
    pub sender_name: String,
    pub sender_id: u64,
    pub sent_at: DateTime<Utc>,
}

/// Where the poller hands turns off. Implemented by [`Lanes`] and by a
/// recorder in tests.
pub trait TurnQueue: Send + Sync {
    fn submit(&self, job: TurnJob);
}

/// Everything a turn needs; shared by all lanes.
pub struct TurnDeps<A: TelegramApi, R: AgentRunner> {
    pub pool: PgPool,
    pub api: Arc<A>,
    pub runner: Arc<R>,
    /// Absolute root of the conversation folders.
    pub agents_dir: PathBuf,
    /// The bot's own Telegram user id, for storing its replies.
    pub bot_user_id: u64,
}

pub const TYPING_EVERY: Duration = Duration::from_secs(4);

pub const NEEDS_ANSWER_TEXT: &str = "❓ The agent is waiting for an answer from you in T3 Code. \
Answering from Telegram arrives in Step 6; for now, open the thread in T3 (link in /status).";

#[derive(Debug, thiserror::Error)]
pub enum TurnError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Agent(#[from] AgentError),
    #[error("agent run failed: {0}")]
    RunFailed(String),
}

impl TurnError {
    pub fn kind(&self) -> &'static str {
        match self {
            TurnError::Db(_) => "turn.db",
            TurnError::Api(_) => "turn.telegram",
            TurnError::Agent(AgentError::Timeout(_)) => "agent.timeout",
            TurnError::Agent(AgentError::Spawn(_)) => "agent.spawn",
            TurnError::Agent(AgentError::Project(_)) => "agent.project",
            TurnError::Agent(AgentError::BadOutput { .. }) => "agent.bad_output",
            TurnError::RunFailed(_) => "agent.run_failed",
        }
    }

    /// What the admin sees after `❌ Failed (E-…):`.
    pub fn short_reason(&self) -> String {
        match self {
            TurnError::Db(_) => "database error".into(),
            TurnError::Api(_) => "Telegram API error".into(),
            TurnError::Agent(AgentError::Timeout(secs)) => format!(
                "the agent took longer than {} min (it may still finish in T3)",
                secs.div_ceil(60)
            ),
            TurnError::Agent(AgentError::Spawn(_)) => "couldn't run the T3 CLI".into(),
            TurnError::Agent(AgentError::Project(_)) => "couldn't add this topic to T3".into(),
            TurnError::Agent(AgentError::BadOutput { .. }) => "unexpected answer from T3".into(),
            TurnError::RunFailed(_) => "the agent run failed".into(),
        }
    }
}

/// Runs one turn and reports any failure in the conversation. Never panics.
pub async fn run_turn<A: TelegramApi + 'static, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: TurnJob,
) {
    let typing = spawn_typing(deps.api.clone(), job.tg_chat_id, job.topic_id);
    let result = turn(deps, &job).await;
    typing.abort();

    let Err(err) = result else { return };
    let context = json!({
        "conversation_id": job.conversation_id,
        "reply_to": job.reply_to,
        "error": err.to_string(),
    });
    let error_id = match errors::record(&deps.pool, err.kind(), &err.to_string(), context).await {
        Ok(id) => id,
        Err(db_err) => {
            tracing::error!(error = %err, %db_err, "turn failed and the error could not be recorded");
            return;
        }
    };
    let text = format!(
        "❌ Failed ({error_id}): {}. Check logs.",
        err.short_reason()
    );
    if let Err(send_err) = deps
        .api
        .send_text(job.tg_chat_id, job.topic_id, Some(job.reply_to), &text)
        .await
    {
        tracing::error!(%error_id, error = %send_err, "could not report the failed turn");
    }
}

/// Shows "typing…" in the topic until aborted.
fn spawn_typing<A: TelegramApi + 'static>(
    api: Arc<A>,
    chat: i64,
    topic: Option<i32>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            if let Err(err) = api.typing(chat, topic).await {
                tracing::debug!(error = %err, "typing indicator failed");
            }
            tokio::time::sleep(TYPING_EVERY).await;
        }
    })
}

async fn turn<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
) -> Result<(), TurnError> {
    let status = store::conversation_status_by_id(&deps.pool, job.conversation_id).await?;
    let place = status.place();
    let folder = deps
        .agents_dir
        .join(agents_md::relative_dir(job.tg_chat_id, job.topic_id));

    if !status.t3_project_registered {
        deps.runner.ensure_project(&folder, &place).await?;
        store::mark_project_registered(&deps.pool, job.conversation_id).await?;
    }

    let active = store::active_thread(&deps.pool, job.conversation_id).await?;
    let agents_md_changed = match (&active, status.agents_md_updated_at) {
        (Some(thread), Some(updated)) => updated > thread.last_turn_at.unwrap_or(thread.created_at),
        _ => false,
    };
    let message = meta::wrap(
        &Meta {
            sender_name: &job.sender_name,
            sender_id: job.sender_id,
            place: &place,
            is_voice: job.is_voice,
            sent_at: job.sent_at,
            agents_md_changed,
        },
        &job.text,
    );

    let result: TurnResult = match &active {
        Some(thread) => {
            let result = deps.runner.send(&thread.t3_thread_id, &message).await;
            store::touch_thread(&deps.pool, thread.id).await?;
            result?
        }
        None => match deps.runner.start(&folder, &place, &message).await {
            Ok(result) => {
                let link = thread_link(deps, &folder, &result.thread_id).await;
                store::insert_thread(
                    &deps.pool,
                    job.conversation_id,
                    &result.thread_id,
                    link.as_deref(),
                )
                .await?;
                tracing::info!(conversation_id = job.conversation_id, thread = %result.thread_id, "started agent thread");
                result
            }
            Err(AgentError::Timeout(secs)) => {
                // The run keeps going in T3; remember its thread so the next
                // message continues it instead of starting another.
                recover_thread(deps, job.conversation_id, &folder, &place).await;
                return Err(AgentError::Timeout(secs).into());
            }
            Err(other) => return Err(other.into()),
        },
    };

    match result.outcome {
        TurnOutcome::Replied(text) => {
            deliver(deps, job, &text).await?;
            tracing::info!(
                conversation_id = job.conversation_id,
                chars = text.len(),
                "agent replied"
            );
            Ok(())
        }
        TurnOutcome::NeedsAnswer => {
            deps.api
                .send_text(
                    job.tg_chat_id,
                    job.topic_id,
                    Some(job.reply_to),
                    NEEDS_ANSWER_TEXT,
                )
                .await?;
            Ok(())
        }
        TurnOutcome::Failed(why) => Err(TurnError::RunFailed(why)),
    }
}

/// Scrubs secrets, splits for Telegram, sends, and stores the reply.
async fn deliver<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
    text: &str,
) -> Result<(), TurnError> {
    let clean = outgoing::scrub(text);
    if clean != text {
        tracing::warn!(
            conversation_id = job.conversation_id,
            "scrubbed something secret-looking from a reply"
        );
    }
    for (i, part) in outgoing::split(&clean, outgoing::MAX_MESSAGE_CHARS)
        .iter()
        .enumerate()
    {
        let reply_to = (i == 0).then_some(job.reply_to);
        let sent_id = deps
            .api
            .send_text(job.tg_chat_id, job.topic_id, reply_to, part)
            .await?;
        store::store_bot_message(
            &deps.pool,
            job.conversation_id,
            sent_id,
            deps.bot_user_id,
            part,
        )
        .await?;
    }
    Ok(())
}

async fn thread_link<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    folder: &std::path::Path,
    thread_id: &str,
) -> Option<String> {
    match deps.runner.list(folder).await {
        Ok(threads) => threads
            .into_iter()
            .find(|t| t.thread_id == thread_id)
            .and_then(|t| t.link),
        Err(err) => {
            tracing::warn!(error = %err, "could not look up the thread link");
            None
        }
    }
}

async fn recover_thread<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    conversation_id: i64,
    folder: &std::path::Path,
    title: &str,
) {
    let Ok(threads) = deps.runner.list(folder).await else {
        return;
    };
    if let Some(newest) = threads.into_iter().find(|t| t.title == title)
        && let Err(err) = store::insert_thread(
            &deps.pool,
            conversation_id,
            &newest.thread_id,
            newest.link.as_deref(),
        )
        .await
    {
        tracing::warn!(error = %err, "could not remember the timed-out thread");
    }
}

/// One worker per conversation, created on first use.
pub struct Lanes<A: TelegramApi + 'static, R: AgentRunner> {
    deps: Arc<TurnDeps<A, R>>,
    senders: Mutex<HashMap<i64, mpsc::UnboundedSender<TurnJob>>>,
}

impl<A: TelegramApi + Send + 'static, R: AgentRunner> Lanes<A, R> {
    pub fn new(deps: TurnDeps<A, R>) -> Self {
        Self {
            deps: Arc::new(deps),
            senders: Mutex::new(HashMap::new()),
        }
    }

    fn spawn_lane(&self) -> mpsc::UnboundedSender<TurnJob> {
        let (tx, mut rx) = mpsc::unbounded_channel::<TurnJob>();
        let deps = self.deps.clone();
        tokio::spawn(async move {
            while let Some(job) = rx.recv().await {
                run_turn(&deps, job).await;
            }
        });
        tx
    }
}

impl<A: TelegramApi + Send + 'static, R: AgentRunner> TurnQueue for Lanes<A, R> {
    fn submit(&self, job: TurnJob) {
        let mut senders = self.senders.lock().expect("lanes lock");
        let id = job.conversation_id;
        let sender = senders.entry(id).or_insert_with(|| self.spawn_lane());
        if let Err(returned) = sender.send(job) {
            // The lane's worker is gone (it shouldn't be); start a new one.
            let fresh = self.spawn_lane();
            let _ = fresh.send(returned.0);
            senders.insert(id, fresh);
        }
    }
}
