//! Step 4: agent turns through a fake T3, a fake Telegram, and a real database.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use sqlx::PgPool;

use herbot_core::agent::{AgentError, AgentRunner, T3Cli, ThreadInfo, TurnOutcome, TurnResult};
use herbot_core::outgoing::REDACTED;
use herbot_core::poller::{ApiError, TelegramApi};
use herbot_core::turns::{
    Lanes, TurnDeps, TurnJob, TurnQueue, answer_button_data, needs_answer_text,
    parse_answer_button, run_turn,
};

const HQ: i64 = -1001234567890;
const BOT_ID: u64 = 999;

// ---- fakes ----

/// (chat, topic, reply_to, text) of one sent message.
type Sent = (i64, Option<i32>, Option<i32>, String);

/// (chat, topic, reply_to, text, buttons) of a message sent with buttons.
type SentButtons = (
    i64,
    Option<i32>,
    Option<i32>,
    String,
    Vec<Vec<(String, String)>>,
);

#[derive(Default)]
struct FakeApi {
    sent: Mutex<Vec<Sent>>,
    with_buttons: Mutex<Vec<SentButtons>>,
    typing: AtomicU32,
    next_id: AtomicI32,
}

impl FakeApi {
    fn texts(&self) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|s| s.3.clone())
            .collect()
    }
}

