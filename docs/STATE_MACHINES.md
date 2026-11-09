# State machines

Every piece of state in Herbot that moves through steps, with each step, what moves it, and where that's enforced. When you add a state or a transition, update this file in the same commit. The schema allows only the states listed here (migration 0010 removed the ones nothing could reach).

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
- `ready` always has a purpose (`conversations_ready_has_purpose`).
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
