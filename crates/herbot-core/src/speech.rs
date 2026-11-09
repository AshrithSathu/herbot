//! Spoken replies, per-topic voices, and original persona presets.
use crate::{
    config::OpenAiConfig,
    media::{Activity, OutFile},
    outgoing,
    poller::{ApiError, TelegramApi},
    turns::TurnJob,
};
use sqlx::PgPool;
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

pub const DEFAULT_MODEL: &str = "gpt-4o-mini-tts";
pub const DEFAULT_VOICE: &str = "marin";
pub const AGENTS_MD_SECTION: &str = "## Spoken replies\nHerbot can read your replies aloud with an AI-generated voice. Ashrith controls this with /voice and can read one bot message with /speak. Keep prose natural to hear; use code and links when useful, but explain their meaning in words. Herbot omits code blocks and URLs from speech and reads only the first 3,500 characters of long replies, pointing to the text for the rest. Never claim to have spoken or changed voice settings yourself. /persona offers original purpose presets with matching voices and asks before replacing this topic's purpose.\n";
pub const VOICES: &[(&str, &str)] = &[
    ("alloy", "Balanced"),
    ("ash", "Grounded"),
    ("ballad", "Expressive"),
    ("coral", "Warm"),
    ("echo", "Clear"),
    ("fable", "Storytelling"),
    ("onyx", "Deep"),
    ("nova", "Bright"),
    ("sage", "Calm"),
    ("shimmer", "Gentle"),
    ("verse", "Versatile"),
    ("marin", "Conversational"),
    ("cedar", "Steady"),
];
pub fn valid_voice(voice: &str) -> bool {
    VOICES.iter().any(|(name, _)| *name == voice)
}

#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    #[error("speech is off: set OPENAI_API_KEY")]
    NotConfigured,
    #[error("unknown speech voice")]
    InvalidVoice,
    #[error("nothing speakable in this message")]
    Empty,
    #[error("speech request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("speech API returned HTTP {0}")]
    Api(u16),
    #[error("speech API did not return OGG audio")]
    InvalidAudio,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Telegram(#[from] ApiError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
pub trait Speaker: Send + Sync {
    fn speak_mp3<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, SpeechError>> + Send + 'a>> {
        Box::pin(async { Err(SpeechError::NotConfigured) })
    }
    fn speak<'a>(
        &'a self,
        text: &'a str,
        voice: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, SpeechError>> + Send + 'a>>;
}
pub struct NoSpeaker;
impl Speaker for NoSpeaker {
    fn speak<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, SpeechError>> + Send + 'a>> {
        Box::pin(async { Err(SpeechError::NotConfigured) })
    }
}
pub struct OpenAiSpeaker {
    client: reqwest::Client,
    key: String,
    model: String,
    base_url: String,
}
impl OpenAiSpeaker {
    pub fn new(key: String, model: String) -> Self {
        Self::with_base_url(key, model, "https://api.openai.com/v1".into())
    }
    pub fn with_base_url(key: String, model: String, base_url: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("HTTP client"),
            key,
            model,
            base_url: base_url.trim_end_matches('/').into(),
        }
    }
}
impl OpenAiSpeaker {
    async fn synthesize(
        &self,
        text: &str,
        voice: &str,
        format: &str,
    ) -> Result<Vec<u8>, SpeechError> {
        if !valid_voice(voice) {
            return Err(SpeechError::InvalidVoice);
        }
        let input = speakable(text);
        if input.is_empty() {
            return Err(SpeechError::Empty);
        }
        let response = self.client.post(format!("{}/audio/speech", self.base_url)).bearer_auth(&self.key)
            .json(&serde_json::json!({"model":self.model,"voice":voice,"input":input,"response_format":format})).send().await?;
        if !response.status().is_success() {
            return Err(SpeechError::Api(response.status().as_u16()));
        }
        let bytes = response.bytes().await?.to_vec();
        if bytes.is_empty() || (format == "opus" && !bytes.starts_with(b"OggS")) {
            return Err(SpeechError::InvalidAudio);
        }
        Ok(bytes)
    }
}
impl Speaker for OpenAiSpeaker {
    fn speak_mp3<'a>(
        &'a self,
        text: &'a str,
        voice: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, SpeechError>> + Send + 'a>> {
        Box::pin(self.synthesize(text, voice, "mp3"))
    }
    fn speak<'a>(
        &'a self,
        text: &'a str,
        voice: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, SpeechError>> + Send + 'a>> {
        Box::pin(self.synthesize(text, voice, "opus"))
    }
}
pub fn configured(config: Option<&OpenAiConfig>) -> Arc<dyn Speaker> {
    match config {
        Some(c) => Arc::new(OpenAiSpeaker::new(c.api_key.clone(), c.tts_model.clone())),
        None => Arc::new(NoSpeaker),
    }
}

