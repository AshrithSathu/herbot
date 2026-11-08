//! herbot-core: the always-on heart of Herbot, a private Telegram bot.
//!
//! - `telegram`: Bot API updates to Herbot events (pure)
//! - `policy`: admin-only decisions (pure)
//! - `setup`: "what should I be here?" presets and texts (pure)
//! - `store`: chats, conversations, messages
//! - `poller`: long-polling and carrying out decisions
//! - `app`: `/health` and `/ready`

pub mod app;
pub mod config;
pub mod db;
pub mod errors;
pub mod policy;
pub mod poller;
pub mod setup;
pub mod store;
pub mod telegram;
pub mod telemetry;
