ALTER TABLE conversations
    ADD COLUMN voice_replies BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN voice TEXT NOT NULL DEFAULT 'marin'
        CHECK (voice IN ('alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse','marin','cedar'));

CREATE TABLE persona_confirmations (
    conversation_id BIGINT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    tg_message_id INTEGER NOT NULL,
    preset TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
