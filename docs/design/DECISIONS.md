# Panel design decisions

Decided by prototyping (emil-prototype) against worst-case data (`make admin-stress`). Each entry keeps what was chosen and what was left behind, so the same discussion doesn't happen twice.

## Stage 1: direction, decided from /proto/direction (Current, Ledger, Conversation, Editorial)

- **Base: Conversation.** A three-pane messenger shell (agents | conversation | details) with the chat as home; one pane on phones, two below 1,100 px. Talking to agents is the panel's main job, and Ashrith already lives in Telegram's layout.
- Palette: cool neutrals with one Telegram-ish blue accent (`oklch(0.58 0.135 237)`, desaturated in dark mode); green / amber / red only for status.
- **Adopted from Ledger:** hairline rules and tabular figures for list pages (topics, logs, tasks, memory) and the overview numbers; borders, not shadows, inside panes.
- **Adopted from Editorial:** a system serif (`ui-serif`, New York, Georgia) for page titles and big numerals only: the one distinctive type decision.
- Left behind: Current (a generic shadcn dashboard; stacked cards waste space and push the chat below the fold).
- Left behind: Editorial's top navigation (no room in a three-pane shell) and its low density (too much scrolling for a daily tool).
- Left behind: Ledger's transcript in place of bubbles (bubbles show who's speaking at a glance) and its 13 px body text (too small for long chats).

## Stage 2: components

### Agent row, decided from /proto/agent-row (Monogram, Signal, Brief)
- Base: **Brief**. No avatar: identity is the name; a "New" pill for unread; a thin running rule under a working agent.
- Mixed from Monogram: when an agent is fine, the second line is its purpose preview (calm); it switches to facts in colour only when the agent needs you (working, asking its purpose, off).
- Left behind: Monogram's pastel monograms (decoration, and the first letter of a hostile name is `<`, `*` or a bare Arabic letter); Signal's one-line glyph rows (glyphs to learn, no preview).
- Needs the API: server-side read markers (unread) and one batched activity endpoint (working), instead of per-row polling.

### Navigation, decided from /proto/navigation (Rail, Sections, Command)
- Base: **Rail**. A slim icon rail outside the panes, grouped, tooltips, Sign out pinned at the bottom. Phones: a bottom tab bar.
- Mixed from Command: a ⌘K / Ctrl+K palette for pages, agents and actions, as an accelerator (the rail stays the visible way).
- Phone tabs: Agents, Overview, Search, Tasks, More (Topics is the same thing as Agents, so it lives under More).
- Left behind: Sections (pushes the agent list ~230 px down); Command alone (pages invisible until you open a menu).

### List rows, decided from /proto/rows (Ledger, Thread, Index cards)
- **Ledger** (one line, aligned columns, tabular figures) for topics and logs: lists you scan and compare.
- **Thread** (two lines: what it is, then what it says) for tasks and memories: lists you read. Mixed from Ledger: actions always visible as quiet text buttons, not only on hover.
- Left behind: Index cards (lowest density, figures don't align, every action two taps away).

### Status language, decided from /proto/status (Pills, Signal, Glyph)
- Base: **Signal**. Colour lives in a small dot; the word is plain text.
- Changed: dense rows keep a short word next to the dot (a dot alone fails colour-blind users).
- Mixed from Pills: serif numerals for the overview figures (Stage 1 reserved the serif for big numbers).
- Left behind: Pills (colour washes compete with content in dense rows); Glyph (icons to learn, tooltips don't open on touch).

### Chat message, decided from /proto/message (Bubbles, Transcript, Cards)
- Base: **Bubbles** (agent left, you right in a soft accent; time in the corner; folds past 1,500 characters or 24 lines; "not sent" with Retry and Discard).
- Mixed from Transcript: a message's files collapse to one summary line ("12 files · 74.4 MB") that expands, instead of four cards plus "Show 8 more".
- Mixed from Cards: Copy is always visible on agent replies (in the meta line by the time), not only on hover.
- Left behind: Transcript as the base (less "who's speaking" at a glance); Cards (a whole card for "ok"; reads less like a conversation).

### Composer, decided from /proto/composer (Chips, Menu, Slash)
- Desktop: **Chips**. One card, attachment chips on top, a growing one-line textarea, the five modes as a chip radio group, Enter sends, Shift+Enter a new line.
- Phones: Menu's compact single row (attach · input · "Auto ▾" mode menu · send), keeping Chips' small file chips (Menu's full-width file cards push the conversation off screen).
- Mixed from Slash: typing /fast, /think, /heavy or /deepsearch at the start sets that mode (the same commands as in Telegram).
- Left behind: Slash's tall editor and Cmd+Enter to send (half a phone screen; unfamiliar on touch).

### Details pane, decided from /proto/details (Summary, Form, Sections)
- Base: **Summary**. Read first: facts as quiet rows; tap a value to edit just that row (each saves on its own); purpose clamped with "Show all"; danger zone last, confirmed inline. On phones it's a full-screen pane with "‹ Chat".
- Left behind: Form (every control live, busy to scan; the 8,000-character purpose box dominates); Sections (settings a tab away; a typed confirmation is slow when you mean it).
- Needs the API: each topic's language (and private mode) in the topic detail; the pane shows "Not reported" today.

### Form controls, decided from /proto/controls (Quiet, Pronounced, Cards)
- Base: **Quiet**. Segmented choices with the selected option's one-line description underneath, light buttons, labels above fields.
- Changed: on phones the five-way mode segment becomes a menu (as in the composer) instead of scrolling sideways.
- Destructive actions stay quiet red text buttons, always separated from the rest and always confirmed in a dialog.
- Left behind: Pronounced (heavy 44 px solid buttons everywhere; dropdowns hide the options); Cards (five mode cards take half a phone screen).

### Implementation notes from the prototypes
- Tailwind emits px breakpoints before rem ones, so `min-[1100px]:` loses to `md:`; write custom breakpoints in rem (`min-[68.75rem]:`).
- In this browser `scrollIntoView()` returns a promise: never return it from an effect (`useEffect(() => el.scrollIntoView())` crashes with "destroy is not a function").

### Feedback states, decided from /proto/feedback (In place, Strip, Toasts)
- Base: **In place**. Every state appears where the content would be, at its size: first-run empty with the action that fills it, no-results with "Clear filter", skeletons shaped like the content, a failed load with Retry (primary), "Show full error" and a copyable E-id. Plain, direct copy.
- Mixed from Strip: one status strip at the top of the shell, only for system-wide states (Telegram off, the panel offline), so they show on every pane.
- Mixed from Toasts: toasts only confirm a finished action, with Undo where it's possible ("Memory forgotten · Undo"). Failures that need action never arrive as toasts.
- Left behind: Strip for everything (one message at a time; a reserved band); Toasts for failures (they sit over the content and pile up; the chatty voice).

### Dialogs, decided from /proto/dialog (Modal, Sheet, Inline)
- Base: **Modal** (centred; a bottom sheet on phones; focus trapped and returned to the trigger).
- The guard matches the risk: typing "forget" only for forgetting a topic (irreversible, rare). Clean slate and forgetting a memory use Sheet's guard: "Keep" is the primary button and the red action sits alone below a rule.
- New agent opens as a modal form (bottom sheet on phones).
- Left behind: Sheet as the container (wide travel, heavy for a one-line confirm); Inline hold-to-confirm (unfamiliar for keyboard and screen-reader users).
