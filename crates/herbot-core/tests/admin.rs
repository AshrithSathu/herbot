//! Step 8: the admin panel's API.

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

use herbot_core::admin::{AdminState, router};
use herbot_core::agent::{AgentError, BoxFuture, ProjectCleaner};
use herbot_core::errors;

const TOKEN: &str = "admin-token-0123456789abcdef0123456789";
const PROJECT: &str = "c8b83136-53e8-401b-8de5-85361fc43bcd";

/// T3 where thread `t3-research` lives alone in PROJECT (unless `shared`).
#[derive(Default)]
struct FakeT3 {
    removed: Mutex<Vec<String>>,
    shared: bool,
}

impl ProjectCleaner for FakeT3 {
    fn project_of_thread<'a>(
        &'a self,
        thread_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AgentError>> {
        Box::pin(async move { Ok((thread_id == "t3-research").then(|| PROJECT.to_string())) })
    }
    fn threads_in_project<'a>(
        &'a self,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, AgentError>> {
        Box::pin(async move {
            let mut threads = vec!["t3-research".to_string()];
            if self.shared {
                threads.push("someone-elses-thread".into());
            }
            Ok(threads)
        })
    }
    fn remove_project<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<(), AgentError>> {
        Box::pin(async move {
            self.removed.lock().unwrap().push(project_id.to_string());
            Ok(())
        })
    }
}

struct H {
    pool: PgPool,
    t3: Arc<FakeT3>,
    agents: tempfile::TempDir,
    app: axum::Router,
}

async fn harness(pool: PgPool, t3: FakeT3) -> H {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (-100111, 'supergroup', 'Herbot HQ', true);
         INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state, agents_md_path) VALUES
           (1, NULL, '', 'Everyday chat', 'ready', 'chat_-100111/general/AGENTS.md'),
           (1, 7, 'Research', 'Rust MCP research and comparisons', 'ready', 'chat_-100111/topic_7/AGENTS.md');
         INSERT INTO agent_threads (conversation_id, t3_thread_id, t3_link)
           VALUES (2, 't3-research', 'https://app.t3.codes/threads/env/t3-research');
         INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, is_voice, body, sent_at) VALUES
           (2, 1, 111, false, true,  'compare rmcp with the others', now() - interval '1 hour'),
           (2, 2, 999, true,  false, 'rmcp is the official SDK', now());",
    )
    .execute(&pool)
    .await
    .unwrap();
    let agents = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(agents.path().join("chat_-100111/topic_7")).unwrap();
    std::fs::write(
        agents.path().join("chat_-100111/topic_7/AGENTS.md"),
        "# Herbot HQ › Research\n\nold rules",
    )
    .unwrap();
    let t3 = Arc::new(t3);
    let app = router(Arc::new(AdminState {
        pool: pool.clone(),
        projects: t3.clone(),
        agents_dir: agents.path().to_path_buf(),
        token: TOKEN.into(),
        agent_label: "gpt-6.1-terra · medium".into(),
        bot_username: Some("sashrith_bot".into()),
    }));
    H {
        pool,
        t3,
        agents,
        app,
    }
}

async fn call(h: &H, method: Method, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    call_with(h, method, path, body, TOKEN).await
}

