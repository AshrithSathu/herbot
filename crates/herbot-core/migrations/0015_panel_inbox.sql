-- Panel messages already posted to Telegram, awaiting the shared setup/turn path.
CREATE TABLE panel_inbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tg_message_id INTEGER NOT NULL,
    payload JSONB NOT NULL,
    UNIQUE (conversation_id, tg_message_id)
);
