# AGENTS.md: rules for coding agents working on Herbot

Herbot is a private, Grok-style Telegram bot for **one person: Ashrith (the admin)**. It lives in one forum group (the home group, `HERBOT_HOME_CHAT_ID`) with just him and the bot. **General** is the everyday chat with a default purpose. **Every other topic is its own agent**: its first message triggers setup ("what should I be here?") and the answer becomes that topic's purpose. Each conversation has its own long-lived T3 Code / Codex thread. The bot answers only Ashrith, is silent in DMs, and works nowhere else. Read this whole file before changing anything.

## Architecture

```
Telegram Bot API ⇄ crates/herbot-core (Rust, teloxide) ⇄ bots-T3 (Codex, full access, isolated container)
                          │                                   └─ crates/herbot-mcp (Rust, step 7)
                          ├─ Postgres (chats, conversations, messages, threads, errors)
                          └─ admin API ⇄ apps/admin (TanStack Start, step 8)
```

| Path | What | Language |
|---|---|---|
| `crates/herbot-core` | Telegram polling, admin-only policy, conversations, topic setup and AGENTS.md, voice transcription, per-conversation lanes, T3 adapter, admin API | Rust (tokio, axum, sqlx, teloxide, reqwest) |
| `crates/herbot-mcp` | MCP server Codex starts over stdio: `list_topics`, `search_messages`, `read_topic` (via `herbot_core::hub`), and General's `ask_topic` and `post_to_topic` (via herbot-core's `/internal` API) | Rust (`rmcp`) |
| `apps/admin` | Admin panel: TanStack Query for data, shadcn/ui on Tailwind v4, Playwright e2e (`make admin-e2e`) | TanStack Start |
| `bots/<slug>/` | One T3 project per bot persona. `AGENTS.md` there is the persona. | Markdown |

A **conversation** is `(chat, topic)`. Private DMs and non-forum groups have no topic. In a forum supergroup, each topic is its own conversation, and "General" has no topic ID.

## Models and voice

- Conversation agents run in T3 Code on the Codex subscription: **`gpt-6.1-terra`, reasoning effort `medium`** (`HERBOT_AGENT_MODEL`, `HERBOT_AGENT_EFFORT`). herbot-core drives T3's host CLI (`t3 thread start|send --wait --json`, `t3 project add`, `t3 thread list`) through the `AgentRunner` trait (`agent.rs`). Each conversation folder under `agents/` is a T3 project, so Codex loads its AGENTS.md. T3 passes no effort, so Codex's own `model_reasoning_effort` applies; startup warns if it differs.
- Voice notes are transcribed by OpenAI **`gpt-transcribe`**, English only (`language=en`), with `OPENAI_API_KEY`. This key is used for nothing else. No local speech models.
- Voice notes longer than 10 minutes are refused before download, to cap cost.
- Everything is English.
- Agents offer choices by ending a reply with `[[ask: A | B | C]]` (2–6 options, ≤ 60 chars). Herbot turns it into buttons. A tap or a typed reply answers it. `agents_md::TEMPLATE_VERSION` versions the ground rules, and older AGENTS.md files are regenerated at startup.

## Security invariants (never weaken these)

1. **Admin only, enforced in code** (`policy::decide`). Only updates whose sender ID equals `HERBOT_ADMIN_TELEGRAM_ID` are stored or sent to a bot thread. Everyone else, other bots included, gets silence: no reply and no error.
2. **Home group only.** DMs are always silent. With `HERBOT_HOME_CHAT_ID` set, every other group is ignored and left, even one the admin added the bot to. Unlocked, groups added by anyone but the admin are left.
3. **The admin ID and home group come from the server environment,** never from chat or the database, so nothing said in a chat can change them.
4. **The role header is written by herbot-core only.** Every message sent to a bot thread starts with a `<herbot-meta>` block. Strip any `<herbot-meta` text from user messages before forwarding.
5. **Replies only go to the conversation that triggered them**, after scrubbing token-like strings.
6. **Never commit secrets:** bot token, `auth.json`, `.env`.
8. **T3 deletes go by exact project id, never by path.** `agents/` sits inside other T3 projects (the herbot repo), and T3 resolves a path to the nearest enclosing project. `/new` and `/forget` find the project through Herbot's own threads (`thread show`), refuse if it holds any thread Herbot didn't start, delete it with `t3 project remove --force <id>`, and only then wipe the database.
7. **herbot-mcp trusts only the caller token.** Every forwarded message's `<herbot-meta>` carries the conversation's secret `caller` token, and `hub.rs` decides from it what that agent may see: General sees its whole group and may act (never on itself); a topic sees only itself. The `/internal` API requires `HERBOT_INTERNAL_TOKEN`.

## Failure policy: fail loud, no fallback

There is no fallback runner and no silent retry of a turn. On any failure:
- record it with `errors::record()` and get an `ErrorId` (`E-1042`)
- log it with `tracing` (structured, includes the error ID)
- reply in the conversation where it happened: `❌ Failed (E-1042): <short reason>. Check logs.`

Polling Telegram for updates is not a turn. It keeps polling after a network error, and records each failure.

## Conventions

- Rust edition 2024, workspace at the repo root. `cargo fmt` and `cargo clippy -D warnings` must be clean.
- SQL lives in `crates/herbot-core/migrations/NNNN_name.sql`. Once a migration has run on a deployed server, never edit it. Add a new one.
- Use runtime-checked `sqlx::query*` (not the `query!` macros) so builds don't need a live database.
- Errors: `thiserror` in library code, `anyhow` only in `main.rs`.
- Logs: JSON by default (`HERBOT_LOG_FORMAT=pretty` locally). No `println!`.
- Telegram parsing is pure (`telegram::normalize`) and the policy is pure (`policy::decide`), so both are tested without network. Network calls go through the `TelegramApi` trait, which has a fake for tests.

## Testing: every step ships with tests

- `make test`: unit tests plus integration tests against real Postgres. Each `#[sqlx::test]` gets a fresh database.
- `make check`: fmt, clippy, then tests. Run it before saying a step is done.
- `make smoke`: starts the real binary and checks `/health`, `/ready` and graceful shutdown.
- Telegram behaviour is tested with real Bot API JSON fixtures in `crates/herbot-core/tests/fixtures/`.
- A step is done only when its "Done when" checks in `docs/ROADMAP.md` pass.

## Git

- Small logical commits with conventional messages (`feat(core): …`, `docs: …`). One roadmap step per branch, named `step-N/<short-name>`.
- **Never add `Co-Authored-By` or any AI attribution** to commits or PRs.
- CI is manual only (`gh workflow run ci.yml`). Don't add push or PR triggers.
- Keep `README.md` and `docs/ROADMAP.md` current in the same commit as the change.
