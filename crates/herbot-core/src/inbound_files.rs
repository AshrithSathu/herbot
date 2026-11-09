//! Files Ashrith sends (Grok's file uploads, image and video understanding).
//!
//! Each one is saved in the topic's folder under `files/` and described to
//! the agent: photos to look at (`view_image`), documents to read, videos as
//! still frames plus their soundtrack transcribed, audio transcribed.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::media::SavedFile;
use crate::poller::{ApiError, TelegramApi};
use crate::telegram::{Attachment, AttachmentKind};
use crate::voice::{MAX_VOICE_SECONDS, Transcriber, VoiceError};

/// Telegram lets bots download files up to 20 MB.
pub const MAX_DOWNLOAD_BYTES: u32 = 20 * 1024 * 1024;
/// Most stills taken from a video.
const MAX_FRAMES: u32 = 6;
const TOOL_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("{name} is {mb} MB; Telegram lets bots download files up to 20 MB")]
    TooBig { name: String, mb: u32 },
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error("could not save the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Tool(String),
    #[error(transparent)]
    Voice(#[from] VoiceError),
}

/// What the agent is told about a file, and the record kept with the message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Received {
    pub note: String,
    pub file: SavedFile,
}

/// Downloads `attachment`, saves it as `<folder>/files/<message_id>-<name>`
/// (`folder` relative to `agents_dir`) and describes it.
pub async fn receive<A: TelegramApi, T: Transcriber>(
    api: &A,
    transcriber: &T,
    agents_dir: &Path,
    folder: &Path,
    message_id: i32,
    attachment: &Attachment,
) -> Result<Received, FileError> {
    let name = file_name(attachment, message_id);
    if let Some(size) = attachment.size
        && size > MAX_DOWNLOAD_BYTES
    {
        return Err(FileError::TooBig {
            name,
            mb: size.div_ceil(1024 * 1024),
        });
    }
    let bytes = api.download_file(&attachment.file_id).await?;
    let relative_in_topic = PathBuf::from("files").join(format!("{message_id}-{name}"));
    let absolute = agents_dir.join(folder).join(&relative_in_topic);
    tokio::fs::create_dir_all(absolute.parent().expect("files/ has a parent")).await?;
    tokio::fs::write(&absolute, &bytes).await?;
    let shown = relative_in_topic.display().to_string();
    let file = SavedFile {
        kind: attachment.kind.as_str().to_string(),
        path: folder.join(&relative_in_topic).display().to_string(),
        name: name.clone(),
        mime: attachment.mime.clone(),
        size: bytes.len() as u64,
    };

    let note = describe_saved(transcriber, &absolute, &shown, message_id, attachment).await?;
    Ok(Received { note, file })
}

/// Shared media preparation for Telegram downloads and panel uploads.
pub async fn describe_saved<T: Transcriber>(
    transcriber: &T,
    absolute: &Path,
    shown: &str,
    message_id: i32,
    attachment: &Attachment,
) -> Result<String, FileError> {
    let is_image_document = attachment.kind == AttachmentKind::Document
        && attachment
            .mime
            .as_deref()
            .is_some_and(|m| m.starts_with("image/"));
    let note = match attachment.kind {
        AttachmentKind::Photo => format!("[Photo: {shown}. Look at it with view_image.]"),
        _ if is_image_document => format!("[Image file: {shown}. Look at it with view_image.]"),
        AttachmentKind::Document => format!(
            "[Document: {shown} ({}, {}). Read it from that path.]",
            attachment.mime.as_deref().unwrap_or("unknown type"),
            human_size(tokio::fs::metadata(absolute).await?.len())
        ),
        AttachmentKind::Sticker => {
            let emoji = attachment.emoji.as_deref().unwrap_or("");
            if attachment.mime.as_deref() == Some("image/webp") {
                format!("[Sticker {emoji}: {shown}. Look at it with view_image.]")
            } else {
                format!("[Animated sticker {emoji}]")
            }
        }
        AttachmentKind::Video | AttachmentKind::VideoNote | AttachmentKind::Animation => {
            describe_video(transcriber, &absolute, &shown, message_id, attachment).await?
        }
        AttachmentKind::Audio => describe_audio(transcriber, &absolute, &shown, attachment).await?,
    };
    Ok(note)
}

