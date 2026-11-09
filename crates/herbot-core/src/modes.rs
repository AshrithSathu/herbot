//! Grok's modes, for Herbot topics.
//!
//! A topic's mode (`conversations.mode`, `/mode`) sets how hard its agent
//! thinks: Fast, Auto, Expert or Heavy (sub-agents in parallel). A single
//! message can go further with `/fast`, `/think`, `/heavy` or `/deepsearch`.
//!
//! Codex reads `.codex/config.toml` from the folder it runs in and every
//! folder above it (inside the trusted herbot project), so:
//! - `agents/.codex/config.toml` (written at startup) turns on live web
//!   search, image generation, image viewing and sub-agents for every topic;
//! - each topic's `.codex/config.toml` sets its reasoning effort, rewritten
//!   before a turn whenever the effort it needs changes.

use std::io;
use std::path::Path;

/// A topic's standing mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Fast,
    Auto,
    Expert,
    Heavy,
}

pub const ALL_MODES: [Mode; 4] = [Mode::Fast, Mode::Auto, Mode::Expert, Mode::Heavy];

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s.trim().to_ascii_lowercase().as_str() {
            "fast" => Some(Mode::Fast),
            "auto" => Some(Mode::Auto),
            "expert" | "think" => Some(Mode::Expert),
            "heavy" => Some(Mode::Heavy),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Fast => "fast",
            Mode::Auto => "auto",
            Mode::Expert => "expert",
            Mode::Heavy => "heavy",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Mode::Fast => "⚡ Fast",
            Mode::Auto => "✨ Auto",
            Mode::Expert => "🧠 Expert",
            Mode::Heavy => "🏋️ Heavy",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Mode::Fast => "quick answers, light reasoning",
            Mode::Auto => "balanced: thinks as hard as the question needs",
            Mode::Expert => "thinks carefully before every answer",
            Mode::Heavy => "several sub-agents work in parallel, then the best answer wins",
        }
    }

    /// Codex reasoning effort; Auto uses Herbot's configured effort.
    pub fn effort(self, auto: &str) -> &str {
        match self {
            Mode::Fast => "low",
            Mode::Auto => auto,
            Mode::Expert => "high",
            Mode::Heavy => "xhigh",
        }
    }

    /// What the agent is told in its header (nothing for Auto).
    pub fn instruction(self) -> Option<&'static str> {
        match self {
            Mode::Fast => Some("fast: answer quickly and briefly; skip long research unless asked"),
            Mode::Auto => None,
            Mode::Expert => {
                Some("expert: think it through carefully before answering, and check your work")
            }
            Mode::Heavy => Some(HEAVY),
        }
    }
}

const HEAVY: &str = "heavy: split this across several sub-agents working in parallel \
(different angles or approaches), compare what they find, then give one best answer \
and say briefly where they disagreed";

/// A one-message mode: `/fast`, `/think`, `/heavy` or `/deepsearch <question>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    Auto,
    Fast,
    Think,
    Heavy,
    DeepSearch,
}

impl Style {
    pub fn as_str(self) -> &'static str {
        match self {
            Style::Auto => "auto",
            Style::Fast => "fast",
            Style::Think => "think",
            Style::Heavy => "heavy",
            Style::DeepSearch => "deepsearch",
        }
    }

    pub fn effort(self, auto: &str) -> &str {
        match self {
            Style::Auto => auto,
            Style::Fast => Mode::Fast.effort(auto),
            Style::Think => Mode::Expert.effort(auto),
            Style::Heavy => Mode::Heavy.effort(auto),
            Style::DeepSearch => "high",
        }
    }

    pub fn instruction(self) -> &'static str {
        match self {
            Style::Auto => "auto: use balanced reasoning appropriate to this question",
            Style::Fast => Mode::Fast.instruction().expect("fast has one"),
            Style::Think => Mode::Expert.instruction().expect("expert has one"),
            Style::Heavy => HEAVY,
            Style::DeepSearch => DEEPSEARCH,
        }
    }

    /// What's shown in the chat while it works.
    pub fn working(self) -> &'static str {
        match self {
            Style::Auto => "Thinking",
            Style::Fast => "⚡ Fast answer coming",
            Style::Think => "🧠 Thinking it through",
            Style::Heavy => "🏋️ Heavy mode: sub-agents are on it",
            Style::DeepSearch => {
                "🔎 DeepSearch: researching across sources. This takes a few minutes"
            }
        }
    }
}

