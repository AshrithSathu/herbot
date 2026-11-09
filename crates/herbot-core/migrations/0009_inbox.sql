-- The admin's messages, commands and button taps waiting to be handled.
-- Each conversation handles its own in order, and conversations don't wait
-- for each other, so a long voice note in one topic no longer holds up the
-- rest. The poller saves an update here in the same transaction that moves
-- the Telegram offset past it, and deletes it once handled; whatever is left
-- at startup (a crash or restart mid-voice-note) is handled then, in order.
-- Only admin updates ever land here (policy decides first).
CREATE TABLE inbox (
    update_id   BIGINT PRIMARY KEY,
    body        JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
