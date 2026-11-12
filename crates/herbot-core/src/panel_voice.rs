//! Authenticated browser speech, independent of Telegram connectivity.
use crate::{
    admin::{self, AdminState},
    config::OpenAiConfig,
    speech, voice,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
struct VoiceState {
    admin: Arc<AdminState>,
    transcriber: Option<voice::OpenAiTranscriber>,
    speaker: Arc<dyn speech::Speaker>,
    /// Speech is configured (OPENAI_API_KEY); off, every speak call fails.
    available: bool,
}
pub fn router(admin: Arc<AdminState>, config: Option<&OpenAiConfig>) -> Router {
    let state = Arc::new(VoiceState {
        admin,
        transcriber: config
            .map(|c| voice::OpenAiTranscriber::new(c.api_key.clone(), c.transcribe_model.clone())),
        speaker: speech::configured(config),
        available: config.is_some(),
    });
    Router::new()
        .route("/admin/api/voice/transcribe", post(transcribe))
        .route("/admin/api/voice/speak", post(speak))
        .route("/admin/api/voice/status", axum::routing::get(status))
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .with_state(state)
}
/// Whether the panel can hear and speak (needs OPENAI_API_KEY), so
/// Companions can say so up front instead of after a failed request.
async fn status(State(s): State<Arc<VoiceState>>, h: HeaderMap) -> Response {
    if !admin::authorized(&h, &s.admin.token) {
        return fail(StatusCode::UNAUTHORIZED, "bad admin token");
    }
    Json(json!({ "transcribe": s.transcriber.is_some(), "speak": s.available })).into_response()
}

fn fail(code: StatusCode, message: &str) -> Response {
    (code, Json(json!({"error":message}))).into_response()
}
async fn failure(s: &VoiceState, reason: impl std::fmt::Display) -> Response {
    let reason = crate::outgoing::scrub(&reason.to_string());
    match crate::errors::record(&s.admin.pool, "panel.voice", &reason, json!({})).await {
        Ok(id) => {
            tracing::error!(error_id=%id,error=%reason,"browser speech failed");
            fail(StatusCode::BAD_GATEWAY, &format!("{id}: {reason}"))
        }
        Err(e) => {
            tracing::error!(error=%e,"could not record browser speech failure");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Speech failed; could not record error. Check logs",
            )
        }
    }
}
async fn transcribe(
    State(s): State<Arc<VoiceState>>,
    h: HeaderMap,
    mut form: Multipart,
) -> Response {
    if !admin::authorized(&h, &s.admin.token) {
        return fail(StatusCode::UNAUTHORIZED, "bad admin token");
    }
    let Some(t) = &s.transcriber else {
        return failure(&s, "Transcription is off: set OPENAI_API_KEY").await;
    };
    let field = match form.next_field().await {
        Ok(Some(f)) => f,
        _ => return fail(StatusCode::BAD_REQUEST, "Upload one audio file"),
    };
    let mime = field
        .content_type()
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_owned();
    let filename = match mime.as_str() {
        "audio/webm" => "recording.webm",
        "audio/mp4" | "audio/m4a" => "recording.mp4",
        "audio/ogg" => "recording.ogg",
        "audio/mpeg" => "recording.mp3",
        "audio/wav" => "recording.wav",
        _ => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Use WebM, MP4, Ogg, MP3 or WAV audio",
            );
        }
    };
    let bytes = match field.bytes().await {
        Ok(b) if !b.is_empty() => b,
        _ => return fail(StatusCode::BAD_REQUEST, "Empty or invalid recording"),
    };
    match t
        .transcribe_file(bytes.to_vec(), filename, &mime, Some("en"))
        .await
    {
        Ok(text) => Json(json!({"text":text})).into_response(),
        Err(e) => failure(&s, e).await,
    }
}
#[derive(Deserialize)]
struct Speech {
    text: String,
    voice: String,
}
async fn speak(State(s): State<Arc<VoiceState>>, h: HeaderMap, Json(b): Json<Speech>) -> Response {
    if !admin::authorized(&h, &s.admin.token) {
        return fail(StatusCode::UNAUTHORIZED, "bad admin token");
    }
    if b.text.chars().count() > 20000 || !speech::valid_voice(&b.voice) {
        return fail(
            StatusCode::BAD_REQUEST,
            "Choose a supported voice and text under 20,000 characters",
        );
    }
    match s.speaker.speak_mp3(&b.text, &b.voice).await {
        Ok(bytes) => (
            [
                ("content-type", "audio/mpeg"),
                ("cache-control", "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => failure(&s, e).await,
    }
}
