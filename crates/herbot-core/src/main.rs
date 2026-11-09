use std::time::Duration;

use anyhow::Context;
use std::sync::Arc;

use herbot_core::{
    admin, agent, agents_md, app, config::Config, db, internal, policy, poller, telemetry, turns,
    voice,
};
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
    let mut internal_router: Option<axum::Router> = None;
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
            let rules = policy::Rules {
                admin_user_id: tg.admin_user_id,
                home_chat_id: tg.home_chat_id,
            };
            poller::register_commands(&bot, &rules)
                .await
                .context("could not register the Telegram command menu")?;
            tracing::info!(
                bot = %username,
                admin = tg.admin_user_id,
                home_chat = ?tg.home_chat_id,
                "telegram connected"
            );
            let transcriber = match &config.openai {
                Some(openai) => {
                    tracing::info!(model = %openai.transcribe_model, "voice notes on (OpenAI, English)");
                    voice::AnyTranscriber::OpenAi(voice::OpenAiTranscriber::new(
                        openai.api_key.clone(),
                        openai.transcribe_model.clone(),
                    ))
                }
                None => {
                    tracing::warn!("OPENAI_API_KEY not set; voice notes will fail with an error");
                    voice::AnyTranscriber::Off(voice::NoTranscriber)
                }
            };
            let agents_dir = absolute_agents_dir(&config.agents_dir)?;
            check_t3_cli(&config.t3_bin).await?;
            let refreshed = agents_md::refresh_outdated(&pool, &agents_dir)
                .await
                .context("could not update older AGENTS.md files")?;
            if refreshed > 0 {
                tracing::info!(
                    refreshed,
                    "rewrote AGENTS.md files with the current ground rules"
                );
            }
            warn_if_codex_effort_differs(&config.agent_effort);
            herbot_core::modes::write_shared_config(&agents_dir)
                .await
                .context("could not write the agents' shared Codex settings")?;
            let runner = agent::T3Cli {
                bin: config.t3_bin.clone(),
                provider: "codex".to_string(),
                model: config.agent_model.clone(),
                timeout: Duration::from_secs(config.turn_timeout_secs),
            };
            tracing::info!(
                model = %config.agent_model,
                effort = %config.agent_effort,
                agents_dir = %agents_dir.display(),
                "agents run as T3 Code threads"
            );
            let projects: Arc<dyn agent::ProjectCleaner> = Arc::new(runner.clone());
            let api = Arc::new(poller::BotApi(bot.clone()));
            let lanes = Arc::new(turns::Lanes::new(turns::TurnDeps {
                pool: pool.clone(),
                api: api.clone(),
                runner: Arc::new(runner),
                agents_dir: agents_dir.clone(),
                bot_user_id: me.id.0,
                auto_effort: config.agent_effort.clone(),
            }));
            let shared_turns: Arc<dyn turns::TurnQueue> = lanes;
            match &config.internal_token {
                Some(token) => {
                    internal_router = Some(internal::router(Arc::new(internal::InternalState {
                        pool: pool.clone(),
                        api: api.clone(),
                        turns: shared_turns.clone(),
                        token: token.clone(),
                        bot_user_id: me.id.0,
                        admin_user_id: tg.admin_user_id,
                        ask_timeout: Duration::from_secs(config.turn_timeout_secs + 30),
                    })));
                    tracing::info!("internal API on (herbot-mcp actions)");
                }
                None => tracing::warn!(
                    "HERBOT_INTERNAL_TOKEN not set; General can't post to or ask topics"
                ),
            }
            let settings = poller::RunSettings {
                rules,
                bot_username: username.clone(),
                transcriber,
                agents_dir,
                agent_label: format!("{} · {}", config.agent_model, config.agent_effort),
                api,
                turns: shared_turns,
                projects,
            };
            poller_task = Some(tokio::spawn(poller::run(
                bot,
                pool.clone(),
                settings,
                shutdown_rx.clone(),
            )));
            telegram_username = Some(username);
        }
    }

    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("could not bind {}", config.bind))?;
    tracing::info!(addr = %config.bind, "herbot-core listening");

    // The admin panel's API works with or without Telegram.
    let admin_router = match &config.admin_token {
        Some(token) => {
            let state = admin::AdminState {
                pool: pool.clone(),
                projects: Arc::new(agent::T3Cli {
                    bin: config.t3_bin.clone(),
                    provider: "codex".to_string(),
                    model: config.agent_model.clone(),
                    timeout: Duration::from_secs(config.turn_timeout_secs),
                }),
                agents_dir: absolute_agents_dir(&config.agents_dir)?,
                token: token.clone(),
                agent_label: format!("{} · {}", config.agent_model, config.agent_effort),
                bot_username: telegram_username.clone(),
            };
            tracing::info!("admin API on");
            Some(admin::router(Arc::new(state)))
        }
        None => {
            tracing::warn!("HERBOT_ADMIN_TOKEN not set; the admin panel can't connect");
            None
        }
    };

    let state = app::AppState {
        pool,
        telegram_username,
    };
    let mut router = app::router(state);
    if let Some(internal) = internal_router {
        router = router.merge(internal);
    }
    if let Some(admin) = admin_router {
        router = router.merge(admin);
    }
    axum::serve(listener, router)
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

/// The agents folder as an absolute path (T3 needs one), created if missing.
fn absolute_agents_dir(dir: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir)
        .with_context(|| format!("could not create agents folder {}", dir.display()))?;
    dir.canonicalize()
        .with_context(|| format!("could not resolve agents folder {}", dir.display()))
}

/// Fails startup if the T3 CLI can't run or lacks `thread` (needs a 2026 nightly).
async fn check_t3_cli(bin: &std::path::Path) -> anyhow::Result<()> {
    let out = tokio::process::Command::new(bin)
        .args(["thread", "--help"])
        .output()
        .await
        .with_context(|| {
            format!(
                "could not run the T3 CLI at {} (set HERBOT_T3_BIN)",
                bin.display()
            )
        })?;
    let help = String::from_utf8_lossy(&out.stdout);
    anyhow::ensure!(
        help.contains("start") && help.contains("send"),
        "{} has no `thread start/send`; update T3 Code or point HERBOT_T3_BIN at ~/.t3/bin/t3",
        bin.display()
    );
    Ok(())
}

/// T3 doesn't pass a reasoning effort, so Codex uses its own config. Warn
/// loudly if that isn't the effort Herbot is configured for.
fn warn_if_codex_effort_differs(wanted: &str) {
    let codex_home = std::env::var("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join(".codex")));
    let Ok(codex_home) = codex_home else { return };
    let path = codex_home.join("config.toml");
    let effort = std::fs::read_to_string(&path)
        .ok()
        .and_then(|toml| agent::codex_config_effort(&toml));
    match effort {
        Some(effort) if effort == wanted => {
            tracing::info!(%effort, "Codex reasoning effort matches")
        }
        other => tracing::warn!(
            wanted,
            found = ?other,
            config = %path.display(),
            "Codex model_reasoning_effort differs from HERBOT_AGENT_EFFORT; agent turns will use Codex's setting"
        ),
    }
}
