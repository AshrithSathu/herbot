# Herbot roadmap

A private Telegram bot for one person (the admin). Build one step at a time. A step is done only when every "Done when" check passes. Automated checks run with `make check`. Manual checks are done by hand in Telegram.

> The project started on WhatsApp. That work is parked on the `step-2/wa-bridge` branch in case a WhatsApp channel is ever added back.

## Step 1: Foundation ✅
- [x] `herbot-core` boots, runs migrations, serves `/health` and `/ready`
- [x] Fail-loud error records with `E-<id>`
- [x] Done when: `make check` and `make smoke` pass

## Step 2: Telegram adapter (single user) ✅
- [x] Schema for Telegram: chats, conversations (chat + topic), messages with search, agent threads, admin questions, key/value state
- [x] `telegram::normalize`: Bot API updates become messages, commands, added/removed events, topic names and renames
- [x] `policy::decide`: admin-only. Others are ignored, and groups added by others are left.
- [x] Long-poll loop with a persisted offset. Admin messages are stored per conversation.
- [x] Commands menu: `/status`, `/help` working; `/new`, `/forget` answer "arrives in Step 4"
- [x] `/ready` reports the Telegram bot username
- Done when: ✅ fixture tests cover every update kind and policy branch, and store tests cover conversations and duplicates. ✅ Manual (2026-11-08, @sashrith_bot): `/status` and per-topic conversations confirmed in a real forum group. ⏳ Stranger test still to do:
  1. Create the bot with @BotFather and turn privacy mode **off**
  2. DM the bot and run `/status`
  3. Add it to a forum supergroup, post in two topics, and check that `/status` in each shows its own conversation
  4. From a second account, a DM gets no reply, and adding the bot to a group makes it leave

## Step 3: Home group, General, topic setup and voice
- [x] DMs are silent; with `HERBOT_HOME_CHAT_ID` the bot works only in the home group and leaves any other
- [x] `/` command menu shown only in the home group, cleared for DMs
- [x] General is the everyday chat: set up silently with the default purpose and its own AGENTS.md
- [x] Each new topic asks openly "what should I be here?" (no presets). The next message, typed or spoken, becomes its purpose and `agents/chat_<id>/topic_<n>/AGENTS.md`
- [x] Voice notes everywhere: OpenAI `gpt-transcribe` (English), echo of what was heard, 10-minute cap, fail loud without a key
- [x] 👀 reaction on every admin message as a "seen" receipt (a failed reaction is recorded, never blocks the message)
- [x] `/setup` rewrites a topic's AGENTS.md; `/status` shows purpose, file and model (`gpt-6.1-terra · medium`)
- [ ] `<herbot-meta>` header builder, and stripping of forged headers (moves to Step 4, where messages reach the agent)
- Done when: ✅ 81 tests plus `make test-voice` (real speech → `gpt-transcribe`). Manual: new topic, answer by voice note, `/status` shows it.

## Step 4: Agent threads: the bot answers ✅
- [x] `agent.rs`: `AgentRunner` over T3's host CLI: `project add`, `thread start|send --wait --json` (Codex, `gpt-6.1-terra`), `thread list` for links and timeout recovery
- [x] Each conversation folder is a T3 project; its AGENTS.md is the agent's instructions; "reread AGENTS.md" note after `/setup`
- [x] `<herbot-meta>` header on every forwarded message; forged headers defused
- [x] `turns.rs`: one lane per conversation (in order), conversations in parallel; typing indicator; 10-minute timeout
- [x] Replies: secrets scrubbed, split under Telegram's limit, quoted, stored as bot messages
- [x] Fail loud: run failures, timeouts, CLI errors → `❌ Failed (E-<id>)`; agent questions point to T3 until Step 6
- [x] `/new` archives the thread; `/forget` asks, then deletes stored messages and archives; `/status` links the thread in T3
- [x] Startup checks: T3 CLI has `thread`; Codex effort matches
- Done when: ✅ 120 tests (turns against a fake T3 and a fake `t3` script driving the real CLI wrapper). ✅ Manual (2026-11-08): a real reply in Testing with its persona in about 10 s, and memory across messages in about 6 s.

## Step 5: Reply path and fail-loud errors ✅
Built as part of Step 4: typing indicator, secret scrubbing, splitting, quoted replies, `❌ Failed (E-<id>)` on every failure.

## Step 6: Choices from the agent, answered in Telegram ✅
- [x] Agents end a reply with `[[ask: A | B | C]]` (rule in every AGENTS.md); Herbot strips it and shows buttons on the reply's last part
- [x] A tap claims the question atomically (one answer only, same topic only), shows "👉 choice", and sends it to the agent as the next turn
- [x] A typed reply closes any open buttons in that topic and goes to the agent as the answer
- [x] AGENTS.md template versions: older files are rewritten at startup, and threads are told to reread them
- [x] If Codex blocks waiting inside T3 (rare in full access), the reply links straight to the thread
- Done when: ✅ 131 tests. ✅ Manual (2026-11-09): the agent offered Yes/No buttons on its own, a voice reply superseded them, and a tapped option reached the agent.

## Step 7: herbot-mcp, so agents see history and General works across topics
- [x] Each conversation has a secret caller token, sent in every `<herbot-meta>` header
- [x] `hub.rs`: General lists, searches and reads its whole group; a topic only itself (plus the topic list); groups never leak into each other
- [x] `herbot-mcp` (rmcp, stdio): `list_topics`, `search_messages`, `read_topic`, `ask_topic`, `post_to_topic`
- [x] herbot-core `/internal/post` and `/internal/ask` (token-protected): General's question shows in the topic, that topic's lane runs it, and the answer comes back
- [x] AGENTS.md v4: General and topics each get their own tools section
- [x] `scripts/codex-mcp-config.sh` registers herbot-mcp with Codex
- [x] Clean sweeps: `/new` deletes the topic's T3 project (all its threads) and its history, and keeps the purpose. `/forget` also clears the purpose. T3 is deleted first and only by verified project id; a project holding threads Herbot didn't start is never touched.
- Done when: ✅ 156 tests (hub permissions, internal API, real MCP over stdio against the binary, clean-sweep safety). ✅ Real T3: `project remove --force` deletes a project with its threads. ✅ Real Codex (GPT-6.1 Terra) called `list_topics` and `read_topic` on live data. ⏳ Manual in Telegram: ask General about other topics and have it `ask_topic`.

## Step 8: Admin panel (TanStack Start)
- [ ] Chats and topics, personas, per-conversation settings, threads
- [ ] Logs page: search by `E-<id>`
- Done when: Playwright tests cover editing a conversation's persona and disabling it. Admin API auth tests pass.

## Step 9: Isolated bots-T3 and VPS deploy
- [ ] bots-T3 container: separate user, no host mounts except `bots/`, resource limits, rebuildable
- [ ] Production `docker-compose`, webhook or long polling, Tailscale-only admin, nightly encrypted Postgres backup
- Done when: a fresh VPS comes up from the README alone.

## Step 10: Hardening
- [ ] Rate limits, retention job, health alerts to the admin
- Done when: a week runs with no manual restarts.
