//! Step 7: what each agent may see through herbot-mcp.
//! General sees every topic in its group; a topic sees only itself.

use sqlx::PgPool;

use herbot_core::hub::{self, Caller, HubError};

/// Herbot HQ: General (1), Research topic 7 (2), Testing topic 9 (3);
/// a second group's General (4) to prove groups don't leak into each other.
async fn seed(pool: &PgPool) {
    sqlx::raw_sql(
        "INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES
           (-100111, 'supergroup', 'Herbot HQ', true),
           (-100222, 'supergroup', 'Other Group', true);
         INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state) VALUES
           (1, NULL, '', 'Everyday chat', 'ready'),
           (1, 7, 'Research', 'Rust MCP research and comparisons', 'ready'),
           (1, 9, 'Testing', 'Casual testing buddy for the bot', 'ready'),
           (2, NULL, '', 'Elsewhere', 'ready');
         INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at) VALUES
           (1, 1, 111, false, 'remind me the VPS has 8 GB of RAM', now() - interval '5 days'),
           (2, 1, 111, false, 'compare rmcp and other MCP crates', now() - interval '3 days'),
           (2, 2, 999, true,  'rmcp is the official SDK and the best maintained', now() - interval '3 days'),
           (3, 1, 111, false, 'does the VPS deploy script work?', now() - interval '1 day'),
           (3, 2, 999, true,  'yes, the deploy script passed', now() - interval '1 day'),
           (4, 1, 111, false, 'secret VPS plans in another group', now());",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn caller(pool: &PgPool, conversation: i64) -> Caller {
    let token = hub::caller_token(pool, conversation).await.unwrap();
    hub::resolve_caller(pool, &token).await.unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn callers_are_identified_by_their_secret_token(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    assert!(general.is_general);
    assert_eq!(general.place, "Herbot HQ › General");
    let research = caller(&pool, 2).await;
    assert!(!research.is_general);
    assert_eq!(research.place, "Herbot HQ › Research");
    assert!(matches!(
        hub::resolve_caller(&pool, "hb_made_up").await,
        Err(HubError::UnknownCaller)
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn everyone_can_list_their_groups_topics(pool: PgPool) {
    seed(&pool).await;
    let research = caller(&pool, 2).await;
    let topics = hub::list_topics(&pool, &research).await.unwrap();
    let names: Vec<_> = topics.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Herbot HQ › General",
            "Herbot HQ › Testing",
            "Herbot HQ › Research"
        ],
        "General first, then most recently active; never the other group"
    );
    assert!(topics.iter().find(|t| t.id == 2).unwrap().is_you);
    assert_eq!(topics[1].messages, 2);
    assert_eq!(
        topics[1].purpose.as_deref(),
        Some("Casual testing buddy for the bot")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn general_searches_every_topic_but_only_its_own_group(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    let hits = hub::search(&pool, &general, "VPS", None, None)
        .await
        .unwrap();
    let topics: Vec<_> = hits.iter().map(|h| h.topic.as_str()).collect();
    assert_eq!(
        topics,
        ["Herbot HQ › Testing", "Herbot HQ › General"],
        "newest first"
    );
    assert!(
        hits.iter().all(|h| !h.text.contains("secret")),
        "other group stays out"
    );

    let only_research = hub::search(&pool, &general, "rmcp", Some("research"), None)
        .await
        .unwrap();
    assert_eq!(only_research.len(), 2);
    assert_eq!(only_research[0].from, "bot");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_topic_searches_and_reads_only_itself(pool: PgPool) {
    seed(&pool).await;
    let testing = caller(&pool, 3).await;
    let hits = hub::search(&pool, &testing, "VPS", None, None)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].topic, "Herbot HQ › Testing");

    for result in [
        hub::search(&pool, &testing, "rmcp", Some("Research"), None)
            .await
            .map(|_| ()),
        hub::read(&pool, &testing, Some("General"), None, None)
            .await
            .map(|_| ()),
    ] {
        assert!(matches!(result, Err(HubError::Forbidden(_))), "{result:?}");
    }
    // Naming itself is fine.
    assert_eq!(
        hub::read(&pool, &testing, Some("Testing"), None, None)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn read_returns_oldest_first_and_pages_back(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    let lines = hub::read(&pool, &general, Some("2"), None, None)
        .await
        .unwrap();
    assert_eq!(
        lines.iter().map(|l| l.from.as_str()).collect::<Vec<_>>(),
        ["Ashrith", "bot"]
    );
    let latest = hub::read(&pool, &general, Some("Research"), Some(1), None)
        .await
        .unwrap();
    assert_eq!(latest.len(), 1);
    let before = hub::read(
        &pool,
        &general,
        Some("Research"),
        Some(10),
        Some(chrono::Utc::now() - chrono::Duration::days(4)),
    )
    .await
    .unwrap();
    assert!(before.is_empty());
    // Without a topic, General reads itself.
    let own = hub::read(&pool, &general, None, None, None).await.unwrap();
    assert_eq!(own[0].topic, "Herbot HQ › General");
}

#[sqlx::test(migrations = "./migrations")]
async fn topics_resolve_by_id_name_or_full_place(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    for reference in [
        "2",
        "Research",
        "research",
        "Herbot HQ › Research",
        " RESEARCH ",
    ] {
        assert_eq!(
            hub::resolve_topic(&pool, &general, reference)
                .await
                .unwrap(),
            2,
            "{reference}"
        );
    }
    assert!(matches!(
        hub::resolve_topic(&pool, &general, "Nope").await,
        Err(HubError::NotFound(_))
    ));
    assert!(
        matches!(
            hub::resolve_topic(&pool, &general, "4").await,
            Err(HubError::NotFound(_))
        ),
        "other group's id"
    );
    assert!(matches!(
        hub::resolve_topic(&pool, &general, "  ").await,
        Err(HubError::BadRequest(_))
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn only_general_can_act_and_never_on_itself(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    assert_eq!(
        hub::action_target(&pool, &general, "Testing")
            .await
            .unwrap(),
        3
    );
    assert!(matches!(
        hub::action_target(&pool, &general, "General").await,
        Err(HubError::BadRequest(_))
    ));
    let research = caller(&pool, 2).await;
    assert!(matches!(
        hub::action_target(&pool, &research, "Testing").await,
        Err(HubError::Forbidden(_))
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn empty_searches_are_rejected(pool: PgPool) {
    seed(&pool).await;
    let general = caller(&pool, 1).await;
    assert!(matches!(
        hub::search(&pool, &general, "  ", None, None).await,
        Err(HubError::BadRequest(_))
    ));
}

#[sqlx::test(migrations = "./migrations")]
async fn personal_memories_are_global_but_require_a_caller(pool: PgPool) {
    use herbot_core::personal;
    seed(&pool).await;
    let root = tempfile::tempdir().unwrap();
    let general = hub::caller_token(&pool, 1).await.unwrap();
    let research = hub::caller_token(&pool, 2).await.unwrap();
    assert!(matches!(
        hub::remember(&pool, "forged", root.path(), "A stable fact").await,
        Err(HubError::UnknownCaller)
    ));
    let m = hub::remember(
        &pool,
        &research,
        root.path(),
        "Ashrith prefers concise English replies.",
    )
    .await
    .unwrap();
    assert_eq!(
        hub::remember(
            &pool,
            &general,
            root.path(),
            "ashrith prefers concise English replies!"
        )
        .await
        .unwrap()
        .id,
        m.id
    );
    assert_eq!(
        hub::recall(&pool, &general, Some("ENGLISH"))
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        hub::remember(
            &pool,
            &research,
            root.path(),
            &format!("sk-{}", "a".repeat(32))
        )
        .await
        .is_err()
    );
    let at = personal::updated_at(&pool).await.unwrap().unwrap();
    personal::write_file(&pool, root.path()).await.unwrap();
    assert_eq!(personal::updated_at(&pool).await.unwrap(), Some(at));
    assert!(
        std::fs::read_to_string(root.path().join("PERSONAL.md"))
            .unwrap()
            .contains(&format!("[id: {}]", m.id))
    );
    assert_eq!(
        hub::forget(&pool, &general, root.path(), m.id)
            .await
            .unwrap(),
        1
    );
    assert!(
        hub::recall(&pool, &research, None)
            .await
            .unwrap()
            .is_empty()
    );
}
