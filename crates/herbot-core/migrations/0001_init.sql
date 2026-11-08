-- Herbot schema: a private Telegram bot for one admin.
-- The admin's Telegram user ID comes from HERBOT_ADMIN_TELEGRAM_ID (server env),
-- never from this database, so nothing written here can change who the admin is.

-- Bot personas. Behaviour lives in the T3 project folder's AGENTS.md.
CREATE TABLE bots (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
    name           TEXT NOT NULL,
    t3_project_dir TEXT,
    is_default     BOOLEAN NOT NULL DEFAULT false,
    enabled        BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bots_single_default ON bots (is_default) WHERE is_default;

-- Telegram chats the bot is in: the admin's DM and the groups he added it to.
CREATE TABLE chats (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tg_chat_id          BIGINT NOT NULL UNIQUE,
    kind                TEXT NOT NULL CHECK (kind IN ('private', 'group', 'supergroup')),
    title               TEXT NOT NULL DEFAULT '',
    is_forum            BOOLEAN NOT NULL DEFAULT false,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'disabled', 'left')),
    added_by_tg_user_id BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A conversation is (chat, topic). tg_topic_id is NULL for DMs, non-forum
-- groups and a forum's General topic. Each conversation has its own thread.
CREATE TABLE conversations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_id     BIGINT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
    tg_topic_id INTEGER,
    name        TEXT NOT NULL DEFAULT '',
    bot_id      BIGINT REFERENCES bots (id) ON DELETE SET NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (chat_id, tg_topic_id)
);

-- Every admin message (and, from Step 5, every bot reply). Source for history search.
CREATE TABLE messages (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id        BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    tg_message_id          INTEGER NOT NULL,
    from_tg_user_id        BIGINT NOT NULL,
    from_bot               BOOLEAN NOT NULL DEFAULT false,
    body                   TEXT NOT NULL DEFAULT '',
    reply_to_tg_message_id INTEGER,
    sent_at                TIMESTAMPTZ NOT NULL,
    received_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    search                 TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
    UNIQUE (conversation_id, tg_message_id)
);
CREATE INDEX messages_conversation_time ON messages (conversation_id, sent_at DESC);
CREATE INDEX messages_search ON messages USING GIN (search);

-- One long-lived T3/Codex thread per conversation. `/new` archives it and starts another.
CREATE TABLE agent_threads (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    bot_id          BIGINT REFERENCES bots (id) ON DELETE SET NULL,
    t3_thread_id    TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX agent_threads_one_active
    ON agent_threads (conversation_id) WHERE status = 'active';

-- Questions a bot thread asked the admin, shown in Telegram with inline buttons.
CREATE TABLE pending_questions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id     BIGINT NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
    source        TEXT NOT NULL CHECK (source IN ('t3_request', 'ask_admin')),
    t3_request_id TEXT,
    question      TEXT NOT NULL,
    options       JSONB NOT NULL DEFAULT '[]',
    tg_message_id INTEGER,
    status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'answered', 'timed_out')),
    answer        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at   TIMESTAMPTZ
);

-- Small durable state, e.g. the Telegram long-poll offset.
CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fail-loud error log. IDs start at 1000 so they read as E-1000, E-1001, ...
CREATE TABLE errors (
    id         BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
    kind       TEXT NOT NULL,
    message    TEXT NOT NULL,
    context    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX errors_kind_time ON errors (kind, created_at DESC);

-- What changed and who changed it (admin panel actions, ignored or left chats).
CREATE TABLE audit_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    payload    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
