//! Telegram updates through the real handler (Steps 2 and 3).
//!
//! Each test loads real Bot API JSON from `tests/fixtures/`, runs it through
//! `poller::process` with a real (fresh) database and a fake Telegram API that
//! records every call, then checks what was stored and what was sent.
//!
//! Default rules match production: admin 111, locked to the "Herbot HQ"
//! forum group. DMs are silent; General is the everyday chat; each topic is
//! its own agent and asks what it should be.

use std::sync::Mutex;
use std::sync::atomic::{AtomicI32, Ordering};

use serde_json::Value;
use sqlx::PgPool;
use teloxide::types::Update;

use herbot_core::policy::{LEFT_ADDED_BY_STRANGER, LEFT_OUTSIDE_HOME, Rules};
use herbot_core::poller::{self, ApiError, Ctx, HELP_TEXT, TelegramApi, WELCOME_TEXT};
use herbot_core::setup;
use herbot_core::store;
use herbot_core::telegram::{self, ChatKind, Command, Inbound};

const ADMIN: u64 = 111;
const BOT: &str = "herbot_test_bot";
const HQ: i64 = -1001234567890;
const SIDE: i64 = -4000000001;
/// The fake API numbers the bot's own messages from here.
const FIRST_BOT_MESSAGE: i32 = 500;

const LOCKED: Rules = Rules {
    admin_user_id: ADMIN,
    home_chat_id: Some(HQ),
};
const OPEN: Rules = Rules {
    admin_user_id: ADMIN,
    home_chat_id: None,
};

#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    Send {
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: String,
    },
    SendButtons {
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: String,
        rows: Vec<Vec<(String, String)>>,
    },
    Edit {
        chat: i64,
        message_id: i32,
        text: String,
    },
    RemoveButtons {
        chat: i64,
        message_id: i32,
    },
    Answer {
        callback_id: String,
        toast: Option<String>,
    },
    Leave {
        chat: i64,
    },
}

struct FakeApi {
    calls: Mutex<Vec<Call>>,
    next_id: AtomicI32,
    fail_sends: bool,
}

impl Default for FakeApi {
    fn default() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            next_id: AtomicI32::new(FIRST_BOT_MESSAGE),
            fail_sends: false,
        }
    }
}

