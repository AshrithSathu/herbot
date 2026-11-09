CREATE TABLE tasks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title TEXT CHECK (length(title) BETWEEN 1 AND 200),
    prompt TEXT NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 16000),
    once_at TIMESTAMPTZ,
    cron TEXT,
    timezone TEXT NOT NULL,
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    run_count BIGINT NOT NULL DEFAULT 0 CHECK (run_count >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','cancelled')),
    last_error TEXT,
    run_requested BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((once_at IS NULL) <> (cron IS NULL)),
    CHECK (status NOT IN ('active','paused') OR next_run_at IS NOT NULL),
    CHECK (status <> 'done' OR (once_at IS NOT NULL AND next_run_at IS NULL)),
    CHECK (status <> 'cancelled' OR NOT run_requested)
);
CREATE INDEX tasks_due ON tasks(next_run_at) WHERE status = 'active' OR run_requested;
