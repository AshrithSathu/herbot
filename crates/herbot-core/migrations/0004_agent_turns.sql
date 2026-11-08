-- Step 4: conversations talk to their own T3 Code thread.

ALTER TABLE conversations
    -- When AGENTS.md was last (re)written; a thread that hasn't seen it yet is told to reread it.
    ADD COLUMN agents_md_updated_at TIMESTAMPTZ,
    -- The conversation's folder has been added to T3 Code as a project.
    ADD COLUMN t3_project_registered BOOLEAN NOT NULL DEFAULT false;

UPDATE conversations SET agents_md_updated_at = now() WHERE agents_md_path IS NOT NULL;

ALTER TABLE agent_threads
    ADD COLUMN last_turn_at TIMESTAMPTZ;

-- Link that opens the thread in the T3 Code app (shown by /status).
ALTER TABLE agent_threads
    ADD COLUMN t3_link TEXT;
