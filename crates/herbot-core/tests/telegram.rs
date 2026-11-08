//! Step 2: Telegram updates through the real handler.
//!
//! Each test loads real Bot API JSON from `tests/fixtures/`, runs it through
//! `poller::process` with a real (fresh) database and a fake Telegram API that
//! records every call, then checks what was stored and what was sent.

use std::sync::Mutex;

use serde_json::Value;
use sqlx::PgPool;
use teloxide::types::Update;

use herbot_core::poller::{self, ApiError, Ctx, HELP_TEXT, TelegramApi, WELCOME_TEXT};
use herbot_core::store;
use herbot_core::telegram::{self, ChatKind, Command, Inbound};

const ADMIN: u64 = 111;
const BOT: &str = "herbot_test_bot";
const HQ: i64 = -1001234567890;
const SIDE: i64 = -4000000001;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    Send {
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: String,
    },
    Leave {
        chat: i64,
    },
}

#[derive(Default)]
struct FakeApi {
    calls: Mutex<Vec<Call>>,
    fail_sends: bool,
}

impl FakeApi {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn sent_texts(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter_map(|c| match c {
                Call::Send { text, .. } => Some(text),
                Call::Leave { .. } => None,
            })
            .collect()
    }
}

impl TelegramApi for FakeApi {
    async fn send_text(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> Result<(), ApiError> {
        self.calls.lock().unwrap().push(Call::Send {
            chat: chat_id,
            topic: topic_id,
            reply_to,
            text: text.to_string(),
        });
        if self.fail_sends {
            Err(ApiError("fake send failure".into()))
        } else {
            Ok(())
        }
    }

    async fn leave_chat(&self, chat_id: i64) -> Result<(), ApiError> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Leave { chat: chat_id });
        Ok(())
    }
}

fn fixture(name: &str) -> Update {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{name} is not a valid Update: {e}"))
}

async fn run(pool: &PgPool, api: &FakeApi, names: &[&str]) {
    let ctx = Ctx {
        pool,
        api,
        admin_user_id: ADMIN,
        bot_username: BOT,
    };
    for name in names {
        assert!(
            poller::process(&ctx, &fixture(name)).await.is_none(),
            "{name} failed"
        );
    }
}

async fn count(pool: &PgPool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

// ---- normalize: every fixture parses into what we expect ----

#[test]
fn every_fixture_normalizes_as_expected() {
    let n = |name| telegram::normalize(&fixture(name), BOT);

    let Some(Inbound::Message(m)) = n("admin_topic_text") else {
        panic!("topic text")
    };
    assert_eq!((m.chat.tg_chat_id, m.topic_id), (HQ, Some(7)));
    assert_eq!(m.chat.kind, ChatKind::Supergroup);
    assert!(m.chat.is_forum);
    assert_eq!(
        m.reply_to_message_id, None,
        "topic root is not a real reply"
    );

    let Some(Inbound::Message(m)) = n("admin_topic_reply") else {
        panic!("topic reply")
    };
    assert_eq!(m.reply_to_message_id, Some(21), "real replies are kept");

    let Some(Inbound::Message(m)) = n("admin_general_text") else {
        panic!("general")
    };
    assert_eq!(m.topic_id, None, "General has no topic id");

    let Some(Inbound::Message(m)) = n("admin_status_in_topic") else {
        panic!("status")
    };
    assert_eq!(m.command, Some(Command::Status));

    let Some(Inbound::Message(m)) = n("admin_photo_caption") else {
        panic!("caption")
    };
    assert_eq!(m.text, "what is this chart?");

    assert_eq!(n("admin_sticker"), None, "no text, nothing to store");
    assert_eq!(
        n("admin_command_other_bot"),
        None,
        "command for another bot"
    );
    assert_eq!(n("channel_post"), None, "channels are ignored");

    assert!(matches!(
        n("added_by_admin"),
        Some(Inbound::AddedToChat {
            by_user_id: 111,
            ..
        })
    ));
    assert!(matches!(
        n("removed_from_group"),
        Some(Inbound::RemovedFromChat { .. })
    ));
    assert!(matches!(
        n("topic_created"),
        Some(Inbound::TopicCreated { topic_id: 9, ref name, .. }) if name == "Daily News"
    ));
    assert!(matches!(
        n("group_renamed"),
        Some(Inbound::ChatRenamed { ref title, .. }) if title == "Side Project v2"
    ));
}

// ---- admin messages: stored per conversation ----

#[sqlx::test(migrations = "./migrations")]
async fn admin_messages_are_stored_per_conversation(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &[
            "admin_dm_text",
            "admin_topic_text",
            "admin_topic_reply",
            "admin_other_topic_text",
            "admin_general_text",
            "admin_photo_caption",
        ],
    )
    .await;

    // DM, topic 7, topic 9, General = 4 conversations.
    assert_eq!(count(&pool, "SELECT count(*) FROM conversations").await, 4);
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 6);

    let per_conversation: Vec<(Option<i32>, i64)> = sqlx::query_as(
        "SELECT v.tg_topic_id, count(m.id) FROM conversations v
         JOIN chats c ON c.id = v.chat_id
         LEFT JOIN messages m ON m.conversation_id = v.id
         WHERE c.tg_chat_id = $1 GROUP BY v.tg_topic_id ORDER BY v.tg_topic_id NULLS FIRST",
    )
    .bind(HQ)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(per_conversation, [(None, 1), (Some(7), 2), (Some(9), 1)]);

    let reply_to: Option<i32> =
        sqlx::query_scalar("SELECT reply_to_tg_message_id FROM messages WHERE tg_message_id = 22")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(reply_to, Some(21));

    assert!(
        api.calls().is_empty(),
        "plain messages get no reply in Step 2"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn redelivered_updates_are_not_stored_twice(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_dm_text", "admin_dm_text"]).await;
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn disabled_conversations_store_nothing(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text"]).await;
    sqlx::query("UPDATE conversations SET enabled = false")
        .execute(&pool)
        .await
        .unwrap();
    run(&pool, &api, &["admin_topic_reply"]).await;
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 1);
}

// ---- everyone else: silence ----

#[sqlx::test(migrations = "./migrations")]
async fn strangers_and_bots_get_silence_and_nothing_is_stored(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &["stranger_dm_text", "other_bot_in_group", "channel_post"],
    )
    .await;
    assert!(api.calls().is_empty(), "no reply to anyone but the admin");
    assert_eq!(count(&pool, "SELECT count(*) FROM chats").await, 0);
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 0);
}

