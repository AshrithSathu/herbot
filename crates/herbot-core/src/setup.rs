//! Conversation setup: "what should I be here?"
//!
//! The first admin message in a new conversation gets a greeting with preset
//! buttons. A tapped preset, or the admin's next message, becomes the
//! conversation's purpose. Pure text and parsing only; see `poller` for the
//! flow and `store` for the state.

/// Longest purpose we keep (also enforced by the database).
pub const MAX_PURPOSE_CHARS: usize = 1000;

/// A one-tap starting point. `purpose` is what gets stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preset {
    pub key: &'static str,
    pub label: &'static str,
    pub purpose: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset {
        key: "research",
        label: "🔎 Research",
        purpose: "Research assistant: dig into my questions, search the web, compare sources and cite them.",
    },
    Preset {
        key: "code",
        label: "💻 Code help",
        purpose: "Coding partner: explain, write, review and debug code with me.",
    },
    Preset {
        key: "news",
        label: "📰 News digest",
        purpose: "News digest: find and summarise what's new on the topics I ask about.",
    },
    Preset {
        key: "chat",
        label: "💬 Just chat",
        purpose: "General assistant, Grok-style: direct, curious, a bit witty, and concise.",
    },
];

/// What General (a group's main chat, with no topic) is for, unless changed
/// with /setup: the everyday Grok-style assistant. Topics ask instead.
pub fn default_general_purpose() -> &'static str {
    PRESETS
        .iter()
        .find(|p| p.key == "chat")
        .map(|p| p.purpose)
        .unwrap_or("General assistant, Grok-style: direct, curious, a bit witty, and concise.")
}

const BUTTON_PREFIX: &str = "setup:";

/// Callback data for a preset button. Stays well under Telegram's 64-byte limit.
pub fn button_data(preset: &Preset) -> String {
    format!("{BUTTON_PREFIX}{}", preset.key)
}

/// The preset a button's callback data points to, if it is a setup button.
pub fn preset_from_button(data: &str) -> Option<&'static Preset> {
    let key = data.strip_prefix(BUTTON_PREFIX)?;
    PRESETS.iter().find(|p| p.key == key)
}

/// Buttons for the greeting, as (label, callback data), two per row.
pub fn preset_buttons() -> Vec<Vec<(String, String)>> {
    PRESETS
        .chunks(2)
        .map(|row| {
            row.iter()
                .map(|p| (p.label.to_string(), button_data(p)))
                .collect()
        })
        .collect()
}

pub fn greeting(place: &str) -> String {
    format!(
        "👋 Hi! Let's set up {place}.\n\n\
         What should I be here? Pick one, or just type it in your own words, \
         like \"help me plan a trip to Japan\" or \"roast my startup ideas\".\n\n\
         You can change it anytime with /setup."
    )
}

pub fn confirmation(place: &str, purpose: &str) -> String {
    format!(
        "✅ Set. In {place} I'm:\n{purpose}\n\n\
         The AI side connects in Step 4. Until then I keep saving your messages here. \
         Change this anytime with /setup."
    )
}

#[derive(Debug, PartialEq, Eq)]
pub enum PurposeError {
    Empty,
    TooLong { chars: usize },
}

impl std::fmt::Display for PurposeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PurposeError::Empty => {
                write!(f, "That's empty. Tell me what this conversation is for.")
            }
            PurposeError::TooLong { chars } => write!(
                f,
                "That's {chars} characters; keep it under {MAX_PURPOSE_CHARS}. A sentence or two is plenty."
            ),
        }
    }
}

/// Cleans up a typed purpose.
pub fn validate_purpose(text: &str) -> Result<String, PurposeError> {
    let trimmed = text.trim();
    let chars = trimmed.chars().count();
    if chars == 0 {
        Err(PurposeError::Empty)
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
    fn every_preset_round_trips_through_its_button() {
        for preset in PRESETS {
            let data = button_data(preset);
            assert!(data.len() <= 64, "{data} is over Telegram's 64-byte limit");
            assert_eq!(preset_from_button(&data), Some(preset));
            assert!(preset.purpose.chars().count() <= MAX_PURPOSE_CHARS);
        }
    }

    #[test]
    fn general_defaults_to_the_just_chat_preset() {
        let chat = PRESETS.iter().find(|p| p.key == "chat").unwrap();
        assert_eq!(default_general_purpose(), chat.purpose);
    }

    #[test]
    fn unknown_or_foreign_button_data_is_rejected() {
        for data in ["setup:", "setup:nope", "answer:research", "research", ""] {
            assert_eq!(preset_from_button(data), None, "{data}");
        }
    }

    #[test]
    fn buttons_are_laid_out_two_per_row() {
        let rows = preset_buttons();
        assert_eq!(rows.len(), PRESETS.len().div_ceil(2));
        assert!(rows.iter().all(|r| !r.is_empty() && r.len() <= 2));
    }

    #[test]
    fn purposes_are_trimmed_and_bounded() {
        assert_eq!(
            validate_purpose("  roast my ideas \n"),
            Ok("roast my ideas".into())
        );
        assert_eq!(validate_purpose("   "), Err(PurposeError::Empty));
        let long = "x".repeat(MAX_PURPOSE_CHARS + 1);
        assert_eq!(
            validate_purpose(&long),
            Err(PurposeError::TooLong {
                chars: MAX_PURPOSE_CHARS + 1
            })
        );
        // Multi-byte characters count as one each.
        assert!(validate_purpose(&"é".repeat(MAX_PURPOSE_CHARS)).is_ok());
    }

    #[test]
    fn texts_name_the_place_and_mention_setup() {
        assert!(greeting("HQ › Research").contains("HQ › Research"));
        assert!(greeting("x").contains("/setup"));
        let done = confirmation("HQ › Research", "Find papers");
        assert!(
            done.contains("HQ › Research")
                && done.contains("Find papers")
                && done.contains("/setup")
        );
    }
}
