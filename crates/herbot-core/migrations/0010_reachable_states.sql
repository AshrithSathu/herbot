-- The schema now allows only the states the code can reach, so it documents
-- the real state machines (docs/STATE_MACHINES.md). Nothing ever set the
-- removed states, and no rows hold them:
-- - chats were never 'disabled' (the panel switches conversations off);
-- - threads were never archived after Step 7 (`/new` and `/forget` delete
--   them), so a conversation has at most one thread and a row is that thread;
-- - questions only came from agents (`[[ask: …]]`) and never timed out.

ALTER TABLE chats
    DROP CONSTRAINT chats_status_check,
    ADD CONSTRAINT chats_status_check CHECK (status IN ('active', 'left'));

DROP INDEX agent_threads_one_active;
ALTER TABLE agent_threads
    DROP CONSTRAINT IF EXISTS agent_threads_check, -- (status = 'archived') = (archived_at IS NOT NULL)
    DROP COLUMN status,
    DROP COLUMN archived_at,
    ADD CONSTRAINT agent_threads_one_per_conversation UNIQUE (conversation_id);

ALTER TABLE pending_questions
    DROP COLUMN source,
    DROP COLUMN t3_request_id,
    DROP CONSTRAINT pending_questions_status_check,
    ADD CONSTRAINT pending_questions_status_check
        CHECK (status IN ('open', 'answered', 'superseded'));
