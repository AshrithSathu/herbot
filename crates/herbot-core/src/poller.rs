//! Telegram long-polling and the handler that carries out policy decisions.
//!
//! All Telegram calls go through [`TelegramApi`], so tests run the real
//! handler against a fake API and a real database.

use std::future::Future;
use std::path::Path;
use std::time::Duration;

use chrono::Utc;

use serde_json::json;
use sqlx::PgPool;
use teloxide::net::Download;
use teloxide::prelude::*;
use teloxide::types::{
    AllowedUpdate, BotCommand, BotCommandScope, CallbackQueryId, ChatId as TgChatId, FileId,
    InlineKeyboardButton, InlineKeyboardMarkup, MessageId, ReactionType, ReplyParameters, ThreadId,
};
use tokio::sync::watch;

use crate::agents_md;
use crate::errors::{self, ErrorId};
use crate::policy::{self, Action, Rules};
use crate::setup;
use crate::store::{self, ConversationStatus, SetupState, StoreOutcome};
use crate::telegram::{self, ButtonPress, ChatKind, Command, Inbound, InboundMessage};
use crate::voice::{MAX_VOICE_SECONDS, Transcriber, VoiceError};

/// How long one `getUpdates` call waits for new updates. Kept under
/// teloxide's default 17 s HTTP timeout.
const POLL_TIMEOUT_SECS: u32 = 10;
/// Pause after a failed poll before trying again.
const POLL_RETRY_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
#[error("Telegram API error: {0}")]
pub struct ApiError(pub String);

