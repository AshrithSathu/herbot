-- Step 8: the admin panel pages through a conversation's messages by id
-- (newest first, then "older than id N"). This index serves those pages.
CREATE INDEX messages_conversation_id_desc ON messages (conversation_id, id DESC);
