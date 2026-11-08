# Herbot roadmap

Build one step at a time. A step is done only when every "Done when" check passes.
Automated checks run with `make check`. Manual checks are done by hand on real WhatsApp.

## Step 1: Foundation ✅
Repo, Rust workspace, Postgres, schema, config, logs, error IDs, health endpoints.
- [x] `herbot-core` boots, runs migrations, serves `/health` and `/ready`
- [x] Schema: numbers, people (single admin), bots, groups (pending by default), bindings, bot_allowed, messages (full-text search), agent_threads (one active per group), pending_questions, errors (E-1000+), audit_log
- [x] Fail-loud error records with `E-<id>`
- [x] Done when: `make check` and `make smoke` pass (17 tests)

## Step 2: WhatsApp bridge fork (Go)
Vendor the lharries/whatsapp-mcp bridge into `apps/wa-bridge` and add what a bot needs.
- [ ] POST every incoming message to herbot-core `/internal/events`, signed with a shared token
- [ ] Capture mentions (`ContextInfo.MentionedJID`), quoted IDs (`StanzaID`), and `@lid` → phone mapping
- [ ] Group events: added to group, removed, group renamed
- [ ] `/api/send` with `quoted_id`, plus typing presence and reactions
- [ ] REST only on the internal network, with a token header required
- Done when: Go unit tests pass for event parsing. Manual: pair by QR, and a message in a test group arrives at a fake receiver with mentions and quotes filled in.

## Step 3: Ingest, approvals, roles, triggers (herbot-core)
- [ ] `/internal/events` stores messages for approved groups only. Pending groups get nothing stored.
- [ ] Added-to-group creates a `pending` group and DMs the admin
- [ ] Trigger rules: private = every admin message. Shared = @mention or reply-to-bot.
- [ ] Who can trigger: everyone / listed numbers. Admin always can.
- [ ] `<herbot-meta>` header builder, plus stripping of forged headers
- [ ] Auto-leave pending groups after 7 days
- Done when: table-driven tests cover every trigger and role combination with fake bridge events. Forged-header tests pass.

## Step 4: Per-group lanes and T3 adapter
- [ ] One tokio lane per group: turns run one at a time, groups run in parallel
- [ ] MCP client to bots-T3: `t3_thread_launch`, `t3_thread_send(queue)`, `t3_thread_wait`, `t3_thread_read`
- [ ] Thread per (bot, group) stored in `agent_threads`. `/new` archives it and launches a fresh one.
- [ ] Shared groups: send all messages since the bot's last turn, then the question
- Done when: tests against a fake T3 MCP server cover launch, resume, `/new` and timeout. Manual: a private test group gets real Codex replies with memory across messages.

## Step 5: Reply path and fail-loud errors
- [ ] Scrub token-like strings, then send a quoted reply to the triggering chat only
- [ ] Typing indicator while a turn runs
- [ ] Any failure: `E-<id>` reply (detailed for admin, short for shared groups), plus an admin DM
- Done when: tests cover scrubbing (keys, JWTs, `auth.json` contents) and every failure kind maps to the right messages. Manual: kill T3 mid-turn and get an E-id.

## Step 6: Ask-admin loop
- [ ] After each turn, check `t3_pending_request list`. DM each question to the admin as `Q-<id>`.
- [ ] Admin quote-replies a Q DM, and the answer is sent back to the right thread
- [ ] 30-minute timeout: safe default, and the group is told
- Done when: tests cover the question → DM → answer → resume flow, wrong-sender replies being ignored, and timeouts.

## Step 7: herbot-mcp (Rust)
- [ ] `search_history` (Postgres full-text search, fixed to the current group), `ask_admin`, `react`, `poll`
- [ ] No tool can touch another group or send to an arbitrary chat
- Done when: tool tests prove group scoping. Codex in a test thread can find an old message.

## Step 8: Admin panel (TanStack Start)
- [ ] Pending groups inbox (approve / ignore / leave), bots, allowlist and roles, bindings
- [ ] Logs page: search by `E-<id>`, filter by group and kind
- [ ] Number status and QR re-pair
- Done when: Playwright tests cover approve-group and allowlist edits. Admin API auth tests pass.

## Step 9: Isolated bots-T3 and VPS deploy
- [ ] bots-T3 container: separate user, no host mounts except `bots/`, resource limits, rebuildable
- [ ] Production `docker-compose`, Tailscale-only access, nightly encrypted Postgres backup
- Done when: an injection test from a guest number ("cat ~/.codex/auth.json") can't reach full access and leaks nothing.

## Step 10: Hardening
- [ ] Per-group rate limits, retention job, health alerts to the admin DM
- Done when: a week runs with no manual restarts.