/// Stills from across the video (for view_image) and, for videos with sound,
/// the soundtrack transcribed.
async fn describe_video<T: Transcriber>(
    transcriber: &T,
    video: &Path,
    shown: &str,
    message_id: i32,
    attachment: &Attachment,
) -> Result<String, FileError> {
    let seconds = match attachment.duration_secs.filter(|&d| d > 0) {
        Some(d) => d as f64,
        None => probe_duration(video).await.unwrap_or(1.0),
    }
    .max(1.0);
    let frames = MAX_FRAMES.min(seconds.ceil() as u32).max(1);
    let frames_dir = video
        .parent()
        .expect("saved under files/")
        .join(format!("{message_id}-frames"));
    tokio::fs::create_dir_all(&frames_dir).await?;
    let fps = format!("fps={frames}/{seconds:.3},scale='min(1280,iw)':-2");
    run_tool(
        "ffmpeg",
        &[
            "-v".as_ref(),
            "error".as_ref(),
            "-y".as_ref(),
            "-i".as_ref(),
            video.as_os_str(),
            "-vf".as_ref(),
            fps.as_ref(),
            "-frames:v".as_ref(),
            frames.to_string().as_ref(),
            "-q:v".as_ref(),
            "3".as_ref(),
            frames_dir.join("frame-%02d.jpg").as_os_str(),
        ],
    )
    .await?;
    let frames_shown = Path::new(shown)
        .parent()
        .unwrap_or(Path::new("files"))
        .join(format!("{message_id}-frames"));
    let mut note = format!(
        "[{}: {shown}, {}. {frames} stills in {}/ (frame-01.jpg …); look at them with view_image.",
        capitalised(attachment.kind.as_str()),
        human_duration(seconds as u32),
        frames_shown.display()
    );
    if attachment.kind != AttachmentKind::Animation && has_audio(video).await {
        note.push_str(&soundtrack(transcriber, video, seconds as u32).await?);
    }
    note.push(']');
    Ok(note)
}

async fn describe_audio<T: Transcriber>(
    transcriber: &T,
    audio: &Path,
    shown: &str,
    attachment: &Attachment,
) -> Result<String, FileError> {
    let seconds = match attachment.duration_secs {
        Some(d) => d,
        None => probe_duration(audio).await.unwrap_or(0.0) as u32,
    };
    let mut note = format!("[Audio: {shown}, {}.", human_duration(seconds));
    note.push_str(&soundtrack(transcriber, audio, seconds).await?);
    note.push(']');
    Ok(note)
}

/// " Transcript: …" for a file's sound, or why there isn't one.
async fn soundtrack<T: Transcriber>(
    transcriber: &T,
    media: &Path,
    seconds: u32,
) -> Result<String, FileError> {
    if seconds > MAX_VOICE_SECONDS {
        return Ok(format!(
            " Not transcribed: longer than {} minutes.",
            MAX_VOICE_SECONDS / 60
        ));
    }
    let ogg = media.with_extension("soundtrack.ogg");
    run_tool(
        "ffmpeg",
        &[
            "-v".as_ref(),
            "error".as_ref(),
            "-y".as_ref(),
            "-i".as_ref(),
            media.as_os_str(),
            "-vn".as_ref(),
            "-ac".as_ref(),
            "1".as_ref(),
            "-c:a".as_ref(),
            "libopus".as_ref(),
            "-b:a".as_ref(),
            "32k".as_ref(),
            ogg.as_os_str(),
        ],
    )
    .await?;
    let audio = tokio::fs::read(&ogg).await?;
    let _ = tokio::fs::remove_file(&ogg).await;
    match transcriber.transcribe(audio).await {
        Ok(text) if text.trim().is_empty() => Ok(" No speech in it.".to_string()),
        Ok(text) => Ok(format!(" Transcript: \"{}\"", text.trim())),
        Err(VoiceError::NotConfigured) => {
            Ok(" Not transcribed: OPENAI_API_KEY isn't set.".to_string())
        }
        Err(err) => Err(err.into()),
    }
}

