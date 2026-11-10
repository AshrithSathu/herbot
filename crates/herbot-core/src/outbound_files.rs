//! Files an agent sends (Grok's image generation, documents, charts, voice):
//! it ends its reply with `[[file: path]]` lines and Herbot sends each one
//! with the right Telegram type.
//!
//! Only files inside the current topic folder or Codex's generated-images folder can
//! be sent, and never secret-looking ones (`.env`, `auth.json`, keys), so a
//! confused agent can't leak credentials into the chat (invariant 5).

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::media::{FileKind, OutFile, SavedFile};

/// Most files one reply may send.
pub const MAX_FILES: usize = 10;
/// Telegram's upload limit for bots.
pub const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;
/// Photos above this are sent as documents (Telegram's photo limit).
pub const MAX_PHOTO_BYTES: u64 = 10 * 1024 * 1024;

static FILE_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^[ \t]*\[\[file:\s*(.+?)\s*\]\][ \t]*$").expect("file pattern is valid")
});

/// `![alt](path)` with a local path (how the Codex app shows images it made).
static LOCAL_IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)").expect("image pattern is valid")
});

/// A `[[file: path | optional caption]]` line from a reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRef {
    pub path: String,
    pub caption: Option<String>,
}

/// Pulls every `[[file: …]]` line out of a reply (at most [`MAX_FILES`];
/// extra lines stay in the text so nothing is silently dropped).
pub fn extract(text: &str) -> (String, Vec<FileRef>) {
    let mut files = Vec::new();
    let mut rest = String::with_capacity(text.len());
    let mut last = 0;
    for m in FILE_LINE.captures_iter(text) {
        if files.len() == MAX_FILES {
            break;
        }
        let whole = m.get(0).expect("match");
        let (path, caption) = match m[1].split_once('|') {
            Some((p, c)) => (p.trim(), Some(c.trim()).filter(|c| !c.is_empty())),
            None => (m[1].trim(), None),
        };
        let path = path.trim_matches(|c| c == '`' || c == '"' || c == '\'');
        if path.is_empty() {
            continue;
        }
        rest.push_str(&text[last..whole.start()]);
        last = whole.end();
        files.push(FileRef {
            path: path.to_string(),
            caption: caption.map(|c| c.chars().take(1000).collect()),
        });
    }
    rest.push_str(&text[last..]);

    // Markdown images of local files are files to send, not text.
    let mut out = String::with_capacity(rest.len());
    let mut last = 0;
    for m in LOCAL_IMAGE.captures_iter(&rest) {
        let path = &m[2];
        let local = !path.contains("://") && !path.starts_with("data:");
        if !local || files.len() == MAX_FILES {
            continue;
        }
        let whole = m.get(0).expect("match");
        out.push_str(&rest[last..whole.start()]);
        last = whole.end();
        if !files.iter().any(|f| f.path == path) {
            let alt = m[1].trim();
            files.push(FileRef {
                path: path.to_string(),
                caption: (!alt.is_empty()).then(|| alt.chars().take(1000).collect()),
            });
        }
    }
    out.push_str(&rest[last..]);
    (out.trim().to_string(), files)
}

/// Why a file couldn't be sent, in words for the chat.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RefuseReason {
    #[error("there's no file at {0}")]
    Missing(String),
    #[error("{0} is outside this topic's folder and Codex's generated images")]
    Outside(String),
    #[error("{0} looks like a secret, so it stays on the server")]
    Secret(String),
    #[error("{name} is {mb} MB; Telegram lets bots send up to 50 MB")]
    TooBig { name: String, mb: u64 },
}

/// Where a file is, ready to send and to record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub file: OutFile,
    pub saved: SavedFile,
}

/// Codex keeps images it generates here (`$CODEX_HOME/generated_images`).
pub fn codex_images_dir() -> Option<PathBuf> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex")))?;
    Some(home.join("generated_images"))
}

