# State machines

Every piece of state in Herbot that moves through steps, with each step, what moves it, and where that's enforced. When you add a state or a transition, update this file in the same commit. Persisted lifecycle constraints are in migrations 0010, 0013 and 0018; transient workflows below are enforced by ownership, channels and guarded operations. External effects are not atomic with database commits.

## Bot (herbot-core)

### 1. Topic setup: `conversations.setup_state`

The main one. It decides where a message goes: to setup, or to the agent. The transition table is also on `store::SetupState`.

| From | To | Trigger | Code |
|---|---|---|---|
| `new` | `ready` | General's first message (gets the default purpose) | `poller::continue_setup` |
| `new` | `awaiting_purpose` | A topic's first message (Herbot asks "What should I be here?") | `poller::send_greeting` |
| any | `awaiting_purpose` | `/setup` | `poller::send_greeting`, `store::begin_setup` |
| `awaiting_purpose` | `ready` | A message of 3 or more words (typed or spoken) becomes the purpose and the topic's AGENTS.md | `store::set_purpose` |
| `awaiting_purpose`, with a purpose | `ready` | The **Keep the current purpose** button (purpose unchanged) | `store::keep_purpose` (guarded in SQL) |
| any | `ready` | The admin panel saves a purpose | `store::set_purpose` |
| any | `new` | `/forget` | `store::reset_setup` |

- Only `ready` hands messages to the agent. In `awaiting_purpose`, the next message is the purpose. A message that's too short gets a reply saying why, and the state stays.
- `ready` always has a purpose (`conversations_ready_has_purpose`). A setup prompt can exist only while `awaiting_purpose` (`conversations_setup_prompt_state`, migration 0018).
- After `/setup`, the old purpose stays until it's replaced or kept. The prompt says so and carries the Keep button. `setup_prompt_tg_message_id` remembers that prompt, so its button is removed when the purpose is replaced, kept, or asked for again. Only the newest prompt has a live button.
- Labels in the panel come from `topicStatus` in `apps/admin/src/format.ts`:

  | Status | Label |
  |---|---|
  | Switched off | Off |
  | `ready` | Ready |
  | `awaiting_purpose`, with a purpose | Waiting for a new purpose |
  | `awaiting_purpose`, no purpose | Asking its purpose |
  | `new` | Not set up |

### 2. Conversation on/off: `conversations.enabled`

A switch, independent of setup. It's flipped only in the admin panel (`PUT …/enabled`). When it's off, messages there are ignored: not stored, nothing sent to the agent (`store::store_message` returns `Disabled`).

### 3. Chat membership: `chats.status`

`active` ⇄ `left`.

| Change | Trigger |
|---|---|
| → `left` | The bot is removed from the chat (`MarkLeft`) |
| `left` → `active` | The admin adds the bot back (`store::upsert_chat`) |

- Messages count only in an `active` chat that's also enabled.
- Chats the policy rejects (strangers, other groups) are left at once and never stored.

### 4. Agent thread: `agent_threads` (a row is the thread)

```
none ──first turn (t3 thread start)──▶ thread ──/new or /forget──▶ none
```

- **One per conversation** (`agent_threads_one_per_conversation`).
- **The T3 side is deleted first.** `/new` and `/forget` delete the T3 project by its verified id (`wipe::run`), then the row.
- **A start that times out still keeps its thread.** If `t3 thread start` times out, `turns::recover_thread` finds the thread T3 kept running and records it, so the next message continues that thread.
- **`conversations.t3_project_registered`:** set on the first turn (`t3 project add`). Cleared by a wipe.
- **AGENTS.md is reread when it changes.** The next message tells the thread to reread it when `agents_md_updated_at` is later than the thread's `last_turn_at`. This is derived, not stored.
- **Older ground rules are rewritten at startup.** AGENTS.md files with an `agents_md_version` below `agents_md::TEMPLATE_VERSION` are rewritten (`agents_md::refresh_outdated`).

### 5. Choice buttons: `pending_questions.status`

