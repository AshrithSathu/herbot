//! herbot-core: the always-on heart of Herbot.
//!
//! Step 1 (foundation) provides config, Postgres + migrations, structured
//! logging, error IDs, and the `/health` + `/ready` endpoints. Later steps add
//! the router, per-group lanes, the T3 adapter and the admin API.

pub mod app;
pub mod config;
pub mod db;
pub mod errors;
pub mod telemetry;
