-- Step 9 (Grok parity) foundation.
-- Files that came with a message (photos, documents, video, audio) or that an
-- agent sent: [{kind, path (relative to HERBOT_AGENTS_DIR), name, mime, size}].
ALTER TABLE messages ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]';

-- Each topic's mode (Grok's Fast / Auto / Expert / Heavy): its reasoning
-- effort, and whether it may fan out to sub-agents. Written to the topic's
-- .codex/config.toml.
ALTER TABLE conversations
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'
        CHECK (mode IN ('fast', 'auto', 'expert', 'heavy'));