/// The Telegram calls Herbot makes. Implemented by the real bot and by a fake
/// in tests.
pub trait TelegramApi: Sync {
    fn send_text(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;

    /// Sends a message with inline buttons, given as rows of (label, callback
    /// data). Returns the new message's ID.
    fn send_buttons(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
        rows: &[Vec<(String, String)>],
    ) -> impl Future<Output = Result<i32, ApiError>> + Send;

    /// Replaces a bot message's text. Its buttons are removed.
    fn edit_text(
        &self,
        chat_id: i64,
        message_id: i32,
        text: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;

    /// Removes the buttons under a bot message, keeping its text.
    fn remove_buttons(
        &self,
        chat_id: i64,
        message_id: i32,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;

    /// Acknowledges a button tap (stops the spinner), optionally with a toast.
    fn answer_button(
        &self,
        callback_id: &str,
        toast: Option<&str>,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;

    fn leave_chat(&self, chat_id: i64) -> impl Future<Output = Result<(), ApiError>> + Send;

    /// Puts an emoji reaction on a message (replacing the bot's previous one).
    fn react(
        &self,
        chat_id: i64,
        message_id: i32,
        emoji: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;

    /// Downloads a file the admin sent (e.g. a voice note) into memory.
    fn download_file(
        &self,
        file_id: &str,
    ) -> impl Future<Output = Result<Vec<u8>, ApiError>> + Send;
}

fn api_err(e: teloxide::RequestError) -> ApiError {
    ApiError(e.to_string())
}

/// The real Telegram API.
pub struct BotApi(pub Bot);

impl TelegramApi for BotApi {
    async fn send_text(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> Result<(), ApiError> {
        let mut req = self.0.send_message(ChatId(chat_id), text);
        if let Some(topic) = topic_id {
            req = req.message_thread_id(ThreadId(MessageId(topic)));
        }
        if let Some(reply) = reply_to {
            req = req.reply_parameters(
                ReplyParameters::new(MessageId(reply)).allow_sending_without_reply(),
            );
        }
        req.await.map(|_| ()).map_err(|e| ApiError(e.to_string()))
    }

    async fn send_buttons(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
        rows: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        let keyboard = InlineKeyboardMarkup::new(rows.iter().map(|row| {
            row.iter()
                .map(|(label, data)| InlineKeyboardButton::callback(label.clone(), data.clone()))
                .collect::<Vec<_>>()
        }));
        let mut req = self
            .0
            .send_message(ChatId(chat_id), text)
            .reply_markup(keyboard);
        if let Some(topic) = topic_id {
            req = req.message_thread_id(ThreadId(MessageId(topic)));
        }
        if let Some(reply) = reply_to {
            req = req.reply_parameters(
                ReplyParameters::new(MessageId(reply)).allow_sending_without_reply(),
            );
        }
        req.await.map(|m| m.id.0).map_err(api_err)
    }

    async fn edit_text(&self, chat_id: i64, message_id: i32, text: &str) -> Result<(), ApiError> {
        self.0
            .edit_message_text(ChatId(chat_id), MessageId(message_id), text)
            .await
            .map(|_| ())
            .map_err(api_err)
    }

    async fn remove_buttons(&self, chat_id: i64, message_id: i32) -> Result<(), ApiError> {
        self.0
            .edit_message_reply_markup(ChatId(chat_id), MessageId(message_id))
            .await
            .map(|_| ())
            .map_err(api_err)
    }

    async fn answer_button(&self, callback_id: &str, toast: Option<&str>) -> Result<(), ApiError> {
        let mut req = self
            .0
            .answer_callback_query(CallbackQueryId(callback_id.to_string()));
        if let Some(toast) = toast {
            req = req.text(toast);
        }
        req.await.map(|_| ()).map_err(api_err)
    }

    async fn leave_chat(&self, chat_id: i64) -> Result<(), ApiError> {
        self.0
            .leave_chat(ChatId(chat_id))
            .await
            .map(|_| ())
            .map_err(api_err)
    }

    async fn react(&self, chat_id: i64, message_id: i32, emoji: &str) -> Result<(), ApiError> {
        self.0
            .set_message_reaction(ChatId(chat_id), MessageId(message_id))
            .reaction(vec![ReactionType::Emoji {
                emoji: emoji.to_string(),
            }])
            .await
            .map(|_| ())
            .map_err(api_err)
    }

    async fn download_file(&self, file_id: &str) -> Result<Vec<u8>, ApiError> {
        let file = self
            .0
            .get_file(FileId(file_id.to_string()))
            .await
            .map_err(api_err)?;
        let mut bytes = Vec::new();
        self.0
            .download_file(&file.path, &mut bytes)
            .await
            .map_err(|e| ApiError(e.to_string()))?;
        Ok(bytes)
    }
}

/// Everything the handler needs.
pub struct Ctx<'a, A: TelegramApi, T: Transcriber> {
    pub pool: &'a PgPool,
    pub api: &'a A,
    pub transcriber: &'a T,
    pub rules: Rules,
    pub bot_username: &'a str,
    /// Root folder for each conversation's AGENTS.md.
    pub agents_dir: &'a Path,
    /// Shown in /status, e.g. "gpt-6.1-terra · medium".
    pub agent_label: &'a str,
}

#[derive(Debug, thiserror::Error)]
pub enum HandleError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Voice(#[from] VoiceError),
    #[error("could not write AGENTS.md: {0}")]
    AgentsMd(#[from] std::io::Error),
}

impl HandleError {
    fn kind(&self) -> &'static str {
        match self {
            HandleError::Db(_) => "telegram.handle_db",
            HandleError::Api(_) => "telegram.handle_api",
            HandleError::Voice(_) => "voice.transcribe",
            HandleError::AgentsMd(_) => "agents_md.write",
        }
    }
}

/// The "seen it" reaction on every admin message, so it's clear the bot is listening.
pub const SEEN_REACTION: &str = "👀";

pub const HELP_TEXT: &str = "Herbot: your private bot.\n\n\
General is the everyday chat. Every other topic is its own agent with its own memory.\n\n\
/setup: set what this conversation is for\n\
/status: this conversation's details\n\
/new: start a fresh thread here\n\
/forget: wipe this conversation's thread and history\n\
/help: this list";

pub const WELCOME_TEXT: &str = "👋 Herbot is here. General is our everyday chat. Every other topic is its own agent: say anything in a new topic and I'll ask what it should be.";

/// Handles one update: normalize, decide, act.
pub async fn handle_update<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    update: &Update,
) -> Result<(), HandleError> {
    let Some(inbound) = telegram::normalize(update, ctx.bot_username) else {
        tracing::debug!(update_id = update.id.0, "update not relevant to Herbot");
        return Ok(());
    };
    let action = policy::decide(inbound, &ctx.rules);
    tracing::debug!(update_id = update.id.0, ?action, "policy decision");
    apply(ctx, action).await
}

async fn apply<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    action: Action,
) -> Result<(), HandleError> {
    match action {
        Action::Ignore { reason } => {
            tracing::info!(reason, "ignored update");
        }
        Action::Leave {
            chat,
            added_by,
            reason,
        } => {
            tracing::warn!(chat_id = chat.tg_chat_id, added_by, reason, "leaving chat");
            if chat.kind != ChatKind::Private {
                ctx.api.leave_chat(chat.tg_chat_id).await?;
            }
            store::audit(
                ctx.pool,
                reason,
                &chat.tg_chat_id.to_string(),
                json!({ "added_by": added_by, "title": chat.title, "kind": chat.kind.as_str() }),
            )
            .await?;
        }
        Action::RegisterChat { chat, added_by } => {
            let chat_row_id = store::upsert_chat(ctx.pool, &chat, Some(added_by)).await?;
            store::upsert_conversation(ctx.pool, chat_row_id, None, "").await?;
            tracing::info!(chat_id = chat.tg_chat_id, title = %chat.title, "registered chat");
            if chat.kind != ChatKind::Private {
                ctx.api
                    .send_text(chat.tg_chat_id, None, None, WELCOME_TEXT)
                    .await?;
            }
        }
        Action::MarkLeft { chat } => {
            store::mark_chat_left(ctx.pool, chat.tg_chat_id).await?;
            tracing::info!(chat_id = chat.tg_chat_id, "bot removed from chat");
        }
        Action::NameTopic {
            chat,
            topic_id,
            name,
        } => {
            store::name_topic(ctx.pool, &chat, topic_id, &name).await?;
        }
        Action::RenameChat { chat, title } => {
            store::rename_chat(ctx.pool, chat.tg_chat_id, &title).await?;
        }
        Action::Store(mut msg) => {
            mark_seen(ctx, &msg).await;
            // Voice notes become English text before anything else sees them.
            if let Some(voice) = msg.voice.clone() {
                if voice.duration_secs > MAX_VOICE_SECONDS {
                    let text = setup::too_long(voice.duration_secs, MAX_VOICE_SECONDS);
                    reply(ctx, &msg, &text).await?;
                    return Ok(());
                }
                let audio = ctx.api.download_file(&voice.file_id).await?;
                let transcript = ctx.transcriber.transcribe(audio).await?;
                if transcript.trim().is_empty() {
                    reply(ctx, &msg, setup::NOTHING_HEARD).await?;
                    return Ok(());
                }
                tracing::info!(
                    seconds = voice.duration_secs,
                    chars = transcript.len(),
                    "transcribed voice note"
                );
                msg.text = if msg.text.trim().is_empty() {
                    transcript
                } else {
                    format!("{}\n\n{}", msg.text.trim(), transcript)
                };
            }
            store_and_continue(ctx, &msg).await?;
        }
        Action::RunCommand(msg, cmd) => {
            mark_seen(ctx, &msg).await;
            run_command(ctx, &msg, cmd).await?
        }
        Action::Button(press) => handle_button(ctx, &press).await?,
    }
    Ok(())
}

/// Reacts 👀 to an admin message as soon as it arrives. A failed reaction
/// (say, reactions turned off in the group) is recorded but never stops the
/// message from being handled.
async fn mark_seen<A: TelegramApi, T: Transcriber>(ctx: &Ctx<'_, A, T>, msg: &InboundMessage) {
    if let Err(err) = ctx
        .api
        .react(msg.chat.tg_chat_id, msg.message_id, SEEN_REACTION)
        .await
    {
        let context = json!({ "chat_id": msg.chat.tg_chat_id, "message_id": msg.message_id });
        match errors::record(ctx.pool, "telegram.react", &err.to_string(), context).await {
            Ok(id) => tracing::warn!(error_id = %id, error = %err, "could not react to message"),
            Err(db_err) => tracing::error!(error = %err, %db_err, "could not react or record it"),
        }
    }
}

async fn reply<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    text: &str,
) -> Result<(), HandleError> {
    ctx.api
        .send_text(
            msg.chat.tg_chat_id,
            msg.topic_id,
            Some(msg.message_id),
            text,
        )
        .await?;
    Ok(())
}

async fn store_and_continue<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
) -> Result<(), HandleError> {
    match store::store_message(ctx.pool, msg).await? {
        StoreOutcome::Stored {
            conversation_id,
            message_row_id,
        } => {
            tracing::info!(conversation_id, message_row_id, "stored admin message");
            continue_setup(ctx, msg, conversation_id).await?;
        }
        StoreOutcome::Duplicate { conversation_id } => {
            tracing::debug!(conversation_id, "duplicate message ignored");
        }
        StoreOutcome::Disabled => {
            tracing::info!(
                chat_id = msg.chat.tg_chat_id,
                "conversation disabled; not stored"
            );
        }
    }
    Ok(())
}

/// Moves a conversation's setup along after an admin message was stored.
/// General sets itself up with the default purpose; a new topic asks what it
/// should be; while waiting, the message (typed or spoken) becomes the purpose
/// and the topic's AGENTS.md. Voice notes also get a "here's what I heard".
async fn continue_setup<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    conversation_id: i64,
) -> Result<(), HandleError> {
    let status = store::conversation_status_by_id(ctx.pool, conversation_id).await?;
    let is_voice = msg.voice.is_some();
    match status.setup_state {
        // General (no topic) is the everyday chat: set it up silently.
        SetupState::New if status.tg_topic_id.is_none() => {
            save_purpose(ctx, msg, &status, setup::DEFAULT_GENERAL_PURPOSE).await?;
            tracing::info!(
                conversation_id,
                "general chat set up with the default purpose"
            );
            if is_voice {
                reply(ctx, msg, &setup::heard(&msg.text)).await?;
            }
        }
        // A new topic: ask what this agent should be.
        SetupState::New => {
            if is_voice {
                reply(ctx, msg, &setup::heard(&msg.text)).await?;
            }
            send_greeting(ctx, msg, &status).await?;
        }
        SetupState::AwaitingPurpose => match setup::validate_purpose(&msg.text) {
            Ok(purpose) => {
                let old_prompt = save_purpose(ctx, msg, &status, &purpose).await?;
                if let Some(prompt) = old_prompt {
                    // A greeting from before setup became open-ended still has buttons.
                    ctx.api.remove_buttons(msg.chat.tg_chat_id, prompt).await?;
                }
                tracing::info!(
                    conversation_id,
                    voice = is_voice,
                    "conversation purpose set"
                );
                reply(ctx, msg, &setup::confirmation(&status.place(), &purpose)).await?;
            }
            Err(problem) => reply(ctx, msg, &problem.to_string()).await?,
        },
        // Step 4 sends the message to the conversation's T3 thread here.
        SetupState::Ready => {
            if is_voice {
                reply(ctx, msg, &setup::heard(&msg.text)).await?;
            }
        }
    }
    Ok(())
}

