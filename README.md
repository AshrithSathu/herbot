# Herbot

**Ashrith's bot**: a Grok-style AI assistant that lives in WhatsApp.

Tag it in a group or reply to one of its messages, and it reads the conversation and answers. In Ashrith's private WhatsApp community, each group works like a separate long-running chat with its own memory. Under the hood, every group is one T3 Code thread running Codex.

> **Status:** Step 1 of 10 (foundation) is done. See [docs/ROADMAP.md](docs/ROADMAP.md).

## How it works

```
WhatsApp ⇄ wa-bridge (Go) ⇄ herbot-core (Rust) ⇄ bots-T3 (Codex, isolated container)
                                 │                     └─ herbot-mcp (Rust)
                                 ├─ Postgres (messages, threads, queue, errors)
                                 └─ admin API ⇄ admin panel (TanStack Start)
```

1. **wa-bridge** is logged in as the bot's own WhatsApp number. It forwards every message to herbot-core and sends replies back.
2. **herbot-core** decides whether to answer. The group must be approved and the sender allowed, and in shared groups the bot also has to be tagged or replied to.
3. It sends the new messages to that group's **T3 Code thread**, waits for Codex, scrubs the reply, and posts it in the group as a quoted reply.
4. If Codex has a question, the bot **DMs Ashrith**. His reply goes back into the thread, which continues on its own.
5. If anything fails, the bot replies with an error ID like `E-1042` and logs the details. There's no silent fallback.

### Groups

| | Private (Ashrith's community) | Shared (other people) |
|---|---|---|
| Answers | Every message from Ashrith | @mentions and replies to the bot |
| Who can use it | Ashrith | Everyone in the group, or only listed numbers |
| Memory | Full thread history plus searchable message archive | Same, plus all messages since its last reply |

New groups are **pending** until approved in the admin panel. Dangerous actions (shell, files, secrets) only ever run for the admin number, and that's enforced in code, not just in the prompt.

## Repository layout

| Path | What | Status |
|---|---|---|
| `crates/herbot-core` | Router, approvals, roles, lanes, T3 adapter, admin API (Rust) | 🟡 foundation |
| `crates/herbot-mcp` | Group-scoped tools for bot threads (Rust) | ⏳ Step 7 |
| `apps/wa-bridge` | Fork of the [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) bridge (Go) | ⏳ Step 2 |
| `apps/admin` | Admin panel (TanStack Start) | ⏳ Step 8 |
| `bots/` | One T3 project per bot persona | ⏳ Step 4 |
| `docs/ROADMAP.md` | Build plan with "Done when" checks | |
| `AGENTS.md` | Rules for coding agents working on this repo | |

## Development

Requires Rust (stable, edition 2024), Docker (OrbStack works) and Make.

```bash
cp .env.example .env   # optional, for local overrides
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
| `GET /ready` | Postgres answers (returns 503 when it doesn't) |

CI runs formatting, clippy and the full test suite against Postgres on every push and pull request.

## Workflow

Development happens in T3 Code with Codex: one roadmap step per branch (`step-N/<name>`), small logical commits, and each step lands only when its "Done when" checks pass. See [AGENTS.md](AGENTS.md).
