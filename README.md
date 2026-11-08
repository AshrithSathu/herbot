# Herbot

**Ashrith's bot**: a private, Grok-style AI assistant on Telegram, running on T3 Code + Codex.

The bot lives in one private Telegram group with Topics turned on: your Herbot group, just you and the bot. **General** is the everyday chat. **Every other topic is its own agent**: the first time you write in a new topic, the bot asks openly what it should be. Your answer, typed at any length or sent as a **voice note**, becomes that topic's `AGENTS.md`, and the topic keeps its own long-running memory, like separate Grok chats. Voice notes work everywhere: they're transcribed to English and the bot shows what it heard. The bot answers only you, stays silent in DMs, and leaves any other group.

> **Status:** Steps 1–7 are done. Step 8 (the admin panel) is in progress. See [docs/ROADMAP.md](docs/ROADMAP.md).

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

7. Optional, the admin panel: add `HERBOT_ADMIN_TOKEN` and `HERBOT_SESSION_SECRET` (each 64 hex characters, e.g. `openssl rand -hex 32`) and `HERBOT_ADMIN_PASSWORD` (12+ characters, your sign-in password) to `.env`, restart herbot-core, then `make admin` and open http://127.0.0.1:3300.

Without `TELEGRAM_BOT_TOKEN`, herbot-core still starts (for tests and local work). `/ready` then reports `"telegram": "disabled"`.

## Repository layout

| Path | What | Status |
|---|---|---|
| `crates/herbot-core` | Telegram adapter, admin-only policy, conversations, T3 adapter, admin API (Rust) | 🟡 Step 3 |
| `crates/herbot-mcp` | MCP tools for agents: `list_topics`, `search_messages`, `read_topic`, and General's `ask_topic` and `post_to_topic` (Rust, `rmcp`) | 🟡 Step 7 |
| `apps/admin` | Admin panel: TanStack Start + TanStack Query, shadcn/ui on Tailwind v4, Playwright tests | 🟡 Step 8 |
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
make admin             # admin panel on 127.0.0.1:3300 (needs pnpm and the admin settings above)
make admin-e2e         # panel tests in your installed Google Chrome, on a throwaway DB and ports
```

### Admin panel

`apps/admin` is a TanStack Start app on `127.0.0.1` only (on the VPS it goes behind Tailscale). You sign in with `HERBOT_ADMIN_PASSWORD`; the session is a signed, httpOnly cookie. The panel's server talks to herbot-core's `/admin/api` with `HERBOT_ADMIN_TOKEN`, which never reaches the browser.

- **Overview**: topics answering, active T3 threads, messages, errors in the last 24 hours, the last error. Refreshes every 15 seconds.
- **Topics**: each topic's purpose (saving rewrites its `AGENTS.md`, like `/setup`), an on/off switch, its `AGENTS.md`, its last 50 messages (refreshing every 10 seconds), and the same clean slates as `/new` and `/forget`, behind a confirm dialog.
- **Logs**: search failures by `E-1042`, kind or words, as you type. Each error shows its context JSON.

Data goes through TanStack Query: route loaders fill the cache on the server, so pages arrive rendered, hovering a link prefetches its page, the on/off switch updates optimistically and rolls back if herbot-core refuses, and a failed background refresh keeps the last data on screen with a warning. UI parts are [shadcn/ui](https://ui.shadcn.com) on Tailwind v4 with an OKLCH palette: blue for actions, green, amber and red for status only, and light and dark modes that follow the system.

`make admin-e2e` builds everything and runs Playwright in your installed Chrome (no browser download) against a real herbot-core with its own database (`herbot_e2e`), ports 8789 and 3399, no Telegram and a T3 that refuses everything. It never touches the live bot. To capture every page in light and dark, on desktop and phone: `SCREENSHOTS=/some/dir ./scripts/admin-e2e.sh e2e/screenshots.spec.ts`.

| Endpoint | Meaning |
|---|---|
| `GET /health` | The process is up |
| `GET /ready` | Postgres answers (returns 503 when it doesn't), plus Telegram status |

CI (formatting, clippy, tests against Postgres) is **manual only**: `gh workflow run ci.yml`. Day to day, run `make check` locally.

## Workflow

Development happens in T3 Code with Codex: one roadmap step per branch (`step-N/<name>`), small logical commits, and each step lands only when its "Done when" checks pass. See [AGENTS.md](AGENTS.md).