/// Writes the conversation's AGENTS.md, then records the purpose. Returns the
/// old greeting's message ID if it still has buttons.
async fn save_purpose<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    status: &ConversationStatus,
    purpose: &str,
) -> Result<Option<i32>, HandleError> {
    let path = agents_md::write(
        ctx.agents_dir,
        msg.chat.tg_chat_id,
        msg.topic_id,
        &status.place(),
        purpose,
        Utc::now(),
    )
    .await?;
    let old_prompt = store::set_purpose(
        ctx.pool,
        status.conversation_id,
        purpose,
        &path.to_string_lossy(),
    )
    .await?;
    Ok(old_prompt)
}

async fn send_greeting<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    status: &ConversationStatus,
) -> Result<(), HandleError> {
    reply(ctx, msg, &setup::greeting(&status.place())).await?;
    store::begin_setup(ctx.pool, status.conversation_id, None).await?;
    tracing::info!(
        conversation_id = status.conversation_id,
        "asked what this conversation is for"
    );
    Ok(())
}

/// A tapped inline button. None are in use right now (Step 6 adds answers to
/// the bot's questions); old setup greetings still have preset buttons, so
/// say they're gone and remove them.
async fn handle_button<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    press: &ButtonPress,
) -> Result<(), HandleError> {
    ctx.api
        .answer_button(&press.callback_id, Some(setup::STALE_BUTTON_TOAST))
        .await?;
    ctx.api
        .remove_buttons(press.chat.tg_chat_id, press.message_id)
        .await?;
    Ok(())
}

