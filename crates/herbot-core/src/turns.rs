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
use tokio::sync::{mpsc, oneshot};

use crate::agent::{AgentError, AgentRunner, TurnOutcome, TurnResult};
use crate::agents_md;
use crate::errors;
use crate::format;
use crate::media::{Activity, FileKind};
use crate::meta::{self, Meta};
use crate::modes::Style;
use crate::outbound_files;
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
    /// Set when someone is waiting for this turn's outcome (General's
    /// `ask_topic`): gets the reply text, or the failure.
    pub reply: Option<ReplySlot>,
    /// `/fast`, `/think`, `/heavy` or `/deepsearch`: this one message's mode.
    pub style: Option<Style>,
    /// An album's id: its photos and files arrive as separate messages and
    /// become one turn (see [`ALBUM_WAIT`]).
    pub album: Option<String>,
}

/// How long a lane waits for the rest of an album before running its turn.
pub const ALBUM_WAIT: Duration = Duration::from_secs(4);

/// A one-shot channel for a turn's outcome, shareable so `TurnJob` stays
/// `Clone`. Only the first send is delivered.
#[derive(Clone)]
pub struct ReplySlot(Arc<Mutex<Option<oneshot::Sender<TurnOutcomeText>>>>);

/// What the agent said (`Ok`), or why the turn failed (`Err`, with the E-id).
pub type TurnOutcomeText = Result<String, String>;

impl ReplySlot {
    pub fn new() -> (Self, oneshot::Receiver<TurnOutcomeText>) {
        let (tx, rx) = oneshot::channel();
        (Self(Arc::new(Mutex::new(Some(tx)))), rx)
    }

    /// Delivers the outcome to whoever is waiting (only the first call counts).
    pub fn deliver(&self, outcome: TurnOutcomeText) {
        if let Some(tx) = self.0.lock().expect("reply slot lock").take() {
            let _ = tx.send(outcome);
        }
    }
}

impl std::fmt::Debug for ReplySlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ReplySlot")
    }
}

impl PartialEq for ReplySlot {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for ReplySlot {}

/// Where the poller hands turns off. Implemented by [`Lanes`] and by a
/// recorder in tests.
pub trait TurnQueue: Send + Sync {
    fn submit(&self, job: TurnJob);
}

/// Everything a turn needs; shared by all lanes.
pub struct TurnDeps<A: TelegramApi, R: AgentRunner> {
    pub pool: PgPool,
    pub speaker: Arc<dyn crate::speech::Speaker>,
    pub api: Arc<A>,
    pub runner: Arc<R>,
    /// Absolute root of the conversation folders.
    pub agents_dir: PathBuf,
    /// The bot's own Telegram user id, for storing its replies.
    pub bot_user_id: u64,
    /// Reasoning effort for Auto mode (`HERBOT_AGENT_EFFORT`).
    pub auto_effort: String,
}

pub const TYPING_EVERY: Duration = Duration::from_secs(4);

/// When Codex blocks on a question inside T3 (rare in full-access mode),
/// point Ashrith straight at the thread.
pub fn needs_answer_text(link: Option<&str>) -> String {
    match link {
        Some(link) => format!("❓ The agent is waiting for your answer inside T3 Code: {link}"),
        None => {
            "❓ The agent is waiting for your answer inside T3 Code (link in /status).".to_string()
        }
    }
}

/// Callback data for answer buttons: `ans:<question id>:<option index>`.
pub fn answer_button_data(question_id: i64, index: usize) -> String {
    format!("ans:{question_id}:{index}")
}

pub fn parse_answer_button(data: &str) -> Option<(i64, usize)> {
    let mut parts = data.strip_prefix("ans:")?.split(':');
    let question_id = parts.next()?.parse().ok()?;
    let index = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((question_id, index))
}

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
    #[error("could not write the topic's Codex settings: {0}")]
    Settings(#[from] std::io::Error),
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
            TurnError::Settings(_) => "agent.settings",
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
            TurnError::Settings(_) => "couldn't set this topic's mode".into(),
        }
    }
}

