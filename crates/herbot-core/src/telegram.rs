//! Turns raw Telegram Bot API updates into Herbot's own small event types.
//!
//! Pure functions only: no network, no database. Everything here is tested
//! with real Bot API JSON fixtures.

use chrono::{DateTime, Utc};
use teloxide::types::{
    CallbackQuery, Chat, ChatKind as TgChatKind, ChatMemberUpdated, Message, PublicChatKind,
    Update, UpdateKind,
};

/// The kinds of chat Herbot works in. Channels are ignored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatKind {
    Private,
    Group,
    Supergroup,
}

impl ChatKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatKind::Private => "private",
            ChatKind::Group => "group",
            ChatKind::Supergroup => "supergroup",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatRef {
    pub tg_chat_id: i64,
    pub kind: ChatKind,
    /// Group title, or the user's name for a private chat.
    pub title: String,
    pub is_forum: bool,
}

/// Slash commands the bot understands. Anything else starting with `/` is
/// `Unknown` so the bot can say it doesn't know it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Start,
    Voice(String),
    Speak,
    Persona,
    Help,
    Status,
    Memory,
    Customize(String),
    AboutMe(String),
    Tasks,
    Retry,
    Export,
    Search(String),
    Private(String),
    Setup,
    /// `/new` asks first; `/new yes` wipes this topic's chat.
    New {
        confirmed: bool,
    },
    /// `/forget` asks first; `/forget yes` does it.
    Forget {
        confirmed: bool,
    },
    /// `/mode` shows the topic's mode with buttons; `/mode fast` sets it.
    Mode(String),
    /// `/fast`, `/think`, `/heavy`, `/deepsearch` + a question: one message
    /// in that mode.
    Styled {
        style: crate::modes::Style,
        question: String,
    },
    Unknown(String),
}

/// All commands shown in Telegram's `/` menu, with descriptions.
pub const COMMAND_MENU: &[(&str, &str)] = &[
    ("mode", "Fast, Auto, Expert or Heavy for this topic"),
    (
        "deepsearch",
        "Research a question across the web, with sources",
    ),
    ("think", "Answer one question thinking carefully"),
    ("imagine", "Generate or edit an image"),
    ("video", "Generate a video"),
    ("voice", "Spoken replies and voice picker"),
    ("speak", "Read a replied-to bot message aloud"),
    ("retry", "Answer your last message again"),
    ("search", "Search history: /search words"),
    ("summary", "Summarise recent history or a replied message"),
    ("tasks", "Scheduled and recurring prompts in this topic"),
    ("memory", "View and forget shared memories"),
    ("customize", "How you want every answer"),
    ("aboutme", "What Herbot should know about you"),
    ("persona", "Pick a persona: purpose and voice"),
    ("sticker", "Make a sticker from a replied photo or prompt"),
    ("export", "Download this conversation as Markdown and HTML"),
    (
        "private",
        "Stop or resume storing this topic: /private on|off",
    ),
    ("fast", "A quick answer to one question"),
    ("heavy", "Answer one question with several sub-agents"),
    ("status", "Show this conversation's details"),
    ("setup", "Set what this conversation is for"),
    (
        "new",
        "Wipe this topic's chat and start fresh (keeps its purpose)",
    ),
    ("forget", "Wipe this topic completely, purpose included"),
    ("help", "List commands"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    pub chat: ChatRef,
    /// Forum topic ID. `None` for DMs, non-forum groups and the General topic.
    pub topic_id: Option<i32>,
    pub message_id: i32,
    pub from_user_id: u64,
    /// Sender's first name, for the agent's `<herbot-meta>` header.
    pub from_name: String,
    pub from_is_bot: bool,
    /// Text, or a photo/document/voice caption. For a voice note without a
    /// caption this starts empty and the poller fills in the transcript.
    pub text: String,
    /// Set for voice notes.
    pub voice: Option<VoiceNote>,
    /// A photo, document, video, audio file, GIF or sticker sent with it.
    pub attachment: Option<Attachment>,
    /// Where that attachment was saved, once the poller has downloaded it.
    pub files: Vec<crate::media::SavedFile>,
    /// Set for each photo or file of an album (several sent at once).
    pub media_group_id: Option<String>,
    pub replied_bot_text: Option<String>,
    pub reply_to_message_id: Option<i32>,
    pub sent_at: DateTime<Utc>,
    /// Set when the text is a slash command addressed to this bot.
    pub command: Option<Command>,
}

/// A file that came with a message (voice notes are [`VoiceNote`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub kind: AttachmentKind,
    /// Telegram file ID, used to download it.
    pub file_id: String,
    pub file_name: Option<String>,
    pub mime: Option<String>,
    /// Bytes, when Telegram says (bots can download up to 20 MB).
    pub size: Option<u32>,
    pub duration_secs: Option<u32>,
    /// A sticker's emoji.
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Photo,
    Document,
    Video,
    /// A round video message.
    VideoNote,
    Audio,
    /// A GIF (Telegram sends it as a silent MP4).
    Animation,
    Sticker,
}

