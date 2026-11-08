//! Telegram updates through the real handler (Steps 2 and 3).
//!
//! Each test loads real Bot API JSON from `tests/fixtures/`, runs it through
//! `poller::process` with a real (fresh) database, a fake Telegram API that
//! records every call, a fake transcriber, and a temporary AGENTS.md folder,
//! then checks what was stored, written and sent.
//!
//! Default rules match production: admin 111, locked to the "Herbot HQ"
//! forum group. DMs are silent; General is the everyday chat; each topic is
//! its own agent and asks openly what it should be.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use sqlx::PgPool;
use teloxide::types::Update;

use herbot_core::errors::ErrorId;
use herbot_core::policy::{LEFT_ADDED_BY_STRANGER, LEFT_OUTSIDE_HOME, Rules};
use herbot_core::poller::{self, ApiError, Ctx, HELP_TEXT, TelegramApi, WELCOME_TEXT};
use herbot_core::setup;
use herbot_core::store;
use herbot_core::telegram::{self, ChatKind, Command, Inbound};
use herbot_core::voice::{Transcriber, VoiceError};

const ADMIN: u64 = 111;
const BOT: &str = "herbot_test_bot";
const HQ: i64 = -1001234567890;
const SIDE: i64 = -4000000001;
const AGENT_LABEL: &str = "gpt-6.1-terra · medium";

const LOCKED: Rules = Rules {
    admin_user_id: ADMIN,
    home_chat_id: Some(HQ),
};
const OPEN: Rules = Rules {
    admin_user_id: ADMIN,
    home_chat_id: None,
};

// ---- fakes ----

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
        text: String,
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
    Download {
        file_id: String,
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
        _topic_id: Option<i32>,
        _reply_to: Option<i32>,
        text: &str,
        _rows: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        self.push(Call::SendButtons {
            chat: chat_id,
            text: text.to_string(),
        });
        Ok(900)
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

    async fn download_file(&self, file_id: &str) -> Result<Vec<u8>, ApiError> {
        self.push(Call::Download {
            file_id: file_id.to_string(),
        });
        Ok(format!("OggS:{file_id}").into_bytes())
    }
}

/// Returns a fixed transcript (or error) and records the audio it was given.
struct FakeVoice {
    reply: Mutex<Result<String, VoiceError>>,
    heard: Mutex<Vec<Vec<u8>>>,
}

impl FakeVoice {
    fn saying(text: &str) -> Self {
        Self {
            reply: Mutex::new(Ok(text.to_string())),
            heard: Mutex::new(Vec::new()),
        }
    }
    fn set(&self, reply: Result<String, VoiceError>) {
        *self.reply.lock().unwrap() = reply;
    }
}

impl Transcriber for FakeVoice {
    async fn transcribe(&self, audio: Vec<u8>) -> Result<String, VoiceError> {
        self.heard.lock().unwrap().push(audio);
        self.reply.lock().unwrap().clone()
    }
}

// ---- harness ----

struct H {
    pool: PgPool,
    api: FakeApi,
    voice: FakeVoice,
    agents: tempfile::TempDir,
}

