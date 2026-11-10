-- Every turn, every Telegram message, the topic lists and the overview read a
-- conversation's message count and last activity. Counting a long history each
-- time grew with it (about 40 ms per call at 250k messages, several calls per
-- message), so both now live on the conversation, kept exact by triggers.
-- Messages are only ever inserted or deleted, never updated.

ALTER TABLE conversations
    ADD COLUMN message_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_message_at TIMESTAMPTZ;

UPDATE conversations v
SET message_count = s.n, last_message_at = s.last
FROM (SELECT conversation_id, count(*) AS n, max(sent_at) AS last
      FROM messages GROUP BY conversation_id) s
WHERE v.id = s.conversation_id;

-- Statement-level, so a bulk insert or a wipe of 250k rows is one update per
-- conversation, not one per row.
CREATE FUNCTION messages_counted_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE conversations v
    SET message_count = v.message_count + s.n,
        last_message_at = GREATEST(v.last_message_at, s.last)
    FROM (SELECT conversation_id, count(*) AS n, max(sent_at) AS last
          FROM inserted GROUP BY conversation_id) s
    WHERE v.id = s.conversation_id;
    RETURN NULL;
END $$;

CREATE FUNCTION messages_counted_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE conversations v
    SET message_count = v.message_count - s.n,
        last_message_at = (SELECT max(m.sent_at) FROM messages m WHERE m.conversation_id = v.id)
    FROM (SELECT conversation_id, count(*) AS n FROM deleted GROUP BY conversation_id) s
    WHERE v.id = s.conversation_id;
    RETURN NULL;
END $$;

CREATE TRIGGER messages_counted_insert AFTER INSERT ON messages
    REFERENCING NEW TABLE AS inserted
    FOR EACH STATEMENT EXECUTE FUNCTION messages_counted_insert();

CREATE TRIGGER messages_counted_delete AFTER DELETE ON messages
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION messages_counted_delete();

-- The overview counts errors from the last 24 hours.
CREATE INDEX errors_created_at ON errors (created_at);
