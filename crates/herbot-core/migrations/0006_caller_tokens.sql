-- Step 7: each conversation gets a secret caller token. Herbot puts it in the
-- <herbot-meta> header of every message to that conversation's agent, and
-- herbot-mcp's tools require it, so an agent can only ever act as itself.

ALTER TABLE conversations
    ADD COLUMN caller_token TEXT UNIQUE
        DEFAULT ('hb_' || replace(gen_random_uuid()::text, '-', '')
                        || replace(gen_random_uuid()::text, '-', ''));

UPDATE conversations
SET caller_token = 'hb_' || replace(gen_random_uuid()::text, '-', '')
                          || replace(gen_random_uuid()::text, '-', '')
WHERE caller_token IS NULL;

ALTER TABLE conversations ALTER COLUMN caller_token SET NOT NULL;
