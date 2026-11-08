use anyhow::Context;
use herbot_mcp::{CoreApi, HerbotTools};
use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // stdout is the MCP protocol; logs go to stderr.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,herbot_mcp=debug".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is not set")?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await
        .context("could not connect to Postgres")?;
    let core = CoreApi {
        base_url: std::env::var("HERBOT_CORE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".into())
            .trim_end_matches('/')
            .to_string(),
        token: std::env::var("HERBOT_INTERNAL_TOKEN")
            .ok()
            .filter(|t| !t.trim().is_empty()),
        client: reqwest::Client::builder()
            // ask_topic waits for another agent; herbot-core enforces the real limit.
            .timeout(std::time::Duration::from_secs(3700))
            .build()?,
    };

    tracing::info!("herbot-mcp ready on stdio");
    let server = HerbotTools::new(pool, core)
        .serve(rmcp::transport::stdio())
        .await
        .context("MCP handshake failed")?;
    server.waiting().await?;
    Ok(())
}
