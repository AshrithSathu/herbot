//! Fail-loud error records.
//!
//! Herbot has no fallback path: when something breaks, it records the error in
//! Postgres, logs it, and shows the ID (`E-1042`) to whoever asked. The admin
//! panel's Logs page looks errors up by that ID.

use std::fmt;
use std::str::FromStr;

use serde::Serialize;
use sqlx::PgPool;

/// A short, human-typable error reference, displayed as `E-<n>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(into = "String")]
pub struct ErrorId(pub i64);

impl fmt::Display for ErrorId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "E-{}", self.0)
    }
}

impl From<ErrorId> for String {
    fn from(id: ErrorId) -> Self {
        id.to_string()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("{0:?} is not an error ID (expected E-<number>)")]
pub struct ParseErrorIdError(String);

impl FromStr for ErrorId {
    type Err = ParseErrorIdError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        s.trim()
            .strip_prefix("E-")
            .or_else(|| s.trim().strip_prefix("e-"))
            .and_then(|n| n.parse::<i64>().ok())
            .filter(|n| *n > 0)
            .map(ErrorId)
            .ok_or_else(|| ParseErrorIdError(s.to_string()))
    }
}

/// Stores an error and returns its ID. `kind` is a stable machine label such as
/// `t3.turn_timeout` or `bridge.send_failed`; `context` holds group, sender and
/// step details for the Logs page.
pub async fn record(
    pool: &PgPool,
    kind: &str,
    message: &str,
    context: serde_json::Value,
) -> Result<ErrorId, sqlx::Error> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO errors (kind, message, context) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(kind)
    .bind(message)
    .bind(&context)
    .fetch_one(pool)
    .await?;

    let error_id = ErrorId(id);
    tracing::error!(error_id = %error_id, kind, message, %context, "recorded error");
    Ok(error_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_and_parse_round_trip() {
        let id = ErrorId(4821);
        assert_eq!(id.to_string(), "E-4821");
        assert_eq!("E-4821".parse::<ErrorId>().unwrap(), id);
        assert_eq!(" e-4821 ".parse::<ErrorId>().unwrap(), id);
    }

    #[test]
    fn rejects_malformed_ids() {
        for bad in ["4821", "E-", "E-abc", "E--5", "E-0", "Q-7", ""] {
            assert!(bad.parse::<ErrorId>().is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn serializes_as_display_string() {
        assert_eq!(serde_json::to_string(&ErrorId(1000)).unwrap(), "\"E-1000\"");
    }
}
