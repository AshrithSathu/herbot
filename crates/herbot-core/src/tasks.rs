//! Durable scheduled prompts; claiming consumes a slot before external effects.
use crate::{
    errors, outgoing,
    poller::{ApiError, TelegramApi},
    store,
    turns::{ReplySlot, TurnJob, TurnQueue},
};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{str::FromStr, sync::Arc, time::Duration};

pub const AGENTS_MD_SECTION: &str = "## Scheduled tasks\nUse schedule_task when Ashrith asks for a reminder, a scheduled prompt, or recurring work (for example, ‘remind me every morning’ or ‘check X daily’). Pass caller from herbot-meta. Supply exactly one of when (RFC3339 with an offset) or cron (five fields: minute hour day month weekday), and an IANA timezone; the default is HERBOT_TIMEZONE (Asia/Kolkata). Confirm the saved schedule and topic only after the tool succeeds. Use list_tasks before changing existing tasks; pause_task, resume_task and cancel_task use the returned id. Topics manage their own tasks; General can manage tasks throughout its group and can select conversation_id when scheduling. A scheduled task run is an instruction to execute the saved prompt now, not to schedule another copy. Never claim a task was saved when a tool failed.\n";

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Api(#[from] ApiError),
}
pub fn default_timezone() -> Result<Tz, TaskError> {
    timezone(&std::env::var("HERBOT_TIMEZONE").unwrap_or_else(|_| "Asia/Kolkata".into()))
}
fn timezone(s: &str) -> Result<Tz, TaskError> {
    s.parse()
        .map_err(|_| TaskError::Invalid(format!("Unknown IANA timezone: {s}")))
}
pub fn next(cron: &str, tz: &str, after: DateTime<Utc>) -> Result<DateTime<Utc>, TaskError> {
    if cron.len() > 255 || cron.split_whitespace().count() != 5 {
        return Err(TaskError::Invalid(
            "Use five cron fields: minute hour day month weekday (0=Sunday)".into(),
        ));
    }
    let schedule =
        croner::Cron::from_str(cron).map_err(|e| TaskError::Invalid(format!("Bad cron: {e}")))?;
    schedule
        .find_next_occurrence(&after.with_timezone(&timezone(tz)?), false)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| TaskError::Invalid(format!("Cron has no future occurrence: {e}")))
}
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Task {
    pub id: i64,
    pub conversation_id: i64,
    pub title: Option<String>,
    pub prompt: String,
    pub once_at: Option<DateTime<Utc>>,
    pub cron: Option<String>,
    pub timezone: String,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub run_count: i64,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Deserialize)]
