//! Speaks real MCP (JSON-RPC over stdio) to the herbot-mcp binary, the way
//! Codex does, against a fresh test database.

use std::process::Stdio;
use std::time::Duration;

use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

struct Mcp {
    child: Child,
    stdin: ChildStdin,
    stdout: tokio::io::Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

impl Mcp {
    async fn start(database_url: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_herbot-mcp"))
            .env("DATABASE_URL", database_url)
            .env("HERBOT_CORE_URL", "http://127.0.0.1:1")
            .env_remove("HERBOT_INTERNAL_TOKEN")
            .env("RUST_LOG", "warn")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("herbot-mcp binary");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut mcp = Self {
            child,
            stdin,
            stdout,
            next_id: 1,
        };
        let init = mcp
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "herbot-test", "version": "0" }
                }),
            )
            .await;
        assert_eq!(init["result"]["serverInfo"]["name"], "herbot-mcp", "{init}");
        assert!(
            init["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("caller")
        );
        mcp.notify("notifications/initialized").await;
        mcp
    }

    async fn send(&mut self, message: Value) {
        let mut line = message.to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await.unwrap();
        self.stdin.flush().await.unwrap();
    }

    async fn notify(&mut self, method: &str) {
        self.send(json!({ "jsonrpc": "2.0", "method": method }))
            .await;
    }

    async fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await;
        loop {
            let line = tokio::time::timeout(Duration::from_secs(10), self.stdout.next_line())
                .await
                .expect("herbot-mcp answered in time")
                .unwrap()
                .expect("herbot-mcp stayed up");
            let message: Value = serde_json::from_str(&line).expect("JSON-RPC on stdout");
            if message["id"] == id {
                return message;
            }
        }
    }

    /// Calls a tool; returns (is_error, text).
    async fn call(&mut self, tool: &str, arguments: Value) -> (bool, String) {
        let reply = self
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )
            .await;
        let result = &reply["result"];
        assert!(result.is_object(), "{reply}");
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        (result["isError"].as_bool().unwrap_or(false), text)
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

/// The URL of the fresh database `#[sqlx::test]` made for this test.
fn url_for(pool: &PgPool) -> String {
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let db = pool
        .connect_options()
        .get_database()
        .expect("test database name")
        .to_string();
    let (server, _) = base.rsplit_once('/').expect("DATABASE_URL has a database");
    format!("{server}/{db}")
}

async fn seed(pool: &PgPool) -> (String, String) {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (-100111, 'supergroup', 'Herbot HQ', true);
         INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state) VALUES
           (1, NULL, '', 'Everyday chat', 'ready'),
           (1, 7, 'Research', 'Rust MCP research', 'ready');
         INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at) VALUES
           (1, 1, 111, false, 'the VPS has 8 GB of RAM', now() - interval '2 days'),
           (2, 1, 111, false, 'compare rmcp with the others', now() - interval '1 day'),
           (2, 2, 999, true, 'rmcp is the official Rust SDK', now());",
    )
    .execute(pool)
    .await
    .unwrap();
    let general: String = sqlx::query_scalar("SELECT caller_token FROM conversations WHERE id = 1")
        .fetch_one(pool)
        .await
        .unwrap();
    let research: String =
        sqlx::query_scalar("SELECT caller_token FROM conversations WHERE id = 2")
            .fetch_one(pool)
            .await
            .unwrap();
    (general, research)
}

#[sqlx::test(migrations = "../herbot-core/migrations")]
async fn lists_all_tools_with_caller_required(pool: PgPool) {
    let mut mcp = Mcp::start(&url_for(&pool)).await;
    let tools = mcp.request("tools/list", json!({})).await;
    let tools = tools["result"]["tools"].as_array().unwrap().clone();
    let mut names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    names.sort();
    assert_eq!(
        names,
        [
            "ask_topic",
            "forget",
            "list_topics",
            "post_to_topic",
            "read_topic",
            "recall",
            "remember",
            "search_messages"
        ]
    );
    for tool in &tools {
        let required = tool["inputSchema"]["required"].as_array().unwrap();
        assert!(
            required.contains(&json!("caller")),
            "{} must require caller",
            tool["name"]
        );
        assert!(tool["description"].as_str().unwrap().len() > 20);
    }
    let read_only = tools
        .iter()
        .find(|t| t["name"] == "search_messages")
        .unwrap();
    assert_eq!(read_only["annotations"]["readOnlyHint"], true);
}

#[sqlx::test(migrations = "../herbot-core/migrations")]
async fn general_sees_everything_and_a_topic_only_itself(pool: PgPool) {
    let (general, research) = seed(&pool).await;
    let mut mcp = Mcp::start(&url_for(&pool)).await;

    let (err, text) = mcp.call("list_topics", json!({ "caller": general })).await;
    assert!(!err, "{text}");
    let topics: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(topics.as_array().unwrap().len(), 2);
    assert_eq!(topics[0]["name"], "Herbot HQ › General");
    assert_eq!(topics[0]["is_you"], true);

    let (err, text) = mcp
        .call(
            "search_messages",
            json!({ "caller": general, "query": "rmcp" }),
        )
        .await;
    assert!(!err, "{text}");
    let hits: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(hits.as_array().unwrap().len(), 2);
    assert_eq!(hits[0]["from"], "bot");
    assert_eq!(hits[0]["topic"], "Herbot HQ › Research");

    let (err, text) = mcp
        .call(
            "read_topic",
            json!({ "caller": research, "topic": "General" }),
        )
        .await;
    assert!(err, "a topic can't read General: {text}");
    assert!(
        text.contains("only search and read their own history"),
        "{text}"
    );

    let (err, text) = mcp.call("read_topic", json!({ "caller": research })).await;
    assert!(!err, "{text}");
    assert_eq!(
        serde_json::from_str::<Value>(&text)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let (err, text) = mcp
        .call("list_topics", json!({ "caller": "hb_forged" }))
        .await;
    assert!(err && text.contains("unknown caller token"), "{text}");
}

#[sqlx::test(migrations = "../herbot-core/migrations")]
async fn actions_say_clearly_when_they_are_off(pool: PgPool) {
    let (general, _) = seed(&pool).await;
    let mut mcp = Mcp::start(&url_for(&pool)).await;
    let (err, text) = mcp
        .call(
            "post_to_topic",
            json!({ "caller": general, "topic": "Research", "text": "hi" }),
        )
        .await;
    assert!(err && text.contains("HERBOT_INTERNAL_TOKEN"), "{text}");
}
