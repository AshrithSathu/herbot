-- Every typed message supersedes open questions by thread. Keep that hot
-- operation independent of the number of previously answered questions.
CREATE INDEX IF NOT EXISTS pending_questions_open_thread
    ON pending_questions (thread_id) WHERE status = 'open';
-- Thread deletion must also find closed questions through the FK.
CREATE INDEX IF NOT EXISTS pending_questions_thread ON pending_questions (thread_id);
-- Task history and conversation FK deletes filter by conversation.
CREATE INDEX IF NOT EXISTS tasks_conversation_created
    ON tasks (conversation_id, created_at DESC, id DESC);