pub struct CreateTask {
    pub conversation_id: i64,
    pub prompt: String,
    pub title: Option<String>,
    pub when: Option<DateTime<Utc>>,
    pub cron: Option<String>,
    pub timezone: Option<String>,
}
pub async fn create(pool: &PgPool, req: CreateTask) -> Result<Task, TaskError> {
    let tz = req.timezone.unwrap_or(default_timezone()?.name().into());
    timezone(&tz)?;
    let prompt = req.prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > 16000 {
        return Err(TaskError::Invalid(
            "Prompt must be 1–16000 characters".into(),
        ));
    }
    if req
        .title
        .as_ref()
        .is_some_and(|t| t.trim().is_empty() || t.chars().count() > 200)
    {
        return Err(TaskError::Invalid("Title must be 1–200 characters".into()));
    }
    let now = Utc::now();
    let run_at = match (&req.when, &req.cron) {
        (Some(at), None) if *at > now => *at,
        (Some(_), None) => {
            return Err(TaskError::Invalid(
                "One-off time must be in the future".into(),
            ));
        }
        (None, Some(c)) => next(c, &tz, now)?,
        _ => {
            return Err(TaskError::Invalid(
                "Supply exactly one of when or cron".into(),
            ));
        }
    };
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversations WHERE id=$1)")
        .bind(req.conversation_id)
        .fetch_one(pool)
        .await?;
    if !exists {
        return Err(TaskError::Invalid("Conversation not found".into()));
    }
    let mut tx = pool.begin().await?;
    // Serialize creation and resume across all entry points, including MCP.
    sqlx::query("SELECT pg_advisory_xact_lock(130013)")
        .execute(&mut *tx)
        .await?;
    capacity(&mut tx).await?;
    let task = sqlx::query_as::<_,Task>("INSERT INTO tasks(conversation_id,prompt,title,once_at,cron,timezone,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *")
        .bind(req.conversation_id).bind(prompt).bind(req.title).bind(req.when).bind(req.cron).bind(tz).bind(run_at).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(task)
}
async fn capacity(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Result<(), TaskError> {
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE status='active'")
        .fetch_one(&mut **tx)
        .await?;
    if n >= 50 {
        return Err(TaskError::Invalid(
            "At most 50 active tasks; pause or cancel one first".into(),
        ));
    }
    Ok(())
}
pub async fn list(pool: &PgPool, conversation: Option<i64>) -> Result<Vec<Task>, TaskError> {
    Ok(sqlx::query_as("SELECT * FROM tasks WHERE ($1::bigint IS NULL OR conversation_id=$1) ORDER BY created_at DESC,id DESC").bind(conversation).fetch_all(pool).await?)
}
pub async fn change(pool: &PgPool, id: i64, action: &str) -> Result<Task, TaskError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(130013)")
        .execute(&mut *tx)
        .await?;
    let t: Task = sqlx::query_as("SELECT * FROM tasks WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| TaskError::Invalid("Task not found".into()))?;
    let (status, at, requested) = match (action, t.status.as_str()) {
        ("pause", "active") => ("paused", t.next_run_at, false),
        ("resume", "paused") => {
            capacity(&mut tx).await?;
            (
                "active",
                Some(match &t.cron {
                    Some(c) => next(c, &t.timezone, Utc::now())?,
                    None => t.next_run_at.unwrap(),
                }),
                false,
            )
        }
        ("cancel", _) => ("cancelled", t.next_run_at, false),
        ("run", s) if s != "cancelled" => (s, t.next_run_at, true),
        _ => {
            return Err(TaskError::Invalid(format!(
                "Cannot {action} a {} task",
                t.status
            )));
        }
    };
    let result = sqlx::query_as(
        "UPDATE tasks SET status=$2,next_run_at=$3,run_requested=$4 WHERE id=$1 RETURNING *",
    )
    .bind(id)
    .bind(status)
    .bind(at)
    .bind(requested)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result)
}