impl H {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            api: FakeApi::default(),
            voice: FakeVoice::saying("unused"),
            agents: tempfile::tempdir().unwrap(),
        }
    }

    fn ctx(&self, rules: Rules) -> Ctx<'_, FakeApi, FakeVoice> {
        Ctx {
            pool: &self.pool,
            api: &self.api,
            transcriber: &self.voice,
            rules,
            bot_username: BOT,
            agents_dir: self.agents.path(),
            agent_label: AGENT_LABEL,
        }
    }

    async fn process(&self, rules: Rules, name: &str) -> Option<ErrorId> {
        poller::process(&self.ctx(rules), &fixture(name)).await
    }

    async fn run_with(&self, rules: Rules, names: &[&str]) {
        for name in names {
            assert!(self.process(rules, name).await.is_none(), "{name} failed");
        }
    }

    async fn run(&self, names: &[&str]) {
        self.run_with(LOCKED, names).await
    }

    async fn count(&self, sql: &'static str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(&self.pool).await.unwrap()
    }

    /// (purpose, setup_state, prompt message id, agents_md_path) for `topic` in HQ.
    async fn setup_row(
        &self,
        topic: Option<i32>,
    ) -> (Option<String>, String, Option<i32>, Option<String>) {
        sqlx::query_as(
            "SELECT v.purpose, v.setup_state, v.setup_prompt_tg_message_id, v.agents_md_path
             FROM conversations v JOIN chats c ON c.id = v.chat_id
             WHERE c.tg_chat_id = $1 AND v.tg_topic_id IS NOT DISTINCT FROM $2",
        )
        .bind(HQ)
        .bind(topic)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    fn agents_md(&self, relative: &str) -> String {
        std::fs::read_to_string(self.agents.path().join(relative))
            .unwrap_or_else(|e| panic!("{relative}: {e}"))
    }

    async fn last_message(&self) -> (String, bool) {
        sqlx::query_as("SELECT body, is_voice FROM messages ORDER BY id DESC LIMIT 1")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

fn fixture(name: &str) -> Update {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{name} is not a valid Update: {e}"))
}

const TOPIC7_MD: &str = "chat_-1001234567890/topic_7/AGENTS.md";
const GENERAL_MD: &str = "chat_-1001234567890/general/AGENTS.md";

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
    assert_eq!(m.voice, None);

    let Some(Inbound::Message(m)) = n("admin_topic_reply") else {
        panic!("topic reply")
    };
    assert_eq!(m.reply_to_message_id, Some(21), "real replies are kept");

    let Some(Inbound::Message(m)) = n("admin_general_text") else {
        panic!("general")
    };
    assert_eq!(m.topic_id, None, "General has no topic id");

    let Some(Inbound::Message(m)) = n("admin_setup_in_topic") else {
        panic!("setup")
    };
    assert_eq!(m.command, Some(Command::Setup));

    let Some(Inbound::Message(m)) = n("voice_in_topic7") else {
        panic!("voice")
    };
    let voice = m.voice.expect("voice note");
    assert_eq!(
        (voice.file_id.as_str(), voice.duration_secs),
        ("AwACAgQ-topic7", 38)
    );
    assert_eq!((m.text.as_str(), m.topic_id), ("", Some(7)));

    let Some(Inbound::Message(m)) = n("voice_with_caption") else {
        panic!("voice caption")
    };
    assert_eq!(m.text, "context:");
    assert!(m.voice.is_some());

    let Some(Inbound::ButtonPressed(press)) = n("button_research_topic7") else {
        panic!("button")
    };
    assert_eq!(
        (press.chat.tg_chat_id, press.topic_id, press.message_id),
        (HQ, Some(7), 500)
    );

    assert_eq!(
        n("admin_sticker"),
        None,
        "no text or voice, nothing to store"
    );
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
    let h = H::new(pool);
    for rules in [LOCKED, OPEN] {
        h.run_with(
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
    assert!(
        h.api.calls().is_empty(),
        "no reply in DMs, even to the admin"
    );
    assert_eq!(h.count("SELECT count(*) FROM chats").await, 0);
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn other_groups_are_ignored_and_left_when_locked(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_side_text", "added_by_admin"]).await;
    assert_eq!(h.api.calls(), [Call::Leave { chat: SIDE }]);
    assert_eq!(h.count("SELECT count(*) FROM chats").await, 0);
    let action: String = sqlx::query_scalar("SELECT action FROM audit_log")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(action, LEFT_OUTSIDE_HOME);
}

#[sqlx::test(migrations = "./migrations")]
async fn unlocked_the_admin_can_add_the_bot_to_any_group(pool: PgPool) {
    let h = H::new(pool);
    h.run_with(OPEN, &["added_by_admin"]).await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(status, "active");
    assert_eq!(h.api.sent_texts(), [WELCOME_TEXT]);
}

// ---- who: only the admin ----

#[sqlx::test(migrations = "./migrations")]
async fn strangers_and_bots_get_silence_and_nothing_is_stored(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "stranger_in_topic",
        "other_bot_in_group",
        "channel_post",
        "button_stranger",
    ])
    .await;
    assert!(h.api.calls().is_empty(), "no reply to anyone but the admin");
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn added_by_stranger_leaves_and_audits(pool: PgPool) {
    let h = H::new(pool);
    h.run_with(OPEN, &["added_by_stranger"]).await;
    assert_eq!(h.api.calls(), [Call::Leave { chat: -4000000002 }]);
    let action: String = sqlx::query_scalar("SELECT action FROM audit_log")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(action, LEFT_ADDED_BY_STRANGER);
}

// ---- General: the everyday chat ----

#[sqlx::test(migrations = "./migrations")]
async fn general_works_right_away_and_gets_a_default_agents_md(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_general_text"]).await;

    assert!(h.api.calls().is_empty(), "no setup question in General");
    let (purpose, state, _, path) = h.setup_row(None).await;
    assert_eq!(purpose.as_deref(), Some(setup::DEFAULT_GENERAL_PURPOSE));
    assert_eq!(state, "ready");
    assert_eq!(path.as_deref(), Some(GENERAL_MD));
    let md = h.agents_md(GENERAL_MD);
    assert!(
        md.starts_with("# Herbot HQ › General\n") && md.contains(setup::DEFAULT_GENERAL_PURPOSE)
    );

    h.run(&["admin_status_general"]).await;
    let status = &h.api.sent_texts()[0];
    assert!(status.starts_with("📍 Herbot HQ › General"), "{status}");
    assert!(status.contains("1 messages stored"), "{status}");
    assert!(
        status.contains(&format!("Agent file: {GENERAL_MD}")),
        "{status}"
    );
    assert!(
        status.contains(&format!("Model: {AGENT_LABEL}")),
        "{status}"
    );
}

// ---- Topics: each one is its own agent ----

#[sqlx::test(migrations = "./migrations")]
async fn a_new_topic_asks_openly_with_no_buttons(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;

    let calls = h.api.calls();
    let [
        Call::Send {
            chat,
            topic,
            reply_to,
            text,
        },
    ] = calls.as_slice()
    else {
        panic!("expected exactly one plain greeting, got {calls:?}")
    };
    assert_eq!((*chat, *topic, *reply_to), (HQ, Some(7), Some(21)));
    assert_eq!(*text, setup::greeting("Herbot HQ › topic 7"));

    assert_eq!(
        h.count("SELECT count(*) FROM messages").await,
        1,
        "the message itself is kept"
    );
    let (purpose, state, prompt, path) = h.setup_row(Some(7)).await;
    assert_eq!(
        (purpose, state.as_str(), prompt, path),
        (None, "awaiting_purpose", None, None)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_typed_answer_becomes_the_topics_agents_md(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;
    h.api.clear();
    h.run(&["admin_topic_reply"]).await;

    let calls = h.api.calls();
    let [
        Call::Send {
            topic,
            reply_to,
            text,
            ..
        },
    ] = calls.as_slice()
    else {
        panic!("expected one confirmation, got {calls:?}")
    };
    assert_eq!((*topic, *reply_to), (Some(7), Some(22)));
    assert_eq!(
        *text,
        setup::confirmation("Herbot HQ › topic 7", "and compare them")
    );

    let (purpose, state, prompt, path) = h.setup_row(Some(7)).await;
    assert_eq!(purpose.as_deref(), Some("and compare them"));
    assert_eq!(
        (state.as_str(), prompt, path.as_deref()),
        ("ready", None, Some(TOPIC7_MD))
    );
    let md = h.agents_md(TOPIC7_MD);
    assert!(
        md.contains("## What this agent is for\n\nand compare them\n"),
        "{md}"
    );

    // Once set up, messages are just stored (Step 4 sends them to the agent).
    h.api.clear();
    h.run(&["admin_topic_third"]).await;
    assert!(h.api.calls().is_empty());
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_voice_note_answer_sets_up_the_topic(pool: PgPool) {
    let spoken = "This is my Rust research agent. Compare MCP crates, check maintenance, and always cite sources.";
    let h = H::new(pool);
    h.voice.set(Ok(spoken.into()));
    h.run(&["admin_topic_text"]).await;
    h.api.clear();
    h.run(&["voice_in_topic7"]).await;

    let calls = h.api.calls();
    assert_eq!(
        calls[0],
        Call::Download {
            file_id: "AwACAgQ-topic7".into()
        }
    );
    assert_eq!(h.voice.heard.lock().unwrap()[0], b"OggS:AwACAgQ-topic7");
    let Call::Send { text, .. } = &calls[1] else {
        panic!("expected the confirmation, got {calls:?}")
    };
    assert_eq!(*text, setup::confirmation("Herbot HQ › topic 7", spoken));
    assert_eq!(
        calls.len(),
        2,
        "the confirmation already shows what was heard"
    );

    let (purpose, state, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str()),
        (Some(spoken), "ready")
    );
    assert!(h.agents_md(TOPIC7_MD).contains(spoken));
    assert_eq!(h.last_message().await, (spoken.to_string(), true));
}

#[sqlx::test(migrations = "./migrations")]
async fn voice_notes_in_a_ready_chat_are_transcribed_and_echoed(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Ok("What's the weather in Hyderabad?".into()));
    h.run(&["voice_in_general"]).await;

    let calls = h.api.calls();
    assert_eq!(calls.len(), 2, "{calls:?}");
    assert!(matches!(&calls[0], Call::Download { file_id } if file_id == "AwACAgQ-general"));
    let Call::Send { reply_to, text, .. } = &calls[1] else {
        panic!("expected the echo")
    };
    assert_eq!(*reply_to, Some(46));
    assert_eq!(*text, setup::heard("What's the weather in Hyderabad?"));
    assert_eq!(
        h.last_message().await,
        ("What's the weather in Hyderabad?".to_string(), true)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_voice_caption_is_kept_before_the_transcript(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Ok("remind me about the VPS".into()));
    h.run(&["voice_with_caption"]).await;
    assert_eq!(
        h.last_message().await,
        ("context:\n\nremind me about the VPS".to_string(), true)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn overly_long_voice_notes_are_refused_before_download(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["voice_too_long"]).await;
    assert_eq!(h.api.sent_texts(), [setup::too_long(1800, 600)]);
    assert!(
        !h.api
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Download { .. }))
    );
    assert!(
        h.voice.heard.lock().unwrap().is_empty(),
        "nothing sent to OpenAI"
    );
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn silent_voice_notes_are_not_stored(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Ok("   ".into()));
    h.run(&["voice_in_general"]).await;
    assert_eq!(h.api.sent_texts(), [setup::NOTHING_HEARD]);
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn transcription_failures_fail_loudly(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Err(VoiceError::NotConfigured));
    let error_id = h
        .process(LOCKED, "voice_in_general")
        .await
        .expect("a voice note without transcription must produce an error id");
    let kind: String = sqlx::query_scalar("SELECT kind FROM errors WHERE id = $1")
        .bind(error_id.0)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(kind, "voice.transcribe");
    assert_eq!(
        h.api.sent_texts(),
        [format!(
            "❌ Failed ({error_id}): voice notes are off (no OPENAI_API_KEY). Check logs."
        )]
    );
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_command_rewrites_the_agents_md(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    h.api.clear();

    h.run(&["admin_setup_in_topic"]).await;
    assert_eq!(h.api.sent_texts(), [setup::greeting("Herbot HQ › topic 7")]);
    let (_, state, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(state, "awaiting_purpose");

    h.run(&["admin_topic_third"]).await;
    let (purpose, state, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str()),
        (Some("what about rmcp?"), "ready")
    );
    let md = h.agents_md(TOPIC7_MD);
    assert!(
        md.contains("what about rmcp?") && !md.contains("and compare them"),
        "{md}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn old_greetings_lose_their_preset_buttons(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;
    // A greeting sent by the earlier, button-based version.
    sqlx::query("UPDATE conversations SET setup_prompt_tg_message_id = 500 WHERE tg_topic_id = 7")
        .execute(&h.pool)
        .await
        .unwrap();
    h.api.clear();

    // Tapping one of its buttons explains they're gone and removes them.
    h.run(&["button_research_topic7"]).await;
    assert_eq!(
        h.api.calls(),
        [
            Call::Answer {
                callback_id: "cb-1".into(),
                toast: Some(setup::STALE_BUTTON_TOAST.into())
            },
            Call::RemoveButtons {
                chat: HQ,
                message_id: 500
            },
        ]
    );
    let (purpose, _, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(purpose, None, "a tap no longer sets anything");

    // Answering in words still works and clears the old buttons.
    h.api.clear();
    h.run(&["admin_topic_reply"]).await;
    assert_eq!(
        h.api.calls()[0],
        Call::RemoveButtons {
            chat: HQ,
            message_id: 500
        }
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn each_topic_is_its_own_conversation(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "admin_topic_text",
        "admin_topic_reply",
        "admin_other_topic_text",
        "admin_general_text",
    ])
    .await;

    let per_conversation: Vec<(Option<i32>, i64, String)> = sqlx::query_as(
        "SELECT v.tg_topic_id, count(m.id), v.setup_state FROM conversations v
         JOIN chats c ON c.id = v.chat_id
         LEFT JOIN messages m ON m.conversation_id = v.id
         WHERE c.tg_chat_id = $1 GROUP BY v.id ORDER BY v.tg_topic_id NULLS FIRST",
    )
    .bind(HQ)
    .fetch_all(&h.pool)
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
    let greetings = h
        .api
        .sent_texts()
        .iter()
        .filter(|t| t.contains("What should I be here?"))
        .count();
    assert_eq!(
        greetings, 2,
        "topics 7 and 9 each asked once; General never"
    );
    for md in [GENERAL_MD, TOPIC7_MD] {
        assert!(h.agents.path().join(md).exists(), "{md}");
    }
    let topic9: PathBuf = h
        .agents
        .path()
        .join("chat_-1001234567890/topic_9/AGENTS.md");
    assert!(!topic9.exists(), "not written until topic 9 is answered");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_named_topic_greets_and_titles_its_agents_md_by_name(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["topic_created", "admin_other_topic_text"]).await;
    assert_eq!(
        h.api.sent_texts()[0],
        setup::greeting("Herbot HQ › Daily News")
    );
}

// ---- storage details ----

#[sqlx::test(migrations = "./migrations")]
async fn redelivered_updates_are_not_stored_twice(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_general_text", "admin_general_text"]).await;
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn disabled_conversations_store_nothing(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;
    sqlx::query("UPDATE conversations SET enabled = false")
        .execute(&h.pool)
        .await
        .unwrap();
    h.api.clear();
    h.run(&["admin_topic_reply"]).await;
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 1);
    assert!(h.api.calls().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn removal_marks_chat_left_and_re_adding_reactivates(pool: PgPool) {
    let h = H::new(pool);
    h.run_with(OPEN, &["added_by_admin", "removed_from_group"])
        .await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(status, "left");
    h.run_with(OPEN, &["added_by_admin"]).await;
    let status: String = sqlx::query_scalar("SELECT status FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(status, "active");
}

#[sqlx::test(migrations = "./migrations")]
async fn topic_names_and_renames_are_recorded(pool: PgPool) {
    let h = H::new(pool);
    h.run_with(OPEN, &["topic_created", "added_by_admin", "group_renamed"])
        .await;
    let topic: String = sqlx::query_scalar(
        "SELECT v.name FROM conversations v JOIN chats c ON c.id = v.chat_id
         WHERE c.tg_chat_id = $1 AND v.tg_topic_id = 9",
    )
    .bind(HQ)
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(topic, "Daily News");
    let title: String = sqlx::query_scalar("SELECT title FROM chats WHERE tg_chat_id = $1")
        .bind(SIDE)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(title, "Side Project v2");
}

// ---- commands ----

#[sqlx::test(migrations = "./migrations")]
async fn status_before_setup_says_so(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_status_in_topic"]).await;
    let calls = h.api.calls();
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
    assert!(text.contains("Agent file: not written yet"), "{text}");
    assert!(text.contains("none yet (Step 4)"), "{text}");
    assert_eq!(
        h.count("SELECT count(*) FROM messages").await,
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
    let mut h = H::new(pool);
    h.api.fail_sends = true;
    let error_id = h
        .process(LOCKED, "admin_status_general")
        .await
        .expect("a failed /status reply must produce an error id");

    let (kind, context): (String, Value) =
        sqlx::query_as("SELECT kind, context FROM errors WHERE id = $1")
            .bind(error_id.0)
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(kind, "telegram.handle_api");
    assert_eq!(context["update_id"], 1020);
    let texts = h.api.sent_texts();
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
