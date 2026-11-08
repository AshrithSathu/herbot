# Herbot

**Ashrith's bot**: a private, Grok-style AI assistant on Telegram, running on T3 Code + Codex.

You add the bot to your own Telegram groups, or open topics in one private supergroup. Each chat or topic becomes its own long-running conversation with full memory, like separate Grok chats. The bot answers only you and ignores everyone else.

> **Status:** Step 1 of 10 is done, and Step 2 (Telegram adapter) is in progress. See [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works

```
Telegram Bot API ⇄ herbot-core (Rust) ⇄ bots-T3 (Codex, isolated container)
                        │                  └─ herbot-mcp (Rust)
                        ├─ Postgres (chats, conversations, messages, threads, errors)
                        └─ admin API ⇄ admin panel (TanStack Start)
```

1. **herbot-core** long-polls the Telegram Bot API. It drops anything not sent by your Telegram account, and leaves any group someone else adds it to.
2. Your message is stored under its **conversation**: the chat, plus the topic if the group has topics.
3. It goes to that conversation's **T3 Code thread**. Herbot waits for Codex, then posts the reply in the same chat or topic.
4. If Codex has a question, it appears with **tap-to-answer buttons**, and the thread continues once you answer.
5. If anything fails, you get `❌ Failed (E-1042)` and the details are in the logs. There's no silent fallback.

### Commands

| Command | Does |
|---|---|
| `/status` | Shows this conversation's chat, topic and message count |
| `/help` | Lists commands |
| `/new` | Starts a fresh thread for this conversation (Step 4) |
| `/forget` | Wipes this conversation's thread and history (Step 4) |

## Setup

1. In Telegram, talk to [@BotFather](https://t.me/BotFather): run `/newbot`, then `/setprivacy` → **Disable**, so the bot sees every message in your groups, not only commands.
2. Find your own Telegram user ID, for example by messaging [@userinfobot](https://t.me/userinfobot).
3. Put both in `.env` (see `.env.example`):
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC…
   HERBOT_ADMIN_TELEGRAM_ID=123456789
   ```
4. `make run`, then DM your bot `/status`.

Without `TELEGRAM_BOT_TOKEN`, herbot-core still starts (for tests and local work). `/ready` then reports `"telegram": "disabled"`.

## Repository layout

| Path | What | Status |
|---|---|---|
| `crates/herbot-core` | Telegram adapter, admin-only policy, conversations, T3 adapter, admin API (Rust) | 🟡 Step 2 |
| `crates/herbot-mcp` | Conversation-scoped tools for bot threads (Rust) | ⏳ Step 7 |
| `apps/admin` | Admin panel (TanStack Start) | ⏳ Step 8 |
| `bots/` | One T3 project per bot persona | ⏳ Step 4 |
| `docs/ROADMAP.md` | Build plan with "Done when" checks | |
| `AGENTS.md` | Rules for coding agents working on this repo | |

## Development

Requires Rust (stable, edition 2024), Docker (OrbStack works) and Make.

```bash
cp .env.example .env   # add your bot token and Telegram ID
make db-up             # Postgres 18 on 127.0.0.1:5433
make test              # unit + integration tests (each gets a fresh database)
make smoke             # boot the real binary, check /health, /ready and shutdown
make run               # run herbot-core with pretty logs on 127.0.0.1:8787
make check             # fmt + clippy (warnings are errors) + tests
make db-down           # stop Postgres (make db-reset also deletes data)
```

| Endpoint | Meaning |
|---|---|
| `GET /health` | The process is up |
| `GET /ready` | Postgres answers (returns 503 when it doesn't), plus Telegram status |

CI (formatting, clippy, tests against Postgres) is **manual only**: `gh workflow run ci.yml`. Day to day, run `make check` locally.

## Workflow

Development happens in T3 Code with Codex: one roadmap step per branch (`step-N/<name>`), small logical commits, and each step lands only when its "Done when" checks pass. See [AGENTS.md](AGENTS.md).
