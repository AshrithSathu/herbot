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
- [x] `/setup` rewrites a topic's AGENTS.md; `/status` shows purpose, file and model (`gpt-6.1-terra · medium`)
- [ ] `<herbot-meta>` header builder, and stripping of forged headers (moves to Step 4, where messages reach the agent)
- Done when: ✅ 78 tests plus `make test-voice` (real speech → `gpt-transcribe`). Manual: new topic, answer by voice note, `/status` shows it.

## Step 4: Per-conversation lanes and T3 adapter
- [ ] One tokio lane per conversation: turns run one at a time, conversations run in parallel
- [ ] MCP client to bots-T3: `t3_thread_launch` (Codex, `gpt-6.1-terra`, effort `medium`, cwd = the conversation's AGENTS.md folder), `t3_thread_send(queue)`, `t3_thread_wait`, `t3_thread_read`
- [ ] `<herbot-meta>` header on every forwarded message, and stripping of forged headers
- [ ] Thread per conversation in `agent_threads`. `/new` archives it and launches a fresh one, and `/forget` wipes it.
- Done when: tests against a fake T3 MCP server cover launch, resume, `/new` and timeout. Manual: a topic gets real Codex replies with memory across messages.

## Step 5: Reply path and fail-loud errors
- [ ] Typing action while a turn runs. The reply is edited in as it progresses, then the final reply goes in the same topic.
- [ ] Scrub token-like strings. Split replies longer than 4096 characters.
- [ ] Any failure gives an `❌ Failed (E-<id>)` reply in that conversation
- Done when: tests cover scrubbing, splitting, and error replies. Manual: stop T3 mid-turn and get an E-id.

## Step 6: Ask-admin with buttons
- [ ] After each turn, check `t3_pending_request list` and post each question in the conversation with inline buttons
- [ ] A button tap, or a typed answer, goes back to the thread, which continues
- [ ] 30-minute timeout: take the safe default and say so
- Done when: tests cover question → buttons → answer → resume, stale buttons, and timeouts.

## Step 7: herbot-mcp (Rust)
- [ ] `search_history` (Postgres full-text search, fixed to the current conversation) and `ask_admin`
- Done when: tool tests prove conversation scoping, and Codex in a test thread finds an old message.

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