impl FakeApi {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
    fn push(&self, call: Call) {
        self.calls.lock().unwrap().push(call);
    }
    fn sent_texts(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter_map(|c| match c {
                Call::Send { text, .. } | Call::SendButtons { text, .. } => Some(text),
                _ => None,
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
        self.push(Call::Send {
            chat: chat_id,
            topic: topic_id,
            reply_to,
            text: text.to_string(),
        });
        if self.fail_sends {
            return Err(ApiError("fake send failure".into()));
        }
        Ok(())
    }

    async fn send_buttons(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
        rows: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        self.push(Call::SendButtons {
            chat: chat_id,
            topic: topic_id,
            reply_to,
            text: text.to_string(),
            rows: rows.to_vec(),
        });
        Ok(self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    async fn edit_text(&self, chat_id: i64, message_id: i32, text: &str) -> Result<(), ApiError> {
        self.push(Call::Edit {
            chat: chat_id,
            message_id,
            text: text.to_string(),
        });
        Ok(())
    }

    async fn remove_buttons(&self, chat_id: i64, message_id: i32) -> Result<(), ApiError> {
        self.push(Call::RemoveButtons {
            chat: chat_id,
            message_id,
        });
        Ok(())
    }

    async fn answer_button(&self, callback_id: &str, toast: Option<&str>) -> Result<(), ApiError> {
        self.push(Call::Answer {
            callback_id: callback_id.to_string(),
            toast: toast.map(str::to_string),
        });
        Ok(())
    }

    async fn leave_chat(&self, chat_id: i64) -> Result<(), ApiError> {
        self.push(Call::Leave { chat: chat_id });
        Ok(())
    }
}

fn fixture(name: &str) -> Update {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{name} is not a valid Update: {e}"))
}

async fn run_with(pool: &PgPool, api: &FakeApi, rules: Rules, names: &[&str]) {
    let ctx = Ctx {
        pool,
        api,
        rules,
        bot_username: BOT,
    };
    for name in names {
        assert!(
            poller::process(&ctx, &fixture(name)).await.is_none(),
            "{name} failed"
        );
    }
}

async fn run(pool: &PgPool, api: &FakeApi, names: &[&str]) {
    run_with(pool, api, LOCKED, names).await
}

async fn count(pool: &PgPool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// (purpose, setup_state, prompt message id) of the conversation in HQ for `topic`.
async fn setup_row(pool: &PgPool, topic: Option<i32>) -> (Option<String>, String, Option<i32>) {
    sqlx::query_as(
        "SELECT v.purpose, v.setup_state, v.setup_prompt_tg_message_id
         FROM conversations v JOIN chats c ON c.id = v.chat_id
         WHERE c.tg_chat_id = $1 AND v.tg_topic_id IS NOT DISTINCT FROM $2",
    )
    .bind(HQ)
    .bind(topic)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn research() -> &'static setup::Preset {
    setup::preset_from_button("setup:research").unwrap()
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

    let Some(Inbound::Message(m)) = n("admin_setup_in_topic") else {
        panic!("setup")
    };
    assert_eq!(m.command, Some(Command::Setup));

    let Some(Inbound::Message(m)) = n("admin_photo_caption") else {
        panic!("caption")
    };
    assert_eq!(m.text, "what is this chart?");

    let Some(Inbound::ButtonPressed(press)) = n("button_research_topic7") else {
        panic!("button")
    };
    assert_eq!(
        (press.chat.tg_chat_id, press.topic_id, press.message_id),
        (HQ, Some(7), FIRST_BOT_MESSAGE)
    );
    assert_eq!(
        (press.data.as_str(), press.callback_id.as_str()),
        ("setup:research", "cb-1")
    );
    assert_eq!(press.from_user_id, ADMIN);

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

// ---- where: group only, home group only ----

#[sqlx::test(migrations = "./migrations")]
async fn direct_messages_are_completely_silent(pool: PgPool) {
    let api = FakeApi::default();
    for rules in [LOCKED, OPEN] {
        run_with(
            &pool,
            &api,
            rules,
            &[
                "admin_dm_text",
                "admin_status_dm",
                "admin_new_dm",
                "admin_photo_caption",
                "stranger_dm_text",
            ],
        )
        .await;
    }
    assert!(api.calls().is_empty(), "no reply in DMs, even to the admin");
    assert_eq!(count(&pool, "SELECT count(*) FROM chats").await, 0);
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn other_groups_are_ignored_and_left_when_locked(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_side_text", "added_by_admin"]).await;
    assert_eq!(api.calls(), [Call::Leave { chat: SIDE }]);
    assert_eq!(count(&pool, "SELECT count(*) FROM chats").await, 0);
    let action: String = sqlx::query_scalar("SELECT action FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(action, LEFT_OUTSIDE_HOME);
}

#[sqlx::test(migrations = "./migrations")]
async fn unlocked_the_admin_can_add_the_bot_to_any_group(pool: PgPool) {
    let api = FakeApi::default();
    run_with(&pool, &api, OPEN, &["added_by_admin"]).await;
    let (status, added_by): (String, Option<i64>) =
        sqlx::query_as("SELECT status, added_by_tg_user_id FROM chats WHERE tg_chat_id = $1")
            .bind(SIDE)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), added_by), ("active", Some(111)));
    assert_eq!(api.sent_texts(), [WELCOME_TEXT]);
}

// ---- who: only the admin ----

#[sqlx::test(migrations = "./migrations")]
async fn strangers_and_bots_get_silence_and_nothing_is_stored(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &[
            "stranger_in_topic",
            "other_bot_in_group",
            "channel_post",
            "button_stranger",
        ],
    )
    .await;
    assert!(api.calls().is_empty(), "no reply to anyone but the admin");
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn added_by_stranger_leaves_and_audits(pool: PgPool) {
    let api = FakeApi::default();
    // Unlocked, so the reason is who added it rather than where.
    run_with(&pool, &api, OPEN, &["added_by_stranger"]).await;
    assert_eq!(api.calls(), [Call::Leave { chat: -4000000002 }]);
    assert_eq!(count(&pool, "SELECT count(*) FROM chats").await, 0);
    let action: String = sqlx::query_scalar("SELECT action FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(action, LEFT_ADDED_BY_STRANGER);
}

// ---- General: the everyday chat ----

#[sqlx::test(migrations = "./migrations")]
async fn general_works_right_away_without_setup(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_general_text"]).await;

    assert!(api.calls().is_empty(), "no setup question in General");
    let (purpose, state, prompt) = setup_row(&pool, None).await;
    assert_eq!(purpose.as_deref(), Some(setup::default_general_purpose()));
    assert_eq!((state.as_str(), prompt), ("ready", None));

    run(&pool, &api, &["admin_status_general"]).await;
    let status = &api.sent_texts()[0];
    assert!(status.starts_with("📍 Herbot HQ › General"), "{status}");
    assert!(status.contains("1 messages stored"), "{status}");
    assert!(
        status.contains(setup::default_general_purpose()),
        "{status}"
    );
}

// ---- Topics: each one is its own agent ----

#[sqlx::test(migrations = "./migrations")]
async fn a_new_topic_asks_what_it_should_be(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text"]).await;

    let calls = api.calls();
    let [
        Call::SendButtons {
            chat,
            topic,
            reply_to,
            text,
            rows,
        },
    ] = calls.as_slice()
    else {
        panic!("expected exactly one greeting, got {calls:?}")
    };
    assert_eq!((*chat, *topic, *reply_to), (HQ, Some(7), Some(21)));
    assert!(
        text.starts_with("👋 Hi! Let's set up Herbot HQ › topic 7"),
        "{text}"
    );
    assert_eq!(*rows, setup::preset_buttons());

    assert_eq!(
        count(&pool, "SELECT count(*) FROM messages").await,
        1,
        "the message itself is kept"
    );
    let (purpose, state, prompt) = setup_row(&pool, Some(7)).await;
    assert_eq!(
        (purpose, state.as_str(), prompt),
        (None, "awaiting_purpose", Some(FIRST_BOT_MESSAGE))
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn the_next_message_becomes_the_purpose(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text"]).await;
    api.clear();
    run(&pool, &api, &["admin_topic_reply"]).await;

    let calls = api.calls();
    assert_eq!(
        calls[0],
        Call::RemoveButtons {
            chat: HQ,
            message_id: FIRST_BOT_MESSAGE
        },
        "the greeting's buttons go away"
    );
    let Call::Send {
        topic,
        reply_to,
        text,
        ..
    } = &calls[1]
    else {
        panic!("expected a confirmation, got {calls:?}")
    };
    assert_eq!((*topic, *reply_to), (Some(7), Some(22)));
    assert!(
        text.starts_with("✅ Set.") && text.contains("and compare them"),
        "{text}"
    );

    let (purpose, state, prompt) = setup_row(&pool, Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str(), prompt),
        (Some("and compare them"), "ready", None)
    );

    // Once set up, messages are just stored (Step 4 sends them to the agent).
    api.clear();
    run(&pool, &api, &["admin_topic_third"]).await;
    assert!(api.calls().is_empty());
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn tapping_a_preset_sets_the_purpose(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text"]).await;
    api.clear();
    run(&pool, &api, &["button_research_topic7"]).await;

    let calls = api.calls();
    let Call::Edit {
        chat,
        message_id,
        text,
    } = &calls[0]
    else {
        panic!("expected the greeting to turn into the confirmation, got {calls:?}")
    };
    assert_eq!((*chat, *message_id), (HQ, FIRST_BOT_MESSAGE));
    assert!(text.contains(research().purpose), "{text}");
    assert_eq!(
        calls[1],
        Call::Answer {
            callback_id: "cb-1".into(),
            toast: Some("Saved".into())
        }
    );
    assert_eq!(calls.len(), 2);

    let (purpose, state, _) = setup_row(&pool, Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str()),
        (Some(research().purpose), "ready")
    );

    // /status in the topic shows it.
    api.clear();
    run(&pool, &api, &["admin_status_in_topic"]).await;
    assert!(api.sent_texts()[0].contains(research().purpose));
}

#[sqlx::test(migrations = "./migrations")]
async fn an_unknown_button_is_answered_and_changes_nothing(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text"]).await;
    api.clear();
    run(&pool, &api, &["button_unknown"]).await;
    assert!(matches!(
        api.calls().as_slice(),
        [Call::Answer { callback_id, toast: Some(_) }] if callback_id == "cb-3"
    ));
    let (purpose, state, _) = setup_row(&pool, Some(7)).await;
    assert_eq!((purpose, state.as_str()), (None, "awaiting_purpose"));
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_command_lets_you_change_the_purpose(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_topic_text", "button_research_topic7"]).await;
    api.clear();

    run(&pool, &api, &["admin_setup_in_topic"]).await;
    assert!(matches!(
        api.calls().as_slice(),
        [Call::SendButtons { topic: Some(7), .. }]
    ));
    let (_, state, prompt) = setup_row(&pool, Some(7)).await;
    assert_eq!(
        (state.as_str(), prompt),
        ("awaiting_purpose", Some(FIRST_BOT_MESSAGE + 1))
    );

    run(&pool, &api, &["admin_topic_third"]).await;
    let (purpose, state, _) = setup_row(&pool, Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str()),
        (Some("what about rmcp?"), "ready")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn each_topic_is_its_own_conversation(pool: PgPool) {
    let api = FakeApi::default();
    run(
        &pool,
        &api,
        &[
            "admin_topic_text",
            "admin_topic_reply",
            "admin_other_topic_text",
            "admin_general_text",
        ],
    )
    .await;

    let per_conversation: Vec<(Option<i32>, i64, String)> = sqlx::query_as(
        "SELECT v.tg_topic_id, count(m.id), v.setup_state FROM conversations v
         JOIN chats c ON c.id = v.chat_id
         LEFT JOIN messages m ON m.conversation_id = v.id
         WHERE c.tg_chat_id = $1 GROUP BY v.id ORDER BY v.tg_topic_id NULLS FIRST",
    )
    .bind(HQ)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        per_conversation,
        [
            (None, 1, "ready".into()),
            (Some(7), 2, "ready".into()),
            (Some(9), 1, "awaiting_purpose".into()),
        ]
    );
    let greetings = api
        .calls()
        .into_iter()
        .filter(|c| matches!(c, Call::SendButtons { .. }))
        .count();
    assert_eq!(
        greetings, 2,
        "topics 7 and 9 each asked once; General never"
    );
}

// ---- storage details ----

#[sqlx::test(migrations = "./migrations")]
async fn redelivered_updates_are_not_stored_twice(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["admin_general_text", "admin_general_text"]).await;
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
    api.clear();
    run(&pool, &api, &["admin_topic_reply"]).await;
    assert_eq!(count(&pool, "SELECT count(*) FROM messages").await, 1);
    assert!(api.calls().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn removal_marks_chat_left_and_re_adding_reactivates(pool: PgPool) {
    let api = FakeApi::default();
    run_with(&pool, &api, OPEN, &["added_by_admin", "removed_from_group"]).await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "left");

    run_with(&pool, &api, OPEN, &["added_by_admin"]).await;
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
    run_with(
        &pool,
        &api,
        OPEN,
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

#[sqlx::test(migrations = "./migrations")]
async fn a_named_topic_greets_by_name(pool: PgPool) {
    let api = FakeApi::default();
    run(&pool, &api, &["topic_created", "admin_other_topic_text"]).await;
    assert!(
        api.sent_texts()[0].contains("Herbot HQ › Daily News"),
        "{}",
        api.sent_texts()[0]
    );
}

// ---- commands ----

#[sqlx::test(migrations = "./migrations")]
async fn placeholder_and_unknown_commands_reply_in_place(pool: PgPool) {
    let api = FakeApi::default();
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
    assert!(
        text.contains("Purpose: not set yet (send /setup)"),
        "{text}"
    );
    assert!(text.contains("none yet (Step 4)"), "{text}");
    assert_eq!(
        count(&pool, "SELECT count(*) FROM messages").await,
        0,
        "commands aren't stored"
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
        rules: LOCKED,
        bot_username: BOT,
    };
    let error_id = poller::process(&ctx, &fixture("admin_status_general"))
        .await
        .expect("a failed /status reply must produce an error id");

    let (kind, context): (String, Value) =
        sqlx::query_as("SELECT kind, context FROM errors WHERE id = $1")
            .bind(error_id.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "telegram.handle_api");
    assert_eq!(context["update_id"], 1020);

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
