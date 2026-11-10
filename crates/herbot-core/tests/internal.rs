//! Step 7: herbot-core's internal API (General's post and ask actions).

use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

use herbot_core::hub;
use herbot_core::internal::{InternalState, router};
use herbot_core::poller::{ApiError, TelegramApi};
use herbot_core::turns::{TurnJob, TurnQueue};

const TOKEN: &str = "test-internal-token-0123456789abcdef";
const HQ: i64 = -100111;

#[derive(Default)]
struct FakeApi {
    sent: Mutex<Vec<(i64, Option<i32>, String)>>,
    next: AtomicI32,
    /// Telegram refuses every send.
    down: std::sync::atomic::AtomicBool,
}

impl TelegramApi for FakeApi {
    async fn send_text(
        &self,
        chat: i64,
        topic: Option<i32>,
        _reply_to: Option<i32>,
        text: &str,
    ) -> Result<i32, ApiError> {
        if self.down.load(Ordering::SeqCst) {
            return Err(ApiError("Bad Request: message thread not found".into()));
        }
        self.sent
            .lock()
            .unwrap()
            .push((chat, topic, text.to_string()));
        Ok(900 + self.next.fetch_add(1, Ordering::SeqCst))
    }
    async fn typing(&self, _: i64, _: Option<i32>) -> Result<(), ApiError> {
        Ok(())
    }
    async fn send_buttons(
        &self,
        _: i64,
        _: Option<i32>,
        _: Option<i32>,
        _: &str,
        _: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        unreachable!()
    }
    async fn edit_text(&self, _: i64, _: i32, _: &str) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn remove_buttons(&self, _: i64, _: i32) -> Result<(), ApiError> {
        unreachable!()
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

/// Answers every job straight away with a fixed reply (or a failure), and
/// records what it was asked. `silent` never answers, to test timeouts.
#[derive(Default)]
struct AnsweringLanes {
    jobs: Mutex<Vec<TurnJob>>,
    answer: Mutex<Option<Result<String, String>>>,
    silent: bool,
}

impl TurnQueue for AnsweringLanes {
    fn submit(&self, job: TurnJob) {
        self.jobs.lock().unwrap().push(job.clone());
        if self.silent {
            std::mem::forget(job); // keep the reply slot open forever
            return;
        }
        let answer = self
            .answer
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(Ok("on it".into()));
        if let Some(slot) = job.reply {
            slot.deliver(answer);
        }
    }
}

struct H {
    pool: PgPool,
    api: Arc<FakeApi>,
    lanes: Arc<AnsweringLanes>,
    app: axum::Router,
}

async fn harness(pool: PgPool, lanes: AnsweringLanes, ask_timeout: Duration) -> H {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (-100111, 'supergroup', 'Herbot HQ', true);
         INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state) VALUES
           (1, NULL, '', 'Everyday chat', 'ready'),
           (1, 7, 'Research', 'Rust research', 'ready');",
    )
    .execute(&pool)
    .await
    .unwrap();
    let api = Arc::new(FakeApi::default());
    let lanes = Arc::new(lanes);
    let app = router(Arc::new(InternalState {
        pool: pool.clone(),
        api: api.clone(),
        turns: lanes.clone(),
        token: TOKEN.into(),
        bot_user_id: 999,
        admin_user_id: 111,
        ask_timeout,
    }));
    H {
        pool,
        api,
        lanes,
        app,
    }
}

