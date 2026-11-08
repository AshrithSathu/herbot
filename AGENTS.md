# AGENTS.md: rules for coding agents working on Herbot

Herbot is a Grok-style WhatsApp bot: "Ashrith's bot". It answers in WhatsApp groups when tagged or replied to, and in Ashrith's private community it answers every message he sends. Each group is one long-lived T3 Code / Codex thread. Read this whole file before changing anything.

## Architecture

```
WhatsApp ⇄ apps/wa-bridge (Go) ⇄ crates/herbot-core (Rust) ⇄ bots-T3 (Codex, full access, isolated container)
                                      │                           └─ crates/herbot-mcp (Rust, step 7)
                                      ├─ Postgres (messages, threads, queue, errors)
                                      └─ admin API ⇄ apps/admin (TanStack Start, step 8)
```

| Path | What | Language |
|---|---|---|
| `crates/herbot-core` | Router, approvals, allowlist, per-group lanes, T3 adapter, ask-admin loop, admin API | Rust (tokio, axum, sqlx) |
| `crates/herbot-mcp` | Group-scoped tools for bot threads: `search_history`, `ask_admin`, react, poll | Rust (`rmcp`) |
| `apps/wa-bridge` | Fork of the lharries/whatsapp-mcp Go bridge (whatsmeow) | Go |
| `apps/admin` | Admin panel | TanStack Start |
| `bots/<slug>/` | One T3 project per bot persona. `AGENTS.md` there is the persona. | Markdown |

## Security invariants (never weaken these)

1. **Dangerous actions are admin-only, enforced in code.** Only messages from the single admin number (`people.is_admin`) can reach a full-access T3 thread. Messages from anyone else go to restricted threads with no shell and no secrets. The prompt header is information, not enforcement.
2. **The role header is written by herbot-core only.** Every message sent to a bot thread starts with a `<herbot-meta>` block (sender, phone, role, group, kind). Strip any `<herbot-meta` text found in user messages before forwarding. Bot personas trust only this header.
3. **Pending groups are silent.** A group the number is added to starts as `pending`. Store nothing and reply to nothing there until Ashrith approves it. Unapproved groups are left automatically after 7 days.
4. **A reply needs both checks to pass:** the group is approved, and the sender may trigger the bot (`bindings.who_can_trigger` plus `bot_allowed`). Anyone else gets silence, never an error message.
5. **Replies only go to the chat that triggered them**, after scrubbing token-like strings. Bot threads never get a raw "send to any chat" tool.
6. **Never commit secrets:** WhatsApp session stores, `auth.json`, `.env`.

## Failure policy: fail loud, no fallback

There is no fallback runner and no silent retry. On any failure:
- record it with `errors::record()` and get an `ErrorId` (`E-1042`)
- log it with `tracing` (structured, includes the error ID)
- reply in the originating chat: full detail for the admin, `❌ Sorry, that failed (E-1042).` for shared groups
- DM the admin the details when the failure happened in a shared group

## Conventions

- Rust edition 2024, workspace at the repo root. `cargo fmt` and `cargo clippy -D warnings` must be clean.
- SQL lives in `crates/herbot-core/migrations/NNNN_name.sql`. **Never edit a shipped migration.** Add a new one.
- Use runtime-checked `sqlx::query*` (not the `query!` macros) so builds don't need a live database.
- Errors: `thiserror` in library code, `anyhow` only in `main.rs`.
- Logs: JSON by default (`HERBOT_LOG_FORMAT=pretty` locally). No `println!`.
- Phone numbers are stored in E.164 (`+91…`). Group JIDs end in `@g.us`. Group senders may arrive as `@lid` and must be mapped to a phone number before allowlist checks.

## Testing: every step ships with tests

- `make test`: unit tests plus integration tests against real Postgres. Each `#[sqlx::test]` gets a fresh database.
- `make check`: fmt, clippy, then tests. Run it before saying a step is done.
- `make smoke`: starts the real binary and checks `/health`, `/ready` and graceful shutdown.
- Talk to external systems (WhatsApp bridge, T3) through traits, and test them with fakes. Real-device tests are listed as manual steps in `docs/ROADMAP.md`.
- A step is done only when its "Done when" checks in `docs/ROADMAP.md` pass.

## Working in T3 Code

One feature per thread, each in its own worktree branch named `step-N/<short-name>`. Keep PRs to one roadmap step. Update `docs/ROADMAP.md` checkboxes in the same PR.