pub struct Scheduler<A: TelegramApi> {
    pub pool: PgPool,
    pub api: Arc<A>,
    pub turns: Arc<dyn TurnQueue>,
    pub admin_user_id: u64,
    pub bot_user_id: u64,
    pub home_chat_id: Option<i64>,
}
impl<A: TelegramApi> Scheduler<A> {
    pub async fn tick(&self) -> Result<usize, TaskError> {
        let mut count = 0;
        // Bounded batch; each task gets its own claim transaction.
        for _ in 0..50 {
            let mut tx = self.pool.begin().await?;
            let now = Utc::now();
            let task: Option<Task>=sqlx::query_as("SELECT t.* FROM tasks t JOIN conversations c ON c.id=t.conversation_id JOIN chats h ON h.id=c.chat_id WHERE ((t.status='active' AND t.next_run_at <= $1) OR t.run_requested) AND c.enabled AND c.setup_state='ready' AND h.status='active' AND h.is_forum AND h.kind='supergroup' AND ($2::bigint IS NULL OR h.tg_chat_id=$2) ORDER BY t.next_run_at NULLS FIRST,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1").bind(now).bind(self.home_chat_id).fetch_optional(&mut *tx).await?;
            let Some(t) = task else { break };
            let scheduled = t.status == "active";
            let at = if scheduled {
                t.cron
                    .as_deref()
                    .map(|c| next(c, &t.timezone, now))
                    .transpose()?
            } else {
                t.next_run_at
            };
            let status = if scheduled && t.cron.is_none() {
                "done"
            } else {
                &t.status
            };
            let claimed: Task = sqlx::query_as("UPDATE tasks SET next_run_at=$2,status=$3,last_run_at=$4,run_count=run_count+1,last_error=NULL,run_requested=false WHERE id=$1 RETURNING *").bind(t.id).bind(at).bind(status).bind(now).fetch_one(&mut *tx).await?;
            tx.commit().await?;
            if let Err(err) = self.dispatch(&claimed).await {
                let error_id = errors::record(
                    &self.pool,
                    "task.dispatch",
                    &err.to_string(),
                    serde_json::json!({"task_id":t.id,"conversation_id":t.conversation_id}),
                )
                .await?;
                tracing::error!(%error_id,error=%err,task_id=t.id,"scheduled task failed");
                sqlx::query("UPDATE tasks SET last_error=$2 WHERE id=$1")
                    .bind(t.id)
                    .bind(format!("{error_id}: {err}"))
                    .execute(&self.pool)
                    .await?;
                let s = store::conversation_status_by_id(&self.pool, t.conversation_id).await?;
                if let Err(e) = self
                    .api
                    .send_text(
                        s.tg_chat_id,
                        s.tg_topic_id,
                        None,
                        &format!(
                            "❌ Failed ({error_id}): scheduled task dispatch failed. Check logs."
                        ),
                    )
                    .await
                {
                    tracing::error!(%error_id,error=%e,"could not report task failure");
                }
            }
            count += 1;
        }
        Ok(count)
    }
    async fn dispatch(&self, t: &Task) -> Result<(), TaskError> {
        let s = store::conversation_status_by_id(&self.pool, t.conversation_id).await?;
        if !s.enabled {
            return Ok(());
        }
        let header = outgoing::scrub(&format!(
            "⏰ {}",
            crate::setup::clip(t.title.as_deref().unwrap_or(&t.prompt), 300)
        ));
        let id = self
            .api
            .send_text(s.tg_chat_id, s.tg_topic_id, None, &header)
            .await?;
        store::store_bot_message(&self.pool, t.conversation_id, id, self.bot_user_id, &header)
            .await?;
        let (slot, outcome) = ReplySlot::new();
        self.turns.submit(TurnJob {
            conversation_id: t.conversation_id,
            tg_chat_id: s.tg_chat_id,
            topic_id: s.tg_topic_id,
            reply_to: id,
            text: format!("This is scheduled task #{} running now. Execute the following saved prompt; do not schedule another copy:\n\n{}", t.id, t.prompt),
            is_voice: false,
            sender_name: "Ashrith (scheduled task)".into(),
            sender_id: self.admin_user_id,
            sent_at: Utc::now(),
            reply: Some(slot),
            style: None,
            album: None,
        });
        let pool = self.pool.clone();
        let task_id = t.id;
        let claimed_at = t.last_run_at;
        tokio::spawn(async move {
            // The turn runner already records and reports agent failures.
            if let Ok(Err(error)) = outcome.await
                && let Err(db) =
                    sqlx::query("UPDATE tasks SET last_error=$2 WHERE id=$1 AND last_run_at=$3")
                        .bind(task_id)
                        .bind(error)
                        .bind(claimed_at)
                        .execute(&pool)
                        .await
            {
                tracing::error!(task_id, error=%db, "could not save scheduled turn failure");
            }
        });
        Ok(())
    }
    pub async fn run(self, mut shutdown: tokio::sync::watch::Receiver<bool>) {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {biased; _=shutdown.changed()=>break, _=interval.tick()=> {
                if let Err(e)=self.tick().await {
                    match errors::record(&self.pool,"task.scheduler",&e.to_string(),serde_json::json!({})).await {
                        Ok(id)=>tracing::error!(error_id=%id,error=%e,"scheduler failed"),
                        Err(db)=>tracing::error!(error=%e,%db,"scheduler failure could not be recorded"),
                    }
                }
            }}
        }
    }
}

