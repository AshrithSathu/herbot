//! Ashrith's global personalisation, shared by all conversation agents.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::path::{Path, PathBuf};

pub const AGENTS_MD_SECTION: &str = "## Memory and personalisation\n\nRespect Ashrith's custom instructions and about-you information in PERSONAL.md across every topic. Call remember for stable preferences or facts Ashrith states, not guesses or temporary task details. Never remember secrets, credentials or token-like strings. Call forget when Ashrith asks you to forget a memory or corrects an outdated fact; use recall to find its id. Memories are shared across topics; do not copy conversation history into them. Always pass caller from your <herbot-meta> header.\n";
const LOCK: i64 = 1_400_014;

#[derive(Debug, thiserror::Error)]
pub enum PersonalError {
    #[error("{0}")]
    Invalid(String),
    #[error("memory not found")]
    NotFound,
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("could not write PERSONAL.md: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Memory {
    pub id: i64,
    pub content: String,
    pub source_conversation_id: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Preferences {
    pub custom_instructions: String,
    pub about_you: String,
}

fn validate(text: &str, max: usize) -> Result<&str, PersonalError> {
    let text = text.trim();
    if text.chars().count() > max {
        return Err(PersonalError::Invalid(format!("maximum {max} characters")));
    }
    if crate::outgoing::scrub(text) != text {
        return Err(PersonalError::Invalid(
            "secrets and token-like strings cannot be stored".into(),
        ));
    }
    Ok(text)
}
fn normalized(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn similar(a: &str, b: &str) -> bool {
    let a = normalized(a);
    let b = normalized(b);
    if a == b {
        return true;
    }
    let mut previous: Vec<usize> = (0..=b.chars().count()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut row = vec![i + 1];
        for (j, cb) in b.chars().enumerate() {
            row.push(
                (previous[j] + usize::from(ca != cb))
                    .min(previous[j + 1] + 1)
                    .min(row[j] + 1),
            );
        }
        previous = row;
    }
    let length = a.chars().count().max(b.chars().count());
    length >= 20 && previous.last().copied().unwrap_or(0) * 20 <= length
}

pub async fn recall(pool: &PgPool, query: Option<&str>) -> Result<Vec<Memory>, sqlx::Error> {
    sqlx::query_as("SELECT * FROM memories WHERE $1::text IS NULL OR strpos(lower(content), lower($1)) > 0 ORDER BY id")
        .bind(query).fetch_all(pool).await
}
pub async fn preferences(pool: &PgPool) -> Result<Preferences, sqlx::Error> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM preferences")
        .fetch_all(pool)
        .await?;
    let mut result = Preferences::default();
    for (key, value) in rows {
        match key.as_str() {
            "custom_instructions" => result.custom_instructions = value,
            "about_you" => result.about_you = value,
            _ => {}
        }
    }
    Ok(result)
}
pub async fn updated_at(pool: &PgPool) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar("SELECT updated_at FROM personal_file_state WHERE singleton")
        .fetch_one(pool)
        .await
}

pub async fn remember(
    pool: &PgPool,
    dir: &Path,
    content: &str,
    source: Option<i64>,
    id: Option<i64>,
) -> Result<Memory, PersonalError> {
    let content = validate(content, 500)?;
    if normalized(content).is_empty() {
        return Err(PersonalError::Invalid("memory needs some words".into()));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK)
        .execute(&mut *tx)
        .await?;
    let all: Vec<Memory> = sqlx::query_as("SELECT * FROM memories ORDER BY id")
        .fetch_all(&mut *tx)
        .await?;
    if id.is_some_and(|id| !all.iter().any(|m| m.id == id)) {
        return Err(PersonalError::NotFound);
    }
    if let Some(existing) = all
        .iter()
        .find(|m| Some(m.id) != id && similar(&m.content, content))
    {
        if id.is_some() {
            return Err(PersonalError::Invalid(format!(
                "duplicates memory #{}",
                existing.id
            )));
        }
        let existing = existing.clone();
        tx.commit().await?;
        write_file(pool, dir).await?;
        return Ok(existing);
    }
    if id.is_none() && all.len() >= 200 {
        return Err(PersonalError::Invalid(
            "memory limit reached (200); forget one first".into(),
        ));
    }
    let memory = if let Some(id) = id {
        sqlx::query_as(
            "UPDATE memories SET content=$2, updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
        )
        .bind(id)
        .bind(content)
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_as(
            "INSERT INTO memories(content, source_conversation_id) VALUES($1,$2) RETURNING *",
        )
        .bind(content)
        .bind(source)
        .fetch_one(&mut *tx)
        .await?
    };
    tx.commit().await?;
    write_file(pool, dir).await?;
    Ok(memory)
}
pub async fn forget(pool: &PgPool, dir: &Path, id: Option<i64>) -> Result<u64, PersonalError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK)
        .execute(&mut *tx)
        .await?;
    let count = sqlx::query("DELETE FROM memories WHERE $1::bigint IS NULL OR id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    write_file(pool, dir).await?;
    Ok(count)
}
pub async fn set_preferences(
    pool: &PgPool,
    dir: &Path,
    prefs: &Preferences,
) -> Result<(), PersonalError> {
    let instructions = validate(&prefs.custom_instructions, 3000)?;
    let about = validate(&prefs.about_you, 1500)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK)
        .execute(&mut *tx)
        .await?;
    for (key, value) in [("custom_instructions", instructions), ("about_you", about)] {
        sqlx::query("INSERT INTO preferences(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value").bind(key).bind(value).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    write_file(pool, dir).await?;
    Ok(())
}

/// Serialises writers across core/MCP processes and atomically replaces the file.
/// Database changes remain durable on an IO failure; the error is returned and
/// startup (or the next successful mutation) repairs the projection.
pub async fn write_file(pool: &PgPool, agents_dir: &Path) -> Result<PathBuf, PersonalError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LOCK)
        .execute(&mut *tx)
        .await?;
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key,value FROM preferences ORDER BY key")
            .fetch_all(&mut *tx)
            .await?;
    let value = |key: &str| {
        rows.iter()
            .find(|r| r.0 == key)
            .map(|r| r.1.as_str())
            .unwrap_or("")
    };
    let mut text = format!(
        "# Ashrith's personalisation\n\n## Custom instructions\n\n{}\n\n## About you\n\n{}\n\n## Memories\n\n",
        value("custom_instructions"),
        value("about_you")
    );
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id,content FROM memories ORDER BY id")
        .fetch_all(&mut *tx)
        .await?;
    for (index, (id, content)) in rows.iter().enumerate() {
        text.push_str(&format!(
            "{}. [id: {id}] {}\n",
            index + 1,
            content.replace('\n', "\n   ")
        ));
    }
    tokio::fs::create_dir_all(agents_dir).await?;
    let path = agents_dir.join("PERSONAL.md");
    let old = match tokio::fs::read_to_string(&path).await {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    if old.as_deref() != Some(&text) {
        let tmp = agents_dir.join(".PERSONAL.md.tmp");
        tokio::fs::write(&tmp, text).await?;
        tokio::fs::rename(&tmp, &path).await?;
        sqlx::query("UPDATE personal_file_state SET updated_at=clock_timestamp() WHERE singleton")
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_deduplicates() {
        assert!(similar(
            "I prefer short replies.",
            "i prefer short replies!"
        ));
        assert!(similar(
            "I prefer concise English replies",
            "I prefer concise English replys"
        ));
        assert!(!similar("I like tea", "I like sea"));
        assert!(validate(&"x".repeat(501), 500).is_err());
        assert!(validate(&format!("sk-{}", "a".repeat(32)), 500).is_err());
    }
}
