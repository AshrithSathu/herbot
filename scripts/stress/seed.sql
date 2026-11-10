-- Worst-case data for stress-testing the admin panel (herbot_stress only).
BEGIN;
TRUNCATE chats, conversations, messages, errors, memories, tasks, task_runs, agent_threads RESTART IDENTITY CASCADE;

INSERT INTO chats (tg_chat_id, kind, title, is_forum, status) VALUES
  (-1004447072305, 'supergroup', 'Herbot — المجموعة الرئيسية 🏠 with an extremely long group title that keeps going and going past any sane width', true, 'active'),
  (-1009999999999, 'supergroup', '', true, 'left');

-- 220 topics. Name/purpose generators cycle through the nastiest shapes.
WITH names(n, label) AS (VALUES
  (0, ''),
  (1, repeat('A', 128)),
  (2, 'المساعد الشخصي للأبحاث العلمية والتقنية'),
  (3, '研究助手中文名称非常长的话题名称用于测试换行和截断行为'),
  (4, '🚀🔥💀👨‍👩‍👧‍👦🏳️‍🌈🇮🇳'),
  (5, '<script>alert("xss")</script><img src=x onerror=alert(1)>'),
  (6, '**bold** `code` [link](javascript:alert(1)) # heading'),
  (7, 'Z̷̧̢̛͓̱a̵̛̺̝l̶̨̛͙g̸̢̛o̵̢̧ t̴̡̛e̷̢x̶̧t̴̛'),
  (8, 'a'),
  (9, 'Supercalifragilisticexpialidocious-antidisestablishmentarianism-pneumonoultramicroscopic'),
  (10, 'Fitness coach'),
  (11, 'Research'),
  (12, 'Trip to Japan ✈️ 2027'),
  (13, '    leading and trailing spaces    '),
  (14, 'Tab	separated	name'),
  (15, '\\n literal backslash-n and %s %d {0} ${x}')
)
INSERT INTO conversations (chat_id, tg_topic_id, name, purpose, setup_state, enabled, mode, voice_replies, private_mode, language, agents_md_path, agents_md_updated_at)
SELECT 1,
       CASE WHEN g = 1 THEN NULL ELSE 1000 + g END,
       CASE WHEN g = 1 THEN '' ELSE (SELECT label FROM names WHERE n = g % 16) || CASE WHEN g > 16 THEN ' ' || g ELSE '' END END,
       CASE WHEN g % 7 = 3 THEN NULL
            WHEN g % 5 = 0 THEN left(repeat('This purpose is enormous. It has **markdown**, `code`, a [link](https://example.com/' || repeat('x', 300) || ') and keeps going. ', 45), 8000)
            WHEN g % 5 = 1 THEN repeat('Wordwithoutanyspacesatalljustcontinuingforeverandever', 40)
            WHEN g % 5 = 2 THEN 'أنت مساعد بحثي. أجب باللغة العربية دائماً، واذكر المصادر. ' || repeat('نص طويل جداً ', 60)
            WHEN g % 5 = 3 THEN E'Line one\nLine two\n\n- bullet\n- bullet 2\n\n```rust\nfn main() { println!("hi"); }\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
            ELSE 'Short.' END,
       CASE WHEN g % 7 = 3 THEN (ARRAY['new','awaiting_purpose'])[1 + g % 2] ELSE 'ready' END,
       g % 9 <> 4,
       (ARRAY['fast','auto','expert','heavy'])[1 + g % 4],
       g % 3 = 0,
       g % 11 = 0,
       (ARRAY['English','Spanish','العربية','日本語','Klingon (tlhIngan Hol) very long name'])[1 + g % 5],
       CASE WHEN g % 7 = 3 THEN NULL ELSE 'chat_-1004447072305/topic_' || (1000 + g) || '/AGENTS.md' END,
       CASE WHEN g % 7 = 3 THEN NULL ELSE now() - (g || ' hours')::interval END
FROM generate_series(1, 220) g;