pub fn schedule_text(t: &Task) -> String {
    match &t.cron {
        Some(c) => format!(
            "{} ({})",
            croner::Cron::from_str(c)
                .map(|s| s.describe())
                .unwrap_or_else(|_| c.clone()),
            t.timezone
        ),
        None => "One-off reminder".into(),
    }
}
pub async fn show<A: TelegramApi>(
    pool: &PgPool,
    api: &A,
    conversation: i64,
    chat: i64,
    topic: Option<i32>,
) -> Result<(), TaskError> {
    let tasks = list(pool, Some(conversation)).await?;
    let tz = default_timezone()?;
    let visible: Vec<_> = tasks.iter().filter(|t| t.status != "cancelled").collect();
    if visible.is_empty() {
        api.send_text(
            chat,
            topic,
            None,
            "No tasks in this topic. Ask me to schedule a reminder or recurring prompt.",
        )
        .await?;
    }
    for t in visible {
        let at = t
            .next_run_at
            .map(|d| {
                d.with_timezone(&tz)
                    .format("%a %d %b %Y, %H:%M %Z")
                    .to_string()
            })
            .unwrap_or_else(|| "—".into());
        let text = outgoing::scrub(&format!(
            "#{} · {}\n{}\n{} · {}\nNext: {}",
            t.id,
            crate::setup::clip(t.title.as_deref().unwrap_or(&t.prompt), 200),
            crate::setup::clip(&t.prompt, 300),
            t.status,
            schedule_text(t),
            at
        ));
        let mut buttons = vec![];
        if t.status == "active" {
            buttons.push(("Pause".into(), format!("task:pause:{}", t.id)));
        }
        if t.status == "paused" {
            buttons.push(("Resume".into(), format!("task:resume:{}", t.id)));
        }
        buttons.push(("Delete".into(), format!("task:delete:{}", t.id)));
        api.send_buttons(chat, topic, None, &text, &[buttons])
            .await?;
    }
    Ok(())
}
pub async fn callback<A: TelegramApi>(
    pool: &PgPool,
    api: &A,
    press: &crate::telegram::ButtonPress,
) -> Result<(), TaskError> {
    let parts: Vec<_> = press.data.split(':').collect();
    let id = parts.get(2).and_then(|v| v.parse::<i64>().ok());
    let Some(id) = id else {
        api.answer_button(&press.callback_id, Some("Invalid task button"))
            .await?;
        return Ok(());
    };
    let conversation:Option<(i64,bool)>=sqlx::query_as("SELECT c.id,c.enabled FROM tasks t JOIN conversations c ON c.id=t.conversation_id JOIN chats h ON h.id=c.chat_id WHERE t.id=$1 AND h.tg_chat_id=$2 AND c.tg_topic_id IS NOT DISTINCT FROM $3").bind(id).bind(press.chat.tg_chat_id).bind(press.topic_id).fetch_optional(pool).await?;
    let Some((_, true)) = conversation else {
        api.answer_button(&press.callback_id, Some("Task unavailable in this topic"))
            .await?;
        return Ok(());
    };
    let action = parts.get(1).copied().unwrap_or("");
    if action == "delete" && parts.len() == 3 {
        api.send_buttons(
            press.chat.tg_chat_id,
            press.topic_id,
            Some(press.message_id),
            "Delete this task permanently?",
            &[vec![
                (
                    "Yes, delete".into(),
                    format!("task:confirm:{id}:{}", Utc::now().timestamp()),
                ),
                ("Keep task".into(), format!("task:keep:{id}")),
            ]],
        )
        .await?;
        api.answer_button(&press.callback_id, None).await?;
        return Ok(());
    }
    let action = match action {
        "keep" => {
            api.remove_buttons(press.chat.tg_chat_id, press.message_id)
                .await?;
            api.answer_button(&press.callback_id, Some("Kept")).await?;
            return Ok(());
        }
        "confirm"
            if parts.len() == 4
                && parts[3]
                    .parse::<i64>()
                    .is_ok_and(|issued| (0..=600).contains(&(Utc::now().timestamp() - issued))) =>
        {
            "cancel"
        }
        "pause" | "resume" if parts.len() == 3 => action,
        _ => {
            api.answer_button(&press.callback_id, Some("This button expired; use /tasks"))
                .await?;
            return Ok(());
        }
    };
    match change(pool, id, action).await {
        Ok(t) => {
            api.edit_text(
                press.chat.tg_chat_id,
                press.message_id,
                &format!(
                    "Task #{}: {}. Use /tasks for current controls.",
                    t.id, t.status
                ),
            )
            .await?;
            api.answer_button(&press.callback_id, Some("Updated"))
                .await?;
        }
        Err(TaskError::Invalid(e)) => api.answer_button(&press.callback_id, Some(&e)).await?,
        Err(e) => return Err(e),
    }
    Ok(())
}
