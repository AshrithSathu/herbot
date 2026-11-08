use std::net::SocketAddr;

/// Runtime configuration, read from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP server binds to (`HERBOT_BIND`).
    pub bind: SocketAddr,
    /// Postgres connection string (`DATABASE_URL`).
    pub database_url: String,
    /// Log output format (`HERBOT_LOG_FORMAT`: `json` or `pretty`).
    pub log_format: LogFormat,
    /// Telegram settings; `None` when `TELEGRAM_BOT_TOKEN` is unset or empty.
    pub telegram: Option<TelegramConfig>,
}

#[derive(Clone)]
pub struct TelegramConfig {
    /// Bot token from @BotFather (`TELEGRAM_BOT_TOKEN`).
    pub token: String,
    /// The only Telegram user the bot answers (`HERBOT_ADMIN_TELEGRAM_ID`).
    pub admin_user_id: u64,
    /// The one group Herbot works in (`HERBOT_HOME_CHAT_ID`). `None` allows
    /// any group the admin adds it to.
    pub home_chat_id: Option<i64>,
}

// Never print the token, even in debug output.
impl std::fmt::Debug for TelegramConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelegramConfig")
            .field("token", &"<redacted>")
            .field("admin_user_id", &self.admin_user_id)
            .field("home_chat_id", &self.home_chat_id)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Json,
    Pretty,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("DATABASE_URL is not set")]
    MissingDatabaseUrl,
    #[error("HERBOT_BIND {0:?} is not a valid socket address (expected e.g. 127.0.0.1:8787)")]
    InvalidBind(String),
    #[error("HERBOT_LOG_FORMAT {0:?} is not valid (expected `json` or `pretty`)")]
    InvalidLogFormat(String),
    #[error(
        "TELEGRAM_BOT_TOKEN is set but HERBOT_ADMIN_TELEGRAM_ID is not; the bot must know who its admin is"
    )]
    MissingAdminId,
    #[error(
        "HERBOT_ADMIN_TELEGRAM_ID {0:?} is not a Telegram user ID (expected a positive number)"
    )]
    InvalidAdminId(String),
    #[error(
        "HERBOT_HOME_CHAT_ID {0:?} is not a group chat ID (expected a negative number like -1004447072305)"
    )]
    InvalidHomeChatId(String),
}

