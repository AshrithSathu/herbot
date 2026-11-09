# Grok parity

Everything Grok does (grok.com, the apps, Grok in Telegram), and how Herbot does it. Herbot's surfaces are the Telegram group (every topic an agent) and the admin panel (the web app). The agent is Codex in T3 on the Codex subscription. Codex has its own image generation, image viewing, web search, multi-agent and memories.

Status: ✅ done · 🔨 being built · ⛔ not applicable (and why)

| # | Grok feature | Herbot | Owner | Status |
|---|---|---|---|---|
| 1 | Chat with an assistant | Every topic is an agent with its own long-lived thread; General is the everyday chat | – | ✅ |
| 2 | Modes: Auto / Fast / Expert (Think) / Heavy (multi-agent) | `/mode fast|auto|expert|heavy` per topic (model, reasoning effort, multi-agent), written to the topic's `.codex/config.toml`; `/think <question>` and `/heavy <question>` for one message | W0 | 🔨 |
| 3 | Live web search with citations | Codex live web search on in every topic; answers cite sources as links | W0 | 🔨 |
| 4 | DeepSearch / DeeperSearch (research reports) | `/deepsearch <question>`: a multi-step, multi-source research report with citations, sent as text plus a document | W0 | 🔨 |
| 5 | Image understanding | Photos (and image documents) are saved in the topic folder and shown to the agent | W0 | 🔨 |
| 6 | File uploads (PDFs, docs, code, spreadsheets) | Documents are saved in the topic's `files/` folder and the agent reads them | W0 | 🔨 |
| 7 | Video understanding (Grok 4.3) | Videos and video notes: frames, plus the soundtrack transcribed, go to the agent | W0 | 🔨 |
| 8 | Imagine: image generation and editing | Codex's built-in image generation and editing; the agent sends the result as a photo (`[[file: …]]`) | W0 | 🔨 |
| 9 | Imagine: video generation | `/video <prompt>` and an agent tool, using the OpenAI video API; sent as a video | W6 | 🔨 |
| 10 | Rich answers (Markdown, code, tables, links) | Markdown rendered as Telegram formatting; long answers split safely | W0 | 🔨 |
| 11 | Files and documents from the assistant (Studio, document generation) | The agent writes files (PDF, DOCX, MD, HTML, CSV, charts) and sends them with `[[file: …]]` | W0 | 🔨 |
| 12 | Voice mode (talk, hear it answer) | Voice notes in (✅) and spoken replies out (OpenAI speech): `/voice on|off`, a choice of voices, 🔊 Read aloud | W1 | 🔨 |
| 13 | Companions / personas | Topics are personas (purpose); persona presets with their own voice | W1 | 🔨 |
| 14 | Memory across chats (view, forget) | `remember`, `forget`, `recall` agent tools; `/memory` lists them with Forget buttons; panel Memory page | W3 | 🔨 |
| 15 | Custom instructions (personalisation) | `/customize` and a panel page: how you want answers, applied to every topic's AGENTS.md | W3 | 🔨 |
| 16 | Tasks (scheduled and recurring prompts) | Agent tools and `/tasks`; one-off or recurring (cron); results posted in the topic; panel Tasks page | W2 | 🔨 |
| 17 | Projects / workspaces (files + instructions) | Each topic is a project: purpose, AGENTS.md, files; panel shows its files | W0/W4 | 🔨 |
| 18 | Conversation history and search | Panel search across every topic; `/search` in Telegram | W5/W4 | 🔨 |
| 19 | Edit a message, regenerate an answer | Editing a message re-asks it; `/retry` and a 🔄 button regenerate the last answer | W5 | 🔨 |
| 20 | Share / export a conversation | `/export` sends the topic as Markdown and HTML; panel download | W5 | 🔨 |
| 21 | Private (temporary) chat | `/private on`: nothing stored, nothing remembered | W5 | 🔨 |
| 22 | Feedback on answers | 👍/👎 reactions on replies are stored and shown in the panel | W5 | 🔨 |
| 23 | Suggested follow-ups | `[[ask: …]]` buttons (✅); agents end with up to three follow-ups when useful | W0 | 🔨 |
| 24 | Streaming / progress | Typing and "uploading…" while working; a live progress message for long turns | W5 | 🔨 |
| 25 | Connectors (MCP, apps) | Codex MCP servers; Herbot-wide ones in `agents/.codex/config.toml`; panel Connectors page | W4 | 🔨 |
| 26 | Web app (grok.com) | Admin panel becomes a chat app: chat with any topic, attachments, new topics, settings | W4 | 🔨 |
| 27 | Telegram extras (summaries, stickers) | Summarise a topic or reply thread; `/sticker` makes a sticker from an image or prompt | W6 | 🔨 |
| 28 | Real-time X (Twitter) analysis | Web search covers public posts; the X API needs a paid key | – | ⛔ no X API key |
| 29 | Grokipedia | xAI's encyclopedia, not a chat feature; web search covers lookups | – | ⛔ |
| 30 | Many languages | Herbot is English by your rule (`AGENTS.md`) | – | ⛔ by choice |
| 31 | Animated 3D companions | Telegram can't host them; personas with voices instead (#13) | – | ⛔ |

## Workstreams

| | Scope | Migration |
|---|---|---|
| W0 | Foundation (lead): media in, files out, formatting, modes and web search, DeepSearch/Think/Heavy, AGENTS.md ground rules, `/internal/simulate` | 0011 |
| W1 | Voice replies, voices, personas | 0012 |
| W2 | Tasks | 0013 |
| W3 | Memory and custom instructions | 0014 |
| W4 | Panel as a chat app, files, connectors, settings, search | 0015 |
| W5 | Retry/edit, export, `/search`, private chat, feedback, progress | 0016 |
| W6 | Video generation, stickers, summaries | 0017 |

Rules for every workstream:
- Use only your migration number.
- Don't edit README.md, docs/ROADMAP.md, AGENTS.md or docs/STATE_MACHINES.md; the lead updates them when merging. Put what they need in your final report.
- AGENTS.md ground-rule text for your feature goes in a `pub const AGENTS_MD_SECTION: &str` in your own module; the lead wires it into `agents_md.rs`.
- Commit small and often on your branch. No AI attribution in commits.
- No new test suites and no browser tests. Keep `cargo clippy --workspace --all-targets -D warnings` clean and the panel's type check passing. Run your feature once for real before you finish.
