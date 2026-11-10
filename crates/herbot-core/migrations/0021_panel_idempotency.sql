-- Pending rows deliberately survive a crash: Telegram cannot atomically deduplicate a create/send.
CREATE TABLE panel_requests (
    key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 128),
    scope TEXT NOT NULL,
    status INTEGER,
    response JSONB,
    CHECK ((status IS NULL) = (response IS NULL))
);
