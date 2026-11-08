//! Telegram long-polling and the handler that carries out policy decisions.
//!
//! All Telegram calls go through [`TelegramApi`], so tests run the real
//! handler against a fake API and a real database.

use std::future::Future;
use std::time::Duration;

use serde_json::json;
use sqlx::PgPool;
use teloxide::prelude::*;
use teloxide::types::{
    AllowedUpdate, BotCommand, BotCommandScope, CallbackQueryId, ChatId as TgChatId,
    InlineKeyboardButton, InlineKeyboardMarkup, MessageId, ReplyParameters, ThreadId,
};
use tokio::sync::watch;

use crate::errors::{self, ErrorId};
use crate::policy::{self, Action, Rules};
use crate::setup;
use crate::store::{self, SetupState, StoreOutcome};
use crate::telegram::{self, ButtonPress, ChatKind, Command, Inbound, InboundMessage};

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
}

/// Everything the handler needs.
pub struct Ctx<'a, A: TelegramApi> {
    pub pool: &'a PgPool,
    pub api: &'a A,
    pub rules: Rules,
    pub bot_username: &'a str,
}

#[derive(Debug, thiserror::Error)]
pub enum HandleError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Api(#[from] ApiError),
}

impl HandleError {
    fn kind(&self) -> &'static str {
        match self {
            HandleError::Db(_) => "telegram.handle_db",
            HandleError::Api(_) => "telegram.handle_api",
        }
    }
}

pub const HELP_TEXT: &str = "Herbot: your private bot.\n\n\
General is the everyday chat. Every other topic is its own agent with its own memory.\n\n\
/setup: set what this conversation is for\n\
/status: this conversation's details\n\
/new: start a fresh thread here\n\
/forget: wipe this conversation's thread and history\n\
/help: this list";

pub const WELCOME_TEXT: &str = "👋 Herbot is here. General is our everyday chat. Every other topic is its own agent: say anything in a new topic and I'll ask what it should be.";

/// Handles one update: normalize, decide, act.
pub async fn handle_update<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
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

async fn apply<A: TelegramApi>(ctx: &Ctx<'_, A>, action: Action) -> Result<(), HandleError> {
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
        Action::Store(msg) => match store::store_message(ctx.pool, &msg).await? {
            StoreOutcome::Stored {
                conversation_id,
                message_row_id,
            } => {
                tracing::info!(conversation_id, message_row_id, "stored admin message");
                continue_setup(ctx, &msg, conversation_id).await?;
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
        },
        Action::RunCommand(msg, cmd) => run_command(ctx, &msg, cmd).await?,
        Action::Button(press) => handle_button(ctx, &press).await?,
    }
    Ok(())
}

/// Moves a conversation's setup along after an admin message was stored:
/// a new conversation gets the greeting, and while we're waiting for a
/// purpose, the message becomes it.
async fn continue_setup<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
    msg: &InboundMessage,
    conversation_id: i64,
) -> Result<(), HandleError> {
    let status = store::conversation_status_by_id(ctx.pool, conversation_id).await?;
    match status.setup_state {
        // General (no topic) is the everyday chat: set it up silently.
        SetupState::New if status.tg_topic_id.is_none() => {
            store::set_purpose(ctx.pool, conversation_id, setup::default_general_purpose()).await?;
            tracing::info!(
                conversation_id,
                "general chat set up with the default purpose"
            );
            Ok(())
        }
        // A new topic: ask what this agent should be.
        SetupState::New => send_greeting(ctx, msg, &status).await,
        SetupState::AwaitingPurpose => match setup::validate_purpose(&msg.text) {
            Ok(purpose) => {
                let old_prompt = store::set_purpose(ctx.pool, conversation_id, &purpose).await?;
                if let Some(prompt) = old_prompt {
                    ctx.api.remove_buttons(msg.chat.tg_chat_id, prompt).await?;
                }
                tracing::info!(conversation_id, "conversation purpose set (typed)");
                let text = setup::confirmation(&status.place(), &purpose);
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
            Err(problem) => {
                ctx.api
                    .send_text(
                        msg.chat.tg_chat_id,
                        msg.topic_id,
                        Some(msg.message_id),
                        &problem.to_string(),
                    )
                    .await?;
                Ok(())
            }
        },
        // Step 4 sends the message to the conversation's T3 thread here.
        SetupState::Ready => Ok(()),
    }
}

async fn send_greeting<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
    msg: &InboundMessage,
    status: &store::ConversationStatus,
) -> Result<(), HandleError> {
    let prompt_id = ctx
        .api
        .send_buttons(
            msg.chat.tg_chat_id,
            msg.topic_id,
            Some(msg.message_id),
            &setup::greeting(&status.place()),
            &setup::preset_buttons(),
        )
        .await?;
    store::begin_setup(ctx.pool, status.conversation_id, Some(prompt_id)).await?;
    tracing::info!(
        conversation_id = status.conversation_id,
        "asked what this conversation is for"
    );
    Ok(())
}

/// A tapped inline button. Today only setup presets exist; Step 6 adds
/// answers to the bot's questions.
async fn handle_button<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
    press: &ButtonPress,
) -> Result<(), HandleError> {
    let Some(preset) = setup::preset_from_button(&press.data) else {
        ctx.api
            .answer_button(
                &press.callback_id,
                Some("That button doesn't do anything anymore."),
            )
            .await?;
        return Ok(());
    };
    let Some(conversation_id) =
        store::find_conversation(ctx.pool, press.chat.tg_chat_id, press.topic_id).await?
    else {
        ctx.api
            .answer_button(
                &press.callback_id,
                Some("I don't know this conversation yet."),
            )
            .await?;
        return Ok(());
    };

    let status = store::conversation_status_by_id(ctx.pool, conversation_id).await?;
    let old_prompt = store::set_purpose(ctx.pool, conversation_id, preset.purpose).await?;
    tracing::info!(
        conversation_id,
        preset = preset.key,
        "conversation purpose set (preset)"
    );

    // Turn the tapped greeting into the confirmation (this also drops its
    // buttons), and clear buttons from any other pending greeting.
    let text = setup::confirmation(&status.place(), preset.purpose);
    ctx.api
        .edit_text(press.chat.tg_chat_id, press.message_id, &text)
        .await?;
    if let Some(prompt) = old_prompt.filter(|p| *p != press.message_id) {
        ctx.api
            .remove_buttons(press.chat.tg_chat_id, prompt)
            .await?;
    }
    ctx.api
        .answer_button(&press.callback_id, Some("Saved"))
        .await?;
    Ok(())
}

async fn run_command<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
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
            format!(
                "📍 {}\nConversation #{} · {} messages stored\nPurpose: {}\nThread: {}",
                s.place(),
                s.conversation_id,
                s.message_count,
                s.purpose.as_deref().unwrap_or("not set yet (send /setup)"),
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
pub async fn process<A: TelegramApi>(ctx: &Ctx<'_, A>, update: &Update) -> Option<ErrorId> {
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
pub async fn run(
    bot: Bot,
    pool: PgPool,
    rules: Rules,
    bot_username: String,
    mut shutdown: watch::Receiver<bool>,
) {
    let api = BotApi(bot.clone());
    let ctx = Ctx {
        pool: &pool,
        api: &api,
        rules,
        bot_username: &bot_username,
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