async fn run_command<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    cmd: Command,
) -> Result<(), HandleError> {
    let text = match cmd {
        Command::Start | Command::Help => HELP_TEXT.to_string(),
        Command::Setup => {
            let status = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
            return send_greeting(ctx, msg, &status).await;
        }
        Command::Status => {
            let s = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
            let purpose = s
                .purpose
                .as_deref()
                .map(|p| setup::clip(p, 300))
                .unwrap_or_else(|| "not set yet (send /setup)".to_string());
            format!(
                "📍 {}\nConversation #{} · {} messages stored\nPurpose: {}\nAgent file: {}\nModel: {}\nThread: {}",
                s.place(),
                s.conversation_id,
                s.message_count,
                purpose,
                s.agents_md_path.as_deref().unwrap_or("not written yet"),
                ctx.agent_label,
                s.thread_id.as_deref().unwrap_or("none yet (Step 4)"),
            )
        }
        Command::New | Command::Forget => {
            "⏳ That arrives in Step 4, once T3 threads are connected.".to_string()
        }
        Command::Unknown(name) => format!("I don't know /{name}. Try /help."),
    };
    ctx.api
        .send_text(
            msg.chat.tg_chat_id,
            msg.topic_id,
            Some(msg.message_id),
            &text,
        )
        .await?;
    Ok(())
}

