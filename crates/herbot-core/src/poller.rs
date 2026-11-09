//! Telegram long-polling and the handler that carries out policy decisions.
//!
//! All Telegram calls go through [`TelegramApi`], so tests run the real
//! handler against a fake API and a real database.

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;

use serde_json::json;
use sqlx::PgPool;
use teloxide::net::Download;
use teloxide::prelude::*;
use teloxide::types::{
    AllowedUpdate, BotCommand, BotCommandScope, CallbackQueryId, ChatAction, ChatId as TgChatId,
    FileId, InlineKeyboardButton, InlineKeyboardMarkup, InputFile, LinkPreviewOptions, MessageId,
    ParseMode, ReactionType, ReplyParameters, ThreadId,
};
use tokio::sync::{mpsc, watch};

use crate::agent::{AgentError, ProjectCleaner};
use crate::agents_md;
use crate::errors::{self, ErrorId};
use crate::inbound_files;
use crate::media::{Activity, FileKind, OutFile};
use crate::policy::{self, Action, Rules};
use crate::setup;
use crate::store::{self, ConversationStatus, SetupState, StoreOutcome};
use crate::telegram::{self, ButtonPress, ChatKind, Command, Inbound, InboundMessage};
use crate::turns::{self, TurnJob, TurnQueue};
use crate::voice::{MAX_VOICE_SECONDS, Transcriber, VoiceError};
use crate::wipe;

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
pub trait TelegramApi: Send + Sync {
    fn send_text(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> impl Future<Output = Result<i32, ApiError>> + Send;

    /// Shows "typing…" in a chat or topic for a few seconds.
    fn typing(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
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

    /// Sends formatted text (Telegram HTML). If Telegram can't parse it, the
    /// plain version goes instead, so a reply is never lost to formatting.
    fn send_rich(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        html: &str,
        plain: &str,
    ) -> impl Future<Output = Result<i32, ApiError>> + Send {
        let _ = html;
        self.send_text(chat_id, topic_id, reply_to, plain)
    }

    /// Replaces a bot message with formatted text (plain if it won't parse).
    fn edit_rich(
        &self,
        chat_id: i64,
        message_id: i32,
        html: &str,
        plain: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send {
        let _ = html;
        self.edit_text(chat_id, message_id, plain)
    }

    /// Sends a file from this machine (photo, voice note, video, document…).
    fn send_file(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        file: &OutFile,
    ) -> impl Future<Output = Result<i32, ApiError>> + Send {
        let _ = (chat_id, topic_id, reply_to, file);
        async { Err(ApiError("sending files is not supported here".into())) }
    }

    /// Shows what the bot is doing ("sending a photo…") for a few seconds.
    fn activity(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        activity: Activity,
    ) -> impl Future<Output = Result<(), ApiError>> + Send {
        let _ = activity;
        self.typing(chat_id, topic_id)
    }
}

/// Links stay links: no preview cards under replies.
fn no_previews() -> LinkPreviewOptions {
    LinkPreviewOptions {
        is_disabled: true,
        url: None,
        prefer_small_media: false,
        prefer_large_media: false,
        show_above_text: false,
    }
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
    ) -> Result<i32, ApiError> {
        let mut req = self.0.send_message(ChatId(chat_id), text);
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

    async fn typing(&self, chat_id: i64, topic_id: Option<i32>) -> Result<(), ApiError> {
        let mut req = self.0.send_chat_action(ChatId(chat_id), ChatAction::Typing);
        if let Some(topic) = topic_id {
            req = req.message_thread_id(ThreadId(MessageId(topic)));
        }
        req.await.map(|_| ()).map_err(api_err)
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
        match self
            .0
            .edit_message_reply_markup(ChatId(chat_id), MessageId(message_id))
            .await
        {
            Ok(_) => Ok(()),
            // Already without buttons (a double tap, a second cleanup): done.
            Err(teloxide::RequestError::Api(teloxide::ApiError::MessageNotModified)) => Ok(()),
            Err(err) => Err(api_err(err)),
        }
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

    async fn send_rich(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        html: &str,
        plain: &str,
    ) -> Result<i32, ApiError> {
        let mut req = self
            .0
            .send_message(ChatId(chat_id), html)
            .parse_mode(ParseMode::Html)
            .link_preview_options(no_previews());
        if let Some(topic) = topic_id {
            req = req.message_thread_id(ThreadId(MessageId(topic)));
        }
        if let Some(reply) = reply_to {
            req = req.reply_parameters(
                ReplyParameters::new(MessageId(reply)).allow_sending_without_reply(),
            );
        }
        match req.await {
            Ok(m) => Ok(m.id.0),
            Err(teloxide::RequestError::Api(teloxide::ApiError::CantParseEntities(why))) => {
                tracing::warn!(%why, "Telegram couldn't parse the formatting; sending plain text");
                self.send_text(chat_id, topic_id, reply_to, plain).await
            }
            Err(err) => Err(api_err(err)),
        }
    }

    async fn edit_rich(
        &self,
        chat_id: i64,
        message_id: i32,
        html: &str,
        plain: &str,
    ) -> Result<(), ApiError> {
        let req = self
            .0
            .edit_message_text(ChatId(chat_id), MessageId(message_id), html)
            .parse_mode(ParseMode::Html)
            .link_preview_options(no_previews());
        match req.await {
            Ok(_) => Ok(()),
            Err(teloxide::RequestError::Api(teloxide::ApiError::MessageNotModified)) => Ok(()),
            Err(teloxide::RequestError::Api(teloxide::ApiError::CantParseEntities(_))) => {
                self.edit_text(chat_id, message_id, plain).await
            }
            Err(err) => Err(api_err(err)),
        }
    }

    async fn send_file(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        file: &OutFile,
    ) -> Result<i32, ApiError> {
        let input = InputFile::file(file.path.clone());
        let chat = ChatId(chat_id);
        let thread = topic_id.map(|t| ThreadId(MessageId(t)));
        let reply =
            reply_to.map(|r| ReplyParameters::new(MessageId(r)).allow_sending_without_reply());
        let caption = file.caption.clone();
        // Each kind is its own request type; set the same fields on each.
        macro_rules! send {
            ($req:expr) => {{
                let mut req = $req;
                if let Some(thread) = thread {
                    req = req.message_thread_id(thread);
                }
                if let Some(reply) = reply.clone() {
                    req = req.reply_parameters(reply);
                }
                if let Some(caption) = caption.clone() {
                    req = req.caption(caption);
                }
                req.await.map(|m| m.id.0).map_err(api_err)
            }};
        }
        match file.kind {
            FileKind::Photo => send!(self.0.send_photo(chat, input)),
            FileKind::Voice => send!(self.0.send_voice(chat, input)),
            FileKind::Audio => send!(self.0.send_audio(chat, input)),
            FileKind::Video => send!(self.0.send_video(chat, input)),
            FileKind::Animation => send!(self.0.send_animation(chat, input)),
            FileKind::Document => send!(self.0.send_document(chat, input)),
        }
    }

    async fn activity(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        activity: Activity,
    ) -> Result<(), ApiError> {
        let action = match activity {
            Activity::Typing => ChatAction::Typing,
            Activity::UploadPhoto => ChatAction::UploadPhoto,
            Activity::UploadVideo => ChatAction::UploadVideo,
            Activity::UploadDocument => ChatAction::UploadDocument,
            Activity::RecordVoice => ChatAction::RecordVoice,
        };
        let mut req = self.0.send_chat_action(ChatId(chat_id), action);
        if let Some(topic) = topic_id {
            req = req.message_thread_id(ThreadId(MessageId(topic)));
        }
        req.await.map(|_| ()).map_err(api_err)
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
    /// Where messages for the agents go (one lane per conversation).
    pub turns: &'a dyn TurnQueue,
    /// Deletes a conversation's T3 project and threads (`/new`, `/forget`).
    pub projects: &'a dyn ProjectCleaner,
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
    #[error(transparent)]
    T3(#[from] AgentError),
    #[error("could not receive the file: {0}")]
    Media(#[from] inbound_files::FileError),
}

impl From<wipe::WipeError> for HandleError {
    fn from(err: wipe::WipeError) -> Self {
        match err {
            wipe::WipeError::Db(e) => HandleError::Db(e),
            wipe::WipeError::T3(e) => HandleError::T3(e),
            wipe::WipeError::Io(e) => HandleError::AgentsMd(e),
        }
    }
}

impl HandleError {
    fn kind(&self) -> &'static str {
        match self {
            HandleError::Db(_) => "telegram.handle_db",
            HandleError::Api(_) => "telegram.handle_api",
            HandleError::Voice(_) => "voice.transcribe",
            HandleError::AgentsMd(_) => "agents_md.write",
            HandleError::T3(_) => "t3.project_remove",
            HandleError::Media(_) => "media.receive",
        }
    }
}

/// The "seen it" reaction on every admin message, so it's clear the bot is listening.
pub const SEEN_REACTION: &str = "👀";

pub const HELP_TEXT: &str = "Herbot: your private bot.\n\n\
General is the everyday chat. Every other topic is its own agent with its own memory.\n\n\
/setup: set what this conversation is for\n\
/status: this conversation's details\n\
/new: wipe this topic's chat and start fresh (keeps its purpose)\n\
/forget: wipe this topic completely, purpose included\n\
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
        // The 👀 goes out alongside the work, not one Telegram round trip
        // before it.
        Action::Store(msg) => {
            let ((), handled) = tokio::join!(mark_seen(ctx, &msg), take_message(ctx, msg.clone()));
            handled?
        }
        Action::RunCommand(msg, cmd) => {
            let ((), ran) = tokio::join!(mark_seen(ctx, &msg), run_command(ctx, &msg, cmd));
            ran?
        }
        Action::Button(press) => handle_button(ctx, &press).await?,
    }
    Ok(())
}

/// An admin message: voice notes become English text before anything else
/// sees them, then it's stored and setup or the agent takes it from there.
async fn take_message<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    mut msg: InboundMessage,
) -> Result<(), HandleError> {
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
    // Photos, documents, video and audio: saved in the topic's folder and
    // described to the agent.
    if let Some(attachment) = msg.attachment.clone() {
        let folder = agents_md::relative_dir(msg.chat.tg_chat_id, msg.topic_id);
        let received = inbound_files::receive(
            ctx.api,
            ctx.transcriber,
            ctx.agents_dir,
            &folder,
            msg.message_id,
            &attachment,
        )
        .await;
        match received {
            Ok(received) => {
                tracing::info!(kind = attachment.kind.as_str(), path = %received.file.path, "received a file");
                msg.text = if msg.text.trim().is_empty() {
                    received.note
                } else {
                    format!("{}\n\n{}", msg.text.trim(), received.note)
                };
                msg.files.push(received.file);
            }
            Err(too_big @ inbound_files::FileError::TooBig { .. }) => {
                reply(
                    ctx,
                    &msg,
                    &format!("📎 {too_big}. Send a smaller file or a link."),
                )
                .await?;
                return Ok(());
            }
            Err(err) => return Err(err.into()),
        }
    }
    store_and_continue(ctx, &msg).await
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

/// A typed message answers any open choice buttons in the conversation
/// (they're closed and removed), then goes to the agent.
async fn hand_to_agent<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    conversation_id: i64,
) -> Result<(), HandleError> {
    for message_id in store::supersede_open_questions(ctx.pool, conversation_id).await? {
        ctx.api
            .remove_buttons(msg.chat.tg_chat_id, message_id)
            .await?;
    }
    submit_turn(ctx, msg, conversation_id);
    Ok(())
}

/// Hands an admin message to its conversation's agent lane.
fn submit_turn<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    conversation_id: i64,
) {
    ctx.turns.submit(TurnJob {
        conversation_id,
        tg_chat_id: msg.chat.tg_chat_id,
        topic_id: msg.topic_id,
        reply_to: msg.message_id,
        text: msg.text.clone(),
        is_voice: msg.voice.is_some(),
        sender_name: msg.from_name.clone(),
        sender_id: msg.from_user_id,
        sent_at: msg.sent_at,
        reply: None,
    });
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
            hand_to_agent(ctx, msg, conversation_id).await?;
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
        // Set up: the message goes to the conversation's agent.
        SetupState::Ready => {
            if is_voice {
                reply(ctx, msg, &setup::heard(&msg.text)).await?;
            }
            hand_to_agent(ctx, msg, conversation_id).await?;
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

/// Asks what the conversation should be (→ AwaitingPurpose). With a purpose
/// already set (`/setup`), it says the next message replaces it and offers a
/// "Keep the current purpose" button back to Ready.
async fn send_greeting<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    status: &ConversationStatus,
) -> Result<(), HandleError> {
    let prompt = match status.purpose {
        None => {
            reply(ctx, msg, &setup::greeting(&status.place())).await?;
            None
        }
        Some(_) => Some(
            ctx.api
                .send_buttons(
                    msg.chat.tg_chat_id,
                    msg.topic_id,
                    Some(msg.message_id),
                    &setup::new_purpose_prompt(&status.place()),
                    &setup::keep_button(status.conversation_id),
                )
                .await?,
        ),
    };
    if let Some(older) = store::begin_setup(ctx.pool, status.conversation_id, prompt).await? {
        // A second /setup: only the newest prompt keeps its button.
        ctx.api.remove_buttons(msg.chat.tg_chat_id, older).await?;
    }
    tracing::info!(
        conversation_id = status.conversation_id,
        "asked what this conversation is for"
    );
    Ok(())
}

pub const ALREADY_ANSWERED_TOAST: &str = "That question was already answered.";

/// A tapped inline button: an answer to one of the agent's choices goes to
/// the agent; anything else (old setup presets, closed questions) is stale.
async fn handle_button<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    press: &ButtonPress,
) -> Result<(), HandleError> {
    let chat = press.chat.tg_chat_id;
    if let Some(tap) = wipe::parse(&press.data) {
        return handle_wipe_tap(ctx, press, tap).await;
    }
    if let Some(conversation_id) = setup::parse_keep(&press.data) {
        return handle_keep_tap(ctx, press, conversation_id).await;
    }
    let Some((question_id, index)) = turns::parse_answer_button(&press.data) else {
        ctx.api
            .answer_button(&press.callback_id, Some(setup::STALE_BUTTON_TOAST))
            .await?;
        ctx.api.remove_buttons(chat, press.message_id).await?;
        return Ok(());
    };
    let Some(claimed) =
        store::claim_answer(ctx.pool, question_id, index, chat, press.topic_id).await?
    else {
        ctx.api
            .answer_button(&press.callback_id, Some(ALREADY_ANSWERED_TOAST))
            .await?;
        ctx.api.remove_buttons(chat, press.message_id).await?;
        return Ok(());
    };

    // Show the choice under the question (this also drops the buttons).
    let shown = format!("{}\n\n👉 {}", claimed.question, claimed.answer);
    ctx.api.edit_text(chat, press.message_id, &shown).await?;
    ctx.api
        .answer_button(&press.callback_id, Some("Sent"))
        .await?;
    tracing::info!(
        conversation_id = claimed.conversation_id,
        question_id,
        "choice tapped"
    );

    ctx.turns.submit(TurnJob {
        conversation_id: claimed.conversation_id,
        tg_chat_id: chat,
        topic_id: press.topic_id,
        reply_to: press.message_id,
        text: claimed.answer,
        is_voice: false,
        sender_name: press.from_name.clone(),
        sender_id: press.from_user_id,
        sent_at: Utc::now(),
        reply: None,
    });
    Ok(())
}

/// "Keep the current purpose": AwaitingPurpose → Ready, only in its own topic
/// and only while there's still a purpose waiting to be replaced.
async fn handle_keep_tap<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    press: &ButtonPress,
    conversation_id: i64,
) -> Result<(), HandleError> {
    let chat = press.chat.tg_chat_id;
    let here = store::find_conversation(ctx.pool, chat, press.topic_id).await?;
    if here != Some(conversation_id) {
        ctx.api
            .answer_button(&press.callback_id, Some(setup::OTHER_TOPIC_TOAST))
            .await?;
        return Ok(());
    }
    match store::keep_purpose(ctx.pool, conversation_id).await? {
        Some(_) => {
            ctx.api
                .edit_text(chat, press.message_id, setup::KEPT)
                .await?;
            ctx.api.answer_button(&press.callback_id, None).await?;
            tracing::info!(conversation_id, "kept the current purpose");
        }
        None => {
            ctx.api
                .answer_button(&press.callback_id, Some(setup::NOTHING_TO_KEEP_TOAST))
                .await?;
            ctx.api.remove_buttons(chat, press.message_id).await?;
        }
    }
    Ok(())
}

/// `/new` or `/forget`: explains what will be deleted, with Yes / Cancel buttons.
async fn ask_to_wipe<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    msg: &InboundMessage,
    kind: wipe::WipeKind,
) -> Result<(), HandleError> {
    let s = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
    ctx.api
        .send_buttons(
            msg.chat.tg_chat_id,
            msg.topic_id,
            Some(msg.message_id),
            &wipe::prompt(kind, &s.place(), s.message_count),
            &wipe::buttons(kind, s.conversation_id, Utc::now().timestamp()),
        )
        .await?;
    Ok(())
}

