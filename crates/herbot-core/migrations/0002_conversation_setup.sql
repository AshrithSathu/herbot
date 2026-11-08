-- Step 3: every conversation gets a purpose ("what should I be here?").
-- The first admin message in a new conversation starts setup; the next
-- message (or a preset button) becomes the purpose. In Step 4 the purpose
-- becomes the instructions for the conversation's T3 thread.

ALTER TABLE conversations
    ADD COLUMN purpose TEXT,
    ADD COLUMN setup_state TEXT NOT NULL DEFAULT 'new'
        CHECK (setup_state IN ('new', 'awaiting_purpose', 'ready')),
    -- The greeting message with preset buttons, so its buttons can be removed.
    ADD COLUMN setup_prompt_tg_message_id INTEGER,
    ADD CONSTRAINT conversations_ready_has_purpose
        CHECK (setup_state <> 'ready' OR purpose IS NOT NULL),
    ADD CONSTRAINT conversations_purpose_length
        CHECK (purpose IS NULL OR char_length(purpose) BETWEEN 1 AND 1000);