pub fn speakable(text: &str) -> String {
    let clean = outgoing::scrub(text);
    let mut fenced = false;
    let mut lines = Vec::new();
    for line in clean.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if !fenced && !line.starts_with("    ") && !line.starts_with('\t') {
            lines.push(line);
        }
    }
    let plain = lines.join(" ");
    let links = regex::Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").expect("link regex");
    let plain = links.replace_all(&plain, "$1");
    let urls = regex::Regex::new(r"(?:https?://|www\.)\S+").expect("URL regex");
    let plain = urls.replace_all(&plain, "");
    let plain: String = plain.chars().filter(|c| !"*`#_>|".contains(*c)).collect();
    let plain = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if plain.chars().count() > 3500 {
        format!(
            "{} The rest is in the text reply.",
            plain.chars().take(3500).collect::<String>().trim_end()
        )
    } else {
        plain
    }
}

pub async fn send<A: TelegramApi>(
    api: &A,
    speaker: &dyn Speaker,
    chat: i64,
    topic: Option<i32>,
    reply_to: i32,
    text: &str,
    voice: &str,
) -> Result<(), SpeechError> {
    let synthesis = speaker.speak(text, voice);
    tokio::pin!(synthesis);
    let mut tick = tokio::time::interval(Duration::from_secs(4));
    let bytes = loop {
        tokio::select! {
            result = &mut synthesis => break result?,
            _ = tick.tick() => api.activity(chat, topic, Activity::RecordVoice).await?,
        }
    };
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("reply.ogg");
    tokio::fs::write(&path, bytes).await?;
    let mut file = OutFile::new(path);
    file.caption = Some("AI-generated voice".into());
    api.send_file(chat, topic, Some(reply_to), &file).await?;
    Ok(())
}

pub async fn after_reply<A: TelegramApi>(
    pool: &PgPool,
    api: &A,
    speaker: &dyn Speaker,
    job: &TurnJob,
    text: &str,
) {
    let result = async {
        let (enabled, voice): (bool, String) =
            sqlx::query_as("SELECT voice_replies, voice FROM conversations WHERE id = $1")
                .bind(job.conversation_id)
                .fetch_one(pool)
                .await?;
        if enabled {
            send(
                api,
                speaker,
                job.tg_chat_id,
                job.topic_id,
                job.reply_to,
                text,
                &voice,
            )
            .await?;
        }
        Ok::<_, SpeechError>(())
    }
    .await;
    if let Err(error) = result {
        match crate::errors::record(
            pool,
            "speech.reply",
            &error.to_string(),
            serde_json::json!({"conversation_id": job.conversation_id}),
        )
        .await
        {
            Ok(id) => {
                tracing::error!(error_id = %id, %error, "spoken reply failed after text delivery");
                if let Err(err) = api
                    .send_text(
                        job.tg_chat_id,
                        job.topic_id,
                        Some(job.reply_to),
                        &format!("❌ Failed ({id}): spoken reply failed. Check logs."),
                    )
                    .await
                {
                    tracing::error!(error_id = %id, error = %err, "could not report speech failure");
                }
            }
            Err(err) => tracing::error!(%error, error = %err, "could not record speech failure"),
        }
    }
}

pub async fn set_voice(
    pool: &PgPool,
    id: i64,
    enabled: bool,
    voice: &str,
) -> Result<(), SpeechError> {
    if !valid_voice(voice) {
        return Err(SpeechError::InvalidVoice);
    }
    let result =
        sqlx::query("UPDATE conversations SET voice_replies = $2, voice = $3 WHERE id = $1")
            .bind(id)
            .bind(enabled)
            .bind(voice)
            .execute(pool)
            .await?;
    if result.rows_affected() == 0 {
        return Err(sqlx::Error::RowNotFound.into());
    }
    Ok(())
}
pub fn voice_menu(id: i64, enabled: bool, voice: &str) -> (String, Vec<Vec<(String, String)>>) {
    let mut rows = vec![vec![
        ("On".into(), format!("voice:{id}:on")),
        ("Off".into(), format!("voice:{id}:off")),
    ]];
    rows.extend(VOICES.iter().map(|(name, description)| {
        vec![(
            format!("{name} · {description}"),
            format!("voice:{id}:{name}"),
        )]
    }));
    (
        format!(
            "Spoken replies: {}\nVoice: {voice}\nAI-generated speech. /speak reads one bot message aloud.",
            if enabled { "on" } else { "off" }
        ),
        rows,
    )
}

