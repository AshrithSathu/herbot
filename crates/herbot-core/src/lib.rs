//! herbot-core: the always-on heart of Herbot, a private Telegram bot.
//!
//! - `telegram`: Bot API updates to Herbot events (pure)
//! - `policy`: admin-only decisions (pure)
//! - `setup`: "what should I be here?" texts (pure)
//! - `store`: chats, conversations, messages
//! - `poller`: long-polling and carrying out decisions
//! - `voice`: voice notes to English text (OpenAI)
//! - `agents_md`: each conversation's AGENTS.md
//! - `turns`, `agent`: per-conversation lanes running T3 Code threads
//! - `meta`, `outgoing`: the agent's header; scrubbing and splitting replies
//! - `hub`: what agents can see and do through herbot-mcp (permission rules)
//! - `internal`: the API herbot-mcp calls for General's post/ask actions
//! - `admin`: the admin panel's API
//! - `app`: `/health` and `/ready`

pub mod admin;
pub mod agent;
pub mod agents_md;
pub mod app;
pub mod config;
pub mod db;
pub mod errors;
pub mod format;
pub mod hub;
pub mod inbound_files;
pub mod internal;
pub mod media;
pub mod meta;
pub mod modes;
pub mod outbound_files;
pub mod outgoing;
pub mod policy;
pub mod poller;
pub mod setup;
pub mod simulate;
pub mod store;
pub mod telegram;
pub mod telemetry;
pub mod turns;
pub mod voice;
pub mod wipe;
