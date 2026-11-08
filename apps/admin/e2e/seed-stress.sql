-- Worst-case data for the admin panel's stress tests (e2e/stress.spec.ts).
-- Sizes follow Telegram's and Herbot's own limits: group titles and topic
-- names up to 128 characters, purposes up to 8,000, messages up to 4,000.

INSERT INTO chats (tg_chat_id, kind, title, is_forum) VALUES (
  -100222, 'supergroup',
  -- 128 characters, with a long unbroken word in it
  left('Herbot Headquarters for an Unreasonably Long Group Name Pneumonoultramicroscopicsilicovolcanoconiosis Edition Of The Group Title Here', 128),
  true);

-- 1: General. 2: the long topic everything is tested on. 3: a huge topic.
INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state, enabled) VALUES
  (1, NULL, '', 'Everyday chat with Ashrith', 'ready', true),
  (1, 7, left('Research of Extraordinarily Long Topic Names: Supercalifragilisticexpialidocious_and_another_unbroken_word_that_never_ends_at_all_ok', 128),
   left(repeat('Compare Rust crates honestly and cite sources. ', 160) ||
        'https://example.invalid/' || repeat('a', 500), 8000),
   'ready', true),
  (1, 8, 'Firehose', 'A topic with a quarter of a million messages', 'ready', true);

-- 79 more topics: a mix of states, some off, some with long purposes.
INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state, enabled)
SELECT 1, 100 + g,
       CASE WHEN g % 10 = 0 THEN left('Topic ' || g || ' ' || repeat('with a very long name ', 8), 128) ELSE 'Topic ' || g END,
       CASE WHEN g % 7 = 0 THEN NULL ELSE left(repeat('Purpose of topic ' || g || ' goes on and on. ', 40), 8000) END,
       CASE WHEN g % 7 = 0 THEN 'awaiting_purpose' ELSE 'ready' END,
       g % 5 <> 0
FROM generate_series(1, 79) AS g;

INSERT INTO agent_threads (conversation_id, t3_thread_id, t3_link)
VALUES (2, 't3-long', 'https://app.t3.codes/threads/env/' || repeat('t', 200));

-- Topic 2: 600 messages over the last 6 days, oldest first, with every
-- awkward shape a message can take.
INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, is_voice, body, sent_at)
SELECT 2, g, CASE WHEN g % 2 = 0 THEN 999 ELSE 111 END, g % 2 = 0, g % 13 = 0,
       CASE
         WHEN g % 50 = 0 THEN left(repeat('This is a very long message that keeps going for a while. ', 70), 4000)
         WHEN g % 50 = 7 THEN repeat('x', 3000)
         WHEN g % 50 = 9 THEN 'line one' || repeat(E'\n', 200) || 'line after two hundred newlines'
         WHEN g % 50 = 11 THEN ''
         WHEN g % 50 = 13 THEN 'https://example.invalid/' || repeat('long-path-segment/', 60)
         ELSE 'message ' || g || CASE WHEN g % 3 = 0 THEN ': ' || repeat('word ', 30) ELSE '' END
       END,
       now() - interval '6 days' + make_interval(mins => g * 14)
FROM generate_series(1, 600) AS g;

-- Topic 3: 250,000 tiny messages, for six-digit counts.
INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at)
SELECT 3, g, 111, false, 'm', now() - make_interval(secs => 250000 - g)
FROM generate_series(1, 250000) AS g;

-- 130 errors: long kinds, 5,000-character messages, 20 KB contexts.
INSERT INTO errors (kind, message, context, created_at)
SELECT CASE WHEN g % 4 = 0 THEN left('t3.turn_failed.' || repeat('deeply_nested_kind_', 8), 150) ELSE 't3.turn_failed' END,
       CASE WHEN g % 3 = 0 THEN 'error ' || g || ': ' || repeat('the agent run failed because of a very long reason ', 100)
            WHEN g % 3 = 1 THEN 'error ' || g || ': ' || repeat('z', 2000)
            ELSE 'error ' || g || ': short' END,
       jsonb_build_object('conversation_id', 2, 'blob', repeat('y', 20000),
                          'nested', jsonb_build_object('a', jsonb_build_object('b', jsonb_build_object('c', repeat('deep ', 50))))),
       now() - make_interval(mins => 130 - g)
FROM generate_series(1, 130) AS g;