```
open ──tap──▶ answered
open ──typed message in that topic──▶ superseded
```

- **Created** when an agent ends a reply with `[[ask: A | B]]` (`store::create_question`).
- **Answered:** `store::claim_answer` runs only while `open`, and only from the question's own topic. The tap is shown under the question and sent to the agent.
- **Superseded:** `store::supersede_open_questions` closes every open question in the topic, and their buttons are removed.
- **Already answered:** a tap on a closed question gets the "already answered" toast, and its buttons are removed.
- **Wiped:** questions are deleted along with their thread.
- `pending_questions_resolution` (0018) enforces: open has no answer or closure timestamp; answered has both; superseded has a closure timestamp and no answer. The timestamp on superseded means closed, not button-answered. A newly created question may have no Telegram message id until delivery succeeds; that is a reachable intermediate state.

### 6. Wipe confirmation (`/new`, `/forget`): kept in the button, not the database

```
asked ──Yes──▶ wiped (or ❌ with an error id, nothing wiped)
asked ──Cancel──▶ cancelled
asked ──after 10 minutes──▶ expired (toast, buttons removed)
asked ──tapped in another topic──▶ refused (toast)
```

- **The button carries everything:** `wipe:<kind|cancel>:<conversation>:<issued_at>` (`wipe.rs`, `CONFIRM_TTL_SECS`).
- **The admin panel runs the same wipe** behind its own confirmation dialog.

### 7. A turn (one message to the agent)

```
queued on the conversation's lane ──▶ running ("typing…") ──▶ replied
                                                          ├─▶ waiting for an answer in the T3 app (note sent)
                                                          └─▶ failed (❌ with an error id)
```

- **One lane per conversation** (`turns::Lanes`): turns run one at a time per topic, and topics run side by side.
- **No retries.** A failure is recorded and reported (fail loud).
- **A reply is checked before it's sent.** `[[ask]]` lines become choice buttons (§5), and secrets are scrubbed first.

### 8. An incoming Telegram update

```
polled ──▶ skipped (nothing Herbot handles)
       ├─▶ handled inline, never stored (ignored, leave chat, rename/topic bookkeeping)
       └─▶ saved to inbox + offset moved, in one transaction ──▶ handled on its conversation's lane ──▶ deleted
                                                    crash ──▶ still in inbox ──next start──▶ handled, in order
```

- **The admin's messages, commands and taps go to lanes.** Each conversation's inbound lane handles them in order, and conversations run side by side (`poller::InboundLanes`).
- **The offset sits in `kv` (`telegram.offset`).** An update is acknowledged only once it's saved.

### 9. Files from Ashrith (`inbound_files.rs`)

```
attachment ──too big (> 20 MB)──▶ refused with a reply
           └─▶ downloaded to files/<message>-<name> ──▶ described (photo/document/video stills + transcript/audio transcript) ──▶ stored with the message ──▶ setup or the agent
```

An album's parts are stored one by one; the turn lane waits up to 4 s (`turns::ALBUM_WAIT`) for the rest and runs them as one turn.

### 10. Files from an agent (`outbound_files.rs`)