impl AttachmentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AttachmentKind::Photo => "photo",
            AttachmentKind::Document => "document",
            AttachmentKind::Video => "video",
            AttachmentKind::VideoNote => "video note",
            AttachmentKind::Audio => "audio",
            AttachmentKind::Animation => "GIF",
            AttachmentKind::Sticker => "sticker",
        }
    }
}

fn attachment_of(msg: &Message) -> Option<Attachment> {
    let base = |kind, file: &teloxide::types::FileMeta| Attachment {
        kind,
        file_id: file.id.0.clone(),
        file_name: None,
        mime: None,
        size: Some(file.size),
        duration_secs: None,
        emoji: None,
    };
    if let Some(sizes) = msg.photo() {
        // Sizes come smallest first; the last is the full photo.
        let largest = sizes.last()?;
        return Some(Attachment {
            mime: Some("image/jpeg".into()),
            ..base(AttachmentKind::Photo, &largest.file)
        });
    }
    if let Some(d) = msg.document() {
        return Some(Attachment {
            file_name: d.file_name.clone(),
            mime: d.mime_type.as_ref().map(|m| m.to_string()),
            ..base(AttachmentKind::Document, &d.file)
        });
    }
    if let Some(v) = msg.video() {
        return Some(Attachment {
            file_name: v.file_name.clone(),
            mime: v.mime_type.as_ref().map(|m| m.to_string()),
            duration_secs: Some(v.duration.seconds()),
            ..base(AttachmentKind::Video, &v.file)
        });
    }
    if let Some(v) = msg.video_note() {
        return Some(Attachment {
            mime: Some("video/mp4".into()),
            duration_secs: Some(v.duration.seconds()),
            ..base(AttachmentKind::VideoNote, &v.file)
        });
    }
    if let Some(a) = msg.audio() {
        return Some(Attachment {
            file_name: a.file_name.clone(),
            mime: a.mime_type.as_ref().map(|m| m.to_string()),
            duration_secs: Some(a.duration.seconds()),
            ..base(AttachmentKind::Audio, &a.file)
        });
    }
    if let Some(a) = msg.animation() {
        return Some(Attachment {
            file_name: a.file_name.clone(),
            mime: a.mime_type.as_ref().map(|m| m.to_string()),
            duration_secs: Some(a.duration.seconds()),
            ..base(AttachmentKind::Animation, &a.file)
        });
    }
    if let Some(s) = msg.sticker() {
        return Some(Attachment {
            emoji: s.emoji.clone(),
            mime: Some(
                if s.is_video() {
                    "video/webm"
                } else if s.is_animated() {
                    "application/x-tgsticker"
                } else {
                    "image/webp"
                }
                .into(),
            ),
            ..base(AttachmentKind::Sticker, &s.file)
        });
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceNote {
    /// Telegram file ID, used to download the audio.
    pub file_id: String,
    pub duration_secs: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)] // one per update, never stored in bulk
pub enum Inbound {
    Message(InboundMessage),
    Edited(InboundMessage),
    Reaction {
        chat: ChatRef,
        message_id: i32,
        user_id: u64,
        reactions: serde_json::Value,
    },
    /// The bot was added to a group (or unblocked in a private chat).
    AddedToChat {
        chat: ChatRef,
        by_user_id: u64,
    },
    /// The bot was removed from a group (or blocked in a private chat).
    RemovedFromChat {
        chat: ChatRef,
        by_user_id: u64,
    },
    /// A forum topic was created; gives the conversation a readable name.
    TopicCreated {
        chat: ChatRef,
        topic_id: i32,
        name: String,
        by_user_id: Option<u64>,
    },
    /// The group's title changed.
    ChatRenamed {
        chat: ChatRef,
        title: String,
        by_user_id: Option<u64>,
    },
    /// An inline button under one of the bot's messages was tapped.
    ButtonPressed(ButtonPress),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ButtonPress {
    pub chat: ChatRef,
    pub topic_id: Option<i32>,
    /// The bot message the button belongs to.
    pub message_id: i32,
    pub from_user_id: u64,
    pub from_name: String,
    pub data: String,
    /// Must be answered so Telegram stops the button's loading spinner.
    pub callback_id: String,
}

impl Inbound {
    /// The chat this event happened in.
    pub fn chat(&self) -> &ChatRef {
        match self {
            Inbound::Message(m) | Inbound::Edited(m) => &m.chat,
            Inbound::Reaction { chat, .. } => chat,
            Inbound::AddedToChat { chat, .. }
            | Inbound::RemovedFromChat { chat, .. }
            | Inbound::TopicCreated { chat, .. }
            | Inbound::ChatRenamed { chat, .. } => chat,
            Inbound::ButtonPressed(press) => &press.chat,
        }
    }
}

/// Converts one update. Returns `None` for updates Herbot doesn't care about
/// (channels, edits, polls, other bots' commands, ...).
pub fn normalize(update: &Update, bot_username: &str) -> Option<Inbound> {
    match &update.kind {
        UpdateKind::Message(msg) => normalize_message(msg, bot_username),
        UpdateKind::EditedMessage(msg) => match normalize_message(msg, bot_username)? {
            Inbound::Message(m) if m.command.is_none() && !m.text.starts_with('/') => {
                Some(Inbound::Edited(m))
            }
            _ => None,
        },
        UpdateKind::MessageReaction(r) => Some(Inbound::Reaction {
            chat: chat_ref(&r.chat)?,
            message_id: r.message_id.0,
            user_id: r.user()?.id.0,
            reactions: serde_json::to_value(&r.new_reaction).ok()?,
        }),
        UpdateKind::MyChatMember(change) => normalize_membership(change),
        UpdateKind::CallbackQuery(query) => normalize_callback(query),
        _ => None,
    }
}

fn normalize_callback(query: &CallbackQuery) -> Option<Inbound> {
    let message = query.message.as_ref()?;
    let chat = chat_ref(message.chat())?;
    let topic_id = message.regular_message().and_then(topic_id);
    Some(Inbound::ButtonPressed(ButtonPress {
        chat,
        topic_id,
        message_id: message.id().0,
        from_user_id: query.from.id.0,
        from_name: query.from.first_name.clone(),
        data: query.data.clone()?,
        callback_id: query.id.0.clone(),
    }))
}

fn chat_ref(chat: &Chat) -> Option<ChatRef> {
    let kind = if chat.is_private() {
        ChatKind::Private
    } else if chat.is_group() {
        ChatKind::Group
    } else if chat.is_supergroup() {
        ChatKind::Supergroup
    } else {
        return None; // channels
    };
    let title = match chat.title() {
        Some(t) => t.to_string(),
        None => [chat.first_name(), chat.last_name()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" "),
    };
    Some(ChatRef {
        tg_chat_id: chat.id.0,
        kind,
        title,
        is_forum: is_forum(chat),
    })
}

fn is_forum(chat: &Chat) -> bool {
    match &chat.kind {
        TgChatKind::Public(public) => match &public.kind {
            PublicChatKind::Supergroup(sg) => sg.is_forum,
            _ => false,
        },
        TgChatKind::Private(_) => false,
    }
}

fn topic_id(msg: &Message) -> Option<i32> {
    if msg.is_topic_message {
        msg.thread_id.map(|t| t.0.0)
    } else {
        None
    }
}

fn normalize_message(msg: &Message, bot_username: &str) -> Option<Inbound> {
    let chat = chat_ref(&msg.chat)?;
    let from = msg.from.as_ref();

    if let Some(created) = msg.forum_topic_created() {
        return Some(Inbound::TopicCreated {
            chat,
            topic_id: msg.thread_id.map(|t| t.0.0)?,
            name: created.name.clone(),
            by_user_id: from.map(|u| u.id.0),
        });
    }
    if let Some(title) = msg.new_chat_title() {
        return Some(Inbound::ChatRenamed {
            chat,
            title: title.to_string(),
            by_user_id: from.map(|u| u.id.0),
        });
    }

    // Anything else needs a sender and words, a voice note or a file.
    let from = from?;
    let voice = msg.voice().map(|v| VoiceNote {
        file_id: v.file.id.0.clone(),
        duration_secs: v.duration.seconds(),
    });
    let text = msg
        .text()
        .or_else(|| msg.caption())
        .unwrap_or_default()
        .to_string();
    let mut attachment = attachment_of(msg);
    if text.is_empty() && voice.is_none() && attachment.is_none() {
        return None; // polls, contacts, locations, ...
    }
    let command = match parse_command(&text, bot_username) {
        CommandParse::NotACommand => None,
        CommandParse::ForThisBot(cmd) => Some(cmd),
        // `/start@other_bot`: not for us, don't treat it as a message either.
        CommandParse::ForAnotherBot => return None,
    };

    // In forum topics Telegram marks every message as a reply to the topic's
    // root message. That isn't a real reply, so drop it.
    let topic = topic_id(msg);
    let reply_to_message_id = msg
        .reply_to_message()
        .map(|m| m.id.0)
        .filter(|id| Some(*id) != topic);

    let mut text = text;
    if let Some(Command::Styled { style, .. }) = &command
        && matches!(
            style,
            crate::modes::Style::Sticker
                | crate::modes::Style::Summary
                | crate::modes::Style::Imagine
                | crate::modes::Style::Video
        )
        && let Some(replied) = msg.reply_to_message().filter(|r| {
            Some(r.id.0) != topic
                && topic_id(r) == topic
                && r.from.as_ref().is_some_and(|sender| {
                    sender.id == from.id
                        || (sender.is_bot
                            && sender
                                .username
                                .as_deref()
                                .is_some_and(|name| name.eq_ignore_ascii_case(bot_username)))
                })
        })
    {
        attachment = attachment.or_else(|| attachment_of(replied));
        if *style == crate::modes::Style::Summary {
            text.push_str("\n\n[Quoted source to summarise]\n");
            text.push_str(replied.text().or_else(|| replied.caption()).unwrap_or(""));
        }
    }
    Some(Inbound::Message(InboundMessage {
        chat,
        topic_id: topic,
        message_id: msg.id.0,
        from_user_id: from.id.0,
        from_name: from.first_name.clone(),
        from_is_bot: from.is_bot,
        text,
        voice,
        attachment,
        files: Vec::new(),
        media_group_id: msg.media_group_id().map(|g| g.0.clone()),
        replied_bot_text: msg
            .reply_to_message()
            .filter(|m| Some(m.id.0) != topic)
            .filter(|m| {
                m.from.as_ref().is_some_and(|u| {
                    u.is_bot
                        && u.username
                            .as_deref()
                            .is_some_and(|n| n.eq_ignore_ascii_case(bot_username))
                })
            })
            .and_then(|m| m.text().or_else(|| m.caption()))
            .map(str::to_owned),
        reply_to_message_id,
        sent_at: msg.date,
        command,
    }))
}

fn normalize_membership(change: &ChatMemberUpdated) -> Option<Inbound> {
    let chat = chat_ref(&change.chat)?;
    let was_in = change.old_chat_member.is_present();
    let is_in = change.new_chat_member.is_present();
    let by_user_id = change.from.id.0;
    match (was_in, is_in) {
        (false, true) => Some(Inbound::AddedToChat { chat, by_user_id }),
        (true, false) => Some(Inbound::RemovedFromChat { chat, by_user_id }),
        _ => None, // promoted, restricted, ... nothing Herbot acts on
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CommandParse {
    NotACommand,
    ForThisBot(Command),
    ForAnotherBot,
}

/// `/new yes` or `/forget yes`: the word after the command is "yes".
fn confirmed_with_yes(rest: &str) -> bool {
    rest.split_whitespace()
        .nth(1)
        .is_some_and(|arg| arg.eq_ignore_ascii_case("yes"))
}

/// Parses `/cmd`, `/cmd args` and `/cmd@botname args`. The `@botname` part
/// must match this bot (case-insensitive) or the command belongs to another bot.
/// Everything after the command word (`/think why?` → `why?`).
fn args(rest: &str, word: &str) -> String {
    rest[word.len()..].trim().to_string()
}

fn parse_command(text: &str, bot_username: &str) -> CommandParse {
    let Some(rest) = text.strip_prefix('/') else {
        return CommandParse::NotACommand;
    };
    // The command word must touch the slash: "/ new" is not a command.
    let word = rest.split(char::is_whitespace).next().unwrap_or("");
    if word.is_empty() {
        return CommandParse::NotACommand;
    }
    let (name, target) = match word.split_once('@') {
        Some((name, target)) => (name, Some(target)),
        None => (word, None),
    };
    if let Some(target) = target
        && !target.eq_ignore_ascii_case(bot_username)
    {
        return CommandParse::ForAnotherBot;
    }
    let cmd = match name.to_ascii_lowercase().as_str() {
        "voice" => Command::Voice(
            rest.split_once(char::is_whitespace)
                .map(|(_, args)| args.trim().to_ascii_lowercase())
                .unwrap_or_default(),
        ),
        "speak" => Command::Speak,
        "persona" => Command::Persona,
        "start" => Command::Start,
        "help" => Command::Help,
        "tasks" => Command::Tasks,
        "status" => Command::Status,
        "memory" => Command::Memory,
        "customize" => Command::Customize(rest[word.len()..].trim().to_string()),
        "aboutme" => Command::AboutMe(rest[word.len()..].trim().to_string()),
        "retry" => Command::Retry,
        "export" => Command::Export,
        "search" => Command::Search(args(rest, word)),
        "private" => Command::Private(args(rest, word)),
        "setup" => Command::Setup,
        "new" => Command::New {
            confirmed: confirmed_with_yes(rest),
        },
        "forget" => Command::Forget {
            confirmed: confirmed_with_yes(rest),
        },
        "mode" => Command::Mode(args(rest, word)),
        "fast" | "think" | "heavy" | "deepsearch" | "deepersearch" | "research" | "video"
        | "imagine" | "sticker" | "summary" => {
            let style = match name.to_ascii_lowercase().as_str() {
                "video" => crate::modes::Style::Video,
                "imagine" => crate::modes::Style::Imagine,
                "sticker" => crate::modes::Style::Sticker,
                "summary" => crate::modes::Style::Summary,
                "fast" => crate::modes::Style::Fast,
                "think" => crate::modes::Style::Think,
                "heavy" => crate::modes::Style::Heavy,
                _ => crate::modes::Style::DeepSearch,
            };
            Command::Styled {
                style,
                question: args(rest, word),
            }
        }
        other => Command::Unknown(other.to_string()),
    };
    CommandParse::ForThisBot(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_commands_take_only_same_topic_trusted_reply_sources() {
        let mut value: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/admin_topic_reply.json")).unwrap();
        value["message"]["text"] = serde_json::json!("/summary");
        value["message"]["reply_to_message"]["text"] =
            serde_json::json!("A long decision to summarise");
        value["message"]["reply_to_message"]["is_topic_message"] = serde_json::json!(true);
        value["message"]["reply_to_message"]["message_thread_id"] = serde_json::json!(7);
        let get = |v: &serde_json::Value| {
            let update: Update = serde_json::from_str(&v.to_string()).unwrap();
            match normalize(&update, "herbot_test_bot").unwrap() {
                Inbound::Message(m) => m,
                _ => panic!("message"),
            }
        };
        assert!(get(&value).text.contains("A long decision"));
        value["message"]["reply_to_message"]["message_thread_id"] = serde_json::json!(8);
        assert!(!get(&value).text.contains("A long decision"));
        value["message"]["reply_to_message"]["message_thread_id"] = serde_json::json!(7);
        value["message"]["reply_to_message"]["from"]["id"] = serde_json::json!(222);
        assert!(!get(&value).text.contains("A long decision"));
    }

    #[test]
    fn parses_commands_for_this_bot() {
        let bot = "Herbot_Bot";
        for (command, style) in [
            ("video", crate::modes::Style::Video),
            ("imagine", crate::modes::Style::Imagine),
            ("sticker", crate::modes::Style::Sticker),
            ("summary", crate::modes::Style::Summary),
        ] {
            assert_eq!(
                parse_command(&format!("/{command}@{bot} hello"), bot),
                CommandParse::ForThisBot(Command::Styled {
                    style,
                    question: "hello".into()
                })
            );
            assert!(COMMAND_MENU.iter().any(|(name, _)| *name == command));
        }
        assert_eq!(
            parse_command("/new", bot),
            CommandParse::ForThisBot(Command::New { confirmed: false })
        );
        assert_eq!(
            parse_command("/new yes", bot),
            CommandParse::ForThisBot(Command::New { confirmed: true })
        );
        assert_eq!(
            parse_command("/forget@herbot_bot YES", bot),
            CommandParse::ForThisBot(Command::Forget { confirmed: true })
        );
        assert_eq!(
            parse_command("/new please", bot),
            CommandParse::ForThisBot(Command::New { confirmed: false }),
            "only an explicit yes confirms"
        );
        assert_eq!(
            parse_command("/status@herbot_bot", bot),
            CommandParse::ForThisBot(Command::Status)
        );
        assert_eq!(
            parse_command("/FORGET please", bot),
            CommandParse::ForThisBot(Command::Forget { confirmed: false })
        );
        assert_eq!(
            parse_command("/weather", bot),
            CommandParse::ForThisBot(Command::Unknown("weather".into()))
        );
    }

    #[test]
    fn ignores_non_commands_and_other_bots() {
        let bot = "herbot_bot";
        assert_eq!(parse_command("hello /new", bot), CommandParse::NotACommand);
        assert_eq!(parse_command("/", bot), CommandParse::NotACommand);
        assert_eq!(parse_command("/ space", bot), CommandParse::NotACommand);
        assert_eq!(
            parse_command("/start@other_bot", bot),
            CommandParse::ForAnotherBot
        );
    }

    #[test]
    fn command_menu_names_are_valid_telegram_commands() {
        for (name, description) in COMMAND_MENU {
            assert!(name.chars().all(|c| c.is_ascii_lowercase() || c == '_'));
            assert!(!description.is_empty() && description.len() <= 256);
        }
    }
}