async fn has_audio(media: &Path) -> bool {
    probe(media, "a:0", "stream=codec_type")
        .await
        .is_some_and(|out| out.contains("audio"))
}

async fn probe_duration(media: &Path) -> Option<f64> {
    probe(media, "", "format=duration")
        .await?
        .trim()
        .parse()
        .ok()
}

async fn probe(media: &Path, stream: &str, entries: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new("ffprobe");
    cmd.args(["-v", "error"]);
    if !stream.is_empty() {
        cmd.args(["-select_streams", stream]);
    }
    cmd.args(["-show_entries", entries, "-of", "default=nw=1:nk=1"])
        .arg(media)
        .kill_on_drop(true);
    let out = tokio::time::timeout(TOOL_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn run_tool(program: &str, args: &[&std::ffi::OsStr]) -> Result<(), FileError> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args).kill_on_drop(true);
    let out = tokio::time::timeout(TOOL_TIMEOUT, cmd.output())
        .await
        .map_err(|_| FileError::Tool(format!("{program} took longer than 3 minutes")))?
        .map_err(|e| FileError::Tool(format!("could not run {program} (is it installed?): {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(FileError::Tool(format!(
            "{program} failed: {}",
            err.trim().chars().take(300).collect::<String>()
        )));
    }
    Ok(())
}

/// A safe file name: the sender's if there was one, else one from the kind.
fn file_name(attachment: &Attachment, message_id: i32) -> String {
    let given = attachment
        .file_name
        .as_deref()
        .map(sanitize)
        .filter(|n| !n.is_empty() && n != "." && n != "..");
    given.unwrap_or_else(|| {
        let ext = match (attachment.kind, attachment.mime.as_deref()) {
            (AttachmentKind::Photo, _) => "jpg",
            (AttachmentKind::Sticker, Some("image/webp")) => "webp",
            (AttachmentKind::Sticker, Some("video/webm")) => "webm",
            (AttachmentKind::Sticker, _) => "tgs",
            (AttachmentKind::Video | AttachmentKind::VideoNote | AttachmentKind::Animation, _) => {
                "mp4"
            }
            (AttachmentKind::Audio, Some("audio/ogg")) => "ogg",
            (AttachmentKind::Audio, _) => "mp3",
            (AttachmentKind::Document, Some("application/pdf")) => "pdf",
            (AttachmentKind::Document, _) => "bin",
        };
        format!(
            "{}-{message_id}.{ext}",
            attachment.kind.as_str().replace(' ', "-")
        )
    })
}

/// Keeps letters, digits, `.`, `-` and `_`; everything else becomes `_`.
/// No path separators survive, so a name can't leave `files/`.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_');
    trimmed.chars().take(120).collect()
}

fn capitalised(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

pub fn human_size(bytes: u64) -> String {
    match bytes {
        b if b >= 1024 * 1024 => format!("{:.1} MB", b as f64 / (1024.0 * 1024.0)),
        b if b >= 1024 => format!("{} KB", b / 1024),
        b => format!("{b} bytes"),
    }
}

fn human_duration(seconds: u32) -> String {
    if seconds >= 60 {
        format!("{}:{:02}", seconds / 60, seconds % 60)
    } else {
        format!("{seconds} s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_never_leave_the_files_folder() {
        assert_eq!(sanitize("../../etc/passwd"), "etc_passwd");
        assert_eq!(sanitize("My Report (final).pdf"), "My_Report__final_.pdf");
        assert_eq!(sanitize("..."), "");
    }
}
