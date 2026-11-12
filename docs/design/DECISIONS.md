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

## Stage 3: pages

### Topic (chat home), decided from /proto/page-topic (Pane, Drawer, Header)
- Base: **Pane**. Details are a permanent third pane from 68.75 rem (hide/show remembered), Drawer's overlay below that width, full screen on phones. You can watch a setting take effect in the conversation while you change it.
- Kept: the "New · N" line where unread replies begin, marking read on reaching the bottom, a switched-off topic's composer saying so, failed sends with Retry / Edit / Discard.
- Left behind: Drawer on wide screens (details hide the chat while open); Header (unfolded settings push the chat down to ~70 px on a phone).

### Files, decided from /proto/page-files (In details, Browser, Gallery)
- Base: **Browser**. A Chat | Files switch in the topic's main pane; files as a Ledger table (name, folder, kind, size) with filter, sort and folder chips, and a preview beside it on wide screens (image, video, audio, first 64 KB of text).
- Mixed from Gallery: images and video get a small thumbnail in the name cell.
- Left behind: In details (a 352 px column, no preview, files compete with settings); Gallery as the base (on real data it's almost all documents).

### Kit fixes found by the page stage (do in Stage 4)
- `AgentRow`: `onSelect(id, event)` so callers can stay in place (it always navigates today).
- A topic standing-mode list (Auto, Fast, Think = expert, Heavy); the composer's per-message `MODES` includes DeepSearch, which can't be a standing mode.
- Composer focus ring: neutral, not accent-tinted.
- `UserText` forwards extra props (`id`, aria attributes), so dialog titles can be labelled by it.
- Phone status strip: shorter copy at phone width.

### Logs, decided from /proto/page-logs (Pages, Split, Inline)
- Base: **Split**. The error list (E-id over kind, first line, when) beside the detail; the newest selected on wide screens; ↑/↓ walks and the detail follows; copy and older/newer in the detail. Below 68.75 rem it behaves like Pages (list, then a detail view with back).
- The selected row uses the kit's subtle selected state, not a dark outline.
- Left behind: Pages on wide screens (comparing errors means back and forth); Inline (expanded rows push the list far down; the most scrolling on phones).

### Search, decided from /proto/page-search (By topic, Flat, Palette)
- Base: **By topic**. Matches grouped under their topic (three shown, "Show N more", "Open"), highlighted, each opening the conversation at that message.
- Mixed from Palette: ⌘K also searches messages (newest few) with "See every match" opening this page with the query.
- Left behind: Flat (repetitive when hits share a topic); Palette as the only search (discoverability rests on a shortcut).

### More kit fixes from the page stage
- `LedgerTable`: a selected-row state, top-aligned cells option, and an expandable row; on phones, several below-the-line cells can share a line.
- Export the scroll-parent hook and a general `CopyButton`; add a kit `SearchInput`.
- `CommandPalette`: a message-search section and a per-page hotkey owner (one ⌘K).
- API: search hits carry time and sender; the errors list stays clipped (the detail has the full message).

### Overview, decided from /proto/page-overview (Figures, Inbox, Since)
- Base: **Figures**. Four serif figures, "Needs you", the last error.
- Mixed from Inbox: "Needs you" names the first few items with an action each (Open, Run again, Read it), then "Show all N" to the filtered view, instead of counts only.
- Left behind: Inbox as the base (the longest page; repeats the agents pane's "New"); Since (nothing prioritised; urgent items sit among routine runs).

### Topics, decided from /proto/page-topics (Ledger, Grouped, Manage)
- Base: **Ledger**. One table with filter, state and sort segments, a select column, a bulk bar while anything is selected (switch on/off with Undo), per-row Switch on/off, New agent. "Active" drops below 75 rem; on phones the checkbox sits in the name cell.
- Left behind: Grouped (no multi-select or sort; section-wide actions are blunt); Manage (the narrow pane caps density; a mode to learn).

### Companions, decided from /proto/page-companions (Stage, Call panel, Voice mode)
- Base: **Call panel**. The companion's conversation stays in the main pane; the voice call (avatar, state, mic, stop talking, timer) docks in the details pane, with a compact call bar below 68.75 rem. Every state has its own words: connecting, listening with a timer, transcribing, thinking, speaking, failed with retry, voice off.
- Mixed from Voice mode: companions also appear in the agents pane like any topic (they are topics).
- Left behind: Stage (typing and history second-class; an extra page); Voice mode as the base (the least prominent voice affordance).

### Connectors, decided from /proto/page-connectors (List, Settings)
- Base: **List**. Ledger tables for MCP servers and for Herbot's 13 tools with what each does and who may use it.
- Left behind: Settings (duplicates Personalize and Memory; long on phones).

### Sign-in, decided from /proto-signin (Card, Split)
- Base: **Card**. Wordmark in the serif, one password field with show/hide and a Caps Lock warning, inline errors, the slowdown message after three wrong tries, "Forgot it? It's HERBOT_ADMIN_PASSWORD in Herbot's .env."
- Left behind: Split (identity copy a single user doesn't need; an empty half-screen at 1,000–1,200 px).

### More kit fixes from the page stage
- Virtualizers (AgentList, LedgerTable, ThreadList): ignore zero-height measurements while a pane is hidden (phones), so lists don't jump when shown.
- LedgerTable phone layout: a per-column opt-out of shrinking (checkbox column).
- QuietAction forwards aria and className; FormDialog and ConfirmDialog restore focus to the opener even without a Radix trigger.
- ShellPage on phones: "‹ Agents" goes above the title.
- Composer: a voice slot (mic) and a way to put text back after a failed turn; inputs stay 16 px on touch at any width (pointer, not width, decides the 14 px desktop size).
- Field: a warning line (Caps Lock) shown alongside an error.
- Shell: details pane `defaultOpen` (permanent third pane on wide screens, remembered).

### Tasks, decided from /proto/page-tasks (Filter, Timeline, By topic)
- Base: **Filter**. One Thread list, newest first, with a status segment (a native picker on phones); each row: title, prompt preview, topic · schedule in words · next run · runs; Pause / Run now quiet actions and a separated Delete; New task in a FormDialog (topic picker over hostile names, presets, cron, timezone).
- Mixed from Timeline: a "Coming up" line above the list with the next three runs.
- Left behind: Timeline as the base (needs every task loaded for the order; one group can hold 200 rows); By topic (mostly one-task headers).

### Memory, decided from /proto/page-memory (List, By source, Reader)
- Base: **List**. One filterable Thread list, edit in place (⌘/Ctrl+Enter saves, Escape cancels), Show all for clamped text, Forget with the Keep-first dialog and an Undo toast. Over the 200 limit the add box is replaced by the limit notice.
- Left behind: By source (166 sources for 299 memories: tiny groups); Reader (one more step to act; borrows the topic-details pane).

### Personalize, decided from /proto/page-personalize (Stacked, Preview, Focused)
- Base: **Preview**. The two texts beside a live PERSONAL.md preview, exactly as herbot-core writes it ("what every agent reads"); an Edit / What agents see switch below 80 rem; a save bar with Unsaved / Saving / Saved, ⌘/Ctrl+S, counters in code points, and the leave guard.
- Left behind: Stacked (no view of what agents actually read); Focused (the other text a tab away; two saves feel like one).

### More kit fixes from the page stage
- ThreadList re-measures its scroll offset when content above it changes (several lists in one scroller).
- DetailsPane title and back label as props; ConfirmDialog's keep label as a prop ("Keep editing").
- A failure toast in `notify` (for a failed Undo); after a confirmed delete, focus moves to the next row.
- TopicPicker: Escape closes the list, not the dialog. Meta lines: no dangling "·" at a wrap.
