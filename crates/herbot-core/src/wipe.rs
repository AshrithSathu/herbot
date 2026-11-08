//! Confirm-with-buttons for `/new` and `/forget`: the button data, the
//! texts, and how long a confirmation stays valid. Pure; see `poller`.

use crate::store::Wiped;

/// A confirmation older than this is refused (send the command again).
pub const CONFIRM_TTL_SECS: i64 = 10 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeKind {
    /// Chat and T3 threads; the purpose stays.
    New,
    /// Everything, purpose included.
    Forget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeButton {
    Confirm(WipeKind),
    Cancel,
}

/// A tapped confirmation button, decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WipeTap {
    pub button: WipeButton,
    pub conversation_id: i64,
    /// When the confirmation was offered (unix seconds).
    pub issued_at: i64,
}

fn word(kind: WipeKind) -> &'static str {
    match kind {
        WipeKind::New => "new",
        WipeKind::Forget => "forget",
    }
}

/// Callback data, e.g. `wipe:new:12:1762600000` (well under Telegram's 64 bytes).
pub fn button_data(button: WipeButton, conversation_id: i64, issued_at: i64) -> String {
    let action = match button {
        WipeButton::Confirm(kind) => word(kind),
        WipeButton::Cancel => "cancel",
    };
    format!("wipe:{action}:{conversation_id}:{issued_at}")
}

pub fn parse(data: &str) -> Option<WipeTap> {
    let mut parts = data.strip_prefix("wipe:")?.split(':');
    let button = match parts.next()? {
        "new" => WipeButton::Confirm(WipeKind::New),
        "forget" => WipeButton::Confirm(WipeKind::Forget),
        "cancel" => WipeButton::Cancel,
        _ => return None,
    };
    let conversation_id = parts.next()?.parse().ok()?;
    let issued_at = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some(WipeTap {
        button,
        conversation_id,
        issued_at,
    })
}

pub fn is_expired(issued_at: i64, now: i64) -> bool {
    now - issued_at > CONFIRM_TTL_SECS || issued_at > now + 60
}

/// The two buttons under a confirmation, one per row.
pub fn buttons(kind: WipeKind, conversation_id: i64, issued_at: i64) -> Vec<Vec<(String, String)>> {
    let yes = match kind {
        WipeKind::New => "🧹 Yes, wipe the chat",
        WipeKind::Forget => "🧹 Yes, wipe everything",
    };
    vec![
        vec![(
            yes.to_string(),
            button_data(WipeButton::Confirm(kind), conversation_id, issued_at),
        )],
        vec![(
            "Cancel".to_string(),
            button_data(WipeButton::Cancel, conversation_id, issued_at),
        )],
    ]
}

pub fn prompt(kind: WipeKind, place: &str, messages: i64) -> String {
    match kind {
        WipeKind::New => format!(
            "🧹 Start {place} fresh?\n\nThis deletes its T3 threads and the {messages} stored messages. \
             Its purpose and AGENTS.md stay, so the same agent picks up with a clean slate."
        ),
        WipeKind::Forget => format!(
            "⚠️ Forget {place} completely?\n\nThis deletes its T3 threads, the {messages} stored messages \
             and its purpose. Next time you write here, it asks what it should be."
        ),
    }
}

pub fn done(kind: WipeKind, wiped: Wiped) -> String {
    match kind {
        WipeKind::New => format!(
            "🆕 Clean slate. Deleted {} T3 thread(s) and {} messages. \
             The purpose stays, so your next message starts fresh with the same agent.",
            wiped.threads, wiped.messages
        ),
        WipeKind::Forget => format!(
            "🧹 Forgotten. Deleted {} T3 thread(s) and {} messages, and cleared the purpose. \
             Say anything here to set it up again.",
            wiped.threads, wiped.messages
        ),
    }
}

pub const CANCELLED: &str = "Cancelled. Nothing was deleted.";
pub const EXPIRED_TOAST: &str = "This confirmation expired. Send the command again.";
pub const WRONG_PLACE_TOAST: &str = "That confirmation belongs to another topic.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_data_round_trips_and_fits_telegram() {
        for button in [
            WipeButton::Confirm(WipeKind::New),
            WipeButton::Confirm(WipeKind::Forget),
            WipeButton::Cancel,
        ] {
            let data = button_data(button, 1234567, 1762600000);
            assert!(data.len() <= 64, "{data}");
            assert_eq!(
                parse(&data),
                Some(WipeTap {
                    button,
                    conversation_id: 1234567,
                    issued_at: 1762600000
                })
            );
        }
    }

    #[test]
    fn foreign_or_broken_data_is_not_a_wipe() {
        for bad in [
            "wipe:new:1",
            "wipe:delete:1:2",
            "wipe:new:x:2",
            "wipe:new:1:2:3",
            "ans:1:0",
            "",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn confirmations_expire_after_ten_minutes() {
        let now = 1_762_600_000;
        assert!(!is_expired(now - 599, now));
        assert!(is_expired(now - 601, now));
        assert!(is_expired(now + 3600, now), "from the future");
    }

    #[test]
    fn texts_say_what_goes_and_what_stays() {
        let new = prompt(WipeKind::New, "HQ › Testing", 12);
        assert!(new.contains("12 stored messages") && new.contains("purpose and AGENTS.md stay"));
        let forget = prompt(WipeKind::Forget, "HQ › Testing", 12);
        assert!(forget.contains("and its purpose"));
        let rows = buttons(WipeKind::New, 7, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][0].0, "Cancel");
    }
}
