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
- [x] Clean sweeps: `/new` deletes the topic's T3 project (all its threads) and its history, and keeps the purpose. `/forget` also clears the purpose. Both confirm with Yes / Cancel buttons that expire after 10 minutes and only work in their own topic. T3 is deleted first and only by verified project id; a project holding threads Herbot didn't start is never touched.
- Done when: ✅ 163 tests (hub permissions, internal API, real MCP over stdio against the binary, clean-sweep safety). ✅ Real T3: `project remove --force` deletes a project with its threads. ✅ Real Codex (GPT-6.1 Terra) called `list_topics` and `read_topic` on live data. ⏳ Manual in Telegram: ask General about other topics and have it `ask_topic`.

## Step 8: Admin panel (TanStack Start)
- [x] herbot-core admin API (`/admin/api`, bearer `HERBOT_ADMIN_TOKEN`): overview, topics, purpose, on/off, clean slate (shared `wipe::run` with `/new` and `/forget`), errors
- [x] Panel: password sign-in with a signed cookie, overview, topics (purpose, on/off, AGENTS.md, recent messages, clean slate), logs searchable by `E-<id>`
- [x] TanStack Query for all data: SSR-filled cache, prefetch on hover, polling, optimistic on/off with rollback
- [x] Every component is shadcn/ui on Tailwind v4 (Sidebar with live agent list, Breadcrumb, Field, InputGroup, Item, Empty, AlertDialog, Sonner…), OKLCH palette, light and dark, phone layout; reviewed against the Emil design-engineering rules (44px touch targets, 16px inputs, neutral focus rings, reduced motion, no layout shift)
- [x] Messages and errors page by cursor (`/conversations/{id}/messages?before|after`, `/errors?before`); the topic page's history is a bounded chat log that loads older pages and merges new messages live
- [x] Production: message counts kept on the conversation (migration 0008), so turns and lists never count history; one query per list; `server.mjs` serves precompressed, immutable assets and compressed pages
- [x] Explicit state machines (`docs/STATE_MACHINES.md`): the schema allows only reachable states (migration 0010 drops archived threads, disabled chats, timed-out questions); `/setup` on a set-up topic says the next message replaces the purpose and offers **Keep the current purpose**; the panel's badge and sidebar dot share one status
- [x] Inbound lanes (migration 0009 `inbox`): each topic's updates in order, topics side by side, so a long voice note no longer holds up other topics; saved before Telegram is acknowledged and resumed after a crash
- Done when: ✅ 14 admin API tests (auth, purpose, on/off, wipe, errors, message and error paging, literal search, exact message counters, short list purposes). The browser (e2e) suites were removed on 2026-11-09. ⏳ Ashrith signs in and clicks through it himself.

## Step 9: Grok parity
Every Grok feature, mapped in [GROK_PARITY.md](GROK_PARITY.md), built in workstreams (W0 by the lead, W1–W6 by GPT-6.1 Sol sub-agents) on `step-9/grok-parity`.
- [x] W0 foundation: photos, documents, video and audio reach the agent (saved in the topic's `files/`, video as stills plus transcript); rich Markdown replies; agents send files with `[[file: …]]` (and local Markdown images); modes (`/mode` Fast/Auto/Expert/Heavy, per-topic Codex reasoning effort) and one-message `/fast`, `/think`, `/heavy`, `/deepsearch`; live web search, image generation, image viewing and sub-agents on for every topic (`agents/.codex/config.toml`); AGENTS.md ground rules v5; `/internal/simulate` for offline runs (`HERBOT_SIMULATE=1`)
- [x] W1 spoken replies (OpenAI speech, 13 voices, `/voice`, `/speak`), original personas with voices (`/persona`, confirmed)
- [x] W2 scheduled tasks: one-off and cron with IANA timezones (`HERBOT_TIMEZONE`), agent tools, `/tasks`, panel Tasks page, 15 s scheduler on the conversation lanes
- [x] W3 shared memory (200 × 500 chars, `remember`/`recall`/`forget`, `/memory`) and custom instructions plus about-you (`/customize`, `/aboutme`, panel pages), in `agents/PERSONAL.md`
- [x] W4 the panel as a chat app: web chat with attachments and per-message modes, rich rendering, new agents, topic mode, files, search, connectors
- [x] W5 `/retry` and 🔄, edited messages re-asked, `/export` (Markdown + HTML), `/search`, `/private`, reaction feedback, a progress timer for long turns
- [x] W6 `/imagine`, `/sticker` (Codex's image generation), `/summary`. Video generation and replying when tagged on X are out of scope
- [x] W7 animated companions with voice chat in the panel
- [x] Lead: `/x` (live web search of X), `/wiki` (Grokipedia), `/language`
- Done when: ✅ every row in GROK_PARITY.md is ✅, 🔑 or ⛔ with a reason; ✅ each ✅ feature ran once through the live bot with simulated messages (2026-11-10); ⏳ Ashrith tries it end to end in Telegram and the panel.

## Step 10: Isolated bots-T3 and VPS deploy
- [ ] bots-T3 container: separate user, no host mounts except `bots/`, resource limits, rebuildable
- [ ] Production `docker-compose`, webhook or long polling, Tailscale-only admin, nightly encrypted Postgres backup
- [ ] Admin panel on real hardware (deferred from Step 8 on 2026-11-09): iPhone sheet clears the home indicator, the purpose box stays above the keyboard, history flick-scrolls smoothly on a mid-range Android, VoiceOver reads a topic well
- Done when: a fresh VPS comes up from the README alone.

## Step 11: Hardening
- [ ] Rate limits, retention job, health alerts to the admin
- Done when: a week runs with no manual restarts.

## Step 11: Review and performance
- Header sanitization handles Unicode case expansion without panicking; outbound file resolution rejects sibling topics, including symlink escapes.
- Verification results are recorded in the review report; no live bot or database checks are used.
- Hub history label lookups are batched; migration 0019 indexes open-question cleanup, thread deletion, and per-topic task history.
- T3 CLI timeouts also bound blocked stdin writes, with a fake-process regression test.
