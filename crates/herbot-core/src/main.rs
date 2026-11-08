use anyhow::Context;
use herbot_core::{app, config::Config, db, telemetry};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env().context("invalid configuration")?;
    telemetry::init(config.log_format);

    let pool = db::connect(&config.database_url)
        .await
        .context("could not connect to Postgres (is `make db-up` running?)")?;
    db::migrate(&pool)
        .await
        .context("database migration failed")?;
    tracing::info!("database ready, migrations applied");

    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("could not bind {}", config.bind))?;
    tracing::info!(addr = %config.bind, "herbot-core listening");

    axum::serve(listener, app::router(app::AppState { pool }))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;

    tracing::info!("herbot-core stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
