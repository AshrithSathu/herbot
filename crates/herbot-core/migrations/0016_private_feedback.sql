ALTER TABLE conversations ADD COLUMN private_mode boolean NOT NULL DEFAULT false,
 ADD COLUMN retry_message_id integer,
 ADD COLUMN negative_feedback boolean NOT NULL DEFAULT false;
CREATE TABLE feedback (
 message_id bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 reactions jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Also guard writes from other entry points and concurrent turns.
CREATE FUNCTION suppress_private_messages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT private_mode FROM conversations WHERE id = NEW.conversation_id FOR SHARE) THEN
  RETURN NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER messages_private BEFORE INSERT OR UPDATE ON messages
 FOR EACH ROW EXECUTE FUNCTION suppress_private_messages();