impl TelegramApi for FakeApi {
    async fn send_text(
        &self,
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
    ) -> Result<i32, ApiError> {
        self.sent
            .lock()
            .unwrap()
            .push((chat, topic, reply_to, text.to_string()));
        Ok(800 + self.next_id.fetch_add(1, Ordering::SeqCst))
    }
    async fn typing(&self, _chat: i64, _topic: Option<i32>) -> Result<(), ApiError> {
        self.typing.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn send_buttons(
        &self,
        chat: i64,
        topic: Option<i32>,
        reply_to: Option<i32>,
        text: &str,
        rows: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        if rows.len() == 1 && rows[0][0].1.starts_with("retry:") {
            self.sent
                .lock()
                .unwrap()
                .push((chat, topic, reply_to, text.to_string()));
        }
        self.with_buttons.lock().unwrap().push((
            chat,
            topic,
            reply_to,
            text.to_string(),
            rows.to_vec(),
        ));
        Ok(800 + self.next_id.fetch_add(1, Ordering::SeqCst))
    }
    async fn edit_text(&self, _: i64, _: i32, _: &str) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn remove_buttons(&self, _: i64, _: i32) -> Result<(), ApiError> {
        Ok(())
    }
    async fn answer_button(&self, _: &str, _: Option<&str>) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn leave_chat(&self, _: i64) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn react(&self, _: i64, _: i32, _: &str) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn download_file(&self, _: &str) -> Result<Vec<u8>, ApiError> {
        unreachable!()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RunnerCall {
    Project {
        folder: PathBuf,
        title: String,
    },
    Start {
        folder: PathBuf,
        title: String,
        message: String,
    },
    Send {
        thread: String,
        message: String,
    },
}

/// A fake T3: numbered threads, scripted outcomes, optional delay, and a
/// record of every call with start/end times (for lane ordering).
#[derive(Default)]
struct FakeRunner {
    calls: Mutex<Vec<RunnerCall>>,
    outcomes: Mutex<VecDeque<Result<TurnOutcome, AgentError>>>,
    threads: Mutex<Vec<ThreadInfo>>,
    next: AtomicU32,
    delay: Duration,
    spans: Mutex<Vec<(String, Instant, Instant)>>,
}

impl FakeRunner {
    fn then(&self, outcome: Result<TurnOutcome, AgentError>) {
        self.outcomes.lock().unwrap().push_back(outcome);
    }
    fn calls(&self) -> Vec<RunnerCall> {
        self.calls.lock().unwrap().clone()
    }
    async fn turn(&self, thread: String, message: &str) -> Result<TurnResult, AgentError> {
        let began = Instant::now();
        tokio::time::sleep(self.delay).await;
        self.spans
            .lock()
            .unwrap()
            .push((message.to_string(), began, Instant::now()));
        let outcome = self
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(TurnOutcome::Replied("ok".into())));
        outcome.map(|outcome| TurnResult {
            thread_id: thread,
            outcome,
        })
    }
}

impl AgentRunner for FakeRunner {
    async fn ensure_project(&self, folder: &Path, title: &str) -> Result<(), AgentError> {
        self.calls.lock().unwrap().push(RunnerCall::Project {
            folder: folder.into(),
            title: title.into(),
        });
        Ok(())
    }
    async fn start(
        &self,
        folder: &Path,
        title: &str,
        message: &str,
    ) -> Result<TurnResult, AgentError> {
        self.calls.lock().unwrap().push(RunnerCall::Start {
            folder: folder.into(),
            title: title.into(),
            message: message.into(),
        });
        let id = format!("t3-{}", self.next.fetch_add(1, Ordering::SeqCst) + 1);
        self.threads.lock().unwrap().insert(
            0,
            ThreadInfo {
                thread_id: id.clone(),
                title: title.into(),
                link: Some(format!("https://app.t3.codes/threads/env/{id}")),
            },
        );
        self.turn(id, message).await
    }
    async fn send(&self, thread: &str, message: &str) -> Result<TurnResult, AgentError> {
        self.calls.lock().unwrap().push(RunnerCall::Send {
            thread: thread.into(),
            message: message.into(),
        });
        self.turn(thread.into(), message).await
    }
    async fn list(&self, _folder: &Path) -> Result<Vec<ThreadInfo>, AgentError> {
        Ok(self.threads.lock().unwrap().clone())
    }
}

// ---- harness ----

struct H {
    deps: TurnDeps<FakeApi, FakeRunner>,
    _agents: tempfile::TempDir,
}

impl H {
    async fn new(pool: PgPool) -> Self {
        Self::with_runner(pool, FakeRunner::default()).await
    }

    async fn with_runner(pool: PgPool, runner: FakeRunner) -> Self {
        // One forum group with a set-up topic 7 (conversation 1) and General (2).
        sqlx::raw_sql(
            "INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (-1001234567890, 'supergroup', 'Herbot HQ', true);
             INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state, agents_md_path, agents_md_updated_at)
               VALUES (1, 7, 'Testing', 'Casual testing buddy for the bot we are building', 'ready',
                       'chat_-1001234567890/topic_7/AGENTS.md', now() - interval '1 hour'),
                      (1, NULL, '', 'Everyday chat', 'ready', 'chat_-1001234567890/general/AGENTS.md', now() - interval '1 hour');",
        )
        .execute(&pool)
        .await
        .unwrap();
        let agents = tempfile::tempdir().unwrap();
        Self {
            deps: TurnDeps {
                speaker: std::sync::Arc::new(herbot_core::speech::NoSpeaker),
                pool,
                api: Arc::new(FakeApi::default()),
                runner: Arc::new(runner),
                agents_dir: agents.path().to_path_buf(),
                bot_user_id: BOT_ID,
                auto_effort: "medium".into(),
            },
            _agents: agents,
        }
    }

    fn folder(&self, leaf: &str) -> PathBuf {
        self.deps.agents_dir.join("chat_-1001234567890").join(leaf)
    }

    async fn count(&self, sql: &'static str) -> i64 {
        sqlx::query_scalar(sql)
            .fetch_one(&self.deps.pool)
            .await
            .unwrap()
    }
}

fn job(conversation_id: i64, topic: Option<i32>, reply_to: i32, text: &str) -> TurnJob {
    TurnJob {
        conversation_id,
        tg_chat_id: HQ,
        topic_id: topic,
        reply_to,
        text: text.into(),
        is_voice: false,
        sender_name: "Ashrith".into(),
        sender_id: 1221260701,
        sent_at: Utc::now(),
        reply: None,
        style: None,
        album: None,
    }
}

// ---- turns ----

#[sqlx::test(migrations = "./migrations")]
async fn first_message_starts_a_thread_in_the_topic_folder_and_replies(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps.runner.then(Ok(TurnOutcome::Replied(
        "Hey! Testing buddy reporting in.".into(),
    )));
    run_turn(&h.deps, job(1, Some(7), 30, "hello there")).await;

    let calls = h.deps.runner.calls();
    assert_eq!(
        calls[0],
        RunnerCall::Project {
            folder: h.folder("topic_7"),
            title: "Herbot HQ › Testing".into()
        }
    );
    let RunnerCall::Start {
        folder,
        title,
        message,
    } = &calls[1]
    else {
        panic!("expected a thread start, got {calls:?}")
    };
    assert_eq!(
        (folder, title.as_str()),
        (&h.folder("topic_7"), "Herbot HQ › Testing")
    );
    assert!(message.starts_with("<herbot-meta>\nfrom: Ashrith (admin, Telegram id 1221260701)\nwhere: Herbot HQ › Testing\nkind: text\n"), "{message}");
    assert!(
        message.ends_with("</herbot-meta>\n\nhello there"),
        "{message}"
    );
    assert!(
        !message.contains("note:"),
        "a new thread reads AGENTS.md anyway"
    );

    let sent = h.deps.api.sent.lock().unwrap().clone();
    assert_eq!(
        sent,
        [(
            HQ,
            Some(7),
            Some(30),
            "Hey! Testing buddy reporting in.".to_string()
        )]
    );

    let (thread, link): (String, Option<String>) =
        sqlx::query_as("SELECT t3_thread_id, t3_link FROM agent_threads")
            .fetch_one(&h.deps.pool)
            .await
            .unwrap();
    assert_eq!(thread, "t3-1");
    assert_eq!(
        link.as_deref(),
        Some("https://app.t3.codes/threads/env/t3-1")
    );

    let (body, from_bot, from_id): (String, bool, i64) =
        sqlx::query_as("SELECT body, from_bot, from_tg_user_id FROM messages")
            .fetch_one(&h.deps.pool)
            .await
            .unwrap();
    assert_eq!(
        (body.as_str(), from_bot, from_id),
        ("Hey! Testing buddy reporting in.", true, BOT_ID as i64)
    );
    assert!(
        h.deps.api.typing.load(Ordering::SeqCst) >= 1,
        "typing shown while waiting"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn later_messages_continue_the_same_thread(pool: PgPool) {
    let h = H::new(pool).await;
    run_turn(&h.deps, job(1, Some(7), 30, "one")).await;
    run_turn(&h.deps, job(1, Some(7), 31, "two")).await;

    let calls = h.deps.runner.calls();
    assert_eq!(
        calls
            .iter()
            .filter(|c| matches!(c, RunnerCall::Project { .. }))
            .count(),
        1,
        "project added once"
    );
    let RunnerCall::Send { thread, message } = &calls[2] else {
        panic!("{calls:?}")
    };
    assert_eq!(thread, "t3-1");
    assert!(message.ends_with("\n\ntwo"));
    assert_eq!(h.count("SELECT count(*) FROM agent_threads").await, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn topics_and_general_get_separate_threads(pool: PgPool) {
    let h = H::new(pool).await;
    run_turn(&h.deps, job(1, Some(7), 30, "topic")).await;
    run_turn(&h.deps, job(2, None, 40, "general")).await;
    let starts: Vec<(PathBuf, String)> = h
        .deps
        .runner
        .calls()
        .into_iter()
        .filter_map(|c| match c {
            RunnerCall::Start { folder, title, .. } => Some((folder, title)),
            _ => None,
        })
        .collect();
    assert_eq!(
        starts,
        [
            (h.folder("topic_7"), "Herbot HQ › Testing".to_string()),
            (h.folder("general"), "Herbot HQ › General".to_string()),
        ]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_rewritten_agents_md_is_announced_once(pool: PgPool) {
    let h = H::new(pool).await;
    run_turn(&h.deps, job(1, Some(7), 30, "one")).await;
    // /setup rewrote AGENTS.md after that turn.
    sqlx::query(
        "UPDATE conversations SET agents_md_updated_at = now() + interval '1 second' WHERE id = 1",
    )
    .execute(&h.deps.pool)
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(1100)).await;
    run_turn(&h.deps, job(1, Some(7), 31, "two")).await;
    run_turn(&h.deps, job(1, Some(7), 32, "three")).await;

    let messages: Vec<String> = h
        .deps
        .runner
        .calls()
        .into_iter()
        .filter_map(|c| match c {
            RunnerCall::Send { message, .. } => Some(message),
            _ => None,
        })
        .collect();
    assert!(
        messages[0].contains("note: your AGENTS.md was rewritten"),
        "{}",
        messages[0]
    );
    assert!(
        !messages[1].contains("note:"),
        "only the first turn after the change"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_failed_run_fails_loudly(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps
        .runner
        .then(Ok(TurnOutcome::Failed("usage limit reached".into())));
    run_turn(&h.deps, job(1, Some(7), 30, "hi there friend")).await;

    let (id, kind, message): (i64, String, String) =
        sqlx::query_as("SELECT id, kind, message FROM errors")
            .fetch_one(&h.deps.pool)
            .await
            .unwrap();
    assert_eq!(kind, "agent.run_failed");
    assert!(message.contains("usage limit reached"));
    assert_eq!(
        h.deps.api.texts(),
        [format!(
            "❌ Failed (E-{id}): the agent run failed. Check logs."
        )]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_timed_out_start_keeps_its_thread_for_next_time(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps.runner.then(Err(AgentError::Timeout(600)));
    run_turn(&h.deps, job(1, Some(7), 30, "a long task")).await;

    let id: i64 = sqlx::query_scalar("SELECT id FROM errors WHERE kind = 'agent.timeout'")
        .fetch_one(&h.deps.pool)
        .await
        .unwrap();
    assert_eq!(
        h.deps.api.texts(),
        [format!(
            "❌ Failed (E-{id}): the agent took longer than 10 min (it may still finish in T3). Check logs."
        )]
    );
    // The thread T3 created was recovered, so the next message continues it.
    run_turn(&h.deps, job(1, Some(7), 31, "status?")).await;
    assert!(
        matches!(&h.deps.runner.calls()[2], RunnerCall::Send { thread, .. } if thread == "t3-1")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_question_from_the_agent_points_to_t3(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps.runner.then(Ok(TurnOutcome::NeedsAnswer));
    run_turn(&h.deps, job(1, Some(7), 30, "delete the old logs")).await;
    assert_eq!(
        h.deps.api.texts(),
        [needs_answer_text(Some(
            "https://app.t3.codes/threads/env/t3-1"
        ))]
    );
    assert_eq!(
        h.count("SELECT count(*) FROM errors").await,
        0,
        "a question isn't a failure"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn replies_are_scrubbed_and_split(pool: PgPool) {
    let h = H::new(pool).await;
    let long = format!(
        "Here is the key: sk-proj-abcdefghijklmnopqrstuvwxyz012345\n\n{}",
        "lorem ipsum ".repeat(700)
    );
    h.deps.runner.then(Ok(TurnOutcome::Replied(long)));
    run_turn(&h.deps, job(1, Some(7), 30, "show me")).await;

    let sent = h.deps.api.sent.lock().unwrap().clone();
    assert!(sent.len() >= 3, "{} parts", sent.len());
    assert!(sent.iter().all(|s| s.3.chars().count() <= 4000));
    assert_eq!(sent[0].2, Some(30), "first part quotes the question");
    assert!(sent[1..].iter().all(|s| s.2.is_none()), "later parts don't");
    assert!(sent[0].3.contains(REDACTED) && !sent[0].3.contains("sk-proj"));
    assert_eq!(
        h.count("SELECT count(*) FROM messages WHERE from_bot")
            .await as usize,
        sent.len()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn after_new_the_next_message_starts_a_fresh_thread(pool: PgPool) {
    let h = H::new(pool).await;
    run_turn(&h.deps, job(1, Some(7), 30, "one")).await;
    // What /new does to the database once T3 has deleted the thread.
    herbot_core::store::wipe_conversation(&h.deps.pool, 1)
        .await
        .unwrap();
    run_turn(&h.deps, job(1, Some(7), 31, "two")).await;
    let starts = h
        .deps
        .runner
        .calls()
        .iter()
        .filter(|c| matches!(c, RunnerCall::Start { .. }))
        .count();
    assert_eq!(starts, 2);
    assert_eq!(h.count("SELECT count(*) FROM agent_threads").await, 1);
}

// ---- caller token and reply slots (Step 7) ----

#[sqlx::test(migrations = "./migrations")]
async fn every_message_carries_the_conversations_caller_token(pool: PgPool) {
    let h = H::new(pool).await;
    run_turn(&h.deps, job(1, Some(7), 30, "hi")).await;
    let token = herbot_core::hub::caller_token(&h.deps.pool, 1)
        .await
        .unwrap();
    assert!(token.starts_with("hb_") && token.len() > 60, "{token}");
    let RunnerCall::Start { message, .. } = &h.deps.runner.calls()[1] else {
        panic!()
    };
    assert!(
        message.contains(&format!("\ncaller: {token}\n")),
        "{message}"
    );
    let general = herbot_core::hub::caller_token(&h.deps.pool, 2)
        .await
        .unwrap();
    assert_ne!(token, general, "each conversation has its own");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_waiting_caller_gets_the_reply_or_the_failure(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps.runner.then(Ok(TurnOutcome::Replied(
        "Build passed.\n\n[[ask: Deploy | Wait]]".into(),
    )));
    let (slot, answer) = herbot_core::turns::ReplySlot::new();
    let mut asked = job(1, Some(7), 30, "did the build pass?");
    asked.reply = Some(slot);
    run_turn(&h.deps, asked).await;
    assert_eq!(
        answer.await.unwrap(),
        Ok("Build passed.\n\n(Options offered: Deploy | Wait)".to_string())
    );

    h.deps.runner.then(Ok(TurnOutcome::Failed("boom".into())));
    let (slot, answer) = herbot_core::turns::ReplySlot::new();
    let mut failing = job(1, Some(7), 31, "again");
    failing.reply = Some(slot);
    run_turn(&h.deps, failing).await;
    let err = answer.await.unwrap().unwrap_err();
    assert!(
        err.starts_with("E-") && err.ends_with("the agent run failed"),
        "{err}"
    );
}

// ---- choices as buttons (Step 6) ----

#[test]
fn answer_button_data_round_trips() {
    assert_eq!(answer_button_data(42, 3), "ans:42:3");
    assert_eq!(parse_answer_button("ans:42:3"), Some((42, 3)));
    for bad in ["ans:42", "ans:x:1", "ans:1:2:3", "setup:research", ""] {
        assert_eq!(parse_answer_button(bad), None, "{bad}");
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn an_ask_line_becomes_buttons_and_an_open_question(pool: PgPool) {
    let h = H::new(pool).await;
    h.deps.runner.then(Ok(TurnOutcome::Replied(
        "There are 42 old logs.\n\n[[ask: Delete all | Only older than 30 days | Keep them]]"
            .into(),
    )));
    run_turn(&h.deps, job(1, Some(7), 30, "clean up the logs")).await;

    assert!(
        h.deps.api.texts().is_empty(),
        "the whole reply went out with buttons"
    );
    let sent = h.deps.api.with_buttons.lock().unwrap().clone();
    let [(chat, topic, reply_to, text, rows)] = sent.as_slice() else {
        panic!("{sent:?}")
    };
    assert_eq!(
        (*chat, *topic, *reply_to, text.as_str()),
        (HQ, Some(7), Some(30), "There are 42 old logs.")
    );
    let (question_id, status, tg_message_id): (i64, String, Option<i32>) =
        sqlx::query_as("SELECT id, status, tg_message_id FROM pending_questions")
            .fetch_one(&h.deps.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), tg_message_id), ("open", Some(800)));
    assert_eq!(
        *rows,
        [
            vec![("Delete all".to_string(), answer_button_data(question_id, 0))],
            vec![(
                "Only older than 30 days".to_string(),
                answer_button_data(question_id, 1)
            )],
            vec![("Keep them".to_string(), answer_button_data(question_id, 2))],
            vec![("🔄".to_string(), "retry:1".to_string())],
        ]
    );
    let body: String = sqlx::query_scalar("SELECT body FROM messages WHERE from_bot")
        .fetch_one(&h.deps.pool)
        .await
        .unwrap();
    assert_eq!(
        body, "There are 42 old logs.",
        "the ask line isn't stored as text"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_long_reply_gets_buttons_on_its_last_part(pool: PgPool) {
    let h = H::new(pool).await;
    let long = format!("{}\n\n[[ask: Yes | No]]", "word ".repeat(1500));
    h.deps.runner.then(Ok(TurnOutcome::Replied(long)));
    run_turn(&h.deps, job(1, Some(7), 30, "go")).await;
    assert!(!h.deps.api.texts().is_empty());
    let buttons = h.deps.api.with_buttons.lock().unwrap().clone();
    assert_eq!(buttons.len(), 1);
    assert_eq!(buttons[0].2, None, "the first part quoted the question");
}

// ---- lanes ----

#[sqlx::test(migrations = "./migrations")]
async fn lanes_run_one_turn_at_a_time_per_conversation_and_in_parallel_across(pool: PgPool) {
    let runner = FakeRunner {
        delay: Duration::from_millis(300),
        ..Default::default()
    };
    let h = H::with_runner(pool, runner).await;
    let api = h.deps.api.clone();
    let runner = h.deps.runner.clone();
    let lanes = Lanes::new(TurnDeps {
        speaker: std::sync::Arc::new(herbot_core::speech::NoSpeaker),
        pool: h.deps.pool.clone(),
        api: api.clone(),
        runner: runner.clone(),
        agents_dir: h.deps.agents_dir.clone(),
        bot_user_id: BOT_ID,
        auto_effort: "medium".into(),
    });

    lanes.submit(job(1, Some(7), 30, "topic-first"));
    lanes.submit(job(1, Some(7), 31, "topic-second"));
    lanes.submit(job(2, None, 40, "general-only"));

    let deadline = Instant::now() + Duration::from_secs(10);
    while api.texts().len() < 3 {
        assert!(
            Instant::now() < deadline,
            "turns didn't finish: {:?}",
            api.texts()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let spans = runner.spans.lock().unwrap().clone();
    let span = |needle: &str| {
        spans
            .iter()
            .find(|(m, _, _)| m.ends_with(needle))
            .map(|(_, a, b)| (*a, *b))
            .unwrap()
    };
    let (first_start, first_end) = span("topic-first");
    let (second_start, _) = span("topic-second");
    let (general_start, _) = span("general-only");
    assert!(
        second_start >= first_end,
        "same topic: second waits for first"
    );
    assert!(
        general_start < first_end,
        "other conversations run in parallel"
    );
    assert!(first_start <= second_start);
}

// ---- the real T3 CLI wrapper, against a fake `t3` script ----

fn fake_t3(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("t3");
    std::fs::write(&path, format!("#!/bin/bash\n{body}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

fn cli(bin: PathBuf, timeout: Duration) -> T3Cli {
    T3Cli {
        bin,
        provider: "codex".into(),
        model: "gpt-6.1-terra".into(),
        timeout,
    }
}

#[tokio::test]
async fn t3_cli_start_passes_model_title_and_message_on_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("argv");
    let stdin = dir.path().join("stdin");
    let bin = fake_t3(
        dir.path(),
        &format!(
            "printf '%s\\n' \"$@\" > {log}\ncat > {stdin}\necho 'note: starting'\necho '{{\"threadId\":\"t3-xyz\",\"status\":\"completed\",\"reply\":\"PINEAPPLE 4\",\"error\":null}}'",
            log = log.display(),
            stdin = stdin.display()
        ),
    );
    let result = cli(bin, Duration::from_secs(10))
        .start(
            Path::new("/agents/chat_1/topic_7"),
            "HQ › Testing",
            "line one\nline two",
        )
        .await
        .unwrap();
    assert_eq!(
        result,
        TurnResult {
            thread_id: "t3-xyz".into(),
            outcome: TurnOutcome::Replied("PINEAPPLE 4".into())
        }
    );
    let argv = std::fs::read_to_string(&log).unwrap();
    assert_eq!(
        argv.lines().collect::<Vec<_>>(),
        [
            "thread",
            "start",
            "/agents/chat_1/topic_7",
            "-",
            "--provider",
            "codex",
            "--model",
            "gpt-6.1-terra",
            "--title",
            "HQ › Testing",
            "--wait",
            "--json",
        ]
    );
    assert_eq!(
        std::fs::read_to_string(&stdin).unwrap(),
        "line one\nline two"
    );
}

#[tokio::test]
async fn t3_cli_send_reports_waiting_and_failures() {
    let dir = tempfile::tempdir().unwrap();
    let waiting = fake_t3(
        dir.path(),
        "cat >/dev/null\necho '{\"threadId\":\"t1\",\"status\":\"waiting\",\"reply\":null,\"error\":null}'\nexit 2",
    );
    let r = cli(waiting, Duration::from_secs(10))
        .send("t1", "hi")
        .await
        .unwrap();
    assert_eq!(r.outcome, TurnOutcome::NeedsAnswer);

    let dir2 = tempfile::tempdir().unwrap();
    let broken = fake_t3(
        dir2.path(),
        "cat >/dev/null\necho 'ERROR: server not running' >&2\nexit 1",
    );
    let err = cli(broken, Duration::from_secs(10))
        .send("t1", "hi")
        .await
        .unwrap_err();
    assert_eq!(
        err,
        AgentError::BadOutput {
            exit: Some(1),
            detail: "ERROR: server not running".into()
        }
    );
}

#[tokio::test]
async fn t3_cli_times_out_and_kills_the_process() {
    let dir = tempfile::tempdir().unwrap();
    let slow = fake_t3(dir.path(), "cat >/dev/null\nsleep 30");
    let began = Instant::now();
    let err = cli(slow, Duration::from_secs(1))
        .send("t1", "hi")
        .await
        .unwrap_err();
    assert_eq!(err, AgentError::Timeout(1));
    assert!(began.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn t3_cli_finds_a_threads_project_and_removes_it_by_id_only() {
    use herbot_core::agent::ProjectCleaner;
    const ID: &str = "c8b83136-53e8-401b-8de5-85361fc43bcd";

    let dir = tempfile::tempdir().unwrap();
    let show = fake_t3(
        dir.path(),
        &format!(
            r#"echo '{{"thread":{{"threadId":"t1","projectId":"{ID}","title":"HQ"}},"messages":[]}}'"#
        ),
    );
    assert_eq!(
        cli(show, Duration::from_secs(10))
            .project_of_thread("t1")
            .await
            .unwrap()
            .as_deref(),
        Some(ID)
    );

    let dir2 = tempfile::tempdir().unwrap();
    let gone = fake_t3(
        dir2.path(),
        "echo 'Thread t1 is no longer available.' >&2\nexit 1",
    );
    assert_eq!(
        cli(gone, Duration::from_secs(10))
            .project_of_thread("t1")
            .await
            .unwrap(),
        None
    );

    let dir3 = tempfile::tempdir().unwrap();
    let log = dir3.path().join("argv");
    let ok = fake_t3(
        dir3.path(),
        &format!("printf '%s\\n' \"$@\" > {}", log.display()),
    );
    cli(ok.clone(), Duration::from_secs(10))
        .remove_project(ID)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&log)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        ["project", "remove", "--force", ID]
    );

    // Never a path, even if asked.
    std::fs::remove_file(&log).unwrap();
    for not_an_id in ["/Users/ashrith/Desktop/herbot", "."] {
        let err = cli(ok.clone(), Duration::from_secs(10))
            .remove_project(not_an_id)
            .await
            .unwrap_err();
        assert!(matches!(err, AgentError::Project(_)), "{err:?}");
        let err = cli(ok.clone(), Duration::from_secs(10))
            .threads_in_project(not_an_id)
            .await
            .unwrap_err();
        assert!(matches!(err, AgentError::Project(_)), "{err:?}");
    }
    assert!(!log.exists(), "the CLI was never even called with a path");
}

#[tokio::test]
async fn t3_cli_project_add_accepts_already_registered() {
    let dir = tempfile::tempdir().unwrap();
    let already = fake_t3(
        dir.path(),
        "echo 'Project folder is already registered' >&2\nexit 1",
    );
    cli(already, Duration::from_secs(10))
        .ensure_project(Path::new("/x"), "X")
        .await
        .unwrap();

    let dir2 = tempfile::tempdir().unwrap();
    let missing = dir2.path().join("no-such-t3");
    let err = cli(missing, Duration::from_secs(10))
        .ensure_project(Path::new("/x"), "X")
        .await
        .unwrap_err();
    assert!(matches!(err, AgentError::Spawn(_)), "{err:?}");
}

#[tokio::test]
async fn t3_cli_deadline_includes_a_blocked_stdin_write() {
    let dir = tempfile::tempdir().unwrap();
    let slow = fake_t3(dir.path(), "exec sleep 30");
    let input = "x".repeat(2 * 1024 * 1024);
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        cli(slow, Duration::from_secs(1)).send("t1", &input),
    )
    .await
    .expect("stdin must be covered by the CLI deadline");
    assert_eq!(result.unwrap_err(), AgentError::Timeout(1));
}

struct NoProjects;
impl herbot_core::agent::ProjectCleaner for NoProjects {
    fn project_of_thread<'a>(
        &'a self,
        _: &'a str,
    ) -> herbot_core::agent::BoxFuture<'a, Result<Option<String>, AgentError>> {
        Box::pin(async { Ok(None) })
    }
    fn threads_in_project<'a>(
        &'a self,
        _: &'a str,
    ) -> herbot_core::agent::BoxFuture<'a, Result<Vec<String>, AgentError>> {
        Box::pin(async { Ok(vec![]) })
    }
    fn remove_project<'a>(
        &'a self,
        _: &'a str,
    ) -> herbot_core::agent::BoxFuture<'a, Result<(), AgentError>> {
        Box::pin(async { Ok(()) })
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn wipes_wait_for_running_turns_and_discard_queued_turns(pool: PgPool) {
    use herbot_core::{
        store,
        wipe::{self, WipeKind},
    };
    for kind in [WipeKind::New, WipeKind::Forget] {
        let runner = FakeRunner {
            delay: Duration::from_millis(150),
            ..Default::default()
        };
        // Use a fresh fixture for each kind without sharing conversation IDs.
        if kind == WipeKind::Forget {
            sqlx::query("TRUNCATE chats RESTART IDENTITY CASCADE")
                .execute(&pool)
                .await
                .unwrap();
        }
        let h = H::with_runner(pool.clone(), runner).await;
        let api = h.deps.api.clone();
        let runner = h.deps.runner.clone();
        let dir = h.deps.agents_dir.clone();
        let lanes = Arc::new(Lanes::new(h.deps));
        let old = job(1, Some(7), 31, "queued before clean slate");
        lanes.submit(job(1, Some(7), 30, "running"));
        tokio::time::timeout(Duration::from_secs(2), async {
            while runner.calls().len() < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let status = store::conversation_status_by_id(&pool, 1).await.unwrap();
        wipe::run(&pool, &NoProjects, &dir, &status, kind)
            .await
            .unwrap();
        // A previously accepted job (including crash replay) cannot recreate the thread.
        lanes.submit(old);
        tokio::time::timeout(Duration::from_secs(2), async {
            while lanes.in_progress(1) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let messages: i64 = sqlx::query_scalar("SELECT count(*) FROM messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        let threads: i64 = sqlx::query_scalar("SELECT count(*) FROM agent_threads")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((messages, threads), (0, 0));
        assert_eq!(api.texts().iter().filter(|s| s.as_str() == "ok").count(), 1);
        assert_eq!(runner.calls().len(), 2);
    }
}
