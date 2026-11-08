-- Setup is now open-ended: a topic's purpose is whatever Ashrith says (long
-- text or a voice note), and it becomes that topic's AGENTS.md.

ALTER TABLE conversations
    DROP CONSTRAINT conversations_purpose_length,
    ADD CONSTRAINT conversations_purpose_length
        CHECK (purpose IS NULL OR char_length(purpose) BETWEEN 1 AND 8000),
    -- Where the conversation's AGENTS.md was written (relative to HERBOT_AGENTS_DIR).
    ADD COLUMN agents_md_path TEXT;

-- Voice notes are stored as their English transcript.
ALTER TABLE messages
    ADD COLUMN is_voice BOOLEAN NOT NULL DEFAULT false;
