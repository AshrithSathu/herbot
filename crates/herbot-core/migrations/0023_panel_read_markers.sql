-- Hold the schema lock through backfill, so no reply can slip between it and commit.
-- A numeric watermark deliberately survives message deletion and clean slates.
ALTER TABLE conversations ADD COLUMN panel_read_through_message_id BIGINT NOT NULL DEFAULT 0
    CHECK (panel_read_through_message_id >= 0);
UPDATE conversations c SET panel_read_through_message_id = COALESCE(
    (SELECT id FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1), 0);
-- The unread query visits at most 99 bot-message index entries per conversation.
CREATE INDEX messages_panel_unread ON messages (conversation_id, id) WHERE from_bot;
