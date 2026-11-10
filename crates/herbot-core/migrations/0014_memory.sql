CREATE TABLE memories (
    id bigserial PRIMARY KEY,
    content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 500),
    source_conversation_id bigint REFERENCES conversations(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE preferences (
    key text PRIMARY KEY CHECK (key IN ('custom_instructions', 'about_you')),
    value text NOT NULL DEFAULT '',
    CHECK (char_length(value) <= CASE key WHEN 'custom_instructions' THEN 3000 ELSE 1500 END)
);
CREATE TABLE personal_file_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    updated_at timestamptz
);
INSERT INTO personal_file_state (singleton) VALUES (true);
