//! Telegram long-polling and the handler that carries out policy decisions.
//!
//! All Telegram calls go through [`TelegramApi`], so tests run the real
//! handler against a fake API and a real database.

use std::future::Future;
use std::time::Duration;

use serde_json::json;
use sqlx::PgPool;
use teloxide::prelude::*;
use teloxide::types::{AllowedUpdate, BotCommand, MessageId, ReplyParameters, ThreadId};
use tokio::sync::watch;

use crate::errors::{self, ErrorId};
use crate::policy::{self, Action};
use crate::store::{self, StoreOutcome};
use crate::telegram::{self, ChatKind, Command, Inbound, InboundMessage};

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

    fn leave_chat(&self, chat_id: i64) -> impl Future<Output = Result<(), ApiError>> + Send;
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

    async fn leave_chat(&self, chat_id: i64) -> Result<(), ApiError> {
        self.0
            .leave_chat(ChatId(chat_id))
            .await
            .map(|_| ())
            .map_err(|e| ApiError(e.to_string()))
    }
}

/// Everything the handler needs.
pub struct Ctx<'a, A: TelegramApi> {
    pub pool: &'a PgPool,
    pub api: &'a A,
    pub admin_user_id: u64,
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
Every chat, and every topic in a forum group, is its own conversation with its own memory.\n\n\
/status: this conversation's details\n\
/new: start a fresh thread here\n\
/forget: wipe this conversation's thread and history\n\
/help: this list";

pub const WELCOME_TEXT: &str = "👋 Herbot is here. Each topic in this group is its own conversation. Send /status in any topic to check.";

/// Handles one update: normalize, decide, act.
pub async fn handle_update<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
    update: &Update,
) -> Result<(), HandleError> {
    let Some(inbound) = telegram::normalize(update, ctx.bot_username) else {
        tracing::debug!(update_id = update.id.0, "update not relevant to Herbot");
        return Ok(());
    };
    let action = policy::decide(inbound, ctx.admin_user_id);
    tracing::debug!(update_id = update.id.0, ?action, "policy decision");
    apply(ctx, action).await
}

async fn apply<A: TelegramApi>(ctx: &Ctx<'_, A>, action: Action) -> Result<(), HandleError> {
    match action {
        Action::Ignore { reason } => {
            tracing::info!(reason, "ignored update");
        }
        Action::Leave { chat, added_by } => {
            tracing::warn!(
                chat_id = chat.tg_chat_id,
                added_by,
                "added by someone else; leaving"
            );
            if chat.kind != ChatKind::Private {
                ctx.api.leave_chat(chat.tg_chat_id).await?;
            }
            store::audit(
                ctx.pool,
                "left_chat_added_by_stranger",
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
    }
    Ok(())
}

async fn run_command<A: TelegramApi>(
    ctx: &Ctx<'_, A>,
    msg: &InboundMessage,
    cmd: Command,
) -> Result<(), HandleError> {
    let text = match cmd {
        Command::Start | Command::Help => HELP_TEXT.to_string(),
        Command::Status => {
            let s = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
            let place = match (msg.chat.kind, msg.topic_id, &s.topic_name) {
                (ChatKind::Private, _, _) => "Direct messages".to_string(),
                (_, Some(_), Some(name)) => format!("{} › {}", s.chat_title, name),
                (_, Some(id), None) => format!("{} › topic {}", s.chat_title, id),
                (_, None, _) if msg.chat.is_forum => format!("{} › General", s.chat_title),
                (_, None, _) => s.chat_title.clone(),
            };
            format!(
                "📍 {place}\nConversation #{} · {} messages stored\nPersona: {}\nThread: {}",
                s.conversation_id,
                s.message_count,
                s.bot_name.as_deref().unwrap_or("none yet (Step 3)"),
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
        && msg.from_user_id == ctx.admin_user_id
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

/// Registers the `/` command menu shown in Telegram.
pub async fn register_commands(bot: &Bot) -> Result<(), teloxide::RequestError> {
    let commands = telegram::COMMAND_MENU
        .iter()
        .map(|(name, description)| BotCommand::new(*name, *description));
    bot.set_my_commands(commands).await.map(|_| ())
}

/// Long-polls Telegram until `shutdown` flips to true.
pub async fn run(
    bot: Bot,
    pool: PgPool,
    admin_user_id: u64,
    bot_username: String,
    mut shutdown: watch::Receiver<bool>,
) {
    let api = BotApi(bot.clone());
    let ctx = Ctx {
        pool: &pool,
        api: &api,
        admin_user_id,
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
            .allowed_updates(vec![AllowedUpdate::Message, AllowedUpdate::MyChatMember]);
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
