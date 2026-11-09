//! Agent replies on their way to Telegram: scrub secrets, then split into
//! messages Telegram accepts.

use std::sync::LazyLock;

use regex::Regex;

/// Telegram's per-message limit is 4096 characters; stay a little under.
pub const MAX_MESSAGE_CHARS: usize = 4000;
pub const REDACTED: &str = "[redacted]";

static SECRETS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        // PEM private keys, whole block.
        r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        // OpenAI and Anthropic style keys.
        r"\bsk-(?:proj-|ant-)?[A-Za-z0-9_\-]{20,}",
        // Telegram bot tokens.
        r"\b\d{8,10}:AA[A-Za-z0-9_\-]{30,}",
        // GitHub tokens.
        r"\bgh[pousr]_[A-Za-z0-9]{30,}",
        r"\bgithub_pat_[A-Za-z0-9_]{40,}",
        // Slack tokens.
        r"\bxox[abprs]-[A-Za-z0-9\-]{10,}",
        // AWS access key IDs.
        r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
        // JWTs (OAuth access/id tokens, e.g. inside ~/.codex/auth.json).
        r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("secret patterns are valid"))
    .collect()
});

/// `"access_token": "…"`-style JSON fields: keep the key, hide the value.
static SECRET_FIELDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)("(?:access_token|refresh_token|id_token|api_key|apikey|secret|password|client_secret|token)"\s*:\s*")[^"]{6,}(")"#,
    )
    .expect("field pattern is valid")
});

/// Replaces anything that looks like a credential with `[redacted]`.
pub fn scrub(text: &str) -> String {
    let mut out = SECRET_FIELDS
        .replace_all(text, format!("${{1}}{REDACTED}${{2}}"))
        .into_owned();
    for re in SECRETS.iter() {
        out = re.replace_all(&out, REDACTED).into_owned();
    }
    out
}

/// Most options an `[[ask: …]]` line may offer, and the longest label.
pub const MAX_CHOICES: usize = 6;
pub const MAX_CHOICE_CHARS: usize = 60;

static ASK_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^[ \t]*\[\[ask:\s*(.+?)\s*\]\][ \t]*$").expect("ask pattern is valid")
});

/// Pulls a trailing `[[ask: A | B | C]]` line out of an agent reply.
/// Returns the reply without it, and the options (2 to 6, trimmed, deduped)
/// if the line was valid. An invalid line is left in the text as-is.
pub fn extract_choices(text: &str) -> (String, Option<Vec<String>>) {
    let Some(m) = ASK_LINE.captures_iter(text).last() else {
        return (text.to_string(), None);
    };
    let whole = m.get(0).expect("match");
    let mut options: Vec<String> = Vec::new();
    for raw in m[1].split('|') {
        let option = raw.trim();
        if !option.is_empty() && !options.iter().any(|o| o.eq_ignore_ascii_case(option)) {
            options.push(option.to_string());
        }
    }
    let valid = (2..=MAX_CHOICES).contains(&options.len())
        && options
            .iter()
            .all(|o| o.chars().count() <= MAX_CHOICE_CHARS);
    if !valid {
        return (text.to_string(), None);
    }
    let mut rest = String::with_capacity(text.len());
    rest.push_str(&text[..whole.start()]);
    rest.push_str(&text[whole.end()..]);
    (rest.trim().to_string(), Some(options))
}

/// Splits text into Telegram-sized messages, preferring paragraph, then line,
/// then word boundaries. Never splits inside a character.
pub fn split(text: &str, max_chars: usize) -> Vec<String> {
    let mut parts = Vec::new();
    let mut rest = text.trim();
    while rest.chars().count() > max_chars {
        let limit = rest
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(rest.len());
        let window = &rest[..limit];
        let cut = window
            .rfind("\n\n")
            .or_else(|| window.rfind('\n'))
            .or_else(|| window.rfind(' '))
            .filter(|&i| i > limit / 2)
            .unwrap_or(limit);
        parts.push(rest[..cut].trim_end().to_string());
        rest = rest[cut..].trim_start();
    }
    if !rest.is_empty() {
        parts.push(rest.to_string());
    }
    parts
}

