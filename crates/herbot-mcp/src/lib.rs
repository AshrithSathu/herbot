//! herbot-mcp: the tools Herbot's agents call.
//!
//! Codex starts this over stdio for each agent thread. Every tool takes the
//! `caller` token from the agent's `<herbot-meta>` header; [`herbot_core::hub`]
//! decides what that caller may see. General's action tools go through
//! herbot-core's internal API, so posting and asking use the same Telegram
//! connection and agent lanes as everything else.

use chrono::{DateTime, Utc};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ErrorData as McpError, ServerHandler, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use herbot_core::hub::{self, HubError};

/// Where herbot-core's internal API lives, and its shared secret.
#[derive(Clone)]
pub struct CoreApi {
    pub base_url: String,
    pub token: Option<String>,
    pub client: reqwest::Client,
}

#[derive(Clone)]
pub struct HerbotTools {
    pool: PgPool,
    core: CoreApi,
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CallerOnly {
    /// The `caller` value from your <herbot-meta> header.
    pub caller: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchArgs {
    /// The `caller` value from your <herbot-meta> header.
    pub caller: String,
    /// Words to look for.
    pub query: String,
    /// General only: limit to one topic (name or id from list_topics). Omit to search every topic.
    pub topic: Option<String>,
    /// How many matches (default 20, max 50).
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadArgs {
    /// The `caller` value from your <herbot-meta> header.
    pub caller: String,
    /// General only: which topic to read (name or id). Omit to read your own conversation.
    pub topic: Option<String>,
    /// How many of the latest messages (default 30, max 100).
    pub limit: Option<i64>,
    /// Only messages before this time (RFC 3339), to page back further.
    pub before: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AskArgs {
    /// The `caller` value from your <herbot-meta> header.
    pub caller: String,
    /// Which topic's agent to ask (name or id from list_topics).
    pub topic: String,
    /// What to ask it.
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct PostArgs {
    /// The `caller` value from your <herbot-meta> header.
    pub caller: String,
    /// Which topic to post into (name or id from list_topics).
    pub topic: String,
    /// The message to post.
    pub text: String,
}

fn ok_json<T: Serialize>(value: &T) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

/// Tool-level failures go back to the agent as readable errors, not protocol errors.
fn tool_error(message: impl Into<String>) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::error(vec![ContentBlock::text(
        message.into(),
    )]))
}

fn hub_error(err: HubError) -> Result<CallToolResult, McpError> {
    tracing::warn!(error = %err, "tool call refused or failed");
    tool_error(err.to_string())
}

#[tool_router]
impl HerbotTools {
    pub fn new(pool: PgPool, core: CoreApi) -> Self {
        Self {
            pool,
            core,
            tool_router: Self::tool_router(),
        }
    }

    async fn caller(&self, token: &str) -> Result<hub::Caller, HubError> {
        hub::resolve_caller(&self.pool, token).await
    }

    /// Every conversation in the Herbot group: General and each topic, with its
    /// purpose, message count and last activity. `is_you` marks yours.
    #[tool(annotations(read_only_hint = true))]
    pub async fn list_topics(
        &self,
        Parameters(args): Parameters<CallerOnly>,
    ) -> Result<CallToolResult, McpError> {
        let caller = match self.caller(&args.caller).await {
            Ok(c) => c,
            Err(e) => return hub_error(e),
        };
        match hub::list_topics(&self.pool, &caller).await {
            Ok(topics) => ok_json(&topics),
            Err(e) => hub_error(e),
        }
    }

    /// Search message history (both Ashrith's messages and the bot's replies),
    /// newest first. General can search every topic or one; a topic searches
    /// only its own history.
    #[tool(annotations(read_only_hint = true))]
    pub async fn search_messages(
        &self,
        Parameters(args): Parameters<SearchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let caller = match self.caller(&args.caller).await {
            Ok(c) => c,
            Err(e) => return hub_error(e),
        };
        match hub::search(
            &self.pool,
            &caller,
            &args.query,
            args.topic.as_deref(),
            args.limit,
        )
        .await
        {
            Ok(lines) if lines.is_empty() => {
                ok_json(&serde_json::json!({ "matches": [], "note": "nothing found" }))
            }
            Ok(lines) => ok_json(&lines),
            Err(e) => hub_error(e),
        }
    }

    /// The latest messages of a conversation, oldest first. General can read
    /// any topic; a topic reads its own. Use `before` to page back.
    #[tool(annotations(read_only_hint = true))]
    pub async fn read_topic(
        &self,
        Parameters(args): Parameters<ReadArgs>,
    ) -> Result<CallToolResult, McpError> {
        let caller = match self.caller(&args.caller).await {
            Ok(c) => c,
            Err(e) => return hub_error(e),
        };
        match hub::read(
            &self.pool,
            &caller,
            args.topic.as_deref(),
            args.limit,
            args.before,
        )
        .await
        {
            Ok(lines) => ok_json(&lines),
            Err(e) => hub_error(e),
        }
    }

    /// General only: ask another topic's agent something and get its answer.
    /// The question and answer also show up in that topic in Telegram. Can take
    /// a few minutes if the other agent has real work to do.
    #[tool]
    pub async fn ask_topic(
        &self,
        Parameters(args): Parameters<AskArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.core_action("/internal/ask", &args).await
    }

    /// General only: post a message into a topic (shown as "From General").
    #[tool]
    pub async fn post_to_topic(
        &self,
        Parameters(args): Parameters<PostArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.core_action("/internal/post", &args).await
    }

    async fn core_action<T: Serialize>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<CallToolResult, McpError> {
        let Some(token) = &self.core.token else {
            return tool_error(
                "General's action tools are off (HERBOT_INTERNAL_TOKEN is not set for herbot-mcp)",
            );
        };
        let response = self
            .core
            .client
            .post(format!("{}{path}", self.core.base_url))
            .bearer_auth(token)
            .json(body)
            .send()
            .await;
        let response = match response {
            Ok(r) => r,
            Err(e) => return tool_error(format!("couldn't reach herbot-core: {e}")),
        };
        let status = response.status();
        let value: serde_json::Value = response.json().await.unwrap_or_default();
        if status.is_success() {
            ok_json(&value)
        } else {
            let error = value["error"].as_str().unwrap_or("request failed");
            tool_error(format!("{error} (HTTP {})", status.as_u16()))
        }
    }
}

pub const INSTRUCTIONS: &str = "Herbot tools for Ashrith's Telegram agents. Always pass `caller` from your \
<herbot-meta> header. General can list, search and read every topic and ask or post to them; a topic can \
search and read only its own history.";

#[tool_handler(router = self.tool_router)]
impl ServerHandler for HerbotTools {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("herbot-mcp", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}