/// Runs one turn and reports any failure in the conversation. Never panics.
pub async fn run_turn<A: TelegramApi + 'static, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: TurnJob,
) {
    let typing = spawn_typing(deps.api.clone(), job.tg_chat_id, job.topic_id);
    let started = tokio::time::Instant::now();
    let mut progress = None;
    let work = turn(deps, &job);
    tokio::pin!(work);
    let mut next = tokio::time::Instant::now() + Duration::from_secs(8);
    let result = loop {
        tokio::select! {
            result=&mut work=>break result,
            _=tokio::time::sleep_until(next)=>{
                let seconds=started.elapsed().as_secs();
                let text=format!("Working on it… {}:{:02}",seconds/60,seconds%60);
                let update=match progress {
                    Some(id)=>deps.api.edit_text(job.tg_chat_id,id,&text).await,
                    None=>match deps.api.send_text(job.tg_chat_id,job.topic_id,None,&text).await {Ok(id)=>{progress=Some(id);Ok(())},Err(e)=>Err(e)},
                };
                if let Err(e)=update {tracing::warn!(error=%e,"progress update failed");}
                next=tokio::time::Instant::now()+Duration::from_secs(5);
            }
        }
    };
    if let Some(id) = progress
        && let Err(e) = deps.api.delete_message(job.tg_chat_id, id).await
    {
        tracing::warn!(error=%e,"progress cleanup failed");
    }
    typing.abort();

    let err = match result {
        Ok(said) => {
            if let Some(slot) = &job.reply {
                slot.deliver(Ok(said));
            }
            return;
        }
        Err(err) => err,
    };
    let context = json!({
        "conversation_id": job.conversation_id,
        "reply_to": job.reply_to,
        "error": err.to_string(),
    });
    let error_id = match errors::record(&deps.pool, err.kind(), &err.to_string(), context).await {
        Ok(id) => id,
        Err(db_err) => {
            tracing::error!(error = %err, %db_err, "turn failed and the error could not be recorded");
            if let Some(slot) = &job.reply {
                slot.deliver(Err(err.short_reason()));
            }
            return;
        }
    };
    if let Some(slot) = &job.reply {
        slot.deliver(Err(format!("{error_id}: {}", err.short_reason())));
    }
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

/// Runs one turn. Returns what the conversation was told (the reply as sent,
/// without any `[[ask]]` line, or the "waiting in T3" note).
async fn turn<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
) -> Result<String, TurnError> {
    let status = store::conversation_status_by_id(&deps.pool, job.conversation_id).await?;
    let place = status.place();
    let folder = deps
        .agents_dir
        .join(agents_md::relative_dir(job.tg_chat_id, job.topic_id));

    if !status.t3_project_registered {
        deps.runner.ensure_project(&folder, &place).await?;
        store::mark_project_registered(&deps.pool, job.conversation_id).await?;
    }

    // The effort this message needs: its own mode (/think, …) or the topic's.
    let effort = match job.style {
        Some(style) => style.effort(&deps.auto_effort),
        None => status.mode.effort(&deps.auto_effort),
    };
    crate::modes::set_topic_effort(
        &deps.agents_dir,
        &agents_md::relative_dir(job.tg_chat_id, job.topic_id),
        effort,
    )
    .await?;
    let mut extra = Vec::new();
    if store::is_private(&deps.pool, job.conversation_id).await? {
        extra.push((
            "private",
            "on; do not store memories or use memory tools; Telegram and T3 retain this thread"
                .into(),
        ));
    } else {
        extra.push(("private", "off".into()));
    }
    let missed:bool=sqlx::query_scalar("WITH previous AS MATERIALIZED (SELECT negative_feedback FROM conversations WHERE id=$1 FOR UPDATE) UPDATE conversations SET negative_feedback=false FROM previous WHERE id=$1 RETURNING previous.negative_feedback").bind(job.conversation_id).fetch_one(&deps.pool).await?;
    if missed {
        extra.push((
            "feedback",
            "Ashrith gave a thumbs-down: the last answer missed; improve your next answer".into(),
        ));
    }
    match (job.style, status.mode.instruction()) {
        (Some(style), _) => extra.push(("mode", style.instruction().to_string())),
        (None, Some(instruction)) => extra.push(("mode", instruction.to_string())),
        (None, None) => {}
    }

    let active = store::active_thread(&deps.pool, job.conversation_id).await?;
    // Custom instructions or memories changed since this thread last ran.
    if let (Some(thread), Some(changed)) = (&active, crate::personal::updated_at(&deps.pool).await?)
        && changed > thread.last_turn_at.unwrap_or(thread.created_at)
    {
        extra.push((
            "note",
            "PERSONAL.md (custom instructions, about-you, memories) changed since your last turn; reread ../../PERSONAL.md".to_string(),
        ));
    }
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
            caller_token: &crate::hub::caller_token(&deps.pool, job.conversation_id).await?,
            extra,
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
            let said = deliver(deps, job, &text).await?;
            tracing::info!(
                conversation_id = job.conversation_id,
                chars = text.len(),
                "agent replied"
            );
            Ok(said)
        }
        TurnOutcome::NeedsAnswer => {
            let link = store::conversation_status_by_id(&deps.pool, job.conversation_id)
                .await?
                .thread_link;
            let note = needs_answer_text(link.as_deref());
            deps.api
                .send_text(job.tg_chat_id, job.topic_id, Some(job.reply_to), &note)
                .await?;
            Ok(note)
        }
        TurnOutcome::Failed(why) => Err(TurnError::RunFailed(why)),
    }
}