async fn call_with(
    h: &H,
    method: Method,
    path: &str,
    body: Option<Value>,
    token: &str,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"));
    let body = match body {
        Some(v) => {
            request = request.header("content-type", "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
    let response = h
        .app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn every_endpoint_needs_the_admin_token(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    for (method, path) in [
        (Method::GET, "/admin/api/overview"),
        (Method::GET, "/admin/api/conversations"),
        (Method::GET, "/admin/api/conversations/2"),
        (Method::GET, "/admin/api/conversations/2/messages"),
        (Method::GET, "/admin/api/errors"),
    ] {
        let (status, _) = call_with(&h, method, path, None, "wrong-token").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
    let (status, _) = call_with(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({"kind": "new"})),
        "",
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(h.t3.removed.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn overview_counts_everything(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    errors::record(&h.pool, "t3.turn_timeout", "slow", json!({}))
        .await
        .unwrap();
    let (status, body) = call(&h, Method::GET, "/admin/api/overview", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bot"], "@sashrith_bot");
    assert_eq!(body["agent"], "gpt-6.1-terra · medium");
    assert_eq!(
        (body["conversations"].as_i64(), body["messages"].as_i64()),
        (Some(2), Some(2))
    );
    assert_eq!(body["active_threads"], 1);
    assert_eq!(body["errors_last_24h"], 1);
    assert_eq!(body["last_error"]["error_id"], "E-1000");
}

#[sqlx::test(migrations = "./migrations")]
async fn conversations_list_general_first(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (_, body) = call(&h, Method::GET, "/admin/api/conversations", None).await;
    let list = body.as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["place"], "Herbot HQ › General");
    assert_eq!(list[1]["place"], "Herbot HQ › Research");
    assert_eq!(list[1]["messages"], 2);
    assert_eq!(
        list[1]["thread_link"],
        "https://app.t3.codes/threads/env/t3-research"
    );
    assert_eq!(list[1]["setup_state"], "ready");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_conversation_shows_its_agents_md(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (status, body) = call(&h, Method::GET, "/admin/api/conversations/2", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["agents_md"], "# Herbot HQ › Research\n\nold rules");
    assert!(
        body.get("recent_messages").is_none(),
        "messages page separately, so polling the topic stays small"
    );
    assert!(
        body.get("caller_token").is_none(),
        "secrets never leave the API"
    );
    let (status, _) = call(&h, Method::GET, "/admin/api/conversations/99", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn editing_a_purpose_rewrites_agents_md(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (status, body) = call(
        &h,
        Method::PUT,
        "/admin/api/conversations/2/purpose",
        Some(json!({ "purpose": "  Compare Rust MCP crates and cite sources.  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["purpose"], "Compare Rust MCP crates and cite sources.");
    let md =
        std::fs::read_to_string(h.agents.path().join("chat_-100111/topic_7/AGENTS.md")).unwrap();
    assert!(
        md.contains("Compare Rust MCP crates and cite sources.") && !md.contains("old rules"),
        "{md}"
    );
    let changed: bool = sqlx::query_scalar(
        "SELECT agents_md_updated_at > now() - interval '1 minute' FROM conversations WHERE id = 2",
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert!(changed, "the thread will be told to reread it");

    let (status, body) = call(
        &h,
        Method::PUT,
        "/admin/api/conversations/2/purpose",
        Some(json!({ "purpose": "hi" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("a bit short"));
}

#[sqlx::test(migrations = "./migrations")]
async fn conversations_can_be_turned_off_and_on(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (status, body) = call(
        &h,
        Method::PUT,
        "/admin/api/conversations/2/enabled",
        Some(json!({ "enabled": false })),
    )
    .await;
    assert_eq!(
        (status, body["enabled"].as_bool()),
        (StatusCode::OK, Some(false))
    );
    let (_, body) = call(
        &h,
        Method::PUT,
        "/admin/api/conversations/2/enabled",
        Some(json!({ "enabled": true })),
    )
    .await;
    assert_eq!(body["enabled"], true);
    let (status, _) = call(
        &h,
        Method::PUT,
        "/admin/api/conversations/99/enabled",
        Some(json!({ "enabled": true })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn wiping_from_the_panel_uses_the_same_safe_sweep(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (status, body) = call(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({ "kind": "new" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        (body["threads"].as_i64(), body["messages"].as_i64()),
        (Some(1), Some(2))
    );
    assert_eq!(*h.t3.removed.lock().unwrap(), [PROJECT]);
    let purpose: Option<String> =
        sqlx::query_scalar("SELECT purpose FROM conversations WHERE id = 2")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert!(purpose.is_some(), "new keeps the purpose");

    let (status, _) = call(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({ "kind": "forget" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let purpose: Option<String> =
        sqlx::query_scalar("SELECT purpose FROM conversations WHERE id = 2")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(purpose, None, "forget clears it");
    assert!(
        !h.agents
            .path()
            .join("chat_-100111/topic_7/AGENTS.md")
            .exists()
    );

    let (status, _) = call(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({ "kind": "everything" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_refused_wipe_reports_an_error_id_and_keeps_everything(pool: PgPool) {
    let h = harness(
        pool,
        FakeT3 {
            shared: true,
            ..Default::default()
        },
    )
    .await;
    let (status, body) = call(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({ "kind": "new" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    let error = body["error"].as_str().unwrap();
    assert!(
        error.starts_with("E-1000: nothing was wiped") && error.contains("didn't start"),
        "{error}"
    );
    assert!(h.t3.removed.lock().unwrap().is_empty());
    let messages: i64 = sqlx::query_scalar("SELECT count(*) FROM messages")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(messages, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn errors_are_found_by_id_or_text(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    errors::record(
        &h.pool,
        "t3.turn_timeout",
        "the agent took too long",
        json!({"conversation_id": 2}),
    )
    .await
    .unwrap();
    errors::record(&h.pool, "voice.transcribe", "OpenAI said 401", json!({}))
        .await
        .unwrap();

    let (_, all) = call(&h, Method::GET, "/admin/api/errors", None).await;
    assert_eq!(all.as_array().unwrap().len(), 2);
    assert_eq!(all[0]["error_id"], "E-1001", "newest first");

    let (_, by_id) = call(&h, Method::GET, "/admin/api/errors?q=E-1000", None).await;
    assert_eq!(by_id.as_array().unwrap().len(), 1);
    assert_eq!(by_id[0]["kind"], "t3.turn_timeout");

    let (_, by_text) = call(&h, Method::GET, "/admin/api/errors?q=openai", None).await;
    assert_eq!(by_text[0]["error_id"], "E-1001");

    let (status, one) = call(&h, Method::GET, "/admin/api/errors/E-1000", None).await;
    assert_eq!(
        (status, one["context"]["conversation_id"].as_i64()),
        (StatusCode::OK, Some(2))
    );
    let (status, _) = call(&h, Method::GET, "/admin/api/errors/E-9999", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&h, Method::GET, "/admin/api/errors/nonsense", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Adds `n` more messages to Research (conversation 2), alternating sides.
async fn add_messages(pool: &PgPool, n: i32) {
    sqlx::query(
        "INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at)
         SELECT 2, 100 + g, CASE WHEN g % 2 = 0 THEN 999 ELSE 111 END, g % 2 = 0,
                'message ' || g, now() + make_interval(secs => g)
         FROM generate_series(1, $1) AS g",
    )
    .bind(n)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn messages_page_back_from_the_newest(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    add_messages(&h.pool, 70).await; // 72 in all

    let (status, first) = call(&h, Method::GET, "/admin/api/conversations/2/messages", None).await;
    assert_eq!(status, StatusCode::OK);
    let page = first["messages"].as_array().unwrap();
    assert_eq!(page.len(), 30, "default page size");
    assert_eq!(first["has_more"], true);
    assert_eq!(
        page.last().unwrap()["body"],
        "message 70",
        "ends at the newest"
    );
    assert_eq!(page[0]["body"], "message 41", "oldest first within a page");

    // Keep going back until the start; every message shows up exactly once.
    let mut seen: Vec<String> = page
        .iter()
        .map(|m| m["body"].as_str().unwrap().to_string())
        .collect();
    let mut before = page[0]["id"].as_i64().unwrap();
    loop {
        let (_, older) = call(
            &h,
            Method::GET,
            &format!("/admin/api/conversations/2/messages?before={before}"),
            None,
        )
        .await;
        let page = older["messages"].as_array().unwrap();
        let mut bodies: Vec<String> = page
            .iter()
            .map(|m| m["body"].as_str().unwrap().to_string())
            .collect();
        bodies.extend(seen);
        seen = bodies;
        before = page[0]["id"].as_i64().unwrap();
        if older["has_more"] == false {
            break;
        }
    }
    assert_eq!(seen.len(), 72);
    assert_eq!(
        seen[0], "compare rmcp with the others",
        "the very first message"
    );
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 72, "no message twice");
}

#[sqlx::test(migrations = "./migrations")]
async fn messages_after_an_id_bring_in_only_new_ones(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (_, first) = call(&h, Method::GET, "/admin/api/conversations/2/messages", None).await;
    let newest = first["messages"].as_array().unwrap().last().unwrap()["id"]
        .as_i64()
        .unwrap();
    assert_eq!(first["has_more"], false);

    add_messages(&h.pool, 3).await;
    let (_, newer) = call(
        &h,
        Method::GET,
        &format!("/admin/api/conversations/2/messages?after={newest}"),
        None,
    )
    .await;
    let bodies: Vec<_> = newer["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["body"].clone())
        .collect();
    assert_eq!(bodies, ["message 1", "message 2", "message 3"]);
    assert_eq!(newer["has_more"], false);

    let (_, capped) = call(
        &h,
        Method::GET,
        "/admin/api/conversations/2/messages?limit=100000",
        None,
    )
    .await;
    assert_eq!(
        capped["messages"].as_array().unwrap().len(),
        5,
        "limit is clamped, not trusted"
    );
    let (status, _) = call(
        &h,
        Method::GET,
        "/admin/api/conversations/99/messages",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn the_error_list_pages_and_stays_small(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let long = "x".repeat(5000);
    for i in 0..5 {
        errors::record(
            &h.pool,
            "t3.turn_failed",
            &format!("{i} {long}"),
            json!({ "big": long }),
        )
        .await
        .unwrap();
    }
    errors::record(&h.pool, "odd", "100% sure_thing", json!({}))
        .await
        .unwrap();

    let (_, first) = call(&h, Method::GET, "/admin/api/errors?limit=4", None).await;
    let first = first.as_array().unwrap();
    assert_eq!(first.len(), 4);
    assert!(
        first[1].get("context").is_none(),
        "lists leave the context out"
    );
    assert_eq!(
        first[1]["message"].as_str().unwrap().chars().count(),
        300,
        "messages are capped"
    );
    let before = first[3]["id"].as_i64().unwrap();
    let (_, rest) = call(
        &h,
        Method::GET,
        &format!("/admin/api/errors?limit=4&before={before}"),
        None,
    )
    .await;
    let rest = rest.as_array().unwrap();
    assert_eq!(rest.len(), 2);
    assert_eq!(rest[1]["error_id"], "E-1000");

    // Search text is literal: % and _ don't act as wildcards.
    let (_, literal) = call(&h, Method::GET, "/admin/api/errors?q=100%25%20sure_", None).await;
    assert_eq!(literal.as_array().unwrap().len(), 1);
    let (_, wildcard) = call(&h, Method::GET, "/admin/api/errors?q=%25", None).await;
    assert_eq!(
        wildcard.as_array().unwrap().len(),
        1,
        "only the message with a real %"
    );

    // The detail still has everything.
    let (_, one) = call(&h, Method::GET, "/admin/api/errors/E-1000", None).await;
    assert_eq!(one["message"].as_str().unwrap().chars().count(), 5002);
    assert_eq!(one["context"]["big"].as_str().unwrap().len(), 5000);
}

type Counted = (i64, Option<chrono::DateTime<chrono::Utc>>);

/// (message count, last activity) as kept on the conversation, and as worked
/// out from its messages. They must always agree.
async fn counted_and_actual(pool: &PgPool, id: i64) -> (Counted, Counted) {
    let kept: Counted =
        sqlx::query_as("SELECT message_count, last_message_at FROM conversations WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    let actual: Counted =
        sqlx::query_as("SELECT count(*), max(sent_at) FROM messages WHERE conversation_id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    (kept, actual)
}

#[sqlx::test(migrations = "./migrations")]
async fn message_counts_stay_exact_without_counting(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let (kept, actual) = counted_and_actual(&h.pool, 2).await;
    assert_eq!(kept, actual);
    assert_eq!(kept.0, 2);

    // A bulk insert, then a redelivered update that inserts nothing.
    add_messages(&h.pool, 70).await;
    sqlx::query(
        "INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, body, sent_at)
         VALUES (2, 1, 111, 'again', now()) ON CONFLICT DO NOTHING",
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let (kept, actual) = counted_and_actual(&h.pool, 2).await;
    assert_eq!(kept, actual);
    assert_eq!(kept.0, 72);

    // Deleting the newest moves last activity back to the one before it.
    sqlx::query(
        "DELETE FROM messages WHERE id = (SELECT max(id) FROM messages WHERE conversation_id = 2)",
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let (kept, actual) = counted_and_actual(&h.pool, 2).await;
    assert_eq!(kept, actual);
    assert_eq!(kept.0, 71);

    // What the panel shows comes from the same numbers.
    let (_, list) = call(&h, Method::GET, "/admin/api/conversations", None).await;
    assert_eq!(list[1]["messages"], 71);
    let (_, overview) = call(&h, Method::GET, "/admin/api/overview", None).await;
    assert_eq!(overview["messages"], 71);

    // A wipe empties it; deleting a conversation outright cascades cleanly.
    let (status, _) = call(
        &h,
        Method::POST,
        "/admin/api/conversations/2/wipe",
        Some(json!({ "kind": "forget" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(counted_and_actual(&h.pool, 2).await, ((0, None), (0, None)));
    add_messages(&h.pool, 3).await;
    sqlx::query("DELETE FROM conversations WHERE id = 2")
        .execute(&h.pool)
        .await
        .unwrap();
    let (_, overview) = call(&h, Method::GET, "/admin/api/overview", None).await;
    assert_eq!(overview["messages"], 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn the_list_carries_short_purposes_and_the_detail_the_full_one(pool: PgPool) {
    let h = harness(pool, FakeT3::default()).await;
    let long = "word ".repeat(1000); // 5,000 characters
    sqlx::query("UPDATE conversations SET purpose = $1 WHERE id = 2")
        .bind(long.trim_end())
        .execute(&h.pool)
        .await
        .unwrap();

    let (_, list) = call(&h, Method::GET, "/admin/api/conversations", None).await;
    let short = list[1]["purpose"].as_str().unwrap();
    assert!(short.ends_with('…'), "{short}");
    assert!(short.chars().count() <= 301, "{}", short.chars().count());
    assert_eq!(list[0]["purpose"], "Everyday chat", "short ones are whole");

    let (_, detail) = call(&h, Method::GET, "/admin/api/conversations/2", None).await;
    assert_eq!(detail["conversation"]["purpose"], long.trim_end());

    // The overview's last error is a list row too: no context.
    errors::record(
        &h.pool,
        "x.big",
        "boom",
        json!({ "blob": "z".repeat(20_000) }),
    )
    .await
    .unwrap();
    let (_, overview) = call(&h, Method::GET, "/admin/api/overview", None).await;
    assert_eq!(overview["last_error"]["message"], "boom");
    assert!(overview["last_error"].get("context").is_none());
}
