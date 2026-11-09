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
use std::sync::atomic::{AtomicI32, Ordering};

use serde_json::Value;
use sqlx::PgPool;
use teloxide::types::Update;

use herbot_core::agent::{AgentError, BoxFuture, ProjectCleaner};
use herbot_core::errors::ErrorId;
use herbot_core::policy::{LEFT_ADDED_BY_STRANGER, LEFT_OUTSIDE_HOME, Rules};
use herbot_core::poller::{
    self, ALREADY_ANSWERED_TOAST, ApiError, Ctx, HELP_TEXT, InboundLanes, Route, RunSettings,
    SEEN_REACTION, TelegramApi, WELCOME_TEXT,
};
use herbot_core::setup;
use herbot_core::store;
use herbot_core::telegram::{self, ChatKind, Command, Inbound};
use herbot_core::turns::{TurnJob, TurnQueue};
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
    Delete {
        message_id: i32,
    },
    File {
        name: String,
        content: String,
    },
    Send {
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: String,
    },
    SendButtons {
        chat: i64,
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
    Download {
        file_id: String,
    },
}

#[derive(Default)]
struct FakeApi {
    calls: Mutex<Vec<Call>>,
    /// 👀 reactions, kept apart so other tests can compare `calls` exactly.
    reactions: Mutex<Vec<(i64, i32, String)>>,
    fail_sends: bool,
    fail_reactions: bool,
    next_id: AtomicI32,
}

