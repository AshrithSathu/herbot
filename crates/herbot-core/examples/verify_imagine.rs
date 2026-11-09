//! Opt-in paid API/media verification; never starts Telegram or reads its token.
//! OPENAI_API_KEY=… cargo run -p herbot-core --example verify_imagine -- /tmp/w6-proof
use herbot_core::imagine;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    let dir = std::path::PathBuf::from(std::env::args().nth(1).ok_or("output directory required")?);
    tokio::fs::create_dir_all(&dir).await?;
    let source = dir.join("source.png");
    let status = tokio::process::Command::new("magick")
        .args([
            "-size",
            "900x450",
            "xc:none",
            "-fill",
            "orange",
            "-draw",
            "circle 450,225 450,40",
        ])
        .arg(&source)
        .status()
        .await?;
    if !status.success() {
        return Err("could not create verification image".into());
    }
    let sticker = dir.join("sticker.webp");
    imagine::sticker(&source, &sticker).await?;
    tracing::info!(path = %sticker.display(), "sticker converted");
    let key = std::env::var("OPENAI_API_KEY")?;
    let model = std::env::var("HERBOT_VIDEO_MODEL").unwrap_or_else(|_| "sora-2".into());
    match imagine::generate_video(&key, &model, &dir, "A small orange paper boat gently floating on calm blue water, static camera, soft daylight.", 4, "720x1280", None).await {
        Ok(video) => tracing::info!(id = %video.id, path = %video.path.display(), seconds = video.seconds, size = %video.size, "video completed"),
        Err(error) => { tracing::error!(%error, "real video verification failed"); return Err(error.into()); }
    }
    Ok(())
}