/// Scrubs secrets, splits for Telegram, sends, and stores the reply. A
/// trailing `[[ask: …]]` line becomes buttons under the last part.
async fn deliver<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
    text: &str,
) -> Result<String, TurnError> {
    let clean = outgoing::scrub(text);
    if clean != text {
        tracing::warn!(
            conversation_id = job.conversation_id,
            "scrubbed something secret-looking from a reply"
        );
    }
    let (body, choices) = outgoing::extract_choices(&clean);
    let (body, file_refs) = outbound_files::extract(&body);
    let mut parts = outgoing::split_markdown(&body, outgoing::MAX_MESSAGE_CHARS);
    if parts.is_empty() && choices.is_some() {
        parts.push("Pick one:".to_string());
    }
    let last = parts.len().saturating_sub(1);
    for (i, part) in parts.iter().enumerate() {
        let reply_to = (i == 0).then_some(job.reply_to);
        // Markdown rendered for Telegram; plain text if it would run long.
        let html = format::to_html(part);
        let html = if format::visible_len(&html) <= format::TELEGRAM_MAX_CHARS {
            html
        } else {
            format::escape(part)
        };
        let sent_id = match (&choices, i == last) {
            (Some(options), true) => {
                send_with_choices(deps, job, reply_to, part, &html, options).await?
            }
            (None, true) => {
                deps.api
                    .send_rich_buttons(
                        job.tg_chat_id,
                        job.topic_id,
                        reply_to,
                        &html,
                        part,
                        &[vec![(
                            "🔄".into(),
                            format!("retry:{}", job.conversation_id),
                        )]],
                    )
                    .await?
            }
            _ => {
                deps.api
                    .send_rich(job.tg_chat_id, job.topic_id, reply_to, &html, part)
                    .await?
            }
        };
        if i == last {
            set_retry(deps, job, sent_id).await?;
        }
        store::store_bot_message(
            &deps.pool,
            job.conversation_id,
            sent_id,
            deps.bot_user_id,
            part,
        )
        .await?;
    }

    let sent_files = send_files(deps, job, &file_refs, parts.is_empty()).await?;
    crate::speech::after_reply(&deps.pool, &*deps.api, &*deps.speaker, job, &body).await;
    // What the caller of `ask_topic` gets back: the reply as sent, with the
    // options listed (they were buttons in Telegram) and the files named.
    let mut said = match choices {
        Some(options) => format!("{body}\n\n(Options offered: {})", options.join(" | ")),
        None => body,
    };
    if !sent_files.is_empty() {
        said.push_str(&format!("\n\n(Files sent: {})", sent_files.join(", ")));
    }
    Ok(said)
}

