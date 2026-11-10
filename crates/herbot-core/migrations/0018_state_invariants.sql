-- Normalize legacy partial states before enforcing writer invariants. Keep
-- purposes, schedules and history intact; only stale control metadata changes.
UPDATE conversations SET setup_prompt_tg_message_id = NULL
WHERE setup_state <> 'awaiting_purpose';
ALTER TABLE conversations ADD CONSTRAINT conversations_setup_prompt_state
    CHECK (setup_prompt_tg_message_id IS NULL OR setup_state = 'awaiting_purpose');

-- answered_at also records when a typed answer superseded a question.
UPDATE pending_questions SET answer = NULL, answered_at = NULL WHERE status = 'open';
UPDATE pending_questions SET status = 'superseded', answer = NULL
WHERE status = 'answered' AND answer IS NULL;
UPDATE pending_questions SET answer = NULL WHERE status = 'superseded';
UPDATE pending_questions SET answered_at = created_at
WHERE status <> 'open' AND answered_at IS NULL;
ALTER TABLE pending_questions ADD CONSTRAINT pending_questions_resolution
    CHECK ((status = 'open' AND answer IS NULL AND answered_at IS NULL)
        OR (status = 'answered' AND answer IS NOT NULL AND answered_at IS NOT NULL)
        OR (status = 'superseded' AND answer IS NULL AND answered_at IS NOT NULL));
