//! Isolated scheduler proof. Never connects to the production database or Telegram.
use chrono::{Duration, Utc};
use herbot_core::{
    db, hub,
    poller::{ApiError, TelegramApi},
    tasks::{self, CreateTask, Scheduler},
    turns::{TurnJob, TurnQueue},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI32, Ordering},
};
#[derive(Default)]
struct Fake {
    messages: Mutex<Vec<String>>,
    jobs: Mutex<Vec<TurnJob>>,
    sequence: AtomicI32,
}
impl TurnQueue for Fake {
    fn submit(&self, job: TurnJob) {
        self.jobs.lock().unwrap().push(job)
    }
}
impl TelegramApi for Fake {
    async fn send_text(
        &self,
        _: i64,
        _: Option<i32>,
        _: Option<i32>,
        text: &str,
    ) -> Result<i32, ApiError> {
        self.messages.lock().unwrap().push(text.into());
        Ok(self.sequence.fetch_add(1, Ordering::SeqCst) + 1)
    }
    async fn typing(&self, _: i64, _: Option<i32>) -> Result<(), ApiError> {
        Ok(())
    }
    async fn send_buttons(
        &self,
        _: i64,
        _: Option<i32>,
        _: Option<i32>,
        _: &str,
        _: &[Vec<(String, String)>],
    ) -> Result<i32, ApiError> {
        unreachable!()
    }
    async fn edit_text(&self, _: i64, _: i32, _: &str) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn remove_buttons(&self, _: i64, _: i32) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn answer_button(&self, _: &str, _: Option<&str>) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn leave_chat(&self, _: i64) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn react(&self, _: i64, _: i32, _: &str) -> Result<(), ApiError> {
        unreachable!()
    }
    async fn download_file(&self, _: &str) -> Result<Vec<u8>, ApiError> {
        unreachable!()
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    let port = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "5433".into())
        .parse::<u16>()?;
    let pool = db::connect(&format!(
        "postgres://herbot:herbot@127.0.0.1:{port}/herbot_w2"
    ))
    .await?;
    db::migrate(&pool).await?;
    let chat:i64=sqlx::query_scalar("INSERT INTO chats(tg_chat_id,kind,title,is_forum) VALUES(-999002,'supergroup','W2 smoke',true) RETURNING id").fetch_one(&pool).await?;
    let conversation:i64=sqlx::query_scalar("INSERT INTO conversations(chat_id,tg_topic_id,name,setup_state,purpose) VALUES($1,42,'Tasks smoke','ready','Test scheduled prompts safely') RETURNING id").bind(chat).fetch_one(&pool).await?;
    let once = tasks::create(
        &pool,
        CreateTask {
            conversation_id: conversation,
            prompt: "One-off smoke".into(),
            title: None,
            when: Some(Utc::now() + Duration::seconds(2)),
            cron: None,
            timezone: None,
        },
    )
    .await?;
    let recurring = tasks::create(
        &pool,
        CreateTask {
            conversation_id: conversation,
            prompt: "Recurring smoke".into(),
            title: Some("Recurring".into()),
            when: None,
            cron: Some("0 9 * * *".into()),
            timezone: Some("Asia/Kolkata".into()),
        },
    )
    .await?;
    // Simulate multiple missed slots while down.
    sqlx::query("UPDATE tasks SET next_run_at=now()-interval '3 days' WHERE id=$1")
        .bind(recurring.id)
        .execute(&pool)
        .await?;
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let fake = Arc::new(Fake::default());
    let scheduler = Scheduler {
        pool: pool.clone(),
        api: fake.clone(),
        turns: fake.clone(),
        admin_user_id: 1,
        bot_user_id: 2,
        home_chat_id: Some(-999002),
    };
    sqlx::query("UPDATE conversations SET enabled=false WHERE id=$1")
        .bind(conversation)
        .execute(&pool)
        .await?;
    assert_eq!(scheduler.tick().await?, 0);
    sqlx::query("UPDATE conversations SET enabled=true WHERE id=$1")
        .bind(conversation)
        .execute(&pool)
        .await?;
    let (a, b) = tokio::join!(scheduler.tick(), scheduler.tick());
    assert_eq!(a? + b?, 2);
    assert_eq!(scheduler.tick().await?, 0);
    let rows = tasks::list(&pool, Some(conversation)).await?;
    let one = rows.iter().find(|t| t.id == once.id).unwrap();
    assert_eq!(one.status, "done");
    assert_eq!(one.run_count, 1);
    assert!(one.next_run_at.is_none());
    let repeat = rows.iter().find(|t| t.id == recurring.id).unwrap();
    assert_eq!(repeat.status, "active");
    assert_eq!(repeat.run_count, 1);
    assert!(repeat.next_run_at.unwrap() > Utc::now());
    assert_eq!(fake.messages.lock().unwrap().len(), 2);
    {
        let jobs = fake.jobs.lock().unwrap();
        assert_eq!(jobs.len(), 2);
        assert!(jobs.iter().all(|j| j.conversation_id == conversation
            && j.topic_id == Some(42)
            && j.reply_to > 0
            && j.text.contains("scheduled task")));
        tracing::info!("scheduler smoke passed");
    }
    tasks::change(&pool, recurring.id, "pause").await?;
    tasks::change(&pool, recurring.id, "run").await?;
    assert_eq!(scheduler.tick().await?, 1);
    let rows = tasks::list(&pool, Some(conversation)).await?;
    assert_eq!(
        rows.iter().find(|t| t.id == recurring.id).unwrap().status,
        "paused"
    );
    tasks::change(&pool, recurring.id, "resume").await?;
    tasks::change(&pool, recurring.id, "cancel").await?;
    assert!(tasks::change(&pool, recurring.id, "resume").await.is_err());
    let token = hub::caller_token(&pool, conversation).await?;
    let caller = hub::resolve_caller(&pool, &token).await?;
    assert_eq!(hub::list_tasks(&pool, &caller).await?.len(), 2);
    assert!(
        hub::task_target(&pool, &caller, conversation + 100)
            .await
            .is_err()
    );
    assert!(tasks::next("invalid", "Asia/Kolkata", Utc::now()).is_err());
    assert!(tasks::next("0 9 * * *", "Invalid/Zone", Utc::now()).is_err());
    assert!(
        tasks::create(
            &pool,
            CreateTask {
                conversation_id: conversation,
                prompt: "Past".into(),
                title: None,
                when: Some(Utc::now() - Duration::seconds(1)),
                cron: None,
                timezone: None
            }
        )
        .await
        .is_err()
    );
    // Keep rows for independent inspection in herbot_w2.
    Ok(())
}
