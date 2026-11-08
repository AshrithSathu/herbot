-- Step 6: agents can offer choices as Telegram buttons, and AGENTS.md files
-- carry a template version so new ground rules reach existing topics.

ALTER TABLE conversations
    ADD COLUMN agents_md_version INTEGER NOT NULL DEFAULT 1;

-- A button question can be closed by a typed reply instead of a tap.
ALTER TABLE pending_questions
    DROP CONSTRAINT pending_questions_status_check,
    ADD CONSTRAINT pending_questions_status_check
        CHECK (status IN ('open', 'answered', 'timed_out', 'superseded'));