/// Sends the files a reply named with `[[file: …]]`, after its text. A file
/// that can't be sent is reported in the chat with an error id; the others
/// still go. Returns the names of the files sent.
async fn send_files<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
    file_refs: &[outbound_files::FileRef],
    reply_to_first: bool,
) -> Result<Vec<String>, TurnError> {
    let folder = agents_md::relative_dir(job.tg_chat_id, job.topic_id);
    let mut sent = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut last_message = None;
    for (i, wanted) in file_refs.iter().enumerate() {
        let reply_to = (reply_to_first && i == 0).then_some(job.reply_to);
        let mut resolved = match outbound_files::resolve(&deps.agents_dir, &folder, wanted).await {
            Ok(resolved) => resolved,
            Err(why) => {
                let context = json!({
                    "conversation_id": job.conversation_id,
                    "path": wanted.path,
                    "error": why.to_string(),
                });
                let id =
                    errors::record(&deps.pool, "agent.file", &why.to_string(), context).await?;
                tracing::warn!(error_id = %id, path = %wanted.path, "agent named a file that can't be sent");
                deps.api
                    .send_text(
                        job.tg_chat_id,
                        job.topic_id,
                        reply_to,
                        &format!("⚠️ Couldn't send a file ({id}): {why}."),
                    )
                    .await?;
                continue;
            }
        };
        if !seen.insert(resolved.file.path.clone()) {
            continue; // the same file named twice ([[file]] and an image link)
        }
        if job.style == Some(Style::Sticker) {
            if resolved.file.kind != FileKind::Photo {
                return Err(TurnError::RunFailed(
                    "sticker source must be a JPG, PNG or WebP image".into(),
                ));
            }
            let destination = deps
                .agents_dir
                .join(&folder)
                .join("files/out")
                .join(format!("sticker-{}-{i}.webp", job.reply_to));
            crate::imagine::sticker(&resolved.file.path, &destination)
                .await
                .map_err(|e| TurnError::RunFailed(e.to_string()))?;
            resolved.file.path = destination.clone();
            resolved.file.kind = FileKind::Sticker;
            resolved.file.caption = None;
            resolved.saved.kind = "sticker".into();
            resolved.saved.name = destination
                .file_name()
                .expect("sticker filename")
                .to_string_lossy()
                .into_owned();
            resolved.saved.path = destination
                .strip_prefix(&deps.agents_dir)
                .expect("inside agents")
                .display()
                .to_string();
            resolved.saved.mime = Some("image/webp".into());
            resolved.saved.size = tokio::fs::metadata(&destination).await?.len();
        }
        let _ = deps
            .api
            .activity(
                job.tg_chat_id,
                job.topic_id,
                Activity::sending(resolved.file.kind),
            )
            .await;
        let mut file = resolved.file.clone();
        let sent_id = match deps
            .api
            .send_file(job.tg_chat_id, job.topic_id, reply_to, &file)
            .await
        {
            Ok(id) => id,
            // Telegram refuses some images as photos (odd sizes, ratios);
            // they still arrive, as a file.
            Err(_) if file.kind == FileKind::Photo => {
                file.kind = FileKind::Document;
                deps.api
                    .send_file(job.tg_chat_id, job.topic_id, reply_to, &file)
                    .await?
            }
            Err(err) => return Err(err.into()),
        };
        let body = wanted
            .caption
            .clone()
            .unwrap_or_else(|| format!("[{}: {}]", resolved.saved.kind, resolved.saved.name));
        store::store_bot_file(
            &deps.pool,
            job.conversation_id,
            sent_id,
            deps.bot_user_id,
            &body,
            &resolved.saved,
        )
        .await?;
        tracing::info!(
            conversation_id = job.conversation_id,
            kind = resolved.saved.kind,
            name = %resolved.saved.name,
            "sent a file"
        );
        last_message = Some(sent_id);
        sent.push(resolved.saved.name);
    }
    if let Some(id) = last_message {
        deps.api
            .set_buttons(
                job.tg_chat_id,
                id,
                &[vec![(
                    "🔄".into(),
                    format!("retry:{}", job.conversation_id),
                )]],
            )
            .await?;
        set_retry(deps, job, id).await?;
    }
    Ok(sent)
}