pub struct Preset {
    pub name: &'static str,
    pub voice: &'static str,
    pub purpose: &'static str,
}
pub const PRESETS: &[Preset] = &[
    Preset {
        name: "Coach",
        voice: "cedar",
        purpose: "Help Ashrith turn intentions into practical action. Ask what matters, identify the smallest useful next step, and offer candid encouragement grounded in evidence. Challenge excuses without shaming, celebrate concrete progress, and adapt plans when circumstances change.",
    },
    Preset {
        name: "Tutor",
        voice: "sage",
        purpose: "Teach Ashrith with patient explanations and worked examples. Find the missing concept, build from what he already understands, and use brief questions to check understanding. Encourage independent reasoning, correct mistakes kindly, and adjust the pace to his curiosity.",
    },
    Preset {
        name: "Storyteller",
        voice: "fable",
        purpose: "Create original stories with Ashrith. Build vivid settings, distinctive characters and satisfying consequences. Follow his preferred genre and tone, preserve continuity, and leave room for his choices. Make scenes concrete and dialogue natural rather than explaining every emotion.",
    },
    Preset {
        name: "Analyst",
        voice: "onyx",
        purpose: "Help Ashrith assess ideas and decisions with clear reasoning. Separate observations, assumptions and unknowns, seek counterexamples, and quantify tradeoffs when the evidence permits. Cite sources for factual claims and give a concise recommendation with its practical limits.",
    },
    Preset {
        name: "Comedian",
        voice: "ballad",
        purpose: "Bring playful, original humor to Ashrith's day. Use sharp observations, surprising comparisons and friendly banter, matching his mood and boundaries. Keep jokes concise, avoid cruelty, and switch to a straightforward helpful answer whenever the situation calls for it.",
    },
    Preset {
        name: "Companion",
        voice: "coral",
        purpose: "Be a warm, curious conversational companion for Ashrith. Listen closely, ask thoughtful questions and explore everyday experiences with gentle humor. Be honest about being an AI, respect his independence and real relationships, and offer practical support without pretending to know his feelings.",
    },
    Preset {
        name: "Editor",
        voice: "marin",
        purpose: "Help Ashrith write clearly in his own voice. Identify the audience and purpose, sharpen structure, remove vague or repetitive language and preserve intended meaning. Explain consequential edits briefly, offer concrete alternatives and flag claims that need evidence.",
    },
    Preset {
        name: "Chef",
        voice: "nova",
        purpose: "Help Ashrith cook enjoyable meals with ingredients, equipment and time he actually has. Offer clear quantities and ordered steps, explain useful techniques and suggest sensible substitutions. Ask about dietary needs when relevant and ground food safety advice in reliable guidance.",
    },
];