/// Checks a file the agent wants to send. Relative paths are from the
/// topic's folder. Files from Codex's generated images are copied into the
/// topic's `files/sent/` first, so the panel can show them later.
pub async fn resolve(
    agents_dir: &Path,
    folder: &Path,
    file: &FileRef,
) -> Result<Resolved, RefuseReason> {
    let topic_dir = agents_dir.join(folder);
    let wanted = expand_home(&file.path);
    let wanted = if wanted.is_absolute() {
        wanted
    } else {
        topic_dir.join(wanted)
    };
    let shown = file.path.clone();
    let real = tokio::fs::canonicalize(&wanted)
        .await
        .map_err(|_| RefuseReason::Missing(shown.clone()))?;
    let meta = tokio::fs::metadata(&real)
        .await
        .map_err(|_| RefuseReason::Missing(shown.clone()))?;
    if !meta.is_file() {
        return Err(RefuseReason::Missing(shown));
    }
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    if looks_secret(&name) {
        return Err(RefuseReason::Secret(name));
    }
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err(RefuseReason::TooBig {
            name,
            mb: meta.len().div_ceil(1024 * 1024),
        });
    }
    let agents_real = tokio::fs::canonicalize(agents_dir)
        .await
        .unwrap_or_else(|_| agents_dir.to_path_buf());
    let topic_real = tokio::fs::canonicalize(&topic_dir)
        .await
        .map_err(|_| RefuseReason::Outside(shown.clone()))?;
    let in_topic = real.starts_with(&topic_real);
    let images = match codex_images_dir() {
        Some(dir) => tokio::fs::canonicalize(&dir).await.ok(),
        None => None,
    };
    let in_images = images.as_ref().is_some_and(|dir| real.starts_with(dir));
    if !in_topic && !in_images {
        return Err(RefuseReason::Outside(shown));
    }

    // Keep a copy of generated images with the topic.
    let real = if in_topic {
        real
    } else {
        let sent = topic_dir.join("files").join("sent");
        tokio::fs::create_dir_all(&sent)
            .await
            .map_err(|_| RefuseReason::Missing(shown.clone()))?;
        let copy = sent.join(&name);
        tokio::fs::copy(&real, &copy)
            .await
            .map_err(|_| RefuseReason::Missing(shown.clone()))?;
        copy
    };

    let mut kind = FileKind::for_path(&real);
    if kind == FileKind::Photo && meta.len() > MAX_PHOTO_BYTES {
        kind = FileKind::Document;
    }
    let relative = real
        .strip_prefix(&agents_real)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| real.display().to_string());
    Ok(Resolved {
        file: OutFile {
            kind,
            path: real.clone(),
            caption: file.caption.clone(),
        },
        saved: SavedFile {
            kind: kind.as_str().to_string(),
            path: relative,
            name,
            mime: mime_of(&real).map(str::to_string),
            size: meta.len(),
        },
    })
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(path),
    }
}

/// Names that hold credentials. Never sent, whatever folder they're in.
fn looks_secret(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "auth.json"
        || lower == ".env"
        || lower.starts_with(".env.")
        || lower.starts_with("id_rsa")
        || lower.starts_with("id_ed25519")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
        || lower == "credentials.json"
}

pub fn mime_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "pdf" => "application/pdf",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        "json" => "application/json",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" => "application/zip",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolution_is_limited_to_current_topic_including_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let topic = Path::new("chat/topic_1");
        let own = root.path().join(topic).join("files");
        let other = root.path().join("chat/topic_2/files");
        tokio::fs::create_dir_all(&own).await.unwrap();
        tokio::fs::create_dir_all(&other).await.unwrap();
        tokio::fs::write(own.join("notes.txt"), "own")
            .await
            .unwrap();
        tokio::fs::write(other.join("notes.txt"), "private")
            .await
            .unwrap();
        let reference = |path: &str| FileRef {
            path: path.into(),
            caption: None,
        };
        assert!(
            resolve(root.path(), topic, &reference("files/notes.txt"))
                .await
                .is_ok()
        );
        for path in ["../topic_2/files/notes.txt", "../../PERSONAL.md"] {
            if path.ends_with("PERSONAL.md") {
                tokio::fs::write(root.path().join("PERSONAL.md"), "shared")
                    .await
                    .unwrap();
            }
            assert!(matches!(
                resolve(root.path(), topic, &reference(path)).await,
                Err(RefuseReason::Outside(_))
            ));
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(other.join("notes.txt"), own.join("link.txt")).unwrap();
            assert!(matches!(
                resolve(root.path(), topic, &reference("files/link.txt")).await,
                Err(RefuseReason::Outside(_))
            ));
        }
        tokio::fs::write(own.join(".env"), "secret").await.unwrap();
        assert!(matches!(
            resolve(root.path(), topic, &reference("files/.env")).await,
            Err(RefuseReason::Secret(_))
        ));
    }

    #[test]
    fn file_lines_come_out_with_captions() {
        let (text, files) = extract(
            "Here it is.\n\n[[file: files/cat.png | A cat in a hat]]\n[[file: `report.pdf`]]",
        );
        assert_eq!(text, "Here it is.");
        assert_eq!(
            files,
            [
                FileRef {
                    path: "files/cat.png".into(),
                    caption: Some("A cat in a hat".into())
                },
                FileRef {
                    path: "report.pdf".into(),
                    caption: None
                },
            ]
        );
        assert!(looks_secret("auth.json") && looks_secret(".env.local") && !looks_secret("env.md"));

        let (text, files) = extract(
            "Done.\n\n![](</Users/a/.codex/generated_images/x/fox.png>) ![logo](https://x.ai/l.png)",
        );
        assert_eq!(text, "Done.\n\n ![logo](https://x.ai/l.png)");
        assert_eq!(files[0].path, "/Users/a/.codex/generated_images/x/fox.png");
    }
}