/// Like [`split`], but a code block cut in two is closed at the end of one
/// part and reopened (same language) at the start of the next, so each part
/// renders on its own.
pub fn split_markdown(text: &str, max_chars: usize) -> Vec<String> {
    let mut parts = split(text, max_chars);
    let mut carry: Option<String> = None; // a fence left open by the last part
    for part in parts.iter_mut() {
        if let Some(fence) = carry.take() {
            *part = format!("{fence}\n{part}");
        }
        let mut open: Option<String> = None;
        for line in part.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") {
                open = match open {
                    Some(_) => None,
                    None => Some(trimmed.to_string()),
                };
            }
        }
        if let Some(fence) = open {
            part.push_str("\n```");
            carry = Some(fence);
        }
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_common_credentials() {
        let cases = [
            "key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 here",
            "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "bot 9029578806:AAEAfkreEQatuJv4_bWuPwQHutA3obw_t8U ok",
            "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
            "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRS",
            "xoxb-1234567890-abcdefghij",
            "AKIAIOSFODNN7EXAMPLE",
            "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYXNpZ25hdHVyZQ",
            "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----",
        ];
        for case in cases {
            let out = scrub(case);
            assert!(out.contains(REDACTED), "not scrubbed: {case} -> {out}");
        }
        assert_eq!(
            scrub("bot 9029578806:AAEAfkreEQatuJv4_bWuPwQHutA3obw_t8U ok"),
            "bot [redacted] ok"
        );
    }

    #[test]
    fn scrubs_auth_json_fields_but_keeps_keys() {
        let json = r#"{"tokens": {"access_token": "abc.def-ghi_123456", "account_id": "acct_1"}, "OPENAI_API_KEY": null}"#;
        let out = scrub(json);
        assert!(out.contains(r#""access_token": "[redacted]""#), "{out}");
        assert!(
            out.contains(r#""account_id": "acct_1""#),
            "ordinary fields stay: {out}"
        );
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        for text in [
            "The answer is 4.",
            "Use `cargo test --workspace` then sk- is a prefix",
            "Order 12345678:AB is short",
            "token budget is 2000",
        ] {
            assert_eq!(scrub(text), text);
        }
    }

    #[test]
    fn extracts_a_trailing_ask_line() {
        let (text, choices) = extract_choices(
            "Two ways to do this.\n\n[[ask: Delete all 42 | Only older than 30 days | Keep them]]",
        );
        assert_eq!(text, "Two ways to do this.");
        assert_eq!(
            choices.unwrap(),
            ["Delete all 42", "Only older than 30 days", "Keep them"]
        );
    }

    #[test]
    fn ask_lines_are_case_insensitive_trimmed_and_deduped() {
        let (text, choices) = extract_choices("Pick:\n  [[ASK:  yes |  no | Yes ]]  \nthanks");
        assert_eq!(choices.unwrap(), ["yes", "no"]);
        assert_eq!(text, "Pick:\n\nthanks");
    }

    #[test]
    fn invalid_ask_lines_stay_as_text() {
        for bad in [
            "[[ask: only one]]",
            "[[ask: a | b | c | d | e | f | g]]",
            &format!("[[ask: ok | {}]]", "x".repeat(61)),
            "inline [[ask: a | b]] is not a line",
        ] {
            let (text, choices) = extract_choices(bad);
            assert_eq!((text.as_str(), choices), (bad, None), "{bad}");
        }
        assert_eq!(
            extract_choices("no question here"),
            ("no question here".into(), None)
        );
    }

    #[test]
    fn short_text_is_one_message() {
        assert_eq!(split("  hello\n", 4000), ["hello"]);
        assert!(split("   ", 4000).is_empty());
    }

    #[test]
    fn long_text_splits_on_paragraphs_and_stays_under_the_limit() {
        let para = "word ".repeat(300); // ~1500 chars
        let text = [para.trim(), para.trim(), para.trim(), para.trim()].join("\n\n");
        let parts = split(&text, 4000);
        assert!(parts.len() >= 2);
        assert!(parts.iter().all(|p| p.chars().count() <= 4000));
        assert_eq!(
            parts.join(" ").split_whitespace().count(),
            1200,
            "no words lost"
        );
    }

    #[test]
    fn unbroken_text_splits_at_the_limit_without_breaking_characters() {
        let text = "é".repeat(9000);
        let parts = split(&text, 4000);
        assert_eq!(
            parts.iter().map(|p| p.chars().count()).collect::<Vec<_>>(),
            [4000, 4000, 1000]
        );
    }
}