/// Wipes the conversation (see [`wipe::run`]) and returns what to tell the admin.
async fn perform_wipe<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    status: &ConversationStatus,
    kind: wipe::WipeKind,
) -> Result<String, HandleError> {
    let wiped = wipe::run(ctx.pool, ctx.projects, ctx.agents_dir, status, kind).await?;
    Ok(wipe::done(kind, wiped))
}

/// A tap on a /new or /forget confirmation.
async fn handle_wipe_tap<A: TelegramApi, T: Transcriber>(
    ctx: &Ctx<'_, A, T>,
    press: &ButtonPress,
    tap: wipe::WipeTap,
) -> Result<(), HandleError> {
    let chat = press.chat.tg_chat_id;
    let here = store::find_conversation(ctx.pool, chat, press.topic_id).await?;
    if here != Some(tap.conversation_id) {
        ctx.api
            .answer_button(&press.callback_id, Some(wipe::WRONG_PLACE_TOAST))
            .await?;
        return Ok(());
    }
    if wipe::is_expired(tap.issued_at, Utc::now().timestamp()) {
        ctx.api
            .answer_button(&press.callback_id, Some(wipe::EXPIRED_TOAST))
            .await?;
        ctx.api.remove_buttons(chat, press.message_id).await?;
        return Ok(());
    }
    let kind = match tap.button {
        wipe::WipeButton::Cancel => {
            ctx.api
                .edit_text(chat, press.message_id, wipe::CANCELLED)
                .await?;
            ctx.api.answer_button(&press.callback_id, None).await?;
            return Ok(());
        }
        wipe::WipeButton::Confirm(kind) => kind,
    };

    let status = store::conversation_status_by_id(ctx.pool, tap.conversation_id).await?;
    let text = match perform_wipe(ctx, &status, kind).await {
        Ok(text) => text,
        Err(err) => {
            // Fail loud in place of the confirmation.
            let context =
                json!({ "conversation_id": tap.conversation_id, "error": err.to_string() });
            let id = errors::record(ctx.pool, err.kind(), &err.to_string(), context).await?;
            format!("❌ Failed ({id}): {}. Check logs.", short_reason(&err))
        }
    };
    ctx.api.edit_text(chat, press.message_id, &text).await?;
    ctx.api.answer_button(&press.callback_id, None).await?;
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
                match (&s.thread_id, &s.thread_link) {
                    (Some(_), Some(link)) => link.clone(),
                    (Some(id), None) => id.clone(),
                    (None, _) => "none yet (your next message starts one)".to_string(),
                },
            )
        }
        Command::New { confirmed: false } => {
            return ask_to_wipe(ctx, msg, wipe::WipeKind::New).await;
        }
        Command::New { confirmed: true } => {
            let s = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
            perform_wipe(ctx, &s, wipe::WipeKind::New).await?
        }
        Command::Forget { confirmed: false } => {
            return ask_to_wipe(ctx, msg, wipe::WipeKind::Forget).await;
        }
        Command::Forget { confirmed: true } => {
            let s = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
            perform_wipe(ctx, &s, wipe::WipeKind::Forget).await?
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
        HandleError::T3(_) => "couldn't delete this topic's T3 threads, so nothing was wiped",
        HandleError::Media(_) => "couldn't receive that file",
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
pub struct RunSettings<A: TelegramApi, T: Transcriber> {
    pub rules: Rules,
    pub bot_username: String,
    pub transcriber: T,
    /// Absolute path of the conversation folders.
    pub agents_dir: std::path::PathBuf,
    pub agent_label: String,
    pub api: Arc<A>,
    /// The agent lanes (shared with the internal API).
    pub turns: Arc<dyn TurnQueue>,
    pub projects: Arc<dyn ProjectCleaner>,
}

/// Where an update is handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Nothing Herbot acts on.
    Skip,
    /// Quick and never stored: ignored updates (strangers, DMs, other
    /// groups), leaving chats, and chat or topic bookkeeping.
    Inline,
    /// The admin's message, command or button tap: saved to the inbox, then
    /// handled in order on its conversation's lane.
    Lane(LaneKey),
}

