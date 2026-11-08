//! Voice notes become English text through OpenAI's transcription API.
//!
//! Codex (on the subscription) cannot take audio, so this is the one place
//! Herbot calls OpenAI's API directly. English only, by design.

use std::future::Future;
use std::time::Duration;

/// Telegram voice notes are Opus in an Ogg container.
pub const VOICE_FILENAME: &str = "voice.ogg";
pub const VOICE_MIME: &str = "audio/ogg";
/// OpenAI's upload limit for transcription.
pub const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
pub const DEFAULT_MODEL: &str = "gpt-transcribe";
/// Longest voice note Herbot transcribes. At $0.0045/min (gpt-transcribe)
/// that's under 5 cents a note, so a stray long recording can't cost much.
pub const MAX_VOICE_SECONDS: u32 = 600;
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum VoiceError {
    #[error("voice notes are off: set OPENAI_API_KEY to turn on transcription")]
    NotConfigured,
    #[error("voice note is {0} bytes; the transcription limit is 25 MB")]
    TooLarge(usize),
    #[error("transcription request failed: {0}")]
    Request(String),
    #[error("transcription API returned {status}: {body}")]
    Api { status: u16, body: String },
}

/// Turns audio into English text.
pub trait Transcriber: Sync {
    fn transcribe(&self, audio: Vec<u8>)
    -> impl Future<Output = Result<String, VoiceError>> + Send;
}

/// Used when no API key is configured: every voice note fails loudly.
pub struct NoTranscriber;

impl Transcriber for NoTranscriber {
    async fn transcribe(&self, _audio: Vec<u8>) -> Result<String, VoiceError> {
        Err(VoiceError::NotConfigured)
    }
}

/// OpenAI `/audio/transcriptions`, English, plain-text response.
pub struct OpenAiTranscriber {
    client: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
}

impl OpenAiTranscriber {
    pub fn new(api_key: String, model: String) -> Self {
        Self::with_base_url(api_key, model, DEFAULT_BASE_URL.to_string())
    }