/// Handles an update and, if that fails, records the error and tells the
/// admin in the same conversation. Never panics or stops the loop.
pub async fn process<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    update: &Update,
) -> Option<ErrorId> {
    let err = match handle_update(ctx, update).await {
        Ok(()) => return None,
        Err(err) => err,
    };
    let context = json!({ "update_id": update.id.0, "error": err.to_string() });
    let error_id = match errors::record(ctx.pool, err.kind(), &err.to_string(), context).await {
        Ok(id) => id,
        Err(db_err) => {
            tracing::error!(error = %err, db_error = %db_err, "handling failed and the error could not be recorded");
            return None;
        }
    };

    // Fail loud: tell the admin where it happened, if it was their message.
    if let Some(Inbound::Message(msg)) = telegram::normalize(update, ctx.bot_username)
        && msg.from_user_id == ctx.rules.admin_user_id
        && msg.chat.kind != ChatKind::Private
    {
        let text = format!(
            "❌ Failed ({error_id}): {}. Check logs.",
            short_reason(&err)
        );
        if let Err(send_err) = ctx
            .api
            .send_text(
                msg.chat.tg_chat_id,
                msg.topic_id,
                Some(msg.message_id),
                &text,
            )
            .await
        {
            tracing::error!(%error_id, error = %send_err, "could not tell the admin about the failure");
        }
    }
    Some(error_id)
}

