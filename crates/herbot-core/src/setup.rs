//! Conversation setup: "what should I be here?"
//!
//! The first admin message in a new topic gets an open question, with no
//! presets. The admin's next message, typed at any length or as a voice note,
//! becomes the topic's purpose and its AGENTS.md. General skips this and uses
//! the default purpose. Pure text only; see `poller` for the flow.

/// Longest purpose we keep (also enforced by the database). A few minutes of
/// voice note fits comfortably.
pub const MAX_PURPOSE_CHARS: usize = 8000;

/// Fewest words that count as a purpose, so "hi" or "ok" can't become an agent.
pub const MIN_PURPOSE_WORDS: usize = 3;

/// What General (the group's main chat) is for, unless changed with /setup.
pub const DEFAULT_GENERAL_PURPOSE: &str = "Everyday chat, Grok-style: a direct, curious, slightly witty \
general assistant. Answer anything, search the web when facts matter, and keep it concise.";

/// Older versions of the greeting had preset buttons. Taps on those now get this.
pub const STALE_BUTTON_TOAST: &str =
    "Those buttons are gone. Just tell me what you want, in text or a voice note.";

pub fn greeting(place: &str) -> String {
    format!(
        "👋 Hi! This is {place}.\n\n\
         What should I be here? Tell me in your own words, as long as you like. \
         Type it or send a voice note: what this agent is for, how it should behave, \
         what it should know.\n\n\
         You can change it anytime with /setup."
    )
}

/// `/setup` on a conversation that already has a purpose: says plainly that
/// the next message replaces it, and offers a way out ([`keep_button`]).
pub fn new_purpose_prompt(place: &str) -> String {
    format!(
        "✏️ What should {place} be now?\n\n\
         Your next message (typed or a voice note) replaces the current purpose. \
         Changed your mind? Tap Keep the current purpose."
    )
}

pub const KEEP_LABEL: &str = "Keep the current purpose";
pub const KEPT: &str = "👍 Kept the current purpose. Messages go to the agent again.";
pub const OTHER_TOPIC_TOAST: &str = "That button belongs to another topic.";
pub const NOTHING_TO_KEEP_TOAST: &str = "Nothing to keep: the purpose was already set or cleared.";

/// The "Keep the current purpose" button under [`new_purpose_prompt`].
pub fn keep_button(conversation_id: i64) -> Vec<Vec<(String, String)>> {
    vec![vec![(
        KEEP_LABEL.to_string(),
        format!("setup:keep:{conversation_id}"),
    )]]
}

/// The conversation a "Keep the current purpose" tap is for.
pub fn parse_keep(data: &str) -> Option<i64> {
    data.strip_prefix("setup:keep:")?.parse().ok()
}

/// Telegram caps messages at 4096 characters; echoes stay well under it.
const ECHO_LIMIT: usize = 1500;

/// Shortens text for display, marking the cut. Counts characters, not bytes.
pub fn clip(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!("{}… (cut here; the full text is saved)", cut.trim_end())
}

pub fn confirmation(place: &str, purpose: &str) -> String {
    let purpose = clip(purpose, ECHO_LIMIT);
    format!(
        "✅ Got it. {place} is set up as:\n\n{purpose}\n\n\
         Saved as this topic's AGENTS.md. The AI side connects in Step 4; \
         until then I keep saving your messages here. Change it anytime with /setup."
    )
}

/// Reply to a voice note: what Herbot heard.
pub fn heard(transcript: &str) -> String {
    format!("🎙️ “{}”", clip(transcript, ECHO_LIMIT))
}

pub fn too_long(seconds: u32, max_seconds: u32) -> String {
    format!(
        "🎙️ That voice note is {} min long. I take up to {} min. Send a shorter one, or split it into parts.",
        seconds.div_ceil(60),
        max_seconds / 60
    )
}

pub const NOTHING_HEARD: &str = "🎙️ I couldn't make out any words in that voice note. Try again?";

#[derive(Debug, PartialEq, Eq)]
pub enum PurposeError {
    Empty,
    TooShort,
    TooLong { chars: usize },
}

impl std::fmt::Display for PurposeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PurposeError::Empty => write!(f, "That's empty. Tell me what this topic is for."),
            PurposeError::TooShort => write!(
                f,
                "That's a bit short for a whole agent. Tell me more about what this topic should do, typed or as a voice note."
            ),
            PurposeError::TooLong { chars } => write!(
                f,
                "That's {chars} characters. Keep it under {MAX_PURPOSE_CHARS}, or split the details into later messages."
            ),
        }
    }
}

/// Cleans up a purpose (typed or transcribed).
pub fn validate_purpose(text: &str) -> Result<String, PurposeError> {
    let trimmed = text.trim();
    let chars = trimmed.chars().count();
    if chars == 0 {
        Err(PurposeError::Empty)
    } else if trimmed.split_whitespace().count() < MIN_PURPOSE_WORDS {
        Err(PurposeError::TooShort)
    } else if chars > MAX_PURPOSE_CHARS {
        Err(PurposeError::TooLong { chars })
    } else {
        Ok(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_buttons_round_trip() {
        let data = &keep_button(42)[0][0].1;
        assert_eq!(parse_keep(data), Some(42));
        assert_eq!(parse_keep("setup:keep:x"), None);
        assert_eq!(parse_keep("ans:1:0"), None);
        assert!(data.len() <= 64, "Telegram's callback data limit");
    }

    #[test]
    fn purposes_are_trimmed_and_bounded() {
        assert_eq!(
            validate_purpose("  roast my ideas \n"),
            Ok("roast my ideas".into())
        );
        assert_eq!(validate_purpose("   "), Err(PurposeError::Empty));
        for short in ["Hi", "ok", "test this"] {
            assert_eq!(
                validate_purpose(short),
                Err(PurposeError::TooShort),
                "{short}"
            );
        }
        assert!(validate_purpose("plan my trips").is_ok());
        let long = "x ".repeat(MAX_PURPOSE_CHARS / 2 + 1);
        assert_eq!(
            validate_purpose(&long),
            Err(PurposeError::TooLong {
                chars: long.trim().chars().count()
            })
        );
        // Long, multi-paragraph answers are fine; characters, not bytes, count.
        assert!(validate_purpose(&"é é ".repeat(MAX_PURPOSE_CHARS / 4)).is_ok());
    }

    #[test]
    fn greeting_is_open_ended() {
        let g = greeting("HQ › Ideas");
        assert!(g.contains("HQ › Ideas") && g.contains("/setup") && g.contains("voice note"));
    }

    #[test]
    fn confirmation_shows_the_whole_purpose() {
        let done = confirmation("HQ › Ideas", "Roast my ideas.\nBe brutal.");
        assert!(done.contains("HQ › Ideas") && done.contains("Roast my ideas.\nBe brutal."));
        assert!(done.contains("AGENTS.md") && done.contains("/setup"));
    }

    #[test]
    fn long_text_is_clipped_for_telegram() {
        let long = "word ".repeat(2000);
        let shown = confirmation("HQ", &long);
        assert!(shown.chars().count() < 4096, "{}", shown.chars().count());
        assert!(shown.contains("full text is saved"));
        assert!(heard(&long).chars().count() < 4096);
        assert_eq!(clip("short", 10), "short");
    }

    #[test]
    fn default_general_purpose_fits() {
        assert!(validate_purpose(DEFAULT_GENERAL_PURPOSE).is_ok());
    }
}