`[[file: …]]` line or local Markdown image → resolved (topic folder or Codex's generated images only; secret-looking names refused; ≤ 50 MB) → sent as photo/voice/audio/video/animation/document (a photo Telegram refuses goes again as a document) → stored with `attachments`. A refused file gets `⚠️ Couldn't send a file (E-…)` and the others still go.

### 11. Mode: `conversations.mode`

`fast ⇄ auto ⇄ expert ⇄ heavy`, any to any, by `/mode` (buttons or `/mode x`) or the panel. Each turn writes the effort it needs (`/fast`, `/think`, `/heavy`, `/deepsearch` override one message) to the topic's `.codex/config.toml` when it changes, and the header carries the mode's instruction.

### 12. Spoken replies: `conversations.voice_replies`, `voice`

`off ⇄ on` by `/voice`, its buttons or the panel; the voice changes on its own. After a reply's text and files are delivered: `synthesizing → voice note sent | failed` (a failure is recorded and reported; the text stays).

### 13. Persona confirmation

`picker → pending → applied | cancelled | expired (10 min)`. Picking again supersedes it; setup changes and wipes invalidate it; a confirmation works once, only for its topic and prompt. Applying writes AGENTS.md (→ setup `ready`) and sets the voice.

### 14. Scheduled task: `tasks.status` / `tasks::TaskStatus`

| From | To | Trigger |
|---|---|---|
| (new) | `active` | Created (agent tool, `/tasks`, panel); at most 50 active |
| `active` | `paused` / `paused` → `active` | Pause / resume (recurring tasks recompute the next run) |
| `active` | `active` | A recurring run is claimed; next run moves past now |
| `active` | `done` | A one-off run is claimed |
| any | `cancelled` | Confirmed delete or cancel |

The scheduler claims due tasks every 15 s (`FOR UPDATE SKIP LOCKED`), posts "⏰ …" in the topic and queues a turn. Missed runs during downtime run once, not once per missed slot; disabled or unready topics are skipped. Run now sets a flag the next claim clears. `TaskAction` parses boundary strings once and `TaskStatus::transition` owns the user transition matrix; invalid transitions return `TaskError::Invalid`. SQL row locks serialize it against scheduler claims. Wire status strings are unchanged.

The full state is a product, not just status:

| Component | Legal states / transitions | Enforcement |
|---|---|---|
| Schedule | exactly one of one-off timestamp / cron | 0013 XOR CHECK; `create`, `next` validate future occurrence/timezone |
| Lifecycle | active / paused / done / cancelled | `TaskStatus`, database CHECK |
| Manual request | absent → requested → claimed (cleared); cancel/pause/resume clear it | `change`, `Scheduler::tick`; cancelled forbids a request |
| Next occurrence | active/paused require a timestamp; done requires one-off, no next time, at least one run | 0013 CHECKs |
| Run history | never run (count 0, no last time) → claimed (count increments, last time set) | 0013 CHECK; claim transaction |
| Result | claim clears last_error → dispatch/agent error records it | `tick`, `dispatch`; async agent errors update only the same claim timestamp |

Manual runs of paused or done tasks preserve their lifecycle and next time. A manual run of an active one-off consumes its schedule; active recurring runs advance the schedule. Cancel is idempotent from every state. These existing behaviors are retained. Claim commits **before** posting to Telegram: a crash after claim can lose that execution; it is not a durable delivery queue and does not replay claimed runs.

### 15. Memory and personalisation (`personal.rs`)

Memories: added (`remember`, panel; near-duplicates and secrets refused; ≤ 200) → edited → forgotten (`forget`, `/memory` Forget, panel). "Forget all" in Telegram needs a confirmation that expires after 10 minutes, works only in its topic and keeps memories made after it was asked. Any change rewrites `agents/PERSONAL.md`; the next turn of every thread whose last turn is older gets "PERSONAL.md changed; reread it".

### 16. Private topic: `conversations` private flag (`actions.rs`)

`off ⇄ on` by `/private`. While on: no messages stored (admin or bot), memory and history tools refused, the header says private. Retry needs storage, so it's unavailable while private.

### 17. Retry, edits, feedback, progress (`actions.rs`)

- 🔄 button: only on the newest reply; a new reply moves it; a wipe clears it.
- An edited message updates its stored text and queues "answer the edited version" (edits of commands are ignored).
- Feedback: the latest reaction set per bot message is stored; a 👎 sets a pending note the next turn's header consumes.
- Progress: none → shown after 8 s ("Working on it… 0:12", updated every 5 s) → deleted when the turn ends.

### 18. Panel chat (`panel.rs`)

Composer: `draft → sending → accepted | error → retry`. Accepted messages are posted to Telegram first, saved in `panel_inbox` (migration 0015), then go through the same setup/turn path and are deleted; anything left is replayed at startup, and a wipe clears it. The chat shows "thinking…" while the conversation's lane has turns queued.

### 19. Companion voice conversation (`/companions`, `panel_voice.rs`)

`connecting → idle → listening → transcribing → thinking → speaking → idle`. Typed text skips listening and transcribing. Tapping the mic while it speaks stops playback and starts listening. A failure returns to idle with the error shown; if the browser blocks autoplay, a "Play reply" button appears. Leaving the page releases the microphone and audio. A reply timeout (180 s) doesn't cancel or retry the agent's turn.

### 20. Topic language: `conversations.language`

English by default; `/language <name>` sets any language, `/language english` goes back. Its voice notes and video soundtracks are transcribed in it (auto-detected if the name isn't known), the agent's header says to reply in it, and spoken replies follow the text.

### 21. Rust state inventory and representation decisions

This inventory covers production modules in both Rust crates, including the schema and in-memory state. Independent configuration switches stay booleans; row presence and Rust ownership already make many workflows explicit without a second status column. Immutable message facts (`from_bot`, `is_voice`, file kind, sender, timestamps) are data, not lifecycle states.

| Machine / where | States and transitions | Decision and enforcement |
|---|---|---|
| Setup + prompt (`store`, `setup`, `poller`, `agents_md`) | new → awaiting purpose → ready; reset/replace/keep (§1) | Keep `SetupState`; add prompt CHECK in 0018. Purpose, file and DB writes are separate effects; errors propagate. Do not require a file path for legacy ready rows. |
| Conversation availability (`store`, `policy`, `admin`) | enabled ⇄ disabled, independently of setup and chat membership | Keep boolean; all combinations are meaningful. Policy remains pure and admin/home checks precede writes. |
| Chat membership (`store`) | active ⇄ left (§3) | Keep checked text: used in SQL predicates, no unchecked Rust transition API. |
| Bot selection (`bots`, `conversations.bot_id`) | default/explicit persona, enabled/off | Keep booleans and nullable foreign key; unique partial index permits one default. These are configuration, not staged work. |
| Project registration / agent thread (`turns`, `wipe`, `store`) | unregistered → registered → thread present; timeout → recovered thread; wipe → absent | Keep boolean + unique thread row. Registration can succeed before thread creation. External project deletion precedes local wipe; no cross-system atomicity claim. |
| Instruction freshness (`agents_md`, `meta`, `modes`, `personal`) | missing/outdated → rewritten; newer than last turn → reread note | Keep version/timestamp comparison, derive freshness. Separate mode override from standing mode; no duplicate stale flag. |
| Choice resolution (`store`, `outgoing`, `turns`) | parsed → open/unattached → delivered → answered or superseded (§5) | Add resolution CHECK (0018); atomic guarded answer claim. Nullable delivery id is intentional after creation/before successful send. |
| Wipe confirmation (`wipe`) | asked → cancelled / expired / refused / wiped / failed | Keep `WipeButton`, `WipeKind`, signed-by-context callback fields + TTL; no redundant stored status. The callback is not a durable single-use nonce. |
| Voice settings (`speech`, `store`) | replies off ⇄ on; voice changed independently | Keep boolean + checked voice name. Disabled voice still remembers selected voice. |
| Persona selection (`speech`) | picker → pending → applied / cancelled / expired; repick replaces | Keep confirmation row as pending state. DELETE RETURNING claims once; topic/message/TTL guards and invalidation trigger. Expired rows may remain until replaced; expiry is derived. |
| Task lifecycle / schedule / run request (`tasks`) | see §14 | Make lifecycle/action Rust enums with central legal transitions; retain 0013 product constraints, timestamps and boolean request. |
| Private mode (`actions`, `poller`, `hub`, `store`) | public ⇄ private | Keep independent boolean. Trigger suppresses message writes; history/memory gates check privacy. Switching does not delete old history or reset independent controls. |
| Retry target (`turns`, `poller`, `store`) | none → latest bot message → newer target; wipe clears | Keep `Option<message id>`: it carries the state and payload together. Private retry is refused; a stored target may outlive the UI button. |
| Feedback (`poller`, `turns`) | reaction set replaced; pending negative note → consumed by next turn | Keep JSON reaction snapshot + boolean latch; atomic UPDATE consumes the latch. Failure after consumption does not restore it. This is a pending hint, not a feedback delivery queue. |
| Edited message (`poller`) | unchanged → changed stored body → queued correction | Keep conditional UPDATE and row count; command edits ignored. No separate persistent status needed. |
| Telegram ingress (`telegram`, `policy`, `poller`, `store`) | normalized → ignored / inline / durable lane → handled → deleted (§8) | Keep `Inbound`, `Action`, `Route` enums and inbox row presence. Offset and enqueue share a transaction. Crash replay can duplicate external effects; this is not exactly-once delivery. |
| Inbound workers (`poller::InboundLanes`) | absent → channel/worker created → processing FIFO → drained on shutdown; dead sender → recreated | Keep channel ownership and per-topic key. Worker list joins at shutdown; timeout leaves inbox work for restart. No extra enum adds safety to channel state. |
| Conversation operation locks (`poller::store_and_continue`) | unlocked → owned guard → released on drop | Keep keyed async Mutex; the guard enforces exclusion. Maps persist for process lifetime. |
| Turn workers / activity (`turns::Lanes`) | absent → worker; pending 0 → queued/running >0 → 0 | Keep channel + count: count includes queued and running parts, not just active requests. Dead sender replaced. In-memory turns do not survive process exit. |
| Album gathering (`turns::spawn_lane`) | first part → collecting same album → timeout/channel end/different album → run merged turn | Keep local ownership: `next: Option<TurnJob>` buffers the first different job. Wait is 4 s of inactivity after each part; late parts start another turn. Count decreases by merged part count. |
| Reply waiter (`turns::ReplySlot`, `internal`, `panel`) | sender present → taken/delivered; receiver may time out/drop independently | Keep `Option<oneshot::Sender>` behind shared Mutex: take guarantees at most one delivery. Timeout does not cancel the turn. |
| Agent run (`agent`, `turns`) | starting/sending → replied / needs answer / failed; CLI timeout → possible thread recovery | Keep `TurnOutcome`/`AgentError`, parse foreign CLI status at boundary. Foreign free-text status is diagnostic only; local decisions use outcome enums. No silent retry of a turn. |
| Turn progress (`turns::run_turn`) | hidden → shown at 8 s → updated every 5 s → deleted | Keep local `Option<message id>` and timer. Typing task aborted on normal completion. Progress delivery/cleanup errors log warnings; they do not replace the agent result. |
| Inbound speech (`voice`, `poller`, `inbound_files`) | duration/size checked → downloaded → transcribed → echoed/stored/forwarded; refused/failed exits | Keep sequential async control flow and typed errors/`AnyTranscriber`; no independent resumable speech state. |
| Outbound speech (`speech`) | disabled/skipped or synthesizing + upload activity → delivered / failure | Keep future scope and speaker trait; text/files can already be delivered when speech fails. Panel speech requests are independent authenticated HTTP operations. |
| Files and media (`media`, `inbound_files`, `outbound_files`, `imagine`, `format`) | validated → saved/transformed → sent → recorded; refused/failed exits | Keep `FileKind`, `Activity`, refusal/error enums and sequential operations. Document/photo resend is a deliberate format conversion path. Partial file delivery is reachable. |
| Panel durable ingress (`panel`) | Telegram posted → inbox row → shared setup/turn submit → row deleted | Keep row presence + processing Mutex + transaction. Consumed after submit, not after agent reply. A crash before durable insert can leave a Telegram post without a turn; a crash after submit before delete can replay. |
| Panel topic provisioning (`panel::new_topic`) | Telegram topic created → conversation/purpose/file saved → ready; each effect may fail | Keep sequential fallible operations; no new lifecycle column can make Telegram and filesystem writes atomic. Partial provisioning is reachable and reported. |
| Panel reply correlation (`panel`) | message-id → reply slot registered → removed at delivery; waiter completes/times out | Keep map + one-shot ownership. Setup/disabled topics may produce no agent turn; caller timeout is separate from queue consumption. |
| Memory/preferences projection (`personal`) | DB mutation committed → projection replaced → timestamp advanced; IO failure → repaired at startup/next mutation | Keep singleton timestamp + advisory lock + atomic rename; no extra dirty flag because startup rewrites from DB. DB and file are not one transaction. |
| Memory forget confirmation (`poller`, `personal`) | requested → cancelled / expired / delete through captured max id | Keep callback TTL/topic guard and captured id; preserves memories added after confirmation. |
| Task delete confirmation (`tasks::callback`) | requested → keep / confirmed cancel / expired | Keep callback topic/TTL guard. Cancel is idempotent; no extra database state. |
| Simulation (`simulate`, `main`) | route absent unless enabled; authorized request → edit/reaction or post/file → injected / failed | Keep startup gate, local branches and `AtomicU32` allocation. It has real Telegram effects before injection; no production exercise. |
| Process / services (`main`, `app`, `db`, `poller`, `tasks`) | configuring → migrating/initializing → serving/polling → shutdown/drain | Keep scoped futures/watch shutdown. Readiness probes DB; polling network failures retry with delay and error records, independently of turn failure policy. |
| MCP and cross-topic actions (`herbot-mcp`, `hub`, `internal`) | authenticate caller → authorize scope → read / post / enqueue+wait → result/error | Keep request-scoped control flow; caller token is sole authority, no session status or cached grant. `ask_topic` waits on `ReplySlot`; timeout leaves turn running. |
| Reply parsing/rendering (`outgoing`, `format`, `meta`, `telegram`) | text ↔ code fence across chunks; HTML tag/entity scanning; list/link stacks; table collection → rendered; command/header/choice/file recognition | Keep local parser state, `Option` carries fence/table payload, stacks represent nesting, `CommandParse` distinguishes recognized/foreign commands. Pure bounded transformations need no persisted status; upstream Markdown events drive start/end pairs. |
| Errors/audit/counters (`errors`, `store`, SQL triggers) | append event / update count on message insert/delete | Keep append-only records and derived counters, not lifecycle status. Private-message trigger prevents suppressed rows contributing counts. |

Migration 0018 clears stale setup prompts outside setup, clears answer metadata on open questions, converts answered-without-answer rows to superseded, and supplies missing closure timestamps from creation time. It never deletes history or schedules. It scans/updates the two tables and takes ALTER TABLE locks; deploy during a quiet period. Validation here uses synthetic legacy rows in a throwaway database, not live data. Ground rules, meta header and MCP tool descriptions are unchanged, so no template version bump is needed.

## Admin panel (apps/admin)

These states live in the browser and are kept explicit where they matter.

| What | States | Where |
|---|---|---|
| Session | signed out → signed in (7-day signed cookie) → signed out (sign-out, or any request with an expired cookie redirects to sign-in) | `server/auth.ts`, `router.tsx` |
| Sign-in form | idle → sending → wrong password / failed → idle when you type; an empty submit explains itself | `routes/login.tsx` |
| Purpose editor | viewing ⇄ editing (draft) → saving → saved / error; leaving with unsaved changes asks first | `routes/_authed/topics/$id.tsx` |
| On/off switch | shown at once → confirmed, or rolled back with an error | `routes/_authed/topics/$id.tsx` |
| Chat log | following the newest ⇄ scrolled up ("N new messages"); loading older pages at the top; reached the start | `components/chat-log.tsx` |
| Log search | typing → debounced (300 ms) into the URL → loading → results / none / error | `routes/_authed/logs/index.tsx` |
| Topic status | Off / Ready / Waiting for a new purpose / Asking its purpose / Not set up | `topicStatus` in `format.ts` |