pub async fn command<A: TelegramApi, T: crate::voice::Transcriber>(
    ctx: &crate::poller::Ctx<'_, A, T>,
    msg: &crate::telegram::InboundMessage,
    cmd: &crate::telegram::Command,
) -> Result<(), crate::poller::HandleError> {
    use crate::{store, telegram::Command};
    let status = store::conversation_status(ctx.pool, &msg.chat, msg.topic_id).await?;
    let id = status.conversation_id;
    match cmd {
        Command::Voice(arg) => {
            let (enabled, voice) = match arg.as_str() {
                "" => (status.voice_replies, status.voice.as_str()),
                "on" => (true, status.voice.as_str()),
                "off" => (false, status.voice.as_str()),
                name if valid_voice(name) => (status.voice_replies, name),
                _ => {
                    ctx.api
                        .send_text(
                            status.tg_chat_id,
                            msg.topic_id,
                            Some(msg.message_id),
                            "Use /voice on, /voice off, or pick a voice with /voice.",
                        )
                        .await?;
                    return Ok(());
                }
            };
            set_voice(ctx.pool, id, enabled, voice).await?;
            let (text, rows) = voice_menu(id, enabled, voice);
            ctx.api
                .send_buttons(
                    status.tg_chat_id,
                    msg.topic_id,
                    Some(msg.message_id),
                    &text,
                    &rows,
                )
                .await?;
        }
        Command::Speak => {
            if let Some(text) = &msg.replied_bot_text {
                send(
                    ctx.api,
                    ctx.speaker,
                    status.tg_chat_id,
                    msg.topic_id,
                    msg.message_id,
                    text,
                    &status.voice,
                )
                .await?;
            } else {
                ctx.api
                    .send_text(
                        status.tg_chat_id,
                        msg.topic_id,
                        Some(msg.message_id),
                        "Reply to one of my text messages with /speak to read it aloud once.",
                    )
                    .await?;
            }
        }
        Command::Persona => {
            let rows = PRESETS
                .iter()
                .enumerate()
                .map(|(i, p)| vec![(p.name.into(), format!("persona:{id}:pick:{i}"))])
                .collect::<Vec<_>>();
            ctx.api.send_buttons(status.tg_chat_id, msg.topic_id, Some(msg.message_id), "Choose an original persona. You’ll confirm before its purpose replaces this topic’s purpose.", &rows).await?;
        }
        _ => unreachable!("speech commands only"),
    }
    Ok(())
}

