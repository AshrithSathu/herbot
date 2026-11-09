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

-- Changing setup or wiping a thread invalidates an earlier persona prompt.
CREATE FUNCTION invalidate_persona_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM persona_confirmations WHERE conversation_id = NEW.id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_persona_confirmation
AFTER UPDATE OF purpose, setup_state, t3_project_registered ON conversations
FOR EACH ROW EXECUTE FUNCTION invalidate_persona_confirmation();
