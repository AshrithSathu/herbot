use std::net::SocketAddr;
use std::path::PathBuf;

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
    /// OpenAI, used for voice transcription and spoken replies; `None` without `OPENAI_API_KEY`.
    pub openai: Option<OpenAiConfig>,
    /// Root folder for each conversation's AGENTS.md (`HERBOT_AGENTS_DIR`).
    pub agents_dir: PathBuf,
    /// Model the conversation agents run on (`HERBOT_AGENT_MODEL`).
    pub agent_model: String,
    /// Reasoning effort for that model (`HERBOT_AGENT_EFFORT`).
    pub agent_effort: String,
    /// T3 Code's CLI (`HERBOT_T3_BIN`, default `~/.t3/bin/t3`).
    pub t3_bin: PathBuf,
    /// Longest an agent turn may take (`HERBOT_TURN_TIMEOUT_SECS`, default 600).
    pub turn_timeout_secs: u64,
    /// Shared secret for herbot-mcp's calls to the internal API
    /// (`HERBOT_INTERNAL_TOKEN`); `None` turns General's action tools off.
    pub internal_token: Option<String>,
    /// Shared secret for the admin panel (`HERBOT_ADMIN_TOKEN`); `None`
    /// turns the admin API off.
    pub admin_token: Option<String>,
}

pub const DEFAULT_T3_BIN: &str = "~/.t3/bin/t3";
pub const DEFAULT_TURN_TIMEOUT_SECS: u64 = 600;

/// Expands a leading `~/` using `home`.
pub fn expand_home(path: &str, home: Option<&str>) -> PathBuf {
    match (path.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(path),
    }
}

pub const DEFAULT_AGENTS_DIR: &str = "agents";
pub const DEFAULT_AGENT_MODEL: &str = "gpt-6.1-terra";
pub const DEFAULT_AGENT_EFFORT: &str = "medium";
pub const AGENT_EFFORTS: &[&str] = &["none", "low", "medium", "high", "xhigh", "max"];

#[derive(Clone)]
pub struct OpenAiConfig {
    pub api_key: String,
    /// `HERBOT_TRANSCRIBE_MODEL`, default `gpt-transcribe`.
    pub transcribe_model: String,
    pub tts_model: String,
}