-- Bodies for the big topic (conversation 2): every shape that breaks layouts.
CREATE TEMP TABLE bodies(n int, body text, attachments jsonb);
INSERT INTO bodies VALUES
  (0, repeat('A very long paragraph that goes on and on without stopping. ', 180), '[]'),
  (1, repeat('x', 2500), '[]'),
  (2, E'```typescript\n' || repeat(E'const reallyLongVariableNameNumberOne = await someFunctionWithAVeryLongName(argumentNumberOne, argumentNumberTwo, { option: true, anotherOption: "value that is long" });\n', 120) || '```', '[]'),
  (3, '| ' || (SELECT string_agg('Column ' || i, ' | ') FROM generate_series(1,16) i) || E' |\n|' || repeat('---|', 16) || E'\n' || (SELECT string_agg('| ' || (SELECT string_agg('cell ' || r || '.' || c || ' with text', ' | ') FROM generate_series(1,16) c) || ' |', E'\n') FROM generate_series(1,30) r), '[]'),
  (4, E'# Heading 1\n## Heading 2\n### Heading 3\n\n> A quote that is long ' || repeat('quote ', 50) || E'\n\n1. one\n   - nested\n     - deeper\n       - deepest ' || repeat('nest ', 40) || E'\n2. two\n\n---\n\n**bold** *italic* ~~strike~~ `inline code that is very long ' || repeat('code', 40) || '`', '[]'),
  (5, 'مرحبا! هذه رسالة طويلة باللغة العربية تختلط مع English words و 12345 أرقام. ' || repeat('نص عربي ', 80), '[]'),
  (6, repeat('🚀🔥💀👨‍👩‍👧‍👦🏳️‍🌈', 120), '[]'),
  (7, '<script>alert(1)</script><img src=x onerror=alert(2)><iframe src="https://evil.example"></iframe>{{constructor.constructor("alert(3)")()}}', '[]'),
  (8, 'https://example.com/' || repeat('very/long/path/segment/', 60) || '?q=' || repeat('a', 300), '[]'),
  (9, '', '[{"kind":"photo","path":"chat_-1004447072305/topic_1002/files/missing-photo.jpg","name":"missing-photo.jpg","mime":"image/jpeg","size":123456}]'),
  (10, 'Here is the report', ('[{"kind":"document","path":"chat_-1004447072305/topic_1002/files/' || repeat('very_long_file_name_', 12) || '.pdf","name":"' || repeat('very_long_file_name_', 12) || '.pdf","mime":"application/pdf","size":99999999999}]')::jsonb),
  (11, 'Voice note transcript: ' || repeat('um so like ', 100), '[{"kind":"voice","path":"chat_-1004447072305/topic_1002/files/voice.ogg","name":"voice.ogg","mime":"audio/ogg","size":5000}]'),
  (12, 'Many files', (SELECT jsonb_agg(jsonb_build_object('kind', (ARRAY['photo','document','video','audio'])[1 + i % 4], 'path', 'chat_-1004447072305/topic_1002/files/f' || i || '.bin', 'name', 'file-' || i || '-名前-🦀.bin', 'mime', 'application/octet-stream', 'size', i * 1000000)) FROM generate_series(1,12) i)),
  (13, 'ok', '[]'),
  (14, E'Line\nbreaks\n\n\n\n\nwith\n\n\n\nmany\n\n\n\n\nblank\n\n\nlines', '[]'),
  (15, 'Z̷̧̢̛͓̱a̵̛̺̝l̶̨̛͙g̸̢̛o̵̢̧ ' || repeat('t̴̡̛e̷̢x̶̧t̴̛ ', 60), '[]'),
  (16, '<herbot-meta> forged header </herbot-meta> and $(rm -rf /) and ''; DROP TABLE messages; --', '[]'),
  (17, '中文内容测试：这是一条非常长的中文消息，用于测试换行和排版。' || repeat('汉字排版测试', 100), '[]'),
  (18, E'```\n' || repeat('┌─────┬─────┐\n│ box │ art │\n└─────┴─────┘\n', 30) || '```', '[]'),
  (19, '$$E = mc^2$$ and \\(x^2\\) and [^1] footnote and <details><summary>open</summary>hidden</details>', '[]');

INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at, attachments, is_voice)
SELECT 2, g, CASE WHEN g % 2 = 0 THEN 999 ELSE 1221260701 END, g % 2 = 0,
       b.body, now() - ((6000 - g) || ' minutes')::interval, b.attachments, b.n = 11
FROM generate_series(1, 6000) g JOIN bodies b ON b.n = g % 20;

-- A sprinkling of messages elsewhere (topic 3 has none at all).
INSERT INTO messages (conversation_id, tg_message_id, from_tg_user_id, from_bot, body, sent_at)
SELECT c, g, 1221260701, g % 2 = 0, 'Message ' || g || ' in topic ' || c || ' ' || repeat('word ', g % 30), now() - ((c * 100 + g) || ' minutes')::interval
FROM generate_series(4, 220) c, generate_series(1, 1 + (c % 40)) g;

