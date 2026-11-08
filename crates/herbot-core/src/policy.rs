//! Who Herbot listens to, and where. Pure: decides an action, never performs it.
//!
//! Enforced here in code:
//! - Herbot works only in groups. Direct messages get total silence.
//! - With a home group configured (`HERBOT_HOME_CHAT_ID`), it works only
//!   there and leaves any other group, even one the admin added it to.
//! - Only the admin's Telegram account is ever stored or answered. Everyone
//!   else gets silence, and a group added by anyone else is left.

use crate::telegram::{ButtonPress, ChatKind, ChatRef, Command, Inbound, InboundMessage};

/// The fixed rules, from the server environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rules {
    pub admin_user_id: u64,
    /// The one group Herbot works in. `None` allows any group the admin adds it to.
    pub home_chat_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Drop silently. `reason` is for logs only.
    Ignore { reason: &'static str },
    /// Leave this chat right away. `reason` is the audit-log action.
    Leave {
        chat: ChatRef,
        added_by: u64,
        reason: &'static str,
    },
    /// The admin added the bot to a chat: remember it as active.
    RegisterChat { chat: ChatRef, added_by: u64 },
    /// The bot was removed from a chat.
    MarkLeft { chat: ChatRef },
    /// A message from the admin: store it under its conversation.
    Store(InboundMessage),
    /// A slash command from the admin.
    RunCommand(InboundMessage, Command),
    /// A forum topic was created in a chat: name its conversation.
    NameTopic {
        chat: ChatRef,
        topic_id: i32,
        name: String,
    },
    /// A chat's title changed.
    RenameChat { chat: ChatRef, title: String },
    /// The admin tapped one of the bot's inline buttons.
    Button(ButtonPress),
}

pub const LEFT_ADDED_BY_STRANGER: &str = "left_chat_added_by_stranger";
pub const LEFT_OUTSIDE_HOME: &str = "left_chat_outside_home_group";

