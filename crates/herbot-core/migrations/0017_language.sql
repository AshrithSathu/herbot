-- Grok answers in many languages. Herbot is English by default (Ashrith's
-- rule); /language sets another language for one topic, and its replies,
-- voice-note transcription and spoken replies follow it.
ALTER TABLE conversations
    ADD COLUMN language TEXT NOT NULL DEFAULT 'English'
        CHECK (char_length(language) BETWEEN 2 AND 40);