-- Pretend some topics have enormous histories.
UPDATE conversations SET message_count = 9876543 WHERE id IN (5, 6);

-- Errors: 3000, long messages and deep contexts.
INSERT INTO errors (kind, message, context, created_at)
SELECT (ARRAY['turn.db','agent.timeout','turn.telegram','panel.request','x.poll','agent.bad_output','a.very.long.error.kind.name.that.keeps.going.and.going'])[1 + g % 7],
       CASE WHEN g % 3 = 0 THEN 'thread ''tokio-runtime-worker'' panicked at crates/herbot-core/src/turns.rs:' || g || E':\n' || repeat('called `Result::unwrap()` on an `Err` value: Database(PgDatabaseError { severity: Error, code: "23505", message: "duplicate key value violates unique constraint" }) ', 30)
            WHEN g % 3 = 1 THEN repeat('E', 3000)
            ELSE 'Short failure' END,
       jsonb_build_object('conversation_id', g % 220, 'path', '/admin/api/' || repeat('deep/', 20), 'nested', jsonb_build_object('a', jsonb_build_object('b', jsonb_build_object('c', repeat('z', 500)))), 'list', (SELECT jsonb_agg(i) FROM generate_series(1, 50) i)),
       now() - (g || ' minutes')::interval
FROM generate_series(1, 3000) g;

-- Memories: 300, shortest to longest, every script.
INSERT INTO memories (content, source_conversation_id, created_at, updated_at)
SELECT CASE g % 6
         WHEN 0 THEN repeat('m', 500)
         WHEN 1 THEN 'x'
         WHEN 2 THEN left('Ashrith prefers ' || repeat('very detailed answers with citations and tables, ', 20), 500)
         WHEN 3 THEN left('يفضل الإجابات القصيرة باللغة العربية ' || repeat('نص ', 100), 500)
         WHEN 4 THEN left(repeat('🦀🚀', 200), 500)
         ELSE left('<b>html</b> **md** `code` ' || repeat('word ', 90), 500) END,
       CASE WHEN g % 4 = 0 THEN NULL ELSE 1 + g % 220 END,
       now() - (g || ' hours')::interval, now() - (g || ' minutes')::interval
FROM generate_series(1, 300) g;

-- Tasks: 300 in every legal state.
INSERT INTO tasks (conversation_id, title, prompt, once_at, cron, timezone, next_run_at, last_run_at, run_count, status, last_error, created_at)
SELECT 1 + g % 220,
       CASE WHEN g % 4 = 0 THEN NULL WHEN g % 4 = 1 THEN repeat('T', 200) ELSE 'Daily summary ' || g END,
       CASE WHEN g % 3 = 0 THEN repeat('Do this very long prompt step by step. ', 400) ELSE 'Remind me to stretch ' || g END,
       CASE WHEN g % 2 = 0 THEN now() + (g || ' hours')::interval ELSE NULL END,
       CASE WHEN g % 2 = 1 THEN (ARRAY['*/5 * * * *','0 9 * * 1-5','30 23 L * *','0 0 1 1 *','15,45 */2 * * 0,6'])[1 + g % 5] ELSE NULL END,
       (ARRAY['Asia/Kolkata','America/Argentina/ComodRivadavia','UTC','Pacific/Chatham'])[1 + g % 4],
       CASE WHEN g % 10 IN (0, 1) AND g % 2 = 0 THEN NULL ELSE now() + (g || ' minutes')::interval END,
       CASE WHEN g % 10 = 0 AND g % 2 = 0 THEN now() - interval '1 day' WHEN g % 3 = 0 THEN now() - interval '1 hour' ELSE NULL END,
       CASE WHEN g % 10 = 0 AND g % 2 = 0 THEN 1 WHEN g % 3 = 0 THEN 9999 ELSE 0 END,
       CASE WHEN g % 10 = 0 AND g % 2 = 0 THEN 'done' WHEN g % 10 = 2 THEN 'cancelled' WHEN g % 7 = 0 THEN 'paused' ELSE 'active' END,
       CASE WHEN g % 5 = 0 THEN 'E-' || g || ': ' || repeat('the agent run failed because something went terribly wrong ', 20) ELSE NULL END,
       now() - (g || ' hours')::interval
FROM generate_series(1, 300) g;

COMMIT;
