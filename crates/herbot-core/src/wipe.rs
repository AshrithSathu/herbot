//! Clean sweeps: [`run`] deletes a conversation in T3 and in Herbot, and
//! the rest is the confirm-with-buttons flow for `/new` and `/forget` (button
//! data, texts, and how long a confirmation stays valid).

use std::path::Path;

use sqlx::PgPool;

use crate::agent::{AgentError, ProjectCleaner};
use crate::store::{self, ConversationStatus, Wiped};

/// A confirmation older than this is refused (send the command again).
pub const CONFIRM_TTL_SECS: i64 = 10 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeKind {
    /// Chat and T3 threads; the purpose stays.
    New,
    /// Everything, purpose included.
    Forget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeButton {
    Confirm(WipeKind),
    Cancel,
}

/// A tapped confirmation button, decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WipeTap {
    pub button: WipeButton,
    pub conversation_id: i64,
    /// When the confirmation was offered (unix seconds).
    pub issued_at: i64,
}

fn word(kind: WipeKind) -> &'static str {
    match kind {
        WipeKind::New => "new",
        WipeKind::Forget => "forget",
    }
}

/// Callback data, e.g. `wipe:new:12:1762600000` (well under Telegram's 64 bytes).
pub fn button_data(button: WipeButton, conversation_id: i64, issued_at: i64) -> String {
    let action = match button {
        WipeButton::Confirm(kind) => word(kind),
        WipeButton::Cancel => "cancel",
    };
    format!("wipe:{action}:{conversation_id}:{issued_at}")
}

pub fn parse(data: &str) -> Option<WipeTap> {
    let mut parts = data.strip_prefix("wipe:")?.split(':');
    let button = match parts.next()? {
        "new" => WipeButton::Confirm(WipeKind::New),
        "forget" => WipeButton::Confirm(WipeKind::Forget),
        "cancel" => WipeButton::Cancel,
        _ => return None,
    };
    let conversation_id = parts.next()?.parse().ok()?;
    let issued_at = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some(WipeTap {
        button,
        conversation_id,
        issued_at,
    })
}

pub fn is_expired(issued_at: i64, now: i64) -> bool {
    now - issued_at > CONFIRM_TTL_SECS || issued_at > now + 60
}

/// The two buttons under a confirmation, one per row.
pub fn buttons(kind: WipeKind, conversation_id: i64, issued_at: i64) -> Vec<Vec<(String, String)>> {
    let yes = match kind {
        WipeKind::New => "🧹 Yes, wipe the chat",
        WipeKind::Forget => "🧹 Yes, wipe everything",
    };
    vec![
        vec![(
            yes.to_string(),
            button_data(WipeButton::Confirm(kind), conversation_id, issued_at),
        )],
        vec![(
            "Cancel".to_string(),
            button_data(WipeButton::Cancel, conversation_id, issued_at),
        )],
    ]
}

pub fn prompt(kind: WipeKind, place: &str, messages: i64) -> String {
    match kind {
        WipeKind::New => format!(
            "🧹 Start {place} fresh?\n\nThis deletes its T3 threads and the {messages} stored messages. \
             Its purpose and AGENTS.md stay, so the same agent picks up with a clean slate."
        ),
        WipeKind::Forget => format!(
            "⚠️ Forget {place} completely?\n\nThis deletes its T3 threads, the {messages} stored messages \
             and its purpose. Next time you write here, it asks what it should be."
        ),
    }
}

