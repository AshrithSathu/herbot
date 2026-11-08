# Herbot

**Ashrith's bot**: a private, Grok-style AI assistant on Telegram, running on T3 Code + Codex.

The bot lives in one private Telegram group with Topics turned on: your Herbot group, just you and the bot. **General** is the everyday chat. **Every other topic is its own agent**: the first time you write in a new topic, the bot asks openly what it should be. Your answer, typed at any length or sent as a **voice note**, becomes that topic's `AGENTS.md`, and the topic keeps its own long-running memory, like separate Grok chats. Voice notes work everywhere: they're transcribed to English and the bot shows what it heard. The bot answers only you, stays silent in DMs, and leaves any other group.

> **Status:** Steps 1–6 are done. Step 7 (herbot-mcp: agents see your history, General works across topics) is in progress. See [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works

```
Telegram Bot API ⇄ herbot-core (Rust) ⇄ bots-T3 (Codex, isolated container)
                        │                  └─ herbot-mcp (Rust)
                        ├─ Postgres (chats, conversations, messages, threads, errors)
                        └─ admin API ⇄ admin panel (TanStack Start)
```

1. **herbot-core** long-polls the Telegram Bot API. It drops anything outside your Herbot group or not sent by your account, ignores DMs, and leaves any other group. Every message of yours gets a 👀 reaction the moment it arrives, so you know the bot saw it.
2. Your message (or voice note, transcribed by OpenAI `gpt-transcribe`) is stored under its **conversation**: General, or the topic it was sent in. A new topic first asks what it should be and writes `agents/chat_<id>/topic_<n>/AGENTS.md`.
3. It goes to that conversation's **T3 Code thread**, running Codex on **GPT-6.1 Terra at medium effort** (your Codex subscription). Each conversation folder is a T3 project, so Codex reads its `AGENTS.md`. Turns in one topic run in order; different topics run in parallel. While Codex works the topic shows "typing…", then the reply arrives quoting your message, with secrets scrubbed and long answers split.
4. When the agent wants you to pick, its reply ends with **buttons** (from an `[[ask: A | B | C]]` line). Tap one, or just type your own answer, and the thread continues. If Codex ever blocks inside T3, you get a direct link to the thread.
5. Agents have **herbot tools** (MCP). **General is the hub:** it can list every topic, search and read their history, ask another topic's agent something (`ask_topic`), or post into a topic. Each topic can search and read only its own history.
6. If anything fails, you get `❌ Failed (E-1042)` and the details are in the logs. There's no silent fallback.

### Commands

| Command | Does |
|---|---|
| `/setup` | Tell it (again) what this topic is for, typed or by voice |
| `/status` | Shows this conversation's place, purpose, AGENTS.md path, model and message count |
| `/help` | Lists commands |
| `/new` | Clean slate: deletes this topic's T3 threads and its stored history, and keeps its purpose. Confirm with the **🧹 Yes** button (expires after 10 minutes) or **Cancel** |
| `/forget` | Same, and also clears the purpose, so the topic sets up again. Same Yes / Cancel buttons |

## Setup

1. In Telegram, talk to [@BotFather](https://t.me/BotFather): run `/newbot`, then `/setprivacy` → **Disable**, so the bot sees every message in your group, not only commands.
2. Find your own numeric Telegram user ID, for example by messaging [@userinfobot](https://t.me/userinfobot).
3. Create a group, turn on **Topics**, and add the bot.
4. Put the values in `.env` (see `.env.example`):
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC…
   HERBOT_ADMIN_TELEGRAM_ID=123456789
   HERBOT_HOME_CHAT_ID=-100…   # your group; the log shows it as "registered chat" when you add the bot
   OPENAI_API_KEY=sk-…         # only for voice notes (gpt-transcribe, about $0.0045/min)
   ```
   Optional: `HERBOT_T3_BIN` (default `~/.t3/bin/t3`, a T3 Code nightly with `t3 thread`), `HERBOT_TURN_TIMEOUT_SECS` (default 600), `HERBOT_TRANSCRIBE_MODEL` (default `gpt-transcribe`), `HERBOT_AGENT_MODEL` / `HERBOT_AGENT_EFFORT` (default `gpt-6.1-terra` / `medium`), `HERBOT_AGENTS_DIR` (default `agents`).
5. `make run`, then send `/status` in General.
6. Give agents their tools: add `HERBOT_INTERNAL_TOKEN` (any 64 hex characters) to `.env`, run `cargo build --release -p herbot-mcp`, then `./scripts/codex-mcp-config.sh >> ~/.codex/config.toml`. `codex mcp list` should show `herbot`.

Without `TELEGRAM_BOT_TOKEN`, herbot-core still starts (for tests and local work). `/ready` then reports `"telegram": "disabled"`.

## Repository layout

| Path | What | Status |
|---|---|---|
| `crates/herbot-core` | Telegram adapter, admin-only policy, conversations, T3 adapter, admin API (Rust) | 🟡 Step 3 |
| `crates/herbot-mcp` | MCP tools for agents: `list_topics`, `search_messages`, `read_topic`, and General's `ask_topic` and `post_to_topic` (Rust, `rmcp`) | 🟡 Step 7 |
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
make test-voice        # real OpenAI transcription of generated speech (fractions of a cent)
make db-down           # stop Postgres (make db-reset also deletes data)
```

| Endpoint | Meaning |
|---|---|
| `GET /health` | The process is up |
| `GET /ready` | Postgres answers (returns 503 when it doesn't), plus Telegram status |

CI (formatting, clippy, tests against Postgres) is **manual only**: `gh workflow run ci.yml`. Day to day, run `make check` locally.

## Workflow

Development happens in T3 Code with Codex: one roadmap step per branch (`step-N/<name>`), small logical commits, and each step lands only when its "Done when" checks pass. See [AGENTS.md](AGENTS.md).