pub fn decide(inbound: Inbound, rules: &Rules) -> Action {
    // Where first: no DMs, and nothing outside the home group.
    let chat = inbound.chat();
    if chat.kind == ChatKind::Private {
        return Action::Ignore {
            reason: "direct messages are off; Herbot works only in its group",
        };
    }
    if let Some(home) = rules.home_chat_id
        && chat.tg_chat_id != home
    {
        return match inbound {
            Inbound::AddedToChat { chat, by_user_id } => Action::Leave {
                chat,
                added_by: by_user_id,
                reason: LEFT_OUTSIDE_HOME,
            },
            _ => Action::Ignore {
                reason: "outside the home group",
            },
        };
    }

    // Then who.
    let admin = rules.admin_user_id;
    match inbound {
        Inbound::Message(msg) => {
            if msg.from_is_bot {
                return Action::Ignore {
                    reason: "message from a bot",
                };
            }
            if msg.from_user_id != admin {
                return Action::Ignore {
                    reason: "message from someone other than the admin",
                };
            }
            match msg.command.clone() {
                Some(cmd) => Action::RunCommand(msg, cmd),
                None if msg.text.trim().is_empty() && msg.voice.is_none() => Action::Ignore {
                    reason: "empty message",
                },
                None => Action::Store(msg),
            }
        }
        Inbound::AddedToChat { chat, by_user_id } => {
            if by_user_id == admin {
                Action::RegisterChat {
                    chat,
                    added_by: by_user_id,
                }
            } else {
                Action::Leave {
                    chat,
                    added_by: by_user_id,
                    reason: LEFT_ADDED_BY_STRANGER,
                }
            }
        }
        Inbound::RemovedFromChat { chat, .. } => Action::MarkLeft { chat },
        Inbound::TopicCreated {
            chat,
            topic_id,
            name,
            ..
        } => Action::NameTopic {
            chat,
            topic_id,
            name,
        },
        Inbound::ChatRenamed { chat, title, .. } => Action::RenameChat { chat, title },
        Inbound::ButtonPressed(press) => {
            if press.from_user_id == admin {
                Action::Button(press)
            } else {
                Action::Ignore {
                    reason: "button pressed by someone other than the admin",
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    const ADMIN: u64 = 111;
    const STRANGER: u64 = 222;
    const HOME: i64 = -1001;
    const OTHER: i64 = -2002;

    fn open() -> Rules {
        Rules {
            admin_user_id: ADMIN,
            home_chat_id: None,
        }
    }
    fn locked() -> Rules {
        Rules {
            admin_user_id: ADMIN,
            home_chat_id: Some(HOME),
        }
    }

    fn group(id: i64) -> ChatRef {
        ChatRef {
            tg_chat_id: id,
            kind: ChatKind::Supergroup,
            title: "HQ".into(),
            is_forum: true,
        }
    }
    fn dm(id: i64) -> ChatRef {
        ChatRef {
            tg_chat_id: id,
            kind: ChatKind::Private,
            title: "Ashrith".into(),
            is_forum: false,
        }
    }

    fn msg_in(chat: ChatRef, from: u64, text: &str, command: Option<Command>) -> InboundMessage {
        InboundMessage {
            chat,
            topic_id: Some(7),
            message_id: 1,
            from_user_id: from,
            from_name: "Ashrith".into(),
            from_is_bot: false,
            text: text.into(),
            voice: None,
            reply_to_message_id: None,
            sent_at: Utc::now(),
            command,
        }
    }
    fn msg(from: u64, text: &str, command: Option<Command>) -> InboundMessage {
        msg_in(group(HOME), from, text, command)
    }

    fn is_ignore(a: &Action) -> bool {
        matches!(a, Action::Ignore { .. })
    }

    #[test]
    fn admin_messages_in_the_group_are_stored() {
        let m = msg(ADMIN, "hello", None);
        for rules in [open(), locked()] {
            assert_eq!(
                decide(Inbound::Message(m.clone()), &rules),
                Action::Store(m.clone())
            );
        }
    }

    #[test]
    fn admin_commands_run_in_the_group() {
        let m = msg(ADMIN, "/status", Some(Command::Status));
        assert_eq!(
            decide(Inbound::Message(m.clone()), &locked()),
            Action::RunCommand(m, Command::Status)
        );
    }

    #[test]
    fn direct_messages_are_silent_even_from_the_admin() {
        for rules in [open(), locked()] {
            for m in [
                msg_in(dm(ADMIN as i64), ADMIN, "hi", None),
                msg_in(dm(ADMIN as i64), ADMIN, "/start", Some(Command::Start)),
                msg_in(dm(ADMIN as i64), ADMIN, "/status", Some(Command::Status)),
            ] {
                assert!(is_ignore(&decide(Inbound::Message(m), &rules)));
            }
            let start = Inbound::AddedToChat {
                chat: dm(ADMIN as i64),
                by_user_id: ADMIN,
            };
            assert!(
                is_ignore(&decide(start, &rules)),
                "starting a DM does nothing"
            );
        }
    }

    #[test]
    fn with_a_home_group_other_groups_are_ignored_and_left() {
        let elsewhere = msg_in(group(OTHER), ADMIN, "hi", None);
        assert!(is_ignore(&decide(
            Inbound::Message(elsewhere.clone()),
            &locked()
        )));
        assert_eq!(
            decide(Inbound::Message(elsewhere.clone()), &open()),
            Action::Store(elsewhere)
        );

        let added = Inbound::AddedToChat {
            chat: group(OTHER),
            by_user_id: ADMIN,
        };
        assert_eq!(
            decide(added, &locked()),
            Action::Leave {
                chat: group(OTHER),
                added_by: ADMIN,
                reason: LEFT_OUTSIDE_HOME
            }
        );
    }

    #[test]
    fn everyone_else_is_ignored_even_with_commands() {
        for m in [
            msg(STRANGER, "hello", None),
            msg(
                STRANGER,
                "/forget",
                Some(Command::Forget { confirmed: false }),
            ),
        ] {
            assert!(is_ignore(&decide(Inbound::Message(m), &locked())));
        }
    }

    #[test]
    fn bots_are_ignored_even_if_their_id_matches() {
        let mut m = msg(ADMIN, "hi", None);
        m.from_is_bot = true;
        assert!(is_ignore(&decide(Inbound::Message(m), &locked())));
    }

    #[test]
    fn admin_voice_notes_are_stored_even_without_text() {
        let mut m = msg(ADMIN, "", None);
        m.voice = Some(crate::telegram::VoiceNote {
            file_id: "AwAC".into(),
            duration_secs: 4,
        });
        assert_eq!(
            decide(Inbound::Message(m.clone()), &locked()),
            Action::Store(m)
        );
    }

    #[test]
    fn blank_admin_messages_are_ignored() {
        assert!(is_ignore(&decide(
            Inbound::Message(msg(ADMIN, "   ", None)),
            &locked()
        )));
    }

    #[test]
    fn the_home_group_added_by_admin_is_registered_and_by_others_is_left() {
        let added = |by| Inbound::AddedToChat {
            chat: group(HOME),
            by_user_id: by,
        };
        assert_eq!(
            decide(added(ADMIN), &locked()),
            Action::RegisterChat {
                chat: group(HOME),
                added_by: ADMIN
            }
        );
        assert_eq!(
            decide(added(STRANGER), &locked()),
            Action::Leave {
                chat: group(HOME),
                added_by: STRANGER,
                reason: LEFT_ADDED_BY_STRANGER
            }
        );
    }

    #[test]
    fn only_the_admin_can_press_buttons() {
        let press = |from| ButtonPress {
            chat: group(HOME),
            topic_id: Some(7),
            message_id: 50,
            from_user_id: from,
            from_name: "Ashrith".into(),
            data: "setup:research".into(),
            callback_id: "cb".into(),
        };
        assert_eq!(
            decide(Inbound::ButtonPressed(press(ADMIN)), &locked()),
            Action::Button(press(ADMIN))
        );
        assert!(is_ignore(&decide(
            Inbound::ButtonPressed(press(STRANGER)),
            &locked()
        )));
    }

    #[test]
    fn removal_marks_left_whoever_did_it() {
        assert_eq!(
            decide(
                Inbound::RemovedFromChat {
                    chat: group(HOME),
                    by_user_id: STRANGER
                },
                &locked()
            ),
            Action::MarkLeft { chat: group(HOME) }
        );
    }
}
