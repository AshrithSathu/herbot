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
Task history loads 50 rows at a time with Load older tasks. History tools search the full-text index first and use literal substring search when it has no matches.

Panel creation and sends reuse an idempotency key on retry. A request interrupted during Telegram stays explicitly pending, so retry cannot duplicate an uncertain action. Panel inbox workers run independently per topic.

Clean slate waits for active work and discards older queued messages using timestamps and Telegram message ordering, including fresh messages sent in the same second. Scheduled occurrences are saved with their claims and unfinished occurrences resume after a process restart; a crash during an external call can replay that effect.

6. If anything fails, you get `❌ Failed (E-1042)` and the details are in the logs. There's no silent fallback.

### Commands

| Command | Does |
|---|---|
| `/setup` | Tell it (again) what this topic is for, typed or by voice. Your next message replaces the purpose; **Keep the current purpose** backs out |
| `/status` | Shows this conversation's place, purpose, AGENTS.md path, model and message count |
| `/help` | Lists commands |
| `/new` | Clean slate: deletes this topic's T3 threads and its stored history, and keeps its purpose. Confirm with the **🧹 Yes** button (expires after 10 minutes) or **Cancel** |
| `/forget` | Same, and also clears the purpose, so the topic sets up again. Same Yes / Cancel buttons |
| `/mode` | This topic's mode: ⚡ Fast, ✨ Auto, 🧠 Expert or 🏋️ Heavy (sub-agents in parallel), as buttons, or `/mode fast` |
| `/fast`, `/think`, `/heavy` + question | One message in that mode |
| `/deepsearch` + question | Researches it across the live web and replies with a cited report, plus the report as a file |
| `/imagine` + prompt | An image (Codex's built-in image generation); reply to a photo to edit it |
| `/x` + topic | What people on X are saying, from the live web |
| `/wiki` + topic | An encyclopedia article from Grokipedia, Wikipedia and sources |
| `/language` + name | The language this topic answers in (English by default); voice notes and spoken replies follow it |
| `/sticker` | A Telegram sticker from a photo you reply to, or from a prompt (drawn by Codex's image generation) |
| `/voice` | Spoken replies on or off and the voice (13 OpenAI voices); `/voice on`, `/voice off`, `/voice marin` |
| `/speak` | Reply to a bot message to hear it once |
| `/persona` | Original ready-made purposes (Coach, Tutor, Storyteller, …) with matching voices; asks before replacing the purpose |
| `/retry` | Answer your last message again (also the 🔄 button under the latest reply). Editing a message re-asks it |
| `/search` + words | Search this topic's history (General: every topic), with links to the messages |
| `/summary [count\|today]` | Summarise recent history, or the message or document you reply to |
| `/export` | This topic as a Markdown and a styled HTML transcript |
| `/private on\|off` | While on, nothing from this topic is stored and memory tools are off (Telegram and T3 keep their own copies) |
| `/tasks` | This topic's scheduled and recurring prompts (pause, resume, delete). Ask any agent "remind me…" or "every morning…" to make one |
| `/memory` | What Herbot remembers about you, shared by every topic, with Forget buttons |
| `/customize [text\|clear]` | How you want every answer (custom instructions) |
| `/aboutme <text\|clear>` | What Herbot should know about you |

Send photos, documents, videos, GIFs, audio and albums too: they're saved in the topic's folder, and the agent looks at images, reads documents, and gets video as stills plus a transcript of its sound. Agents search the live web and cite it, generate and edit images, and send back files (images, PDFs, DOCX, charts, voice notes). Replies render as Telegram formatting. Thumbs up or down on a reply is recorded (a 👎 tells the agent its last answer missed). Long turns show a "Working on it…" timer. See [docs/GROK_PARITY.md](docs/GROK_PARITY.md) for everything Herbot does that Grok does.

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
| `apps/admin` | Admin panel: TanStack Start + TanStack Query, shadcn/ui on Tailwind v4 | 🟡 Step 8 |
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
make admin-stress      # admin panel on 127.0.0.1:3310 against worst-case data (separate database)
make admin             # admin panel on 127.0.0.1:3300 (needs [Bun](https://bun.sh) and the admin settings above)
```

### Admin panel

`apps/admin` is a TanStack Start app on `127.0.0.1` only (on the VPS it goes behind Tailscale). You sign in with `HERBOT_ADMIN_PASSWORD`; the session is a signed, httpOnly cookie. The panel's server talks to herbot-core's `/admin/api` with `HERBOT_ADMIN_TOKEN`, which never reaches the browser.

- **Overview**: topics answering, active T3 threads, messages, errors in the last 24 hours, the last error. Refreshes every 15 seconds.
- **Topics**: each topic's purpose (saving rewrites its `AGENTS.md`, like `/setup`), an on/off switch, its `AGENTS.md`, its history, and the same clean slates as `/new` and `/forget`, behind a confirm dialog. The history is a fixed-height, virtualized chat log (only the messages on screen are in the page, however far back you go): it opens at the newest message, loads 30 older ones at a time as you scroll up (keeping your place), groups by day, cuts long messages to 12 lines with Show more, and picks up new messages live (following them if you're at the bottom, or showing "N new messages" if you scrolled up).
- **Logs**: search failures by `E-1042`, kind or words, as you type, 50 at a time with "Load older errors". Each error shows its full message and context JSON.
- **Chat** (each topic's Chat tab): talk to any agent from the web, like grok.com. Attach files (button, drag and drop, paste), pick a mode for the message (Auto, Fast, Think, Heavy, DeepSearch), and see it posted in Telegram as "🖥️ from the panel", a thinking indicator while the agent works, and the reply rendered with code highlighting, tables, images, players and file cards. **New agent** creates a forum topic with its purpose (the bot needs the "Manage topics" right). **Files** lists everything in the topic's folder; **Settings** has on/off, mode, voice, purpose and clean slates.
- **Search**: full-text search across every topic, with highlighted snippets that jump to the message.
- **Tasks**, **Memory**, **Personalize**: scheduled prompts (create with presets or cron), shared memories, and custom instructions with about-you.
- **Connectors**: the MCP servers Codex has (names and commands only, never secrets) and Herbot's own tools.
- **Companions**: four original animated characters (Luma, Flint, Pip, Orbit) to talk to by voice or text. Hold the mic, speak, and the companion answers out loud while its avatar talks; tap while it speaks to interrupt. Each has its own agent topic with memory, or runs in General (labelled) if the bot can't create topics.

Data goes through TanStack Query: route loaders fill the cache on the server, so pages arrive rendered, hovering a link prefetches its page, the on/off switch updates optimistically and rolls back if herbot-core refuses, and a failed background refresh keeps the last data on screen with a warning. Every part is [shadcn/ui](https://ui.shadcn.com) on Tailwind v4: the Sidebar (lists every agent with its status, collapses to icons with ⌘B, becomes a sheet on phones, remembers its state in a cookie read on the server), Breadcrumb, Card, Table, Field, InputGroup, Item, Empty, Alert, AlertDialog, Switch, Badge, Kbd, Spinner, Skeleton and Sonner toasts. The palette is OKLCH: blue for actions, green, amber and red for status only, and light and dark modes that follow the system.

In production, `make admin-build` and then `bun run --cwd apps/admin start` run `apps/admin/server.mjs` on Bun (Bun is the panel's runtime and package manager). It caches the content-hashed `/assets` for a year without revalidating, and serves them as brotli or gzip files written at build time (718 KB of JavaScript and CSS goes out as 196 KB). Pages and server-function data are compressed as they stream out.

Panel lifecycle ownership and the full state inventory are in [docs/STATE_MACHINES.md](docs/STATE_MACHINES.md#panel-inventory-and-ownership-step-11). Settings drafts survive tab switches, failed reads offer recovery, and accepted New agent creation is separate from opening its page. Companion connection failures offer retry; microphone stop/transcription holds one request lock.

Tests run when Ashrith asks for them, not on every change. The panel has no browser (e2e) tests; they were removed on 2026-11-09.

| Endpoint | Meaning |
|---|---|
| `GET /health` | The process is up |
| `GET /ready` | Postgres answers (returns 503 when it doesn't), plus Telegram status |

CI (formatting, clippy, tests against Postgres) is **manual only**: `gh workflow run ci.yml`. Day to day, run `make check` locally.

## Workflow

Development happens in T3 Code with Codex: one roadmap step per branch (`step-N/<name>`), small logical commits, and each step lands only when its "Done when" checks pass. See [AGENTS.md](AGENTS.md).

The messenger API also exposes `unread` (bot replies, capped at 99), `language` and `private_mode` in conversation list/detail summaries. `POST /admin/api/conversations/{id}/read` accepts `{through_message_id}` from that conversation and advances a shared, durable read marker. Migration 0023 starts existing history as read. `GET /admin/api/activity` batches active/queued conversations as `[{conversation_id, in_progress: true}]`; the per-topic activity route remains available. Typed server/query helpers are ready for the messenger redesign; this change does not alter panel UI.
