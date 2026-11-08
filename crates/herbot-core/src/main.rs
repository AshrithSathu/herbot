use std::time::Duration;

use anyhow::Context;
use herbot_core::{app, config::Config, db, poller, telemetry};
use teloxide::prelude::*;
use tokio::sync::watch;

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

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Telegram is optional for local work, but when a token is set it must
    // work: a bad token stops startup instead of running half-broken.
    let mut telegram_username = None;
    let mut poller_task = None;
    match &config.telegram {
        None => tracing::warn!("TELEGRAM_BOT_TOKEN not set; Telegram is disabled"),
        Some(tg) => {
            let bot = Bot::new(tg.token.clone());
            let me = bot
                .get_me()
                .await
                .context("Telegram getMe failed (is TELEGRAM_BOT_TOKEN correct?)")?;
            let username = me.username().to_string();
            poller::register_commands(&bot)
                .await
                .context("could not register the Telegram command menu")?;
            tracing::info!(bot = %username, admin = tg.admin_user_id, "telegram connected");
            poller_task = Some(tokio::spawn(poller::run(
                bot,
                pool.clone(),
                tg.admin_user_id,
                username.clone(),
                shutdown_rx.clone(),
            )));
            telegram_username = Some(username);
        }
    }

    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("could not bind {}", config.bind))?;
    tracing::info!(addr = %config.bind, "herbot-core listening");

    let state = app::AppState {
        pool,
        telegram_username,
    };
    axum::serve(listener, app::router(state))
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            let _ = shutdown_tx.send(true);
        })
        .await
        .context("server error")?;

    if let Some(task) = poller_task
        && tokio::time::timeout(Duration::from_secs(15), task)
            .await
            .is_err()
    {
        tracing::warn!("telegram poller did not stop within 15s");
    }

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
