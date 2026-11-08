-- Herbot foundation schema (Step 1).
-- Later steps add columns through new migrations; never edit this file after it ships.

-- WhatsApp numbers the bridge is logged in as (one for now: "Ashrith's bot").
CREATE TABLE numbers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_e164    TEXT NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
    label         TEXT NOT NULL,
    session_state TEXT NOT NULL DEFAULT 'unpaired'
                  CHECK (session_state IN ('unpaired', 'paired', 'disconnected')),
    paired_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Everyone the bot knows by phone number. Exactly zero or one admin (Ashrith).
CREATE TABLE people (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone_e164   TEXT NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
    display_name TEXT NOT NULL,
    is_admin     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX people_single_admin ON people (is_admin) WHERE is_admin;

-- A bot persona. Its behaviour lives in the T3 project folder's AGENTS.md.
CREATE TABLE bots (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
    name           TEXT NOT NULL,
    number_id      BIGINT NOT NULL REFERENCES numbers (id),
    t3_project_dir TEXT,
    enabled        BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WhatsApp groups the number is in. New groups start pending: silent, nothing stored.
CREATE TABLE groups (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wa_jid        TEXT NOT NULL UNIQUE CHECK (wa_jid LIKE '%@g.us'),
    name          TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL DEFAULT 'shared' CHECK (kind IN ('private', 'shared')),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'ignored', 'left')),
    community_jid TEXT,
    added_by_jid  TEXT,
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);

-- Which bot answers in a group (one number => one bot per group) and how.
CREATE TABLE bindings (
    bot_id          BIGINT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
    group_id        BIGINT NOT NULL UNIQUE REFERENCES groups (id) ON DELETE CASCADE,
    trigger_policy  TEXT NOT NULL DEFAULT 'mention_or_reply'
                    CHECK (trigger_policy IN ('every_message', 'mention_or_reply')),
    who_can_trigger TEXT NOT NULL DEFAULT 'everyone'
                    CHECK (who_can_trigger IN ('everyone', 'listed')),
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, group_id)
);

-- Per-bot allowlist. Admin is global (people.is_admin) and never listed here.
CREATE TABLE bot_allowed (
    bot_id     BIGINT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
    person_id  BIGINT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'guest')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, person_id)
);

-- Every message from approved groups and DMs. Source of truth for history search.
CREATE TABLE messages (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_jid      TEXT NOT NULL,
    wa_message_id TEXT NOT NULL,
    sender_jid    TEXT NOT NULL,
    sender_phone  TEXT,
    body          TEXT NOT NULL DEFAULT '',
    quoted_wa_id  TEXT,
    mentions      TEXT[] NOT NULL DEFAULT '{}',
    media_type    TEXT,
    from_bot      BOOLEAN NOT NULL DEFAULT false,
    sent_at       TIMESTAMPTZ NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    search        TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
    UNIQUE (chat_jid, wa_message_id)
);
CREATE INDEX messages_chat_time ON messages (chat_jid, sent_at DESC);
CREATE INDEX messages_search ON messages USING GIN (search);

-- One long-lived T3/Codex thread per (bot, group). `/new` archives and starts another.
CREATE TABLE agent_threads (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bot_id       BIGINT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
    group_id     BIGINT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    t3_thread_id TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX agent_threads_one_active
    ON agent_threads (bot_id, group_id) WHERE status = 'active';

-- Questions the bot asked the admin over WhatsApp DM (shown as Q-<id>).
CREATE TABLE pending_questions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id       BIGINT NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
    source          TEXT NOT NULL CHECK (source IN ('t3_request', 'ask_admin')),
    t3_request_id   TEXT,
    asked_by_phone  TEXT,
    question        TEXT NOT NULL,
    options         JSONB NOT NULL DEFAULT '[]',
    admin_dm_wa_id  TEXT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'answered', 'timed_out')),
    answer          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at     TIMESTAMPTZ
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

-- Who changed what (admin panel actions, approvals, allowlist edits).
CREATE TABLE audit_log (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    payload    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
