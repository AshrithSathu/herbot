//! Step 1 integration tests. Each `#[sqlx::test]` gets its own fresh database
//! with all migrations applied, so tests never share state.
//! Needs Postgres from `make db-up` and DATABASE_URL (the Makefile sets it).

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

async fn get(pool: PgPool, path: &str) -> (StatusCode, Value) {
    let response = router(AppState { pool })
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "./migrations")]
async fn health_reports_ok(pool: PgPool) {
    let (status, body) = get(pool, "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "herbot-core");
}

#[sqlx::test(migrations = "./migrations")]
async fn ready_reports_db_ok(pool: PgPool) {
    let (status, body) = get(pool, "/ready").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "status": "ready", "db": "ok" }));
}

#[tokio::test]
async fn ready_returns_503_when_db_is_unreachable() {
    let dead_pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(500))
        .connect_lazy("postgres://nobody:nothing@127.0.0.1:1/none")
        .unwrap();
    let (status, body) = get(dead_pool, "/ready").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({ "status": "not_ready", "db": "unreachable" }));
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
            "bindings",
            "bot_allowed",
            "bots",
            "errors",
            "groups",
            "messages",
            "numbers",
            "pending_questions",
            "people",
        ]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn recorded_errors_get_increasing_ids_from_1000(pool: PgPool) {
    let first = errors::record(
        &pool,
        "t3.turn_timeout",
        "turn timed out after 120s",
        json!({"group": "G2"}),
    )
    .await
    .unwrap();
    let second = errors::record(
        &pool,
        "bridge.send_failed",
        "bridge returned 500",
        json!({}),
    )
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
    assert_eq!(context, json!({"group": "G2"}));
}

#[sqlx::test(migrations = "./migrations")]
async fn new_groups_default_to_pending_shared(pool: PgPool) {
    let (status, kind): (String, String) = sqlx::query_as(
        "INSERT INTO groups (wa_jid, name) VALUES ('120363000000000001@g.us', 'Test') RETURNING status, kind",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((status.as_str(), kind.as_str()), ("pending", "shared"));
}

#[sqlx::test(migrations = "./migrations")]
async fn schema_rejects_invalid_rows(pool: PgPool) {
    // Not a group JID.
    assert!(
        sqlx::query("INSERT INTO groups (wa_jid) VALUES ('919000000000@s.whatsapp.net')")
            .execute(&pool)
            .await
            .is_err()
    );
    // Unknown status.
    assert!(
        sqlx::query("INSERT INTO groups (wa_jid, status) VALUES ('1@g.us', 'maybe')")
            .execute(&pool)
            .await
            .is_err()
    );
    // Approved without approved_at.
    assert!(
        sqlx::query("INSERT INTO groups (wa_jid, status) VALUES ('2@g.us', 'approved')")
            .execute(&pool)
            .await
            .is_err()
    );
    // Phone not in E.164.
    assert!(
        sqlx::query("INSERT INTO people (phone_e164, display_name) VALUES ('9876543210', 'x')")
            .execute(&pool)
            .await
            .is_err()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn only_one_admin_can_exist(pool: PgPool) {
    sqlx::query("INSERT INTO people (phone_e164, display_name, is_admin) VALUES ('+919000000001', 'Ashrith', true)")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO people (phone_e164, display_name) VALUES ('+919000000002', 'Ravi')")
        .execute(&pool)
        .await
        .unwrap();
    let second_admin = sqlx::query(
        "INSERT INTO people (phone_e164, display_name, is_admin) VALUES ('+919000000003', 'Mallory', true)",
    )
    .execute(&pool)
    .await;
    assert!(second_admin.is_err(), "a second admin must be rejected");
}

#[sqlx::test(migrations = "./migrations")]
async fn one_active_thread_per_bot_and_group(pool: PgPool) {
    sqlx::raw_sql(
        "INSERT INTO numbers (phone_e164, label) VALUES ('+919000000009', 'Ashrith''s bot');
         INSERT INTO bots (slug, name, number_id) VALUES ('research', 'Research', 1);
         INSERT INTO groups (wa_jid) VALUES ('3@g.us');
         INSERT INTO agent_threads (bot_id, group_id, t3_thread_id) VALUES (1, 1, 't3-a');",
    )
    .execute(&pool)
    .await
    .unwrap();

    let duplicate = sqlx::query(
        "INSERT INTO agent_threads (bot_id, group_id, t3_thread_id) VALUES (1, 1, 't3-b')",
    )
    .execute(&pool)
    .await;
    assert!(
        duplicate.is_err(),
        "two active threads for one group must be rejected"
    );

    // After archiving (what `/new` does), a fresh thread is allowed.
    sqlx::query("UPDATE agent_threads SET status = 'archived', archived_at = now() WHERE t3_thread_id = 't3-a'")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO agent_threads (bot_id, group_id, t3_thread_id) VALUES (1, 1, 't3-b')")
        .execute(&pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn message_search_finds_words(pool: PgPool) {
    sqlx::query(
        "INSERT INTO messages (chat_jid, wa_message_id, sender_jid, body, sent_at)
         VALUES ('4@g.us', 'm1', 'x@lid', 'remember the VPS has 8 GB of RAM', now()),
                ('4@g.us', 'm2', 'x@lid', 'cricket tonight?', now())",
    )
    .execute(&pool)
    .await
    .unwrap();
    let hits: Vec<String> = sqlx::query_scalar(
        "SELECT wa_message_id FROM messages WHERE search @@ plainto_tsquery('simple', 'vps ram')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(hits, ["m1"]);
}