// ---- membership ----

#[sqlx::test(migrations = "./migrations")]
async fn added_by_admin_registers_and_welcomes(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["added_by_admin"]).await;
    let (status, added_by): (String, Option<i64>) =
        sqlx::query_as("SELECT status, added_by_tg_user_id FROM chats WHERE tg_chat_id = $1")
            .bind(SIDE)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), added_by), ("active", Some(111)));
    assert_eq!(api.sent_texts(), [WELCOME_TEXT]);
}

#[sqlx::test(migrations = "./migrations")]
async fn added_by_stranger_leaves_and_audits(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["added_by_stranger"]).await;
    assert_eq!(api.calls(), [Call::Leave { chat: -4000000002 }]);
    assert_eq!(count(&pool, "SELECT count(*) FROM chats").await, 0);
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM audit_log WHERE action = 'left_chat_added_by_stranger'"
        )
        .await,
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn removal_marks_chat_left_and_re_adding_reactivates(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["added_by_admin", "removed_from_group"]).await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "left");

    run(&pool, &api, &["added_by_admin"]).await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "active");
}

#[sqlx::test(migrations = "./migrations")]
async fn topic_names_and_renames_are_recorded(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &["topic_created", "added_by_admin", "group_renamed"],
    )
    .await;
    let topic: String = sqlx::query_scalar(
        "SELECT v.name FROM conversations v JOIN chats c ON c.id = v.chat_id
         WHERE c.tg_chat_id = $1 AND v.tg_topic_id = 9",
    )
    .bind(HQ)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(topic, "Daily News");
    let title: String = sqlx::query_scalar("SELECT title FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "Side Project v2");
}

// ---- commands ----

#[sqlx::test(migrations = "./migrations")]
async fn status_reports_this_conversation_in_its_topic(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text", "admin_topic_reply"]).await;
    // Normally the name comes from the "topic created" event; set it directly.
    sqlx::query("UPDATE conversations SET name = 'Research' WHERE tg_topic_id = 7")
        .execute(&pool)
        .await
        .unwrap();
    run(&pool, &api, &["admin_status_in_topic"]).await;

    let calls = api.calls();
    let Call::Send {
        chat,
        topic,
        reply_to,
        text,
    } = &calls[0]
    else {
        panic!("expected a reply")
    };
    assert_eq!((*chat, *topic, *reply_to), (HQ, Some(7), Some(23)));
    assert!(text.contains("Herbot HQ › Research"), "{text}");
    assert!(text.contains("2 messages stored"), "{text}");
    assert!(text.contains("none yet (Step 4)"), "{text}");
}

#[sqlx::test(migrations = "./migrations")]
async fn status_in_dm_and_placeholder_commands(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &["admin_dm_text", "admin_status_dm", "admin_new_dm"],
    )
    .await;
    let texts = api.sent_texts();
    assert!(texts[0].starts_with("📍 Direct messages"), "{}", texts[0]);
    assert!(texts[0].contains("1 messages stored"), "{}", texts[0]);
    assert!(texts[1].contains("arrives in Step 4"), "{}", texts[1]);
    assert_eq!(
        count(&pool, "SELECT count(*) FROM messages").await,
        1,
        "commands are not stored as conversation text"
    );
}

#[test]
fn help_lists_every_menu_command() {
    for (name, _) in telegram::COMMAND_MENU {
        assert!(
            HELP_TEXT.contains(&format!("/{name}")),
            "/{name} missing from help"
        );
    }
}

// ---- fail loud ----

#[sqlx::test(migrations = "./migrations")]
async fn failures_are_recorded_and_reported_to_the_admin(pool: PgPool) {
    let api = FakeApi {
        fail_sends: true,
        ..Default::default()
    };
    let ctx = Ctx {
        pool: &pool,
        api: &api,
        admin_user_id: ADMIN,
        bot_username: BOT,
    };
    let error_id = poller::process(&ctx, &fixture("admin_status_dm"))
        .await
        .expect("a failed /status reply must produce an error id");

    let (kind, context): (String, Value) =
        sqlx::query_as("SELECT kind, context FROM errors WHERE id = $1")
            .bind(error_id.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "telegram.handle_api");
    assert_eq!(context["update_id"], 1007);

    let texts = api.sent_texts();
    assert_eq!(texts.len(), 2, "the /status reply, then the failure notice");
    assert_eq!(
        texts[1],
        format!("❌ Failed ({error_id}): Telegram API error. Check logs.")
    );
}

// ---- offset ----

#[sqlx::test(migrations = "./migrations")]
async fn poll_offset_round_trips(pool: PgPool) {
    assert_eq!(store::load_offset(&pool).await.unwrap(), None);
    store::save_offset(&pool, 1020).await.unwrap();
    store::save_offset(&pool, 1021).await.unwrap();
    assert_eq!(store::load_offset(&pool).await.unwrap(), Some(1021));
}