const DEEPSEARCH: &str = "deepsearch: research this thoroughly on the live web. Plan the \
questions, run many searches across independent, reputable sources (sub-agents in parallel \
if it helps), read the sources, cross-check claims and note where they disagree. Reply with a \
structured report: a short answer first, then findings with numbered inline citations [1], \
then a Sources list of links. Also save the full report as Markdown in files/ and send it \
with a [[file: …]] line";

/// Herbot-wide Codex settings for every topic, written at startup.
pub const SHARED_CONFIG: &str = "# Written by Herbot at startup; applies to every topic below.\n\
# Each topic's own .codex/config.toml sets its mode's reasoning effort.\n\
web_search = \"live\"\n\
\n\
[features]\n\
image_generation = true\n\
view_image = true\n\
multi_agent = true\n";

pub async fn write_shared_config(agents_dir: &Path) -> io::Result<()> {
    write_if_changed(
        &agents_dir.join(".codex").join("config.toml"),
        SHARED_CONFIG,
    )
    .await
}

/// Sets a topic's reasoning effort for its next turn. Writes only when it
/// changes, so most turns touch nothing.
pub async fn set_topic_effort(agents_dir: &Path, folder: &Path, effort: &str) -> io::Result<()> {
    let text = format!(
        "# Written by Herbot: this topic's mode (change it with /mode).\n\
         model_reasoning_effort = \"{effort}\"\n"
    );
    write_if_changed(
        &agents_dir.join(folder).join(".codex").join("config.toml"),
        &text,
    )
    .await
}

async fn write_if_changed(path: &Path, text: &str) -> io::Result<()> {
    if tokio::fs::read_to_string(path).await.ok().as_deref() == Some(text) {
        return Ok(());
    }
    let dir = path.parent().expect("config.toml has a folder");
    tokio::fs::create_dir_all(dir).await?;
    let tmp = dir.join(".config.toml.tmp");
    tokio::fs::write(&tmp, text).await?;
    tokio::fs::rename(&tmp, path).await
}

/// The `/mode` buttons for a conversation (callback `mode:<conversation>:<mode>`).
pub fn buttons(conversation_id: i64, current: Mode) -> Vec<Vec<(String, String)>> {
    ALL_MODES
        .iter()
        .map(|&m| {
            let mark = if m == current { " ✓" } else { "" };
            vec![(
                format!("{}{mark}", m.label()),
                format!("mode:{conversation_id}:{}", m.as_str()),
            )]
        })
        .collect()
}

/// A tapped `/mode` button.
pub fn parse_button(data: &str) -> Option<(i64, Mode)> {
    let mut parts = data.strip_prefix("mode:")?.split(':');
    let id = parts.next()?.parse().ok()?;
    let mode = Mode::parse(parts.next()?)?;
    parts.next().is_none().then_some((id, mode))
}

/// The `/mode` message.
pub fn summary(place: &str, current: Mode) -> String {
    let mut text = format!(
        "Mode for {place}: {} ({})\n",
        current.label(),
        current.description()
    );
    for m in ALL_MODES {
        text.push_str(&format!("\n{} · {}", m.label(), m.description()));
    }
    text.push_str(
        "\n\nFor one message: /fast, /think, /heavy or /deepsearch followed by your question.",
    );
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_round_trip() {
        for m in ALL_MODES {
            let data =
                &buttons(12, Mode::Auto)[ALL_MODES.iter().position(|&x| x == m).unwrap()][0].1;
            assert_eq!(parse_button(data), Some((12, m)));
            assert!(data.len() <= 64);
        }
        assert_eq!(Mode::parse("Think"), Some(Mode::Expert));
        assert_eq!(Mode::Auto.effort("medium"), "medium");
    }
}