    /// `base_url` is overridable so tests can point at a local server.
    pub fn with_base_url(api_key: String, model: String, base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("reqwest client with a timeout always builds");
        Self {
            client,
            api_key,
            model,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }
}

impl Transcriber for OpenAiTranscriber {
    async fn transcribe(&self, audio: Vec<u8>) -> Result<String, VoiceError> {
        if audio.len() > MAX_AUDIO_BYTES {
            return Err(VoiceError::TooLarge(audio.len()));
        }
        let file = reqwest::multipart::Part::bytes(audio)
            .file_name(VOICE_FILENAME)
            .mime_str(VOICE_MIME)
            .map_err(|e| VoiceError::Request(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .part("file", file)
            .text("model", self.model.clone())
            .text("language", "en")
            .text("response_format", "text");

        let response = self
            .client
            .post(format!("{}/audio/transcriptions", self.base_url))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| VoiceError::Request(e.to_string()))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| VoiceError::Request(e.to_string()))?;
        if !status.is_success() {
            // Keep the error short; OpenAI error bodies are JSON with a message.
            let body: String = body.chars().take(300).collect();
            return Err(VoiceError::Api {
                status: status.as_u16(),
                body,
            });
        }
        Ok(body.trim().to_string())
    }
}

/// Whichever transcriber the config chose, as one concrete type.
pub enum AnyTranscriber {
    OpenAi(OpenAiTranscriber),
    Off(NoTranscriber),
}

impl Transcriber for AnyTranscriber {
    async fn transcribe(&self, audio: Vec<u8>) -> Result<String, VoiceError> {
        match self {
            AnyTranscriber::OpenAi(t) => t.transcribe(audio).await,
            AnyTranscriber::Off(t) => t.transcribe(audio).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use axum::Router;
    use axum::body::Bytes;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;

    #[derive(Default)]
    struct Seen {
        auth: Option<String>,
        body: Vec<u8>,
    }

    /// A fake OpenAI that records the request and answers with `status`/`reply`.
    async fn fake_openai(status: StatusCode, reply: &'static str) -> (String, Arc<Mutex<Seen>>) {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let recorder = seen.clone();
        let app = Router::new().route(
            "/v1/audio/transcriptions",
            post(move |headers: HeaderMap, body: Bytes| {
                let recorder = recorder.clone();
                async move {
                    let mut s = recorder.lock().unwrap();
                    s.auth = headers
                        .get("authorization")
                        .map(|v| v.to_str().unwrap().to_string());
                    s.body = body.to_vec();
                    (status, reply)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}/v1"), seen)
    }

    #[tokio::test]
    async fn sends_english_gpt_transcribe_request_and_returns_text() {
        let (base, seen) = fake_openai(StatusCode::OK, "  Make this my research agent.\n").await;
        let t = OpenAiTranscriber::with_base_url("sk-test".into(), DEFAULT_MODEL.into(), base);
        let text = t.transcribe(b"OggS-fake-audio".to_vec()).await.unwrap();
        assert_eq!(text, "Make this my research agent.");

        let seen = seen.lock().unwrap();
        assert_eq!(seen.auth.as_deref(), Some("Bearer sk-test"));
        let body = String::from_utf8_lossy(&seen.body);
        for expected in [
            "name=\"model\"\r\n\r\ngpt-transcribe\r\n",
            "name=\"language\"\r\n\r\nen\r\n",
            "name=\"response_format\"\r\n\r\ntext\r\n",
            "filename=\"voice.ogg\"",
            "Content-Type: audio/ogg",
            "OggS-fake-audio",
        ] {
            assert!(body.contains(expected), "missing {expected:?} in request");
        }
    }

    #[tokio::test]
    async fn api_errors_are_reported_with_status() {
        let (base, _) = fake_openai(StatusCode::UNAUTHORIZED, "{\"error\":\"bad key\"}").await;
        let t = OpenAiTranscriber::with_base_url("sk-bad".into(), DEFAULT_MODEL.into(), base);
        let err = t.transcribe(b"x".to_vec()).await.unwrap_err();
        assert!(
            matches!(err, VoiceError::Api { status: 401, .. }),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn oversized_audio_is_rejected_before_any_request() {
        let t = OpenAiTranscriber::with_base_url(
            "sk".into(),
            DEFAULT_MODEL.into(),
            "http://127.0.0.1:1/v1".into(),
        );
        let err = t
            .transcribe(vec![0; MAX_AUDIO_BYTES + 1])
            .await
            .unwrap_err();
        assert_eq!(err, VoiceError::TooLarge(MAX_AUDIO_BYTES + 1));
    }

    #[tokio::test]
    async fn without_a_key_voice_fails_loudly() {
        assert_eq!(
            NoTranscriber.transcribe(vec![1]).await.unwrap_err(),
            VoiceError::NotConfigured
        );
    }

    /// Real OpenAI call with real speech (macOS `say` + ffmpeg). Costs a
    /// fraction of a cent. Run with `make test-voice`.
    #[tokio::test]
    #[ignore = "calls the real OpenAI API; run with make test-voice"]
    async fn real_openai_transcribes_spoken_english() {
        let key = std::env::var("OPENAI_API_KEY").expect("OPENAI_API_KEY must be set");
        let dir = tempfile::tempdir().unwrap();
        let aiff = dir.path().join("speech.aiff");
        let ogg = dir.path().join("speech.ogg");
        let said = std::process::Command::new("say")
            .args([
                "-o",
                aiff.to_str().unwrap(),
                "Herbot, this topic is for planning my trip to Japan.",
            ])
            .status()
            .expect("macOS say");
        assert!(said.success());
        // Same format Telegram uses for voice notes: Opus in Ogg.
        let converted = std::process::Command::new("ffmpeg")
            .args([
                "-loglevel",
                "error",
                "-y",
                "-i",
                aiff.to_str().unwrap(),
                "-c:a",
                "libopus",
                ogg.to_str().unwrap(),
            ])
            .status()
            .expect("ffmpeg");
        assert!(converted.success());

        let t = OpenAiTranscriber::new(key, DEFAULT_MODEL.into());
        let text = t
            .transcribe(std::fs::read(&ogg).unwrap())
            .await
            .unwrap()
            .to_lowercase();
        assert!(
            text.contains("japan") && text.contains("trip"),
            "heard: {text}"
        );
    }
}