async fn call(h: &H, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let response = h
        .app
        .clone()
        .oneshot(
            Request::post(path)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn token(pool: &PgPool, conversation: i64) -> String {
    hub::caller_token(pool, conversation).await.unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn general_posts_into_a_topic(pool: PgPool) {
    let h = harness(pool, AnsweringLanes::default(), Duration::from_secs(5)).await;
    let general = token(&h.pool, 1).await;
    let (status, body) = call(
        &h,
        "/internal/post",
        TOKEN,
        json!({ "caller": general, "topic": "Research", "text": "Summary: rmcp wins." }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["posted_messages"], 1);
    assert_eq!(
        h.api.sent.lock().unwrap().clone(),
        [(
            HQ,
            Some(7),
            "📨 From General:\n\nSummary: rmcp wins.".to_string()
        )]
    );
    let stored: i64 =
        sqlx::query_scalar("SELECT count(*) FROM messages WHERE conversation_id = 2 AND from_bot")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(stored, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn general_asks_a_topic_and_gets_its_answer(pool: PgPool) {
    let lanes = AnsweringLanes::default();
    *lanes.answer.lock().unwrap() = Some(Ok("rmcp, because it's the official SDK.".into()));
    let h = harness(pool, lanes, Duration::from_secs(5)).await;
    let general = token(&h.pool, 1).await;
    let (status, body) = call(
        &h,
        "/internal/ask",
        TOKEN,
        json!({ "caller": general, "topic": "research", "message": "Which MCP crate should Herbot use?" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reply"], "rmcp, because it's the official SDK.");
    assert_eq!(body["topic"], "Herbot HQ › Research");

    // The question is visible in the topic, and the turn quotes it.
    let sent = h.api.sent.lock().unwrap().clone();
    assert_eq!(
        sent,
        [(
            HQ,
            Some(7),
            "📨 General asks:\n\nWhich MCP crate should Herbot use?".to_string()
        )]
    );
    let jobs = h.lanes.jobs.lock().unwrap().clone();
    assert_eq!(jobs.len(), 1);
    assert_eq!((jobs[0].conversation_id, jobs[0].reply_to), (2, 900));
    assert_eq!(jobs[0].text, "Which MCP crate should Herbot use?");
    assert_eq!(jobs[0].sender_name, "General (asking for Ashrith)");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_failed_or_slow_answer_is_reported(pool: PgPool) {
    let lanes = AnsweringLanes::default();
    *lanes.answer.lock().unwrap() = Some(Err("E-1042: the agent run failed".into()));
    let h = harness(pool, lanes, Duration::from_secs(5)).await;
    let general = token(&h.pool, 1).await;
    let (status, body) = call(
        &h,
        "/internal/ask",
        TOKEN,
        json!({ "caller": general, "topic": "2", "message": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body["error"].as_str().unwrap().contains("E-1042"));
}

#[sqlx::test(migrations = "./migrations")]
async fn asking_times_out_but_the_answer_still_lands_in_the_topic(pool: PgPool) {
    let lanes = AnsweringLanes {
        silent: true,
        ..Default::default()
    };
    let h = harness(pool, lanes, Duration::from_millis(200)).await;
    let general = token(&h.pool, 1).await;
    let (status, body) = call(
        &h,
        "/internal/ask",
        TOKEN,
        json!({ "caller": general, "topic": "Research", "message": "slow one" }),
    )
    .await;
    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
    assert!(body["error"].as_str().unwrap().contains("still working"));
}

#[sqlx::test(migrations = "./migrations")]
async fn bad_tokens_topics_and_targets_are_refused(pool: PgPool) {
    let h = harness(pool, AnsweringLanes::default(), Duration::from_secs(5)).await;
    let general = token(&h.pool, 1).await;
    let research = token(&h.pool, 2).await;

    let cases = [
        (
            "wrong-internal-token",
            json!({ "caller": general, "topic": "Research", "text": "hi" }),
            StatusCode::UNAUTHORIZED,
        ),
        (
            TOKEN,
            json!({ "caller": "hb_nobody", "topic": "Research", "text": "hi" }),
            StatusCode::UNAUTHORIZED,
        ),
        (
            TOKEN,
            json!({ "caller": research, "topic": "General", "text": "hi" }),
            StatusCode::FORBIDDEN,
        ),
        (
            TOKEN,
            json!({ "caller": general, "topic": "General", "text": "hi" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            TOKEN,
            json!({ "caller": general, "topic": "Nope", "text": "hi" }),
            StatusCode::NOT_FOUND,
        ),
        (
            TOKEN,
            json!({ "caller": general, "topic": "Research", "text": "  " }),
            StatusCode::BAD_REQUEST,
        ),
    ];
    for (bearer, body, expected) in cases {
        let (status, reply) = call(&h, "/internal/post", bearer, body.clone()).await;
        assert_eq!(status, expected, "{body} -> {reply}");
    }
    assert!(h.api.sent.lock().unwrap().is_empty(), "nothing was posted");
    assert!(h.lanes.jobs.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn only_set_up_switched_on_topics_can_be_asked(pool: PgPool) {
    let h = harness(pool, AnsweringLanes::default(), Duration::from_secs(5)).await;
    let general = token(&h.pool, 1).await;
    // Not set up yet: refused, so General can't skip the topic's purpose setup.
    sqlx::query("UPDATE conversations SET setup_state = 'new', purpose = NULL WHERE id = 2")
        .execute(&h.pool)
        .await
        .unwrap();
    let (status, body) = call(
        &h,
        "/internal/ask",
        TOKEN,
        json!({ "caller": general, "topic": "2", "message": "hi" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["error"].as_str().unwrap().contains("isn't set up yet"),
        "{body}"
    );
    // Switched off: hidden from General altogether.
    sqlx::query("UPDATE conversations SET setup_state = 'ready', purpose = 'Rust research', enabled = false WHERE id = 2")
        .execute(&h.pool)
        .await
        .unwrap();
    let (status, body) = call(
        &h,
        "/internal/ask",
        TOKEN,
        json!({ "caller": general, "topic": "2", "message": "hi" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    // Nothing was shown in the topic and no turn ran.
    assert!(h.api.sent.lock().unwrap().is_empty());
    assert!(h.lanes.jobs.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn a_telegram_failure_is_recorded_with_an_error_id(pool: PgPool) {
    let h = harness(pool, AnsweringLanes::default(), Duration::from_secs(5)).await;
    h.api.down.store(true, Ordering::SeqCst);
    let general = token(&h.pool, 1).await;
    let (status, body) = call(
        &h,
        "/internal/post",
        TOKEN,
        json!({ "caller": general, "topic": "Research", "text": "hi" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    let error = body["error"].as_str().unwrap();
    assert!(
        error.starts_with("Failed (E-") && error.contains("message thread not found"),
        "{error}"
    );
    let recorded: i64 =
        sqlx::query_scalar("SELECT count(*) FROM errors WHERE kind = 'internal.send'")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(recorded, 1);
}
