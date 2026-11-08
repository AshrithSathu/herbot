//! Who Herbot listens to. Pure: decides an action, never performs it.
//!
//! The rule is simple and enforced here in code: only the admin's Telegram
//! account is ever stored or answered. Everyone else gets silence, and any
//! group the bot is added to by someone else is left.

use crate::telegram::{ChatRef, Command, Inbound, InboundMessage};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Drop silently. `reason` is for logs only.
    Ignore { reason: &'static str },
    /// Leave this chat right away (someone else added the bot).
    Leave { chat: ChatRef, added_by: u64 },
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
}

pub fn decide(inbound: Inbound, admin_user_id: u64) -> Action {
    match inbound {
        Inbound::Message(msg) => {
            if msg.from_is_bot {
                return Action::Ignore {
                    reason: "message from a bot",
                };
            }
            if msg.from_user_id != admin_user_id {
                return Action::Ignore {
                    reason: "message from someone other than the admin",
                };
            }
            match msg.command.clone() {
                Some(cmd) => Action::RunCommand(msg, cmd),
                None if msg.text.trim().is_empty() => Action::Ignore {
                    reason: "empty message",
                },
                None => Action::Store(msg),
            }
        }
        Inbound::AddedToChat { chat, by_user_id } => {
            if by_user_id == admin_user_id {
                Action::RegisterChat {
                    chat,
                    added_by: by_user_id,
                }
            } else {
                Action::Leave {
                    chat,
                    added_by: by_user_id,
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telegram::ChatKind;
    use chrono::Utc;

    const ADMIN: u64 = 111;
    const STRANGER: u64 = 222;

    fn chat() -> ChatRef {
        ChatRef {
            tg_chat_id: -1001,
            kind: ChatKind::Supergroup,
            title: "HQ".into(),
            is_forum: true,
        }
    }

    fn msg(from: u64, text: &str, command: Option<Command>) -> InboundMessage {
        InboundMessage {
            chat: chat(),
            topic_id: Some(7),
            message_id: 1,
            from_user_id: from,
            from_is_bot: false,
            text: text.into(),
            reply_to_message_id: None,
            sent_at: Utc::now(),
            command,
        }
    }

    #[test]
    fn admin_messages_are_stored() {
        let m = msg(ADMIN, "hello", None);
        assert_eq!(decide(Inbound::Message(m.clone()), ADMIN), Action::Store(m));
    }

    #[test]
    fn admin_commands_run() {
        let m = msg(ADMIN, "/status", Some(Command::Status));
        assert_eq!(
            decide(Inbound::Message(m.clone()), ADMIN),
            Action::RunCommand(m, Command::Status)
        );
    }

    #[test]
    fn everyone_else_is_ignored_even_with_commands() {
        for m in [
            msg(STRANGER, "hello", None),
            msg(STRANGER, "/forget", Some(Command::Forget)),
        ] {
            assert!(matches!(
                decide(Inbound::Message(m), ADMIN),
                Action::Ignore { .. }
            ));
        }
    }

    #[test]
    fn bots_are_ignored_even_if_their_id_matches() {
        let mut m = msg(ADMIN, "hi", None);
        m.from_is_bot = true;
        assert!(matches!(
            decide(Inbound::Message(m), ADMIN),
            Action::Ignore { .. }
        ));
    }

    #[test]
    fn blank_admin_messages_are_ignored() {
        assert!(matches!(
            decide(Inbound::Message(msg(ADMIN, "   ", None)), ADMIN),
            Action::Ignore { .. }
        ));
    }

    #[test]
    fn groups_added_by_admin_are_registered_and_others_are_left() {
        assert_eq!(
            decide(
                Inbound::AddedToChat {
                    chat: chat(),
                    by_user_id: ADMIN
                },
                ADMIN
            ),
            Action::RegisterChat {
                chat: chat(),
                added_by: ADMIN
            }
        );
        assert_eq!(
            decide(
                Inbound::AddedToChat {
                    chat: chat(),
                    by_user_id: STRANGER
                },
                ADMIN
            ),
            Action::Leave {
                chat: chat(),
                added_by: STRANGER
            }
        );
    }

    #[test]
    fn removal_marks_left_whoever_did_it() {
        assert_eq!(
            decide(
                Inbound::RemovedFromChat {
                    chat: chat(),
                    by_user_id: STRANGER
                },
                ADMIN
            ),
            Action::MarkLeft { chat: chat() }
        );
    }
}
