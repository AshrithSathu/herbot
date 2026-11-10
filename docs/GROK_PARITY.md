# Grok parity

Everything Grok does (grok.com, the apps, Grok in Telegram), and how Herbot does it. Herbot's surfaces are the Telegram group (every topic an agent) and the admin panel (the web app). The agent is Codex in T3 on the Codex subscription. Codex has its own image generation, image viewing, web search, multi-agent and memories.

Status: ✅ built and run once for real (simulated messages through the live bot, 2026-11-10)

| # | Grok feature | Herbot | Owner | Status |
|---|---|---|---|---|
| 1 | Chat with an assistant | Every topic is an agent with its own long-lived thread; General is the everyday chat | – | ✅ |
| 2 | Modes: Auto / Fast / Expert (Think) / Heavy (multi-agent) | `/mode fast|auto|expert|heavy` per topic (model, reasoning effort, multi-agent), written to the topic's `.codex/config.toml`; `/think <question>` and `/heavy <question>` for one message | W0 | ✅ |
| 3 | Live web search with citations | Codex live web search on in every topic; answers cite sources as links | W0 | ✅ |
| 4 | DeepSearch / DeeperSearch (research reports) | `/deepsearch <question>`: a multi-step, multi-source research report with citations, sent as text plus a document | W0 | ✅ |
| 5 | Image understanding | Photos (and image documents) are saved in the topic folder and shown to the agent | W0 | ✅ |
| 6 | File uploads (PDFs, docs, code, spreadsheets) | Documents are saved in the topic's `files/` folder and the agent reads them | W0 | ✅ |
| 7 | Video understanding (Grok 4.3) | Videos and video notes: frames, plus the soundtrack transcribed, go to the agent | W0 | ✅ |
| 8 | Imagine: image generation and editing | Codex's built-in image generation and editing; the agent sends the result as a photo (`[[file: …]]`) | W0 | ✅ |
| 9 | Imagine: video generation | `/video <prompt>` and the agents' `generate_video` tool: xAI's Grok Imagine when `XAI_API_KEY` is set; otherwise storyboard videos from the OpenAI key (keyframes from OpenAI image models, each an edit of the last so the subject holds, animated with ffmpeg camera moves and crossfades). Ran live: an 8 s MP4 sent as a Telegram video | W6/lead | ✅ |
| 10 | Rich answers (Markdown, code, tables, links) | Markdown rendered as Telegram formatting; long answers split safely | W0 | ✅ |
| 11 | Files and documents from the assistant (Studio, document generation) | The agent writes files (PDF, DOCX, MD, HTML, CSV, charts) and sends them with `[[file: …]]` | W0 | ✅ |
| 12 | Voice mode (talk, hear it answer) | Voice notes in (✅) and spoken replies out (OpenAI speech): `/voice on|off`, a choice of voices, 🔊 Read aloud | W1 | ✅ |
| 13 | Companions / personas | Topics are personas (purpose); persona presets with their own voice | W1 | ✅ |
| 14 | Memory across chats (view, forget) | `remember`, `forget`, `recall` agent tools; `/memory` lists them with Forget buttons; panel Memory page | W3 | ✅ |
| 15 | Custom instructions (personalisation) | `/customize` and a panel page: how you want answers, applied to every topic's AGENTS.md | W3 | ✅ |
| 16 | Tasks (scheduled and recurring prompts) | Agent tools and `/tasks`; one-off or recurring (cron); results posted in the topic; panel Tasks page | W2 | ✅ |
| 17 | Projects / workspaces (files + instructions) | Each topic is a project: purpose, AGENTS.md, files; panel shows its files | W0/W4 | ✅ |
| 18 | Conversation history and search | Panel search across every topic; `/search` in Telegram | W5/W4 | ✅ |
| 19 | Edit a message, regenerate an answer | Editing a message re-asks it; `/retry` and a 🔄 button regenerate the last answer | W5 | ✅ |
| 20 | Share / export a conversation | `/export` sends the topic as Markdown and HTML; panel download | W5 | ✅ |
| 21 | Private (temporary) chat | `/private on`: nothing stored, nothing remembered | W5 | ✅ |
| 22 | Feedback on answers | 👍/👎 reactions on replies are stored and shown in the panel | W5 | ✅ |
| 23 | Suggested follow-ups | `[[ask: …]]` buttons (✅); agents end with up to three follow-ups when useful | W0 | ✅ |
| 24 | Streaming / progress | Typing and "uploading…" while working; after 8 s a live "Working on it… 0:12" message, removed when the reply lands (T3 doesn't expose what the agent is doing, so it shows elapsed time) | W5 | ✅ |
| 25 | Connectors (MCP, apps) | Codex MCP servers; Herbot-wide ones in `agents/.codex/config.toml`; panel Connectors page | W4 | ✅ |
| 26 | Web app (grok.com) | Admin panel becomes a chat app: chat with any topic, attachments, new topics, settings | W4 | ✅ |
| 27 | Telegram extras (summaries, stickers) | Summarise a topic or reply thread; `/sticker` makes a sticker from an image or prompt | W6 | ✅ |
| 28 | Real-time X (Twitter) analysis | `/x <topic>` and the agents' `search_x` tool (X API v2 recent search: posts, authors, dates, engagement, links) with `X_BEARER_TOKEN`; without it, live web search of x.com plus X's public post endpoint (verified) for reading posts | lead | ✅ (full real-time search with `X_BEARER_TOKEN`) |
| 29 | Grokipedia | `/wiki <topic>`: an encyclopedia article from Grokipedia (grokipedia.com), Wikipedia and primary sources, noting where they disagree; agents use Grokipedia for lookups | lead | ✅ |
| 30 | Many languages | English by default (your rule); `/language <name>` makes a topic answer in any language, with its voice notes and video soundtracks transcribed in it and spoken replies following it. Ran live in Spanish | lead | ✅ |
| 31 | Animated companions and live voice chat | Panel **Companions** page: four original animated characters (Luma, Flint, Pip, Orbit; SVG, idle/listening/thinking/talking with mouths driven by the reply's audio, calmer under reduced motion) you talk to by voice or text, each backed by its own agent topic with memory (General, clearly labelled, until the bot can create topics). Ran live: speech → transcription → agent reply → spoken reply | W7 | ✅ |

## How it was checked

Each ✅ row ran once through the live bot with `/internal/simulate` (Ashrith was offline): real Telegram, real T3/Codex, real OpenAI. Highlights: a live-web answer with cited Rust release posts; a photo read back exactly; a generated fox and a teal hummingbird logo sent as photos; a PDF summarised and returned as DOCX; a DeepSearch report plus its Markdown file; remember → PERSONAL.md → metric answers with the custom TL;DR; a spoken reply; a 2-minute reminder that fired on time; /retry, /search, /export, /persona, /summary; a sticker; private mode storing nothing; audio and video understood (transcript plus stills); Heavy mode with parallel sub-agents; a message sent from the panel's chat answered in Telegram. Also live: `/video` (a storyboard MP4 sent as a video), `/wiki`, `/language Spanish` with a Spanish voice note, and the panel's New agent up to Telegram's permission check (the bot needs the "Manage topics" right; it reports that clearly with an error id).

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
