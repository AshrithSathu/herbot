-- Fixture data for the admin panel's browser tests (scripts/admin-e2e.sh).
INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (-100111, 'supergroup', 'Herbot HQ', true);
INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state) VALUES
  (1, NULL, '', 'Everyday chat with Ashrith', 'ready'),
  (1, 7, 'Research', 'Rust MCP research and comparisons', 'ready'),
  (1, 9, 'Ideas', NULL, 'awaiting_purpose');
INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at) VALUES
  (2, 1, 111, false, 'compare rmcp and other MCP crates', now() - interval '2 hours'),
  (2, 2, 999, true,  'rmcp is the official SDK and the best maintained.', now() - interval '2 hours' + interval '9 seconds'),
  (1, 1, 111, false, 'remind me the VPS has 8 GB of RAM', now() - interval '1 day');
INSERT INTO errors (kind, message, context, created_at) VALUES
  ('t3.turn_failed', 'the agent run failed: codex exited 1', '{"conversation_id": 2, "exit": 1}', now() - interval '3 days'),
  ('telegram.send', 'Telegram refused the reply: message is too long', '{"conversation_id": 1}', now() - interval '20 minutes');
