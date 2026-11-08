use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use crate::db;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// The bot's Telegram username once `getMe` succeeded; `None` when
    /// Telegram is disabled (no token configured).
    pub telegram_username: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

/// Process is up. Never touches dependencies.
async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "herbot-core",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// Process can do real work: Postgres answers. Also reports Telegram status.
async fn ready(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let telegram = state
        .telegram_username
        .as_deref()
        .map(|name| format!("@{name}"))
        .unwrap_or_else(|| "disabled".to_string());

    match db::ping(&state.pool).await {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "status": "ready", "db": "ok", "telegram": telegram })),
        ),
        Err(err) => {
            tracing::warn!(error = %err, "readiness check failed: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "not_ready", "db": "unreachable", "telegram": telegram })),
            )
        }
    }
}