/// A conversation: (Telegram chat, topic). `None` is General.
pub type LaneKey = (i64, Option<i32>);

pub fn route(update: &Update, bot_username: &str, rules: &Rules) -> Route {
    let Some(inbound) = telegram::normalize(update, bot_username) else {
        return Route::Skip;
    };
    match policy::decide(inbound, rules) {
        Action::Store(msg) | Action::RunCommand(msg, _) => {
            Route::Lane((msg.chat.tg_chat_id, msg.topic_id))
        }
        Action::Button(press) => Route::Lane((press.chat.tg_chat_id, press.topic_id)),
        _ => Route::Inline,
    }
}

struct Shared<A: TelegramApi, T: Transcriber> {
    pool: PgPool,
    settings: RunSettings<A, T>,
}

impl<A: TelegramApi, T: Transcriber> Shared<A, T> {
    fn ctx(&self) -> Ctx<'_, A, T> {
        let s = &self.settings;
        Ctx {
            pool: &self.pool,
            api: &*s.api,
            transcriber: &s.transcriber,
            rules: s.rules,
            bot_username: &s.bot_username,
            agents_dir: &s.agents_dir,
            agent_label: &s.agent_label,
            turns: &*s.turns,
            projects: &*s.projects,
        }
    }
}

/// One worker per conversation, created on first use. Each handles its
/// conversation's updates in order (a voice note, then the text after it);
/// conversations run side by side, so a long voice note holds up only its
/// own topic.
pub struct InboundLanes<A: TelegramApi + 'static, T: Transcriber + Send + 'static> {
    shared: Arc<Shared<A, T>>,
    senders: std::sync::Mutex<std::collections::HashMap<LaneKey, mpsc::UnboundedSender<Update>>>,
    workers: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl<A: TelegramApi + 'static, T: Transcriber + Send + 'static> InboundLanes<A, T> {
    pub fn new(pool: PgPool, settings: RunSettings<A, T>) -> Self {
        Self {
            shared: Arc::new(Shared { pool, settings }),
            senders: Default::default(),
            workers: Default::default(),
        }
    }

    pub fn route(&self, update: &Update) -> Route {
        let s = &self.shared.settings;
        route(update, &s.bot_username, &s.rules)
    }

    /// Handles an update right here (for [`Route::Inline`]).
    pub async fn handle_inline(&self, update: &Update) {
        process(&self.shared.ctx(), update).await;
    }

    /// Queues an update on its conversation's lane. It must already be in
    /// the inbox; the lane deletes it from there once handled.
    pub fn submit(&self, key: LaneKey, update: Update) {
        let mut senders = self.senders.lock().expect("inbound lanes lock");
        let sender = senders.entry(key).or_insert_with(|| self.spawn_lane());
        if let Err(returned) = sender.send(update) {
            // The worker is gone (it shouldn't be); start another.
            let fresh = self.spawn_lane();
            let _ = fresh.send(returned.0);
            senders.insert(key, fresh);
        }
    }

    fn spawn_lane(&self) -> mpsc::UnboundedSender<Update> {
        let (tx, mut rx) = mpsc::unbounded_channel::<Update>();
        let shared = self.shared.clone();
        let worker = tokio::spawn(async move {
            while let Some(update) = rx.recv().await {
                process(&shared.ctx(), &update).await;
                let update_id = i64::from(update.id.0);
                if let Err(err) = store::inbox_done(&shared.pool, update_id).await {
                    // It stays in the inbox and runs again at the next start.
                    tracing::error!(update_id, error = %err, "could not clear a handled update from the inbox");
                }
            }
        });
        self.workers
            .lock()
            .expect("inbound workers lock")
            .push(worker);
        tx
    }

    /// Waits up to `limit` for queued updates to finish. Anything unfinished
    /// stays in the inbox and is handled at the next start.
    pub async fn finish(&self, limit: Duration) {
        self.senders.lock().expect("inbound lanes lock").clear(); // workers end when their queue empties
        let workers: Vec<_> =
            std::mem::take(&mut *self.workers.lock().expect("inbound workers lock"));
        if tokio::time::timeout(limit, futures_join_all(workers))
            .await
            .is_err()
        {
            tracing::warn!(
                "some updates were still being handled at shutdown; they run again at the next start"
            );
        }
    }

    /// Handles what a previous run saved but didn't finish, in order, before
    /// anything new.
    pub async fn resume(&self) {
        let pool = &self.shared.pool;
        let pending = match store::inbox_pending(pool).await {
            Ok(pending) => pending,
            Err(err) => {
                let _ =
                    errors::record(pool, "telegram.inbox_load", &err.to_string(), json!({})).await;
                return;
            }
        };
        if !pending.is_empty() {
            tracing::info!(
                count = pending.len(),
                "handling updates left from the last run"
            );
        }
        for (update_id, body) in pending {
            match serde_json::from_value::<Update>(body) {
                Ok(update) => match self.route(&update) {
                    Route::Lane(key) => self.submit(key, update),
                    other => {
                        if other == Route::Inline {
                            self.handle_inline(&update).await;
                        }
                        let _ = store::inbox_done(pool, update_id).await;
                    }
                },
                Err(err) => {
                    let context = json!({ "update_id": update_id });
                    let _ = errors::record(
                        pool,
                        "telegram.inbox_unreadable",
                        &err.to_string(),
                        context,
                    )
                    .await;
                    let _ = store::inbox_done(pool, update_id).await;
                }
            }
        }
    }
}

async fn futures_join_all(workers: Vec<tokio::task::JoinHandle<()>>) {
    for worker in workers {
        let _ = worker.await;
    }
}

pub async fn run<T: Transcriber + Send + 'static>(
    bot: Bot,
    pool: PgPool,
    settings: RunSettings<BotApi, T>,
    mut shutdown: watch::Receiver<bool>,
) {
    let bot_username = settings.bot_username.clone();
    let lanes = InboundLanes::new(pool.clone(), settings);

    let mut offset = match store::load_offset(&pool).await {
        Ok(offset) => offset,
        Err(err) => {
            let _ =
                errors::record(&pool, "telegram.offset_load", &err.to_string(), json!({})).await;
            None
        }
    };
    lanes.resume().await;
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

        let updates = match result {
            Ok(updates) => updates,
            Err(err) => {
                let _ = errors::record(&pool, "telegram.poll_failed", &err.to_string(), json!({}))
                    .await;
                tokio::select! {
                    _ = tokio::time::sleep(POLL_RETRY_DELAY) => {},
                    _ = shutdown.changed() => break,
                }
                continue;
            }
        };
        let Some(last) = updates.last() else { continue };
        let next = last.id.0 as i32 + 1;

        let mut queued = Vec::new();
        for update in &updates {
            match lanes.route(update) {
                Route::Skip => {}
                Route::Inline => lanes.handle_inline(update).await,
                Route::Lane(key) => queued.push((key, update)),
            }
        }
        let saved: Vec<(i64, serde_json::Value)> = queued
            .iter()
            .filter_map(|(_, u)| Some((i64::from(u.id.0), serde_json::to_value(u).ok()?)))
            .collect();
        if let Err(err) = store::inbox_save(&pool, &saved, next).await {
            // Not acknowledged: Telegram sends the batch again.
            let _ = errors::record(
                &pool,
                "telegram.inbox_save",
                &err.to_string(),
                json!({ "offset": next }),
            )
            .await;
            tokio::select! {
                _ = tokio::time::sleep(POLL_RETRY_DELAY) => {},
                _ = shutdown.changed() => break,
            }
            continue;
        }
        offset = Some(next);
        for (key, update) in queued {
            lanes.submit(key, update.clone());
        }
    }
    lanes.finish(Duration::from_secs(10)).await;
    tracing::info!("telegram polling stopped");
}