pub fn done(kind: WipeKind, wiped: Wiped) -> String {
    match kind {
        WipeKind::New => format!(
            "🆕 Clean slate. Deleted {} T3 thread(s) and {} messages. \
             The purpose stays, so your next message starts fresh with the same agent.",
            wiped.threads, wiped.messages
        ),
        WipeKind::Forget => format!(
            "🧹 Forgotten. Deleted {} T3 thread(s) and {} messages, and cleared the purpose. \
             Say anything here to set it up again.",
            wiped.threads, wiped.messages
        ),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WipeError {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    T3(#[from] AgentError),
    #[error("could not delete AGENTS.md: {0}")]
    Io(#[from] std::io::Error),
}

/// Shared with turns and ingress; scope includes the database for isolated tests.
pub(crate) async fn lock(pool: &PgPool, id: i64) -> tokio::sync::OwnedMutexGuard<()> {
    type Locks = std::sync::Mutex<
        std::collections::HashMap<(String, i64), std::sync::Arc<tokio::sync::Mutex<()>>>,
    >;
    static LOCKS: std::sync::OnceLock<Locks> = std::sync::OnceLock::new();
    let key = (
        pool.connect_options()
            .get_database()
            .unwrap_or_default()
            .to_owned(),
        id,
    );
    let lock = LOCKS
        .get_or_init(Default::default)
        .lock()
        .expect("conversation locks")
        .entry(key)
        .or_default()
        .clone();
    lock.lock_owned().await
}

/// When the conversation was last wiped (`None`: never). A turn compares it
/// before and after its agent run to tell whether a clean slate overtook it.
pub(crate) async fn epoch(
    pool: &PgPool,
    id: i64,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar("SELECT wiped_at FROM conversations WHERE id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
}

pub(crate) async fn predates_wipe(
    pool: &PgPool,
    id: i64,
    sent: chrono::DateTime<chrono::Utc>,
    message_id: i32,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE($2 <= wiped_at AND $3 <= wiped_through_message_id, false) FROM conversations WHERE id=$1")
        .bind(id)
        .bind(sent)
        .bind(message_id)
        .fetch_one(pool)
        .await
}

/// The clean sweep behind `/new`, `/forget` and the admin panel's wipe.
///
/// Deletes the conversation's T3 project (with all its threads) first, and
/// only then its Herbot history, so the two never disagree. The project is
/// found through Herbot's own threads and removed by exact id, and only if
/// every thread in it is one Herbot started: a project holding anything else
/// (say, the herbot repo's own project) is never touched. `Forget` also
/// clears the purpose and deletes AGENTS.md.
pub async fn run(
    pool: &PgPool,
    projects: &dyn ProjectCleaner,
    agents_dir: &Path,
    status: &ConversationStatus,
    kind: WipeKind,
) -> Result<Wiped, WipeError> {
    let _guard = lock(pool, status.conversation_id).await;
    let ours = store::all_thread_ids(pool, status.conversation_id).await?;
    let mut found = std::collections::BTreeSet::new();
    for thread in &ours {
        if let Some(project) = projects.project_of_thread(thread).await? {
            found.insert(project);
        }
    }
    for project in &found {
        let inside = projects.threads_in_project(project).await?;
        if let Some(foreign) = inside.iter().find(|t| !ours.contains(t)) {
            return Err(AgentError::Project(format!(
                "T3 project {project} also holds thread {foreign}, which Herbot didn't start; not deleting it"
            ))
            .into());
        }
        projects.remove_project(project).await?;
    }
    let wiped = store::wipe_conversation(pool, status.conversation_id).await?;
    if kind == WipeKind::Forget
        && let Some(path) = store::reset_setup(pool, status.conversation_id).await?
    {
        match tokio::fs::remove_file(agents_dir.join(path)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    tracing::info!(
        conversation_id = status.conversation_id,
        projects = found.len(),
        threads = wiped.threads,
        messages = wiped.messages,
        ?kind,
        "wiped conversation"
    );
    Ok(wiped)
}

pub const CANCELLED: &str = "Cancelled. Nothing was deleted.";
pub const EXPIRED_TOAST: &str = "This confirmation expired. Send the command again.";
pub const WRONG_PLACE_TOAST: &str = "That confirmation belongs to another topic.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_data_round_trips_and_fits_telegram() {
        for button in [
            WipeButton::Confirm(WipeKind::New),
            WipeButton::Confirm(WipeKind::Forget),
            WipeButton::Cancel,
        ] {
            let data = button_data(button, 1234567, 1762600000);
            assert!(data.len() <= 64, "{data}");
            assert_eq!(
                parse(&data),
                Some(WipeTap {
                    button,
                    conversation_id: 1234567,
                    issued_at: 1762600000
                })
            );
        }
    }

    #[test]
    fn foreign_or_broken_data_is_not_a_wipe() {
        for bad in [
            "wipe:new:1",
            "wipe:delete:1:2",
            "wipe:new:x:2",
            "wipe:new:1:2:3",
            "ans:1:0",
            "",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn confirmations_expire_after_ten_minutes() {
        let now = 1_762_600_000;
        assert!(!is_expired(now - 599, now));
        assert!(is_expired(now - 601, now));
        assert!(is_expired(now + 3600, now), "from the future");
    }

    #[test]
    fn texts_say_what_goes_and_what_stays() {
        let new = prompt(WipeKind::New, "HQ › Testing", 12);
        assert!(new.contains("12 stored messages") && new.contains("purpose and AGENTS.md stay"));
        let forget = prompt(WipeKind::Forget, "HQ › Testing", 12);
        assert!(forget.contains("and its purpose"));
        let rows = buttons(WipeKind::New, 7, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][0].0, "Cancel");
    }
}