impl std::fmt::Debug for OpenAiConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAiConfig")
            .field("api_key", &"<redacted>")
            .field("transcribe_model", &self.transcribe_model)
            .field("tts_model", &self.tts_model)
            .finish()
    }
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
    #[error(
        "HERBOT_AGENT_EFFORT {0:?} is not valid (expected none, low, medium, high, xhigh or max)"
    )]
    InvalidAgentEffort(String),
    #[error("HERBOT_TURN_TIMEOUT_SECS {0:?} is not valid (expected seconds between 30 and 3600)")]
    InvalidTurnTimeout(String),
    #[error("HERBOT_INTERNAL_TOKEN is too short (use at least 32 characters)")]
    WeakInternalToken,
    #[error("HERBOT_ADMIN_TOKEN is too short (use at least 32 characters)")]
    WeakAdminToken,
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

        let openai = get("OPENAI_API_KEY")
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .map(|api_key| OpenAiConfig {
                api_key,
                tts_model: get("HERBOT_TTS_MODEL")
                    .map(|m| m.trim().to_string())
                    .filter(|m| !m.trim().is_empty())
                    .unwrap_or_else(|| crate::speech::DEFAULT_MODEL.into()),
                transcribe_model: get("HERBOT_TRANSCRIBE_MODEL")
                    .map(|m| m.trim().to_string())
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| crate::voice::DEFAULT_MODEL.to_string()),
            });

        let non_empty = |key: &str, default: &str| {
            get(key)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| default.to_string())
        };
        let agents_dir = PathBuf::from(non_empty("HERBOT_AGENTS_DIR", DEFAULT_AGENTS_DIR));
        let agent_model = non_empty("HERBOT_AGENT_MODEL", DEFAULT_AGENT_MODEL);
        let agent_effort = non_empty("HERBOT_AGENT_EFFORT", DEFAULT_AGENT_EFFORT).to_lowercase();
        if !AGENT_EFFORTS.contains(&agent_effort.as_str()) {
            return Err(ConfigError::InvalidAgentEffort(agent_effort));
        }

        let internal_token = match get("HERBOT_INTERNAL_TOKEN").map(|t| t.trim().to_string()) {
            Some(t) if t.is_empty() => None,
            Some(t) if t.len() < 32 => return Err(ConfigError::WeakInternalToken),
            other => other,
        };
        let admin_token = match get("HERBOT_ADMIN_TOKEN").map(|t| t.trim().to_string()) {
            Some(t) if t.is_empty() => None,
            Some(t) if t.len() < 32 => return Err(ConfigError::WeakAdminToken),
            other => other,
        };
        let home = get("HOME");
        let t3_bin = expand_home(&non_empty("HERBOT_T3_BIN", DEFAULT_T3_BIN), home.as_deref());
        let timeout_raw = non_empty(
            "HERBOT_TURN_TIMEOUT_SECS",
            &DEFAULT_TURN_TIMEOUT_SECS.to_string(),
        );
        let turn_timeout_secs = timeout_raw
            .parse::<u64>()
            .ok()
            .filter(|s| (30..=3600).contains(s))
            .ok_or(ConfigError::InvalidTurnTimeout(timeout_raw))?;

        Ok(Self {
            bind,
            database_url,
            log_format,
            telegram,
            openai,
            agents_dir,
            agent_model,
            agent_effort,
            t3_bin,
            turn_timeout_secs,
            internal_token,
            admin_token,
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
    fn agent_model_defaults_to_terra_on_medium() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://x")])).unwrap();
        assert_eq!(config.agent_model, "gpt-6.1-terra");
        assert_eq!(config.agent_effort, "medium");
        assert_eq!(config.agents_dir, PathBuf::from("agents"));
        assert!(config.openai.is_none(), "voice is off without a key");

        let err = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("HERBOT_AGENT_EFFORT", "turbo"),
        ]))
        .unwrap_err();
        assert_eq!(err, ConfigError::InvalidAgentEffort("turbo".into()));
    }

    #[test]
    fn t3_cli_and_timeout_defaults() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("HOME", "/Users/ashrith"),
        ]))
        .unwrap();
        assert_eq!(config.t3_bin, PathBuf::from("/Users/ashrith/.t3/bin/t3"));
        assert_eq!(config.turn_timeout_secs, 600);
        for bad in ["5", "abc", "99999"] {
            let err = Config::from_lookup(lookup(&[
                ("DATABASE_URL", "postgres://x"),
                ("HERBOT_TURN_TIMEOUT_SECS", bad),
            ]))
            .unwrap_err();
            assert_eq!(err, ConfigError::InvalidTurnTimeout(bad.into()));
        }
        assert_eq!(expand_home("/opt/t3", Some("/h")), PathBuf::from("/opt/t3"));
    }

    #[test]
    fn internal_token_is_optional_but_must_be_strong() {
        let base = ("DATABASE_URL", "postgres://x");
        assert_eq!(
            Config::from_lookup(lookup(&[base])).unwrap().internal_token,
            None
        );
        assert_eq!(
            Config::from_lookup(lookup(&[base, ("HERBOT_INTERNAL_TOKEN", "short")])).unwrap_err(),
            ConfigError::WeakInternalToken
        );
        let strong = "x".repeat(40);
        let config =
            Config::from_lookup(lookup(&[base, ("HERBOT_INTERNAL_TOKEN", strong.as_str())]))
                .unwrap();
        assert_eq!(config.internal_token.as_deref(), Some(strong.as_str()));
    }

    #[test]
    fn openai_key_turns_on_voice_with_a_default_model() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "postgres://x"),
            ("OPENAI_API_KEY", " sk-test "),
        ]))
        .unwrap();
        let openai = config.openai.unwrap();
        assert_eq!(openai.api_key, "sk-test");
        assert_eq!(openai.transcribe_model, "gpt-transcribe");
        let shown = format!("{openai:?}");
        assert!(!shown.contains("sk-test"), "{shown}");
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
