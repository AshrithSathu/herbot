//! Files moving between Telegram and an agent: what kind each one is, and
//! how Telegram should show it.

use std::path::{Path, PathBuf};

/// How Telegram shows a file Herbot sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// Shown inline (jpg, png, webp).
    Photo,
    Sticker,
    /// A round-trip voice note (ogg/opus): plays like one Ashrith recorded.
    Voice,
    /// Music or long audio (mp3, m4a, wav, flac).
    Audio,
    /// Plays inline (mp4, mov, webm).
    Video,
    /// A looping silent clip (gif).
    Animation,
    /// Anything else: a downloadable file (pdf, docx, md, html, zip, …).
    Document,
}

impl FileKind {
    /// Picks the kind from the file name. Unknown types are documents.
    pub fn for_path(path: &Path) -> FileKind {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        match ext.as_str() {
            "jpg" | "jpeg" | "png" | "webp" => FileKind::Photo,
            "ogg" | "oga" | "opus" => FileKind::Voice,
            "mp3" | "m4a" | "wav" | "flac" | "aac" => FileKind::Audio,
            "mp4" | "mov" | "webm" | "m4v" => FileKind::Video,
            "gif" => FileKind::Animation,
            _ => FileKind::Document,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FileKind::Sticker => "sticker",
            FileKind::Photo => "photo",
            FileKind::Voice => "voice",
            FileKind::Audio => "audio",
            FileKind::Video => "video",
            FileKind::Animation => "animation",
            FileKind::Document => "document",
        }
    }
}

/// A file on its way to Telegram.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutFile {
    pub kind: FileKind,
    /// Absolute path on this machine.
    pub path: PathBuf,
    /// Shown under the file (plain text, at most 1024 characters).
    pub caption: Option<String>,
}

impl OutFile {
    pub fn new(path: PathBuf) -> Self {
        OutFile {
            kind: FileKind::for_path(&path),
            path,
            caption: None,
        }
    }
}

/// A file saved on this machine and recorded with its message
/// (`messages.attachments`), for the agent and the admin panel.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SavedFile {
    /// photo, document, video, video note, audio, GIF, sticker, voice
    pub kind: String,
    /// Relative to the agents root (`HERBOT_AGENTS_DIR`).
    pub path: String,
    pub name: String,
    pub mime: Option<String>,
    pub size: u64,
}

/// What the bot is doing, shown at the top of the chat ("sending a photo…").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Activity {
    Typing,
    UploadPhoto,
    UploadVideo,
    UploadDocument,
    RecordVoice,
}

impl Activity {
    /// What's shown while a file of this kind is on its way.
    pub fn sending(kind: FileKind) -> Activity {
        match kind {
            FileKind::Photo | FileKind::Sticker => Activity::UploadPhoto,
            FileKind::Video | FileKind::Animation => Activity::UploadVideo,
            FileKind::Voice => Activity::RecordVoice,
            FileKind::Audio | FileKind::Document => Activity::UploadDocument,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_follow_the_extension() {
        assert_eq!(FileKind::for_path(Path::new("a/b.PNG")), FileKind::Photo);
        assert_eq!(FileKind::for_path(Path::new("reply.ogg")), FileKind::Voice);
        assert_eq!(FileKind::for_path(Path::new("clip.mp4")), FileKind::Video);
        assert_eq!(
            FileKind::for_path(Path::new("report.pdf")),
            FileKind::Document
        );
        assert_eq!(FileKind::for_path(Path::new("noext")), FileKind::Document);
    }
}