fn short_reason(err: &HandleError) -> &'static str {
    match err {
        HandleError::Db(_) => "database error",
        HandleError::Api(_) => "Telegram API error",
        HandleError::Voice(VoiceError::NotConfigured) => "voice notes are off (no OPENAI_API_KEY)",
        HandleError::Voice(_) => "couldn't transcribe that voice note",
        HandleError::AgentsMd(_) => "couldn't save AGENTS.md",
    }
}

/// Registers the `/` command menu, only where Herbot works: the home group
/// if one is set, otherwise all groups. The default menu (what DMs show) is
/// cleared, since direct messages do nothing.
pub async fn register_commands(bot: &Bot, rules: &Rules) -> Result<(), teloxide::RequestError> {
    let commands: Vec<BotCommand> = telegram::COMMAND_MENU
        .iter()
        .map(|(name, description)| BotCommand::new(*name, *description))
        .collect();
    let scope = match rules.home_chat_id {
        Some(home) => BotCommandScope::Chat {
            chat_id: TgChatId(home).into(),
        },
        None => BotCommandScope::AllGroupChats,
    };
    bot.delete_my_commands()
        .scope(BotCommandScope::Default)
        .await?;
    bot.delete_my_commands()
        .scope(BotCommandScope::AllPrivateChats)
        .await?;
    bot.set_my_commands(commands).scope(scope).await.map(|_| ())
}

/// Long-polls Telegram until `shutdown` flips to true.
/// What the poller needs besides the bot and database.
pub struct RunSettings<T: Transcriber> {
    pub rules: Rules,
    pub bot_username: String,
    pub transcriber: T,
    pub agents_dir: std::path::PathBuf,
    pub agent_label: String,
}

pub async fn run<T: Transcriber>(
    bot: Bot,
    pool: PgPool,
    settings: RunSettings<T>,
    mut shutdown: watch::Receiver<bool>,
) {
    let api = BotApi(bot.clone());
    let bot_username = settings.bot_username.clone();
    let ctx = Ctx {
        pool: &pool,
        api: &api,
        transcriber: &settings.transcriber,
        rules: settings.rules,
        bot_username: &bot_username,
        agents_dir: &settings.agents_dir,
        agent_label: &settings.agent_label,
    };

    let mut offset = match store::load_offset(&pool).await {
        Ok(offset) => offset,
        Err(err) => {
            let _ =
                errors::record(&pool, "telegram.offset_load", &err.to_string(), json!({})).await;
            None
        }
    };
    tracing::info!(?offset, bot = %bot_username, "telegram polling started");

    loop {
        let mut request = bot
            .get_updates()
            .timeout(POLL_TIMEOUT_SECS)
            .allowed_updates(vec![
                AllowedUpdate::Message,
                AllowedUpdate::MyChatMember,
                AllowedUpdate::CallbackQuery,
            ]);
        if let Some(offset) = offset {
            request = request.offset(offset);
        }

        let result = tokio::select! {
            result = request.send() => result,
            _ = shutdown.changed() => break,
        };

        match result {
            Ok(updates) => {
                for update in &updates {
                    process(&ctx, update).await;
                    let next = update.id.0 as i32 + 1;
                    offset = Some(next);
                    if let Err(err) = store::save_offset(&pool, next).await {
                        let _ = errors::record(
                            &pool,
                            "telegram.offset_save",
                            &err.to_string(),
                            json!({ "offset": next }),
                        )
                        .await;
                    }
                }
            }
            Err(err) => {
                let _ = errors::record(&pool, "telegram.poll_failed", &err.to_string(), json!({}))
                    .await;
                tokio::select! {
                    _ = tokio::time::sleep(POLL_RETRY_DELAY) => {},
                    _ = shutdown.changed() => break,
                }
            }
        }
    }
    tracing::info!("telegram polling stopped");
}
