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

        Ok(Self {
            bind,
            database_url,
            log_format,
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
}
