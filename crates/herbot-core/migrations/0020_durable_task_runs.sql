-- Existing history remains history: only new claims create pending occurrences.
ALTER TABLE conversations ADD COLUMN wiped_at TIMESTAMPTZ;
CREATE TABLE task_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    snapshot JSONB NOT NULL,
    dispatch_owner TEXT,
    completed_at TIMESTAMPTZ,
    UNIQUE(task_id, id)
);
CREATE INDEX task_runs_pending ON task_runs(id) WHERE completed_at IS NULL;