impl FakeApi {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
        self.reactions.lock().unwrap().clear();
    }
    fn reactions(&self) -> Vec<(i64, i32, String)> {
        self.reactions.lock().unwrap().clone()
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
    async fn delete_message(&self, _: i64, message_id: i32) -> Result<(), ApiError> {
        self.push(Call::Delete { message_id });
        Ok(())
    }

    async fn send_file(
        &self,
        _: i64,
        _: Option<i32>,
        _: Option<i32>,
        file: &herbot_core::media::OutFile,
    ) -> Result<i32, ApiError> {
        self.push(Call::File {
            name: file.path.file_name().unwrap().to_string_lossy().into(),
            content: std::fs::read_to_string(&file.path).unwrap(),
        });
        Ok(999)
    }

    async fn send_text(
        &self,
        chat_id: i64,
        topic_id: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> Result<i32, ApiError> {
        self.push(Call::Send {
            chat: chat_id,
            topic: topic_id,
            reply_to,
            text: text.to_string(),
        });
        if self.fail_sends {
            return Err(ApiError("fake send failure".into()));
        }
        Ok(700 + self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    async fn typing(&self, _chat_id: i64, _topic_id: Option<i32>) -> Result<(), ApiError> {
        Ok(())
    }

    async fn send_buttons(
        &self,
        chat_id: i64,
        _topic_id: Option<i32>,
        _reply_to: Option<i32>,
        text: &str,
        rows: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        self.push(Call::SendButtons {
            chat: chat_id,
            text: text.to_string(),
            rows: rows.to_vec(),
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

    async fn react(&self, chat_id: i64, message_id: i32, emoji: &str) -> Result<(), ApiError> {
        if self.fail_reactions {
            return Err(ApiError("reactions are disabled in this chat".into()));
        }
        self.reactions
            .lock()
            .unwrap()
            .push((chat_id, message_id, emoji.to_string()));
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

/// Records the turns the poller hands to agent lanes (Step 4 tests run the
/// turns themselves in tests/turns.rs).
#[derive(Default)]
struct Jobs(Mutex<Vec<TurnJob>>);

impl TurnQueue for Jobs {
    fn submit(&self, job: TurnJob) {
        self.0.lock().unwrap().push(job);
    }
}

impl Jobs {
    fn all(&self) -> Vec<TurnJob> {
        self.0.lock().unwrap().clone()
    }
}

/// A fake T3 for clean sweeps: which project each thread lives in, which
/// threads each project holds, and which projects got removed.
#[derive(Default)]
struct FakeCleaner {
    thread_project: Mutex<std::collections::HashMap<String, String>>,
    extra_threads: Mutex<Vec<(String, String)>>,
    removed: Mutex<Vec<String>>,
    fail: Mutex<bool>,
}

const PROJECT: &str = "c8b83136-53e8-401b-8de5-85361fc43bcd";

impl FakeCleaner {
    fn removed(&self) -> Vec<String> {
        self.removed.lock().unwrap().clone()
    }
}

impl ProjectCleaner for FakeCleaner {
    fn project_of_thread<'a>(
        &'a self,
        thread_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AgentError>> {
        Box::pin(async move { Ok(self.thread_project.lock().unwrap().get(thread_id).cloned()) })
    }
    fn threads_in_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, AgentError>> {
        Box::pin(async move {
            let mut ids: Vec<String> = self
                .thread_project
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, p)| p.as_str() == project_id)
                .map(|(t, _)| t.clone())
                .collect();
            ids.extend(
                self.extra_threads
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(p, _)| p == project_id)
                    .map(|(_, t)| t.clone()),
            );
            Ok(ids)
        })
    }
    fn remove_project<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<(), AgentError>> {
        Box::pin(async move {
            if *self.fail.lock().unwrap() {
                return Err(AgentError::Project("T3 said no".into()));
            }
            self.removed.lock().unwrap().push(project_id.to_string());
            Ok(())
        })
    }
}

// ---- harness ----

struct H {
    pool: PgPool,
    api: FakeApi,
    voice: FakeVoice,
    agents: tempfile::TempDir,
    jobs: Jobs,
    projects: FakeCleaner,
}

impl H {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            api: FakeApi::default(),
            voice: FakeVoice::saying("unused"),
            agents: tempfile::tempdir().unwrap(),
            jobs: Jobs::default(),
            projects: FakeCleaner::default(),
        }
    }

    fn ctx(&self, rules: Rules) -> Ctx<'_, FakeApi, FakeVoice> {
        Ctx {
            speaker: &herbot_core::speech::NoSpeaker,
            pool: &self.pool,
            api: &self.api,
            transcriber: &self.voice,
            rules,
            bot_username: BOT,
            agents_dir: self.agents.path(),
            agent_label: AGENT_LABEL,
            turns: &self.jobs,
            projects: &self.projects,
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
    // It already has a purpose: say the next message replaces it, with a way out.
    assert_eq!(
        h.api.calls(),
        [Call::SendButtons {
            chat: HQ,
            text: setup::new_purpose_prompt("Herbot HQ › topic 7"),
            rows: setup::keep_button(topic7_id(&h).await),
        }]
    );
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

async fn topic7_id(h: &H) -> i64 {
    h.count("SELECT id FROM conversations WHERE tg_topic_id = 7")
        .await
}

/// A tap on "Keep the current purpose" (on bot message 500).
fn keep_tap(conversation_id: i64) -> Update {
    let mut update = fixture("button_research_topic7");
    if let teloxide::types::UpdateKind::CallbackQuery(q) = &mut update.kind {
        q.data = Some(setup::keep_button(conversation_id)[0][0].1.clone());
    }
    update
}

#[sqlx::test(migrations = "./migrations")]
async fn after_setup_the_current_purpose_can_be_kept(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    let (before, ..) = h.setup_row(Some(7)).await;
    h.run(&["admin_setup_in_topic"]).await;
    let (_, state, prompt, _) = h.setup_row(Some(7)).await;
    assert_eq!((state.as_str(), prompt), ("awaiting_purpose", Some(900)));
    h.api.clear();

    let id = topic7_id(&h).await;
    assert!(
        poller::process(&h.ctx(LOCKED), &keep_tap(id))
            .await
            .is_none()
    );
    assert_eq!(
        h.api.calls()[0],
        Call::Edit {
            chat: HQ,
            message_id: 500,
            text: setup::KEPT.to_string(),
        }
    );
    let (after, state, prompt, _) = h.setup_row(Some(7)).await;
    assert_eq!((state.as_str(), prompt), ("ready", None));
    assert_eq!(after, before, "the purpose is unchanged");

    // Messages go to the agent again instead of becoming the purpose.
    let turns = h.jobs.all().len();
    h.run(&["admin_topic_third"]).await;
    assert_eq!(h.jobs.all().len(), turns + 1);
    assert_eq!(h.setup_row(Some(7)).await.0, before);
}

#[sqlx::test(migrations = "./migrations")]
async fn keep_does_nothing_once_the_purpose_was_replaced(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "admin_topic_text",
        "admin_topic_reply",
        "admin_setup_in_topic",
        "admin_topic_third",
    ])
    .await;
    let (replaced, state, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(
        (replaced.as_deref(), state.as_str()),
        (Some("what about rmcp?"), "ready")
    );
    h.api.clear();

    let id = topic7_id(&h).await;
    assert!(
        poller::process(&h.ctx(LOCKED), &keep_tap(id))
            .await
            .is_none()
    );
    let calls = h.api.calls();
    assert!(
        matches!(&calls[0], Call::Answer { toast: Some(t), .. } if t == setup::NOTHING_TO_KEEP_TOAST),
        "{calls:?}"
    );
    assert_eq!(
        calls[1],
        Call::RemoveButtons {
            chat: HQ,
            message_id: 500
        }
    );
    assert_eq!(
        h.setup_row(Some(7)).await.0.as_deref(),
        Some("what about rmcp?")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_second_setup_leaves_one_keep_button(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "admin_topic_text",
        "admin_topic_reply",
        "admin_setup_in_topic",
    ])
    .await;
    h.api.clear();
    h.run(&["admin_setup_in_topic"]).await;
    let calls = h.api.calls();
    assert!(matches!(calls[0], Call::SendButtons { .. }), "{calls:?}");
    // The first prompt (the fake numbers every sent message 900) loses its button.
    assert_eq!(
        calls[1],
        Call::RemoveButtons {
            chat: HQ,
            message_id: 900
        }
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

#[sqlx::test(migrations = "./migrations")]
async fn a_one_word_answer_is_not_a_purpose(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;
    // The admin's next message is just "Hi".
    h.api.clear();
    let mut update = fixture("admin_topic_third");
    if let teloxide::types::UpdateKind::Message(m) = &mut update.kind
        && let teloxide::types::MessageKind::Common(c) = &mut m.kind
        && let teloxide::types::MediaKind::Text(t) = &mut c.media_kind
    {
        t.text = "Hi".into();
    }
    assert!(poller::process(&h.ctx(LOCKED), &update).await.is_none());
    assert_eq!(
        h.api.sent_texts(),
        [setup::PurposeError::TooShort.to_string()]
    );
    let (purpose, state, _, _) = h.setup_row(Some(7)).await;
    assert_eq!(
        (purpose, state.as_str()),
        (None, "awaiting_purpose"),
        "still waiting"
    );
}

// ---- which messages go to the agent (Step 4) ----

#[sqlx::test(migrations = "./migrations")]
async fn general_messages_go_to_the_agent_right_away(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_general_text"]).await;
    let jobs = h.jobs.all();
    assert_eq!(jobs.len(), 1);
    let job = &jobs[0];
    assert_eq!((job.tg_chat_id, job.topic_id, job.reply_to), (HQ, None, 40));
    assert_eq!(job.text, "hello from General");
    assert_eq!(
        (job.sender_name.as_str(), job.sender_id, job.is_voice),
        ("Ashrith", ADMIN, false)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_messages_never_reach_the_agent(pool: PgPool) {
    let h = H::new(pool);
    // First message (greeting), then the purpose answer: neither is a turn.
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    assert!(h.jobs.all().is_empty());
    // After setup, messages are turns.
    h.run(&["admin_topic_third"]).await;
    let jobs = h.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].topic_id, jobs[0].text.as_str()),
        (Some(7), "what about rmcp?")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn voice_turns_carry_the_transcript(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Ok("summarise today's news".into()));
    h.run(&["voice_in_general"]).await;
    let jobs = h.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].text.as_str(), jobs[0].is_voice),
        ("summarise today's news", true)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn commands_strangers_and_duplicates_are_not_turns(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "admin_status_general",
        "stranger_in_topic",
        "admin_dm_text",
        "admin_general_text",
        "admin_general_text",
    ])
    .await;
    assert_eq!(h.jobs.all().len(), 1, "only the first General message");
}

/// Sends `/new` or `/forget` in topic 7 and returns the confirmation's
/// buttons as (label, callback data).
async fn ask_wipe(h: &H, text: &str) -> Vec<(String, String)> {
    h.api.clear();
    command(h, text).await;
    let calls = h.api.calls();
    let [Call::SendButtons { chat, rows, .. }] = calls.as_slice() else {
        panic!("expected a confirmation with buttons, got {calls:?}")
    };
    assert_eq!(*chat, HQ);
    h.api.clear();
    rows.iter().flatten().cloned().collect()
}

/// Taps a button with this callback data on bot message 500 in topic 7.
async fn tap_data(h: &H, data: &str) {
    let mut update = fixture("button_research_topic7");
    if let teloxide::types::UpdateKind::CallbackQuery(q) = &mut update.kind {
        q.data = Some(data.to_string());
    }
    assert!(
        poller::process(&h.ctx(LOCKED), &update).await.is_none(),
        "{data}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn new_asks_with_buttons_then_wipes_on_yes_and_keeps_the_purpose(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply", "admin_topic_third"])
        .await;
    with_thread(&h, 7).await;

    let buttons = ask_wipe(&h, "/new").await;
    assert_eq!(buttons.len(), 2);
    assert_eq!(buttons[0].0, "🧹 Yes, wipe the chat");
    assert_eq!(buttons[1].0, "Cancel");
    assert!(
        h.projects.removed().is_empty(),
        "nothing deleted before the tap"
    );

    tap_data(&h, &buttons[0].1).await;
    assert_eq!(h.projects.removed(), [PROJECT]);
    let calls = h.api.calls();
    let Call::Edit {
        message_id, text, ..
    } = &calls[0]
    else {
        panic!("{calls:?}")
    };
    assert_eq!(*message_id, 500);
    assert!(
        text.starts_with("🆕 Clean slate. Deleted 1 T3 thread(s) and 3 messages."),
        "{text}"
    );
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
    assert_eq!(h.count("SELECT count(*) FROM agent_threads").await, 0);
    let (purpose, state, _, path) = h.setup_row(Some(7)).await;
    assert_eq!(
        (purpose.as_deref(), state.as_str()),
        (Some("and compare them"), "ready")
    );
    assert!(
        h.agents.path().join(path.unwrap()).exists(),
        "AGENTS.md kept"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn forget_by_button_wipes_everything_including_the_purpose(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;

    let buttons = ask_wipe(&h, "/forget").await;
    assert_eq!(buttons[0].0, "🧹 Yes, wipe everything");
    tap_data(&h, &buttons[0].1).await;
    assert_eq!(h.projects.removed().len(), 1);
    let (purpose, state, _, path) = h.setup_row(Some(7)).await;
    assert_eq!((purpose, state.as_str(), path), (None, "new", None));
    assert!(
        !h.agents.path().join(TOPIC7_MD).exists(),
        "AGENTS.md deleted"
    );

    // The next message sets the topic up again.
    h.api.clear();
    h.run(&["admin_topic_third"]).await;
    assert_eq!(h.api.sent_texts(), [setup::greeting("Herbot HQ › topic 7")]);
}

#[sqlx::test(migrations = "./migrations")]
async fn cancel_deletes_nothing(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;
    let buttons = ask_wipe(&h, "/new").await;
    tap_data(&h, &buttons[1].1).await;
    assert!(
        matches!(&h.api.calls()[0], Call::Edit { text, .. } if text == herbot_core::wipe::CANCELLED)
    );
    assert!(h.projects.removed().is_empty());
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_or_misplaced_confirmations_do_nothing(pool: PgPool) {
    use herbot_core::wipe::{self, WipeButton, WipeKind};
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;
    let conversation: i64 =
        sqlx::query_scalar("SELECT id FROM conversations WHERE tg_topic_id = 7")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    h.api.clear();

    let old = chrono::Utc::now().timestamp() - 3600;
    tap_data(
        &h,
        &wipe::button_data(WipeButton::Confirm(WipeKind::New), conversation, old),
    )
    .await;
    assert_eq!(
        h.api.calls()[0],
        Call::Answer {
            callback_id: "cb-1".into(),
            toast: Some(wipe::EXPIRED_TOAST.into())
        }
    );

    h.api.clear();
    let now = chrono::Utc::now().timestamp();
    tap_data(
        &h,
        &wipe::button_data(WipeButton::Confirm(WipeKind::New), conversation + 99, now),
    )
    .await;
    assert_eq!(
        h.api.calls(),
        [Call::Answer {
            callback_id: "cb-1".into(),
            toast: Some(wipe::WRONG_PLACE_TOAST.into())
        }]
    );
    assert!(h.projects.removed().is_empty());
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_failed_wipe_shows_the_error_in_place_of_the_buttons(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;
    *h.projects.fail.lock().unwrap() = true;
    let buttons = ask_wipe(&h, "/new").await;
    tap_data(&h, &buttons[0].1).await;
    let calls = h.api.calls();
    let Call::Edit { text, .. } = &calls[0] else {
        panic!("{calls:?}")
    };
    assert!(
        text.starts_with("❌ Failed (E-") && text.contains("so nothing was wiped"),
        "{text}"
    );
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn if_t3_refuses_nothing_is_wiped(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;
    *h.projects.fail.lock().unwrap() = true;
    h.api.clear();

    let mut update = fixture("admin_status_in_topic");
    set_text(&mut update, "/new yes");
    let error_id = poller::process(&h.ctx(LOCKED), &update)
        .await
        .expect("a failed T3 delete is an error");
    assert_eq!(
        h.api.sent_texts(),
        [format!(
            "❌ Failed ({error_id}): couldn't delete this topic's T3 threads, so nothing was wiped. Check logs."
        )]
    );
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 2);
    assert_eq!(h.count("SELECT count(*) FROM agent_threads").await, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_project_holding_threads_herbot_did_not_start_is_never_deleted(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    with_thread(&h, 7).await;
    // Say the thread somehow lives in a project that also holds your own
    // coding threads (like the herbot repo's project).
    h.projects
        .extra_threads
        .lock()
        .unwrap()
        .push((PROJECT.into(), "your-coding-thread".into()));
    h.api.clear();

    let mut update = fixture("admin_status_in_topic");
    set_text(&mut update, "/forget yes");
    let error_id = poller::process(&h.ctx(LOCKED), &update)
        .await
        .expect("refusing is an error");
    assert!(
        h.projects.removed().is_empty(),
        "the shared project is untouched"
    );
    let message: String = sqlx::query_scalar("SELECT message FROM errors WHERE id = $1")
        .bind(error_id.0)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert!(message.contains("which Herbot didn't start"), "{message}");
    assert_eq!(
        h.count("SELECT count(*) FROM messages").await,
        2,
        "nothing wiped"
    );
    let (purpose, _, _, _) = h.setup_row(Some(7)).await;
    assert!(purpose.is_some(), "purpose kept");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_topic_that_never_reached_t3_skips_the_t3_delete(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    command(&h, "/new yes").await;
    assert!(h.projects.removed().is_empty());
    assert_eq!(h.count("SELECT count(*) FROM messages").await, 0);
}

/// Gives topic 7 an active thread and marks its folder as a T3 project.
async fn with_thread(h: &H, topic: i32) {
    sqlx::query(
        "INSERT INTO agent_threads (conversation_id, t3_thread_id)
         SELECT id, 't3-live' FROM conversations WHERE tg_topic_id = $1",
    )
    .bind(topic)
    .execute(&h.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE conversations SET t3_project_registered = true WHERE tg_topic_id = $1")
        .bind(topic)
        .execute(&h.pool)
        .await
        .unwrap();
    h.projects
        .thread_project
        .lock()
        .unwrap()
        .insert("t3-live".into(), PROJECT.into());
}

/// Sends a command typed into topic 7.
async fn command(h: &H, text: &str) {
    let mut update = fixture("admin_status_in_topic");
    set_text(&mut update, text);
    assert!(
        poller::process(&h.ctx(LOCKED), &update).await.is_none(),
        "{text}"
    );
}

fn set_text(update: &mut Update, text: &str) {
    if let teloxide::types::UpdateKind::Message(m) = &mut update.kind
        && let teloxide::types::MessageKind::Common(c) = &mut m.kind
        && let teloxide::types::MediaKind::Text(t) = &mut c.media_kind
    {
        t.text = text.into();
        t.entities.clear();
    } else {
        panic!("not a text message fixture");
    }
}

// ---- answering the agent's choices (Step 6) ----

/// Topic 7 set up, with an active thread and an open question whose buttons
/// sit on bot message 500 (the message `button_research_topic7` taps).
async fn open_question(h: &H) -> i64 {
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    sqlx::query(
        "INSERT INTO agent_threads (conversation_id, t3_thread_id)
         SELECT id, 't3-q' FROM conversations WHERE tg_topic_id = 7",
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let id: i64 = sqlx::query_scalar(
        r#"INSERT INTO pending_questions (thread_id, question, options, tg_message_id)
           SELECT id, 'There are 42 old logs.',
                  '["Delete all", "Only older than 30 days", "Keep them"]', 500
           FROM agent_threads WHERE t3_thread_id = 't3-q' RETURNING id"#,
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    h.api.clear();
    id
}

fn tap(question_id: i64, index: usize) -> Update {
    let mut update = fixture("button_research_topic7");
    if let teloxide::types::UpdateKind::CallbackQuery(q) = &mut update.kind {
        q.data = Some(format!("ans:{question_id}:{index}"));
    }
    update
}

async fn question_status(h: &H, id: i64) -> (String, Option<String>) {
    sqlx::query_as("SELECT status, answer FROM pending_questions WHERE id = $1")
        .bind(id)
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn tapping_a_choice_sends_it_to_the_agent(pool: PgPool) {
    let h = H::new(pool);
    let q = open_question(&h).await;
    assert!(poller::process(&h.ctx(LOCKED), &tap(q, 1)).await.is_none());

    assert_eq!(
        h.api.calls(),
        [
            Call::Edit {
                chat: HQ,
                message_id: 500,
                text: "There are 42 old logs.\n\n👉 Only older than 30 days".into()
            },
            Call::Answer {
                callback_id: "cb-1".into(),
                toast: Some("Sent".into())
            },
        ]
    );
    let jobs = h.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].text.as_str(), jobs[0].reply_to, jobs[0].topic_id),
        ("Only older than 30 days", 500, Some(7))
    );
    assert_eq!(
        question_status(&h, q).await,
        ("answered".into(), Some("Only older than 30 days".into()))
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_second_tap_does_nothing(pool: PgPool) {
    let h = H::new(pool);
    let q = open_question(&h).await;
    assert!(poller::process(&h.ctx(LOCKED), &tap(q, 0)).await.is_none());
    h.api.clear();
    assert!(poller::process(&h.ctx(LOCKED), &tap(q, 2)).await.is_none());
    assert_eq!(
        h.api.calls(),
        [
            Call::Answer {
                callback_id: "cb-1".into(),
                toast: Some(ALREADY_ANSWERED_TOAST.into())
            },
            Call::RemoveButtons {
                chat: HQ,
                message_id: 500
            },
        ]
    );
    assert_eq!(
        h.jobs.all().len(),
        1,
        "only the first tap reached the agent"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn taps_out_of_range_or_from_another_topic_are_refused(pool: PgPool) {
    let h = H::new(pool);
    let q = open_question(&h).await;
    assert!(poller::process(&h.ctx(LOCKED), &tap(q, 9)).await.is_none());
    let mut elsewhere = tap(q, 0);
    if let teloxide::types::UpdateKind::CallbackQuery(cb) = &mut elsewhere.kind
        && let Some(teloxide::types::MaybeInaccessibleMessage::Regular(m)) = &mut cb.message
    {
        m.thread_id = Some(teloxide::types::ThreadId(teloxide::types::MessageId(9)));
    }
    assert!(poller::process(&h.ctx(LOCKED), &elsewhere).await.is_none());
    assert!(h.jobs.all().is_empty());
    assert_eq!(question_status(&h, q).await, ("open".into(), None));
}

#[sqlx::test(migrations = "./migrations")]
async fn typing_an_answer_closes_the_buttons(pool: PgPool) {
    let h = H::new(pool);
    let q = open_question(&h).await;
    h.run(&["admin_topic_third"]).await;
    assert_eq!(
        h.api.calls(),
        [Call::RemoveButtons {
            chat: HQ,
            message_id: 500
        }]
    );
    assert_eq!(h.jobs.all()[0].text, "what about rmcp?");
    assert_eq!(question_status(&h, q).await.0, "superseded");
}

#[sqlx::test(migrations = "./migrations")]
async fn older_agents_md_files_get_the_new_ground_rules(pool: PgPool) {
    let h = H::new(pool);
    h.run(&["admin_topic_text", "admin_topic_reply"]).await;
    // Pretend topic 7 was set up by the previous template.
    std::fs::write(h.agents.path().join(TOPIC7_MD), "old file without buttons").unwrap();
    sqlx::query(
        "UPDATE conversations SET agents_md_version = 1,
                agents_md_updated_at = now() - interval '1 day'
         WHERE tg_topic_id = 7",
    )
    .execute(&h.pool)
    .await
    .unwrap();

    let refreshed = herbot_core::agents_md::refresh_outdated(&h.pool, h.agents.path())
        .await
        .unwrap();
    assert_eq!(refreshed, 1);
    let md = h.agents_md(TOPIC7_MD);
    assert!(
        md.contains("and compare them") && md.contains("[[ask:"),
        "{md}"
    );
    let (version, fresh): (i32, bool) = sqlx::query_as(
        "SELECT agents_md_version, agents_md_updated_at > now() - interval '1 minute'
         FROM conversations WHERE tg_topic_id = 7",
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(
        (version, fresh),
        (herbot_core::agents_md::TEMPLATE_VERSION, true)
    );
    let again = herbot_core::agents_md::refresh_outdated(&h.pool, h.agents.path())
        .await
        .unwrap();
    assert_eq!(again, 0, "nothing left to do");
}

// ---- 👀 "seen it" reactions ----

#[sqlx::test(migrations = "./migrations")]
async fn every_admin_message_gets_a_seen_reaction(pool: PgPool) {
    let h = H::new(pool);
    h.voice.set(Ok("hello by voice".into()));
    h.run(&[
        "admin_topic_text",
        "admin_general_text",
        "voice_in_general",
        "admin_status_in_topic",
    ])
    .await;
    let eyes = |m| (HQ, m, SEEN_REACTION.to_string());
    assert_eq!(h.api.reactions(), [eyes(21), eyes(40), eyes(46), eyes(23)]);
}

#[sqlx::test(migrations = "./migrations")]
async fn nobody_else_gets_a_reaction(pool: PgPool) {
    let h = H::new(pool);
    h.run(&[
        "stranger_in_topic",
        "other_bot_in_group",
        "admin_dm_text",
        "admin_status_dm",
        "admin_side_text",
        "button_stranger",
    ])
    .await;
    assert!(h.api.reactions().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn a_failed_reaction_is_recorded_but_the_message_still_counts(pool: PgPool) {
    let mut h = H::new(pool);
    h.api.fail_reactions = true;
    h.run(&["admin_general_text"]).await;
    assert_eq!(
        h.count("SELECT count(*) FROM messages").await,
        1,
        "still stored"
    );
    assert_eq!(
        h.count("SELECT count(*) FROM errors WHERE kind = 'telegram.react'")
            .await,
        1
    );
    assert!(
        h.api.sent_texts().is_empty(),
        "no ❌ reply just for a missing reaction"
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
    assert!(
        text.contains("Thread: none yet (your next message starts one)"),
        "{text}"
    );
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

// ---- inbound lanes: each conversation in order, conversations side by side ----

#[test]
fn only_the_admins_messages_commands_and_taps_go_to_lanes() {
    let route = |name| poller::route(&fixture(name), BOT, &LOCKED);
    assert_eq!(route("admin_general_text"), Route::Lane((HQ, None)));
    assert_eq!(route("voice_in_topic7"), Route::Lane((HQ, Some(7))));
    assert_eq!(route("button_research_topic7"), Route::Lane((HQ, Some(7))));
    // Never stored: strangers, DMs, a stranger adding the bot, bookkeeping.
    assert_eq!(route("stranger_in_topic"), Route::Inline);
    assert_eq!(route("stranger_dm_text"), Route::Inline);
    assert_eq!(route("added_by_stranger"), Route::Inline);
    assert_eq!(route("topic_created"), Route::Inline);
    assert_eq!(route("channel_post"), Route::Skip);
}

/// Transcribes only once the test lets it.
struct HeldVoice(std::sync::Arc<tokio::sync::Semaphore>);

impl Transcriber for HeldVoice {
    async fn transcribe(&self, _audio: Vec<u8>) -> Result<String, VoiceError> {
        let _go = self.0.acquire().await.expect("semaphore open");
        Ok("the long voice note".to_string())
    }
}

fn lanes(
    pool: &PgPool,
    voice: HeldVoice,
    agents: &std::path::Path,
) -> InboundLanes<FakeApi, HeldVoice> {
    InboundLanes::new(
        pool.clone(),
        RunSettings {
            speaker: std::sync::Arc::new(herbot_core::speech::NoSpeaker),
            rules: LOCKED,
            bot_username: BOT.to_string(),
            transcriber: voice,
            agents_dir: agents.to_path_buf(),
            agent_label: AGENT_LABEL.to_string(),
            api: std::sync::Arc::new(FakeApi::default()),
            turns: std::sync::Arc::new(Jobs::default()),
            projects: std::sync::Arc::new(FakeCleaner::default()),
        },
    )
}

/// Saves updates to the inbox the way the poll loop does, then queues them.
async fn deliver(pool: &PgPool, lanes: &InboundLanes<FakeApi, HeldVoice>, names: &[&str]) {
    let updates: Vec<Update> = names.iter().map(|n| fixture(n)).collect();
    let saved: Vec<(i64, Value)> = updates
        .iter()
        .map(|u| (i64::from(u.id.0), serde_json::to_value(u).unwrap()))
        .collect();
    let next = updates.last().unwrap().id.0 as i32 + 1;
    store::inbox_save(pool, &saved, next).await.unwrap();
    for update in updates {
        let Route::Lane(key) = lanes.route(&update) else {
            panic!("expected a lane")
        };
        lanes.submit(key, update);
    }
}

async fn admin_messages(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM messages WHERE NOT from_bot")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn a_long_voice_note_holds_up_only_its_own_topic(pool: PgPool) {
    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(0));
    let agents = tempfile::tempdir().unwrap();
    let lanes = lanes(&pool, HeldVoice(gate.clone()), agents.path());

    // A voice note in Research, then a text in General.
    deliver(&pool, &lanes, &["voice_in_topic7", "admin_general_text"]).await;

    // General's text is handled while the voice note is still transcribing.
    let mut waited = 0;
    while admin_messages(&pool).await < 1 {
        assert!(waited < 100, "General waited on Research's voice note");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        waited += 1;
    }
    let inbox: i64 = sqlx::query_scalar("SELECT count(*) FROM inbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inbox, 1, "the voice note is still waiting, and still saved");

    gate.add_permits(1);
    lanes.finish(std::time::Duration::from_secs(10)).await;
    assert_eq!(admin_messages(&pool).await, 2);
    let body: String = sqlx::query_scalar("SELECT body FROM messages WHERE is_voice")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(body, "the long voice note");
    let inbox: i64 = sqlx::query_scalar("SELECT count(*) FROM inbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inbox, 0, "handled updates leave the inbox");
    assert_eq!(store::load_offset(&pool).await.unwrap(), Some(1031));
}

#[sqlx::test(migrations = "./migrations")]
async fn updates_left_from_a_crash_are_handled_at_the_next_start(pool: PgPool) {
    let agents = tempfile::tempdir().unwrap();
    // Saved and acknowledged, but the process died before handling them.
    let updates = [fixture("admin_general_text"), fixture("voice_in_topic7")];
    let saved: Vec<(i64, Value)> = updates
        .iter()
        .map(|u| (i64::from(u.id.0), serde_json::to_value(u).unwrap()))
        .collect();
    store::inbox_save(&pool, &saved, 1031).await.unwrap();

    let gate = std::sync::Arc::new(tokio::sync::Semaphore::new(1));
    let lanes = lanes(&pool, HeldVoice(gate), agents.path());
    lanes.resume().await;
    lanes.finish(std::time::Duration::from_secs(10)).await;

    assert_eq!(
        admin_messages(&pool).await,
        2,
        "both handled after the restart"
    );
    let inbox: i64 = sqlx::query_scalar("SELECT count(*) FROM inbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inbox, 0);
}

/// Explicit local smoke: no Telegram token, no T3 process, only herbot_w5.
#[tokio::test]
#[ignore = "requires the isolated herbot_w5 database on port 5433"]
async fn w5_actions_smoke() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect("postgres://herbot:herbot@127.0.0.1:5433/herbot_w5")
        .await
        .unwrap();
    herbot_core::db::migrate(&pool).await.unwrap();
    sqlx::query("DELETE FROM chats WHERE tg_chat_id=$1")
        .bind(HQ)
        .execute(&pool)
        .await
        .unwrap();
    let h = H::new(pool);
    h.run(&["admin_topic_text"]).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM conversations LIMIT 1")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE conversations SET purpose='Research Rust crates',setup_state='ready' WHERE id=$1",
    )
    .bind(id)
    .execute(&h.pool)
    .await
    .unwrap();
    assert!(h.process(LOCKED, "w5_edited_message").await.is_none());
    assert!(
        h.jobs
            .all()
            .last()
            .unwrap()
            .text
            .contains("edited his message")
    );
    assert!(h.last_message().await.0.contains("<script>"));
    // Non-admin edits and reactions must never alter history or submit turns.
    let jobs = h.jobs.all().len();
    let mut stranger: Value =
        serde_json::from_str(include_str!("fixtures/w5_edited_message.json")).unwrap();
    stranger["edited_message"]["from"]["id"] = 222.into();
    assert!(
        poller::process(
            &h.ctx(LOCKED),
            &serde_json::from_str(&stranger.to_string()).unwrap()
        )
        .await
        .is_none()
    );
    assert_eq!(h.jobs.all().len(), jobs);
    store::store_bot_message(&h.pool, id, 777, 999, "An answer")
        .await
        .unwrap();
    assert!(h.process(LOCKED, "w5_message_reaction").await.is_none());
    assert_eq!(h.count("SELECT count(*) FROM feedback").await, 1);
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT negative_feedback FROM conversations WHERE id=$1")
            .bind(id)
            .fetch_one(&h.pool)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE messages SET attachments='[{\"name\":\"report.txt\"}]'::jsonb WHERE tg_message_id=777").execute(&h.pool).await.unwrap();
    let mut msg: Value =
        serde_json::from_str(include_str!("fixtures/admin_topic_text.json")).unwrap();
    for (n, text) in [
        (9010, "/retry"),
        (9011, "/search Rust"),
        (9012, "/export"),
        (9013, "/private on"),
        (9014, "SECRET EPHEMERAL TEXT"),
        (9015, "/status"),
    ] {
        msg["update_id"] = n.into();
        msg["message"]["message_id"] = n.into();
        msg["message"]["text"] = text.into();
        let update: Update = serde_json::from_str(&msg.to_string()).unwrap();
        assert!(
            telegram::normalize(&update, BOT).is_some(),
            "skipped {text}: {update:?}"
        );
        assert!(
            poller::process(&h.ctx(LOCKED), &update).await.is_none(),
            "{text}"
        );
    }
    assert!(
        h.jobs
            .all()
            .iter()
            .any(|j| j.text.contains("differently or better"))
    );
    assert!(
        h.jobs
            .all()
            .iter()
            .any(|j| j.text == "SECRET EPHEMERAL TEXT")
    );
    assert!(store::is_private(&h.pool, id).await.unwrap());
    store::store_bot_message(&h.pool, id, 778, 999, "SECRET BOT ANSWER")
        .await
        .unwrap();
    assert_eq!(
        h.count("SELECT count(*) FROM messages WHERE body LIKE 'SECRET%'")
            .await,
        0
    );
    let token = herbot_core::hub::caller_token(&h.pool, id).await.unwrap();
    assert!(
        herbot_core::hub::resolve_caller(&h.pool, &token)
            .await
            .is_err()
    );
    let files: Vec<_> = h
        .api
        .calls()
        .into_iter()
        .filter_map(|c| match c {
            Call::File { name, content } => Some((name, content)),
            _ => None,
        })
        .collect();
    assert_eq!(files.len(), 2);
    let html = &files
        .iter()
        .find(|(name, _)| name.ends_with(".html"))
        .unwrap()
        .1;
    assert!(html.contains("&lt;script&gt;") && !html.contains("<script>"));
    assert!(html.contains("report.txt"));
    assert!(html.contains("color-scheme:light dark") && html.contains("viewport"));
    std::fs::write("/tmp/herbot-w5-export.html", html).unwrap();
    assert!(
        h.api
            .sent_texts()
            .iter()
            .any(|t| t.contains("https://t.me/c/1234567890/7/21"))
    );
    assert!(h.api.sent_texts().iter().any(|t| t.contains("🕶️")));
    msg["message"]["text"] = "/private off".into();
    msg["message"]["message_id"] = 9020.into();
    assert!(
        poller::process(
            &h.ctx(LOCKED),
            &serde_json::from_str(&msg.to_string()).unwrap()
        )
        .await
        .is_none()
    );
    assert!(!store::is_private(&h.pool, id).await.unwrap());
    // Exercise a full delayed turn, feedback header, retry markup and progress cleanup.
    struct Runner(Mutex<Vec<String>>);
    impl herbot_core::agent::AgentRunner for Runner {
        async fn ensure_project(&self, _: &std::path::Path, _: &str) -> Result<(), AgentError> {
            Ok(())
        }
        async fn start(
            &self,
            _: &std::path::Path,
            _: &str,
            message: &str,
        ) -> Result<herbot_core::agent::TurnResult, AgentError> {
            self.send("w5-smoke-thread", message).await
        }
        async fn send(
            &self,
            id: &str,
            message: &str,
        ) -> Result<herbot_core::agent::TurnResult, AgentError> {
            self.0.lock().unwrap().push(message.into());
            tokio::time::sleep(std::time::Duration::from_secs(14)).await;
            Ok(herbot_core::agent::TurnResult {
                thread_id: id.into(),
                outcome: herbot_core::agent::TurnOutcome::Replied("A better answer".into()),
            })
        }
        async fn list(
            &self,
            _: &std::path::Path,
        ) -> Result<Vec<herbot_core::agent::ThreadInfo>, AgentError> {
            Ok(vec![])
        }
    }
    let api = std::sync::Arc::new(FakeApi::default());
    let runner = std::sync::Arc::new(Runner(Mutex::new(vec![])));
    let deps = herbot_core::turns::TurnDeps {
        pool: h.pool.clone(),
        api: api.clone(),
        runner: runner.clone(),
        agents_dir: h.agents.path().into(),
        bot_user_id: 999,
        auto_effort: "medium".into(),
        speaker: std::sync::Arc::new(herbot_core::speech::NoSpeaker),
    };
    let mut job = h.jobs.all()[0].clone();
    job.text = "Improve your answer".into();
    herbot_core::turns::run_turn(&deps, job).await;
    assert!(runner.0.lock().unwrap()[0].contains("feedback: Ashrith gave a thumbs-down"));
    assert!(
        api.calls()
            .iter()
            .any(|c| matches!(c,Call::Edit{text,..} if text.contains("Working on it… 0:13")))
    );
    assert!(api.calls().iter().any(|c| matches!(c, Call::Delete { .. })));
    assert!(api.calls().iter().any(|c|matches!(c,Call::SendButtons{rows,..} if rows.iter().flatten().any(|(label,data)|label=="🔄" && data==&format!("retry:{id}")))));
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT negative_feedback FROM conversations WHERE id=$1")
            .bind(id)
            .fetch_one(&h.pool)
            .await
            .unwrap()
    );
}
