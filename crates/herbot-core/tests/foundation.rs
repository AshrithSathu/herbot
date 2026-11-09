//! Foundation integration tests: HTTP endpoints, error IDs and schema rules.
//! Each `#[sqlx::test]` gets its own fresh database with all migrations
//! applied. Needs Postgres from `make db-up` and DATABASE_URL (the Makefile
//! sets it).

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use herbot_core::app::{AppState, router};
use herbot_core::errors::{self, ErrorId};

async fn get(state: AppState, path: &str) -> (StatusCode, Value) {
    let response = router(state)
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

fn state(pool: PgPool) -> AppState {
    AppState {
        pool,
        telegram_username: None,
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn health_reports_ok(pool: PgPool) {
    let (status, body) = get(state(pool), "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "herbot-core");
}

#[sqlx::test(migrations = "./migrations")]
async fn ready_reports_db_ok_and_telegram_disabled(pool: PgPool) {
    let (status, body) = get(state(pool), "/ready").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "status": "ready", "db": "ok", "telegram": "disabled" })
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn ready_reports_telegram_username(pool: PgPool) {
    let app = AppState {
        pool,
        telegram_username: Some("herbot_test_bot".into()),
    };
    let (_, body) = get(app, "/ready").await;
    assert_eq!(body["telegram"], "@herbot_test_bot");
}

#[tokio::test]
async fn ready_returns_503_when_db_is_unreachable() {
    let dead_pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(500))
        .connect_lazy("postgres://nobody:nothing@127.0.0.1:1/none")
        .unwrap();
    let (status, body) = get(state(dead_pool), "/ready").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "not_ready");
    assert_eq!(body["db"], "unreachable");
}

#[sqlx::test(migrations = "./migrations")]
async fn migrations_create_every_table(pool: PgPool) {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT table_name::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name <> '_sqlx_migrations'
         ORDER BY table_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        tables,
        [
            "agent_threads",
            "audit_log",
            "bots",
            "chats",
            "conversations",
            "errors",
            "inbox",
            "kv",
            "messages",
            "pending_questions",
        ]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn recorded_errors_get_increasing_ids_from_1000(pool: PgPool) {
    let first = errors::record(
        &pool,
        "t3.turn_timeout",
        "turn timed out after 120s",
        json!({"conversation": 7}),
    )
    .await
    .unwrap();
    let second = errors::record(&pool, "telegram.poll_failed", "network down", json!({}))
        .await
        .unwrap();
    assert_eq!(first, ErrorId(1000));
    assert_eq!(second, ErrorId(1001));
    assert_eq!(first.to_string(), "E-1000");

    let (kind, context): (String, Value) =
        sqlx::query_as("SELECT kind, context FROM errors WHERE id = $1")
            .bind(first.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "t3.turn_timeout");
    assert_eq!(context, json!({"conversation": 7}));
}

#[sqlx::test(migrations = "./migrations")]
async fn schema_rejects_invalid_rows(pool: PgPool) {
    // Channels are not supported chat kinds.
    assert!(
        sqlx::query("INSERT INTO chats (tg_chat_id, kind) VALUES (-100, 'channel')")
            .execute(&pool)
            .await
            .is_err()
    );
    // Unknown chat status.
    assert!(
        sqlx::query("INSERT INTO chats (tg_chat_id, kind, status) VALUES (-101, 'group', 'maybe')")
            .execute(&pool)
            .await
            .is_err()
    );
    // Bad persona slug.
    assert!(
        sqlx::query("INSERT INTO bots (slug, name) VALUES ('Has Spaces', 'x')")
            .execute(&pool)
            .await
            .is_err()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn only_one_default_bot(pool: PgPool) {
    sqlx::query("INSERT INTO bots (slug, name, is_default) VALUES ('main', 'Main', true)")
        .execute(&pool)
        .await
        .unwrap();
    let second =
        sqlx::query("INSERT INTO bots (slug, name, is_default) VALUES ('alt', 'Alt', true)")
            .execute(&pool)
            .await;
    assert!(second.is_err(), "a second default persona must be rejected");
}

#[sqlx::test(migrations = "./migrations")]
async fn one_conversation_per_chat_and_topic_including_no_topic(pool: PgPool) {
    sqlx::query(
        "INSERT INTO chats (tg_chat_id, kind, is_forum) VALUES (-1001, 'supergroup', true)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let inserts: [&'static str; 2] = [
        "INSERT INTO conversations (chat_id, tg_topic_id) VALUES (1, NULL)",
        "INSERT INTO conversations (chat_id, tg_topic_id) VALUES (1, 7)",
    ];
    for sql in inserts {
        sqlx::query(sql).execute(&pool).await.unwrap();
        let dup = sqlx::query(sql).execute(&pool).await;
        assert!(
            dup.is_err(),
            "duplicate conversation must be rejected: {sql}"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn one_thread_per_conversation(pool: PgPool) {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind) VALUES (42, 'private');
         INSERT INTO conversations (chat_id) VALUES (1);
         INSERT INTO agent_threads (conversation_id, t3_thread_id) VALUES (1, 't3-a');",
    )
    .execute(&pool)
    .await
    .unwrap();

    let duplicate =
        sqlx::query("INSERT INTO agent_threads (conversation_id, t3_thread_id) VALUES (1, 't3-b')")
            .execute(&pool)
            .await;
    assert!(duplicate.is_err(), "a second thread must be rejected");

    // After deleting it (what `/new` and `/forget` do), a fresh one is allowed.
    sqlx::query("DELETE FROM agent_threads WHERE t3_thread_id = 't3-a'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO agent_threads (conversation_id, t3_thread_id) VALUES (1, 't3-b')")
        .execute(&pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn message_search_finds_words(pool: PgPool) {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind) VALUES (42, 'private');
         INSERT INTO conversations (chat_id) VALUES (1);
         INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, body, sent_at)
         VALUES (1, 1, 42, 'remember the VPS has 8 GB of RAM', now()),
                (1, 2, 42, 'cricket tonight?', now());",
    )
    .execute(&pool)
    .await
    .unwrap();
    let hits: Vec<i32> = sqlx::query_scalar(
        "SELECT tg_message_id FROM messages WHERE search @@ plainto_tsquery('simple', 'vps ram')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(hits, [1]);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_state_rules_are_enforced(pool: PgPool) {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind, is_forum) VALUES (-1001, 'supergroup', true);
         INSERT INTO conversations (chat_id, tg_topic_id) VALUES (1, 7);",
    )
    .execute(&pool)
    .await
    .unwrap();
    let state: String = sqlx::query_scalar("SELECT setup_state FROM conversations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "new");

    // Ready needs a purpose; purposes are 1..=8000 characters.
    for bad in [
        "UPDATE conversations SET setup_state = 'ready'",
        "UPDATE conversations SET purpose = ''",
        "UPDATE conversations SET purpose = repeat('x', 8001)",
        "UPDATE conversations SET setup_state = 'maybe'",
    ] {
        assert!(sqlx::query(bad).execute(&pool).await.is_err(), "{bad}");
    }
    sqlx::query("UPDATE conversations SET purpose = 'Research', setup_state = 'ready'")
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn imagine_rejects_invalid_requests_and_cross_topic_reference_before_api() {
    use herbot_core::imagine::{ImagineError, generate_video};
    let topic = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let reference = outside.path().join("reference.png");
    std::fs::write(&reference, b"not sent").unwrap();
    for (prompt, seconds, size) in [
        ("", 4, "720x1280"),
        ("boat", 5, "720x1280"),
        ("boat", 4, "512x512"),
    ] {
        assert!(matches!(
            generate_video(
                "unused",
                "sora-2",
                topic.path(),
                prompt,
                seconds,
                size,
                None
            )
            .await,
            Err(ImagineError::Invalid(_))
        ));
    }
    assert!(matches!(
        generate_video(
            "unused",
            "sora-2",
            topic.path(),
            "boat",
            4,
            "720x1280",
            Some(&reference)
        )
        .await,
        Err(ImagineError::Invalid(_))
    ));
}