/// Sends the last part of a reply with one button per option, and opens a
/// question so a tap can be matched back to this conversation.
async fn send_with_choices<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
    reply_to: Option<i32>,
    text: &str,
    html: &str,
    options: &[String],
) -> Result<i32, TurnError> {
    let thread = store::active_thread(&deps.pool, job.conversation_id)
        .await?
        .ok_or_else(|| {
            TurnError::RunFailed("reply offered choices but the thread is gone".into())
        })?;
    let question_id = store::create_question(&deps.pool, thread.id, text, options).await?;
    let mut rows: Vec<Vec<(String, String)>> = options
        .iter()
        .enumerate()
        .map(|(i, option)| vec![(option.clone(), answer_button_data(question_id, i))])
        .collect();
    rows.push(vec![(
        "🔄".into(),
        format!("retry:{}", job.conversation_id),
    )]);
    let sent_id = deps
        .api
        .send_rich_buttons(job.tg_chat_id, job.topic_id, reply_to, html, text, &rows)
        .await?;
    store::set_question_message(&deps.pool, question_id, sent_id).await?;
    tracing::info!(
        conversation_id = job.conversation_id,
        question_id,
        options = options.len(),
        "offered choices"
    );
    Ok(sent_id)
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
            let mut next: Option<TurnJob> = None;
            loop {
                let job = match next.take() {
                    Some(job) => job,
                    None => match rx.recv().await {
                        Some(job) => job,
                        None => break,
                    },
                };
                // An album: gather its other parts into one turn.
                let job = match job.album.clone() {
                    None => job,
                    Some(album) => {
                        let mut merged = job;
                        loop {
                            match tokio::time::timeout(ALBUM_WAIT, rx.recv()).await {
                                Ok(Some(part)) if part.album.as_deref() == Some(album.as_str()) => {
                                    merged.text.push_str("\n\n");
                                    merged.text.push_str(&part.text);
                                }
                                Ok(Some(other)) => {
                                    next = Some(other);
                                    break;
                                }
                                _ => break,
                            }
                        }
                        merged
                    }
                };
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

async fn set_retry<A: TelegramApi, R: AgentRunner>(
    deps: &TurnDeps<A, R>,
    job: &TurnJob,
    id: i32,
) -> Result<(), TurnError> {
    let previous: Option<i32> =
        sqlx::query_scalar("SELECT retry_message_id FROM conversations WHERE id=$1")
            .bind(job.conversation_id)
            .fetch_one(&deps.pool)
            .await?;
    if let Some(old) = previous {
        deps.api.remove_buttons(job.tg_chat_id, old).await?;
    }
    sqlx::query("UPDATE conversations SET retry_message_id=$2 WHERE id=$1")
        .bind(job.conversation_id)
        .bind(id)
        .execute(&deps.pool)
        .await?;
    Ok(())
}
