//! Real-time X (Twitter) search for agents (Grok's X search), through X's
//! official API v2 recent search. Needs `X_BEARER_TOKEN` (a paid X API tier);
//! without it agents fall back to live web search of x.com.

use std::time::Duration;

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum XError {
    #[error("X search needs X_BEARER_TOKEN (an X API v2 bearer token) in herbot-mcp's environment")]
    NotConfigured,
    #[error("X API request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("X API returned {status}: {body}")]
    Api { status: u16, body: String },
}

/// One post, with what an agent needs to cite it.
#[derive(Debug, Clone, Serialize)]
pub struct Post {
    pub id: String,
    pub url: String,
    pub author: String,
    pub name: String,
    pub created_at: Option<String>,
    pub text: String,
    pub likes: u64,
    pub reposts: u64,
    pub replies: u64,
}

/// Posts from the last seven days matching `query` (X search syntax, e.g.
/// `rust lang -is:retweet lang:en`), newest or most relevant first.
pub async fn search_recent(query: &str, limit: u32, relevant: bool) -> Result<Vec<Post>, XError> {
    let token = std::env::var("X_BEARER_TOKEN")
        .ok()
        .filter(|t| !t.trim().is_empty())
        .ok_or(XError::NotConfigured)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let limit = limit.clamp(10, 100).to_string();
    let response = client
        .get("https://api.x.com/2/tweets/search/recent")
        .bearer_auth(token)
        .query(&[
            ("query", query),
            ("max_results", limit.as_str()),
            ("sort_order", if relevant { "relevancy" } else { "recency" }),
            ("tweet.fields", "created_at,public_metrics,author_id"),
            ("expansions", "author_id"),
            ("user.fields", "username,name"),
        ])
        .send()
        .await?;
    let status = response.status();
    let body: serde_json::Value = response.json().await?;
    if !status.is_success() {
        return Err(XError::Api {
            status: status.as_u16(),
            body: crate::outgoing::scrub(&body.to_string())
                .chars()
                .take(300)
                .collect(),
        });
    }
    let users = body["includes"]["users"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let posts = body["data"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|t| {
            let author_id = t["author_id"].as_str().unwrap_or_default();
            let user = users.iter().find(|u| u["id"].as_str() == Some(author_id));
            let author = user
                .and_then(|u| u["username"].as_str())
                .unwrap_or("i")
                .to_string();
            let id = t["id"].as_str().unwrap_or_default().to_string();
            let metric = |k: &str| t["public_metrics"][k].as_u64().unwrap_or(0);
            Post {
                url: format!("https://x.com/{author}/status/{id}"),
                name: user
                    .and_then(|u| u["name"].as_str())
                    .unwrap_or_default()
                    .to_string(),
                created_at: t["created_at"].as_str().map(str::to_string),
                text: t["text"].as_str().unwrap_or_default().to_string(),
                likes: metric("like_count"),
                reposts: metric("retweet_count"),
                replies: metric("reply_count"),
                id,
                author,
            }
        })
        .collect();
    Ok(posts)
}