pub const DEFAULT_BIND: &str = "127.0.0.1:8787";

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Builds a config from any key lookup, so tests don't touch the real env.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let database_url = get("DATABASE_URL")
            .filter(|v| !v.trim().is_empty())
            .ok_or(ConfigError::MissingDatabaseUrl)?;

        let bind_raw = get("HERBOT_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string());
        let bind = bind_raw
            .parse()
            .map_err(|_| ConfigError::InvalidBind(bind_raw.clone()))?;

        let log_format = match get("HERBOT_LOG_FORMAT").as_deref() {
            None | Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(other) => return Err(ConfigError::InvalidLogFormat(other.to_string())),
        };

        let telegram = match get("TELEGRAM_BOT_TOKEN").filter(|t| !t.trim().is_empty()) {
            None => None,
            Some(token) => {
                let raw = get("HERBOT_ADMIN_TELEGRAM_ID")
                    .filter(|v| !v.trim().is_empty())
                    .ok_or(ConfigError::MissingAdminId)?;
                let admin_user_id = raw
                    .trim()
                    .parse::<u64>()
                    .ok()
                    .filter(|id| *id > 0)
                    .ok_or_else(|| ConfigError::InvalidAdminId(raw.clone()))?;
                let home_chat_id = match get("HERBOT_HOME_CHAT_ID").filter(|v| !v.trim().is_empty())
                {
                    None => None,
                    Some(raw) => Some(
                        raw.trim()
                            .parse::<i64>()
                            .ok()
                            .filter(|id| *id < 0)
                            .ok_or_else(|| ConfigError::InvalidHomeChatId(raw.clone()))?,
                    ),
                };
                Some(TelegramConfig {
                    token: token.trim().to_string(),
                    admin_user_id,
                    home_chat_id,
                })
            }
        };

        Ok(Self {
            bind,
            database_url,
            log_format,
            telegram,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key| map.get(key).cloned()
    }

    #[test]
    fn defaults_apply_when_only_database_url_is_set() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://x")])).unwrap();
        assert_eq!(config.bind, DEFAULT_BIND.parse().unwrap());
        assert_eq!(config.log_format, LogFormat::Json);
        assert_eq!(config.database_url, "postgres://x");
    }

    #[test]
    fn missing_or_blank_database_url_is_an_error() {
        assert_eq!(
            Config::from_lookup(lookup(&[])).unwrap_err(),
            ConfigError::MissingDatabaseUrl
        );
        assert_eq!(
            Config::from_lookup(lookup(&[("DATABASE_URL", "  ")])).unwrap_err(),
            ConfigError::MissingDatabaseUrl
        );
    }

    #[test]
    fn invalid_bind_is_rejected() {
        let err = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("HERBOT_BIND", "not-an-address"),
        ]))
        .unwrap_err();
        assert_eq!(err, ConfigError::InvalidBind("not-an-address".into()));
    }

    #[test]
    fn log_format_parses_pretty_and_rejects_unknown() {
        let pretty = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("HERBOT_LOG_FORMAT", "pretty"),
        ]))
        .unwrap();
        assert_eq!(pretty.log_format, LogFormat::Pretty);

        let err = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("HERBOT_LOG_FORMAT", "yaml"),
        ]))
        .unwrap_err();
        assert_eq!(err, ConfigError::InvalidLogFormat("yaml".into()));
    }

    #[test]
    fn telegram_is_disabled_without_a_token() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("TELEGRAM_BOT_TOKEN", ""),
            ("HERBOT_ADMIN_TELEGRAM_ID", "123"),
        ]))
        .unwrap();
        assert!(config.telegram.is_none());
    }

    #[test]
    fn telegram_token_requires_a_valid_admin_id() {
        let base = [
            ("DATABASE_URL", "postgres://x"),
            ("TELEGRAM_BOT_TOKEN", "123:abc"),
        ];
        assert_eq!(
            Config::from_lookup(lookup(&base)).unwrap_err(),
            ConfigError::MissingAdminId
        );
        for bad in ["abc", "-5", "0"] {
            let mut pairs = base.to_vec();
            pairs.push(("HERBOT_ADMIN_TELEGRAM_ID", bad));
            assert_eq!(
                Config::from_lookup(lookup(&pairs)).unwrap_err(),
                ConfigError::InvalidAdminId(bad.into()),
            );
        }
        let mut pairs = base.to_vec();
        pairs.push(("HERBOT_ADMIN_TELEGRAM_ID", " 987654321 "));
        let telegram = Config::from_lookup(lookup(&pairs))
            .unwrap()
            .telegram
            .unwrap();
        assert_eq!(telegram.admin_user_id, 987654321);
        assert_eq!(telegram.token, "123:abc");
    }

    #[test]
    fn home_chat_id_must_be_a_group_id() {
        let base = [
            ("DATABASE_URL", "postgres://x"),
            ("TELEGRAM_BOT_TOKEN", "123:abc"),
            ("HERBOT_ADMIN_TELEGRAM_ID", "42"),
        ];
        let none = Config::from_lookup(lookup(&base))
            .unwrap()
            .telegram
            .unwrap();
        assert_eq!(none.home_chat_id, None);

        let mut pairs = base.to_vec();
        pairs.push(("HERBOT_HOME_CHAT_ID", "-1004447072305"));
        let set = Config::from_lookup(lookup(&pairs))
            .unwrap()
            .telegram
            .unwrap();
        assert_eq!(set.home_chat_id, Some(-1004447072305));

        for bad in ["42", "herbot", "0"] {
            let mut pairs = base.to_vec();
            pairs.push(("HERBOT_HOME_CHAT_ID", bad));
            assert_eq!(
                Config::from_lookup(lookup(&pairs)).unwrap_err(),
                ConfigError::InvalidHomeChatId(bad.into())
            );
        }
    }

    #[test]
    fn debug_output_never_contains_the_token() {
        let telegram = TelegramConfig {
            token: "123:super-secret".into(),
            admin_user_id: 1,
            home_chat_id: None,
        };
        let shown = format!("{telegram:?}");
        assert!(!shown.contains("super-secret"), "{shown}");
        assert!(shown.contains("<redacted>"));
    }
}
