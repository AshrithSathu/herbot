//! Direct speech API probe. Never starts a Telegram poller.
use herbot_core::speech::{DEFAULT_MODEL, DEFAULT_VOICE, OpenAiSpeaker, Speaker};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = std::env::var("OPENAI_API_KEY")?;
    let model = std::env::var("HERBOT_TTS_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into());
    let path = std::env::args()
        .nth(1)
        .ok_or("provide an output OGG path")?;
    let bytes = OpenAiSpeaker::new(key, model)
        .speak(
            "Hello Ashrith. Herbot can now read replies aloud. This is an AI-generated voice.",
            DEFAULT_VOICE,
        )
        .await?;
    tokio::fs::write(path, bytes).await?;
    Ok(())
}
