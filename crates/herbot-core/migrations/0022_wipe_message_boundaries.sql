-- Telegram timestamps have second precision. Preserve message ordering at wipes.
ALTER TABLE conversations
    ADD COLUMN last_inbound_message_id INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN wiped_through_inbound_id INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN wiped_through_message_id INTEGER NOT NULL DEFAULT 0;
UPDATE conversations c SET last_inbound_message_id = COALESCE(
    (SELECT max(tg_message_id) FROM messages m WHERE m.conversation_id=c.id AND NOT m.from_bot),0);