pub async fn button<A: TelegramApi, T: crate::voice::Transcriber>(
    ctx: &crate::poller::Ctx<'_, A, T>,
    press: &crate::telegram::ButtonPress,
) -> Result<(), crate::poller::HandleError> {
    use crate::{agents_md, store};
    let Some(id) =
        store::find_conversation(ctx.pool, press.chat.tg_chat_id, press.topic_id).await?
    else {
        ctx.api
            .answer_button(&press.callback_id, Some("This topic no longer exists."))
            .await?;
        return Ok(());
    };
    let status = store::conversation_status_by_id(ctx.pool, id).await?;
    let parts = press.data.split(':').collect::<Vec<_>>();
    if parts.get(1).and_then(|v| v.parse::<i64>().ok()) != Some(status.conversation_id) {
        ctx.api
            .answer_button(
                &press.callback_id,
                Some("That button belongs to another topic."),
            )
            .await?;
        return Ok(());
    }
    // Acknowledge before disk or network work to stop Telegram's spinner.
    ctx.api.answer_button(&press.callback_id, None).await?;
    if parts.first() == Some(&"voice") && parts.len() == 3 {
        let arg = parts[2];
        let enabled = match arg {
            "on" => true,
            "off" => false,
            _ => status.voice_replies,
        };
        let voice = if valid_voice(arg) { arg } else { &status.voice };
        if !valid_voice(arg) && arg != "on" && arg != "off" {
            return Ok(());
        }
        set_voice(ctx.pool, status.conversation_id, enabled, voice).await?;
        let (text, rows) = voice_menu(status.conversation_id, enabled, voice);
        ctx.api
            .edit_buttons(status.tg_chat_id, press.message_id, &text, &rows)
            .await?;
    } else if parts.first() == Some(&"persona") && parts.len() >= 3 {
        match parts[2] {
            "pick" if parts.len() == 4 => {
                let Some(preset) = parts[3].parse::<usize>().ok().and_then(|i| PRESETS.get(i))
                else {
                    return Ok(());
                };
                let rows = vec![vec![
                    (
                        "Replace purpose".into(),
                        format!("persona:{}:confirm", status.conversation_id),
                    ),
                    (
                        "Cancel".into(),
                        format!("persona:{}:cancel", status.conversation_id),
                    ),
                ]];
                let prompt = format!(
                    "Replace this topic's purpose with {}?\n\n{}\n\nVoice: {}. Spoken replies stay {}.",
                    preset.name,
                    preset.purpose,
                    preset.voice,
                    if status.voice_replies { "on" } else { "off" }
                );
                ctx.api
                    .edit_buttons(status.tg_chat_id, press.message_id, &prompt, &rows)
                    .await?;
                sqlx::query("INSERT INTO persona_confirmations (conversation_id, tg_message_id, preset) VALUES ($1,$2,$3) ON CONFLICT (conversation_id) DO UPDATE SET tg_message_id = $2, preset = $3, issued_at = now()")
                    .bind(status.conversation_id).bind(press.message_id).bind(preset.name).execute(ctx.pool).await?;
            }
            "confirm" | "cancel" if parts.len() == 3 => {
                let name: Option<String> = sqlx::query_scalar("DELETE FROM persona_confirmations WHERE conversation_id = $1 AND tg_message_id = $2 AND issued_at > now() - interval '10 minutes' RETURNING preset")
                    .bind(status.conversation_id).bind(press.message_id).fetch_optional(ctx.pool).await?;
                let Some(preset) = name
                    .as_deref()
                    .and_then(|name| PRESETS.iter().find(|p| p.name == name))
                else {
                    ctx.api
                        .edit_text(
                            status.tg_chat_id,
                            press.message_id,
                            "This confirmation expired or was already handled. Use /persona again.",
                        )
                        .await?;
                    ctx.api
                        .remove_buttons(status.tg_chat_id, press.message_id)
                        .await?;
                    return Ok(());
                };
                if parts[2] == "cancel" {
                    ctx.api
                        .edit_text(
                            status.tg_chat_id,
                            press.message_id,
                            "Persona change cancelled.",
                        )
                        .await?;
                } else {
                    let path = agents_md::write(
                        ctx.agents_dir,
                        status.tg_chat_id,
                        status.tg_topic_id,
                        &status.place(),
                        preset.purpose,
                        chrono::Utc::now(),
                    )
                    .await?;
                    let old = store::set_purpose(
                        ctx.pool,
                        status.conversation_id,
                        preset.purpose,
                        &path.to_string_lossy(),
                    )
                    .await?;
                    set_voice(
                        ctx.pool,
                        status.conversation_id,
                        status.voice_replies,
                        preset.voice,
                    )
                    .await?;
                    if let Some(old) = old {
                        ctx.api.remove_buttons(status.tg_chat_id, old).await?;
                    }
                    ctx.api
                        .edit_text(
                            status.tg_chat_id,
                            press.message_id,
                            &format!("{} purpose applied. Voice: {}.", preset.name, preset.voice),
                        )
                        .await?;
                }
                ctx.api
                    .remove_buttons(status.tg_chat_id, press.message_id)
                    .await?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn speech_request_uses_opus_and_reports_api_failures() {
        use super::{OpenAiSpeaker, Speaker, SpeechError};
        use axum::{
            Json, Router,
            http::{HeaderMap, StatusCode},
            routing::post,
        };
        let app = Router::new().route(
            "/audio/speech",
            post(
                |headers: HeaderMap, Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(headers["authorization"], "Bearer test-key");
                    assert_eq!(body["model"], "test-model");
                    assert_eq!(body["voice"], "marin");
                    assert!(body["response_format"] == "opus" || body["response_format"] == "mp3");
                    assert_eq!(body["input"], "Hello world");
                    (StatusCode::TOO_MANY_REQUESTS, "quota")
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        let client = OpenAiSpeaker::with_base_url("test-key".into(), "test-model".into(), url);
        assert!(matches!(
            client.speak("**Hello** world", "marin").await,
            Err(SpeechError::Api(429))
        ));
        assert!(matches!(
            client.speak("hello", "invalid").await,
            Err(SpeechError::InvalidVoice)
        ));
        assert!(matches!(
            client.speak_mp3("Hello world", "marin").await,
            Err(SpeechError::Api(429))
        ));
        server.abort();
    }

    #[test]
    fn voice_callbacks_fit_telegram_and_presets_are_valid() {
        let (_, rows) = super::voice_menu(i64::MAX, true, super::DEFAULT_VOICE);
        assert_eq!(rows.len(), super::VOICES.len() + 1);
        for row in rows {
            for (_, data) in row {
                assert!(data.len() <= 64);
            }
        }
        for preset in super::PRESETS {
            assert!(super::valid_voice(preset.voice));
            assert!(crate::setup::validate_purpose(preset.purpose).is_ok());
        }
    }

    #[test]
    fn speech_text_omits_code_links_and_bounds_unicode() {
        assert_eq!(
            super::speakable(
                "**Hello** [world](https://example.com)\n```rust\nsecret code\n```\nhttps://example.com"
            ),
            "Hello world"
        );
        let text = super::speakable(&"é".repeat(4000));
        assert!(text.chars().count() < 3600 && text.ends_with("The rest is in the text reply."));
    }
}
