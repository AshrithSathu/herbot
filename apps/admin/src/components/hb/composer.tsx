// The message composer (docs/design/DECISIONS.md, "Composer"):
// - wide (by its own width, a container query, not the window): one card,
//   attachment chips on top, a growing textarea, the five modes as a chip
//   radio group, Enter sends, Shift+Enter a new line;
// - narrow (phones, or a chat squeezed beside the details pane): one row,
//   attach · input · "Auto ▾" mode menu · send, keeping the small file chips;
//   Enter makes a new line on touch screens;
// - typing /fast, /think, /heavy or /deepsearch at the start sets that mode,
//   the same commands as in Telegram;
// - the draft (text, files, mode) is kept per `draftKey` and can be restored
//   whole after a failed send.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, LoaderIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { charCount } from '../../format'
import { formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export const MAX_CHARS = 3500
export const MAX_FILES = 10
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024

export const MODES = [
  { id: 'auto', label: 'Auto', hint: 'Thinks as hard as the question needs' },
  { id: 'fast', label: 'Fast', hint: 'Quick answer, light reasoning' },
  { id: 'think', label: 'Think', hint: 'Thinks carefully before answering' },
  { id: 'heavy', label: 'Heavy', hint: 'Several sub-agents in parallel' },
  { id: 'deepsearch', label: 'DeepSearch', hint: 'Researches the web, with sources' },
] as const
export type Mode = (typeof MODES)[number]['id']

const SLASH = /^\/(fast|think|heavy|deepsearch|auto)(?:\s+|$)/i

export type Outgoing = { text: string; files: File[]; mode: Mode }

/** What a composer holds: restored after a failed send, kept per topic. */
export type Draft = { text: string; files: File[]; mode: Mode }

type ComposerProps = {
  onSend: (message: Outgoing) => void
  /** Blocks sending (and says why) while you can still type, e.g. files too big. */
  disabledReason?: string
  /** Replaces the whole composer, e.g. a switched-off topic's reason and its
   * Switch on action (use ComposerBlocked). */
  blocked?: ReactNode
  /** A send is in flight. */
  sending?: boolean
  placeholder?: string
  /** Text to start with. */
  initialText?: string
  /** Puts a draft back (Edit on a failed message): text, and files and mode
   * when given. A new `key` restores again, even the same draft. */
  restore?: { text: string; files?: File[]; mode?: Mode; key: string | number }
  /** Keeps the draft (text and mode across reloads; files for this session)
   * under this key, e.g. the topic id, so switching agents never loses it. */
  draftKey?: string
  /** The topic's own mode ("Heavy"): the first choice reads "Topic default
   * (Heavy)" instead of "Auto", since a message without a mode uses it. */
  defaultLabel?: string
  /** Called whenever the per-message mode changes (chips, menu or /command). */
  onModeChange?: (mode: Mode) => void
  /** Beside the send button: a mic for voice turns (companions). */
  voice?: ReactNode
  /** Offer attaching files (default). Off where a turn can't carry files. */
  attachments?: boolean
  /** Offer the per-message mode (default). Off where modes don't apply. */
  modes?: boolean
  className?: string
}

function fileProblem(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Attach up to ${MAX_FILES} files at a time`
  const big = files.filter((f) => f.size > MAX_FILE_BYTES)
  if (big.length) return `Remove ${big.length === 1 ? 'the file' : `${big.length} files`} over 20 MB to send`
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return 'Files add up to more than 24 MB; remove some to send'
  return null
}

const coarse = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches

// Drafts: text and mode in sessionStorage (survive a reload), files in memory
// (a File can't be stored; they survive switching agents, not a reload).
const draftFiles = new Map<string, File[]>()
const storageKey = (key: string) => `hb-draft:${key}`

function loadDraft(key: string | undefined, initialText: string): Draft & { key?: string } {
  const empty = { key, text: initialText, files: [], mode: 'auto' as Mode }
  if (!key || typeof window === 'undefined') return empty
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(key)) ?? 'null') as { text?: string; mode?: Mode } | null
    return {
      key,
      text: saved?.text ?? initialText,
      mode: MODES.some((m) => m.id === saved?.mode) ? (saved?.mode as Mode) : 'auto',
      files: draftFiles.get(key) ?? [],
    }
  } catch {
    return { ...empty, files: draftFiles.get(key) ?? [] }
  }
}

function saveDraft(key: string, d: Draft) {
  if (d.files.length) draftFiles.set(key, d.files)
  else draftFiles.delete(key)
  try {
    if (!d.text && d.mode === 'auto') sessionStorage.removeItem(storageKey(key))
    else sessionStorage.setItem(storageKey(key), JSON.stringify({ text: d.text, mode: d.mode }))
  } catch {
    /* storage can be blocked; the draft still lives while the page is open */
  }
}

/** Optional per-message modes, with "auto" reading as the topic's default. */
function modeOptions(defaultLabel?: string) {
  if (!defaultLabel) return MODES.map((m) => ({ ...m, chip: m.label }))
  // The topic's own mode is the default choice, so it isn't offered twice
  // ("Default (Think)" and a separate "Think").
  return MODES.filter((m) => m.id === 'auto' || m.label !== defaultLabel).map((m) =>
    m.id === 'auto'
      ? { ...m, label: `Topic default (${defaultLabel})`, chip: `Default (${defaultLabel})`, hint: `This topic's mode, ${defaultLabel}` }
      : { ...m, chip: m.label },
  )
}
type ModeOption = ReturnType<typeof modeOptions>[number]

export function Composer({
  onSend,
  disabledReason,
  blocked,
  sending = false,
  placeholder = 'Message this agent',
  initialText = '',
  restore,
  draftKey,
  defaultLabel,
  onModeChange,
  voice,
  attachments = true,
  modes = true,
  className,
}: ComposerProps) {
  // One state for the whole draft, tagged with the key it belongs to, so
  // switching topics can never save one topic's text under another's key.
  const [draft, setDraft] = useState(() => loadDraft(draftKey, initialText))
  if (draft.key !== draftKey) setDraft(loadDraft(draftKey, initialText))
  const { text, files, mode } = draft
  const box = useRef<HTMLTextAreaElement>(null)
  const options = modeOptions(defaultLabel)

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setText = (t: string) => update({ text: t })
  const setFiles = (f: File[] | ((all: File[]) => File[])) => setDraft((d) => ({ ...d, files: typeof f === 'function' ? f(d.files) : f }))
  const setMode = (m: Mode) => {
    update({ mode: m })
    onModeChange?.(m)
  }

  useEffect(() => {
    if (draft.key) saveDraft(draft.key, draft)
  }, [draft])

  // Grows with its content up to ~10 lines (writes style, returns nothing).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    // A scrollbar only once it stops growing.
    el.style.overflowY = el.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [text])
  // Restoring writes state, never returns anything from the effect.
  useLayoutEffect(() => {
    if (!restore) return
    setDraft((d) => ({ ...d, text: restore.text, files: restore.files ?? d.files, mode: restore.mode ?? d.mode }))
    if (restore.mode) onModeChange?.(restore.mode)
    box.current?.focus()
  }, [restore?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (blocked) return <div className={className}>{blocked}</div>

  const count = charCount(text)
  const over = count > MAX_CHARS
  const problem = disabledReason ?? (over ? `Shorten it by ${(count - MAX_CHARS).toLocaleString('en-GB')} characters to send` : fileProblem(files))
  const empty = !text.trim() && files.length === 0
  const canSend = !empty && !problem && !sending

  function change(value: string) {
    const m = modes ? SLASH.exec(value) : null
    if (m) {
      setMode(m[1].toLowerCase() as Mode)
      value = value.slice(m[0].length)
    }
    setText(value)
  }

  function send() {
    if (!canSend) return
    onSend({ text: text.trim(), files, mode })
    setDraft((d) => ({ ...d, text: '', files: [], mode: 'auto' }))
    if (mode !== 'auto') onModeChange?.('auto')
    box.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      send()
      return
    }
    if (e.shiftKey || coarse()) return // a new line
    e.preventDefault()
    send()
  }

  const current = options.find((m) => m.id === mode) ?? options[0]

  // Layout follows the composer's own width (a container query), not the
  // window: beside an open details pane the chat can be narrow on a wide
  // screen. Wide: text on top, attach · mode chips · count · send below.
  // Narrow: one row, attach · text · mode menu · send.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      className={cn('@container/composer flex flex-col gap-1.5', className)}
    >
      <div className="rounded-2xl bg-pane shadow-raised transition-[box-shadow] duration-150 ease-out focus-within:shadow-[var(--raised),0_0_0_1px_var(--mute)]">
        {files.length > 0 && (
          <ul aria-label="Attachments" className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {files.map((f, i) => {
              const big = f.size > MAX_FILE_BYTES
              return (
                <li
                  key={`${f.name}-${i}`}
                  title={f.name}
                  className={cn(
                    'flex h-11 max-w-60 shrink-0 items-center gap-2 rounded-xl pr-1 pl-3 shadow-[inset_0_0_0_var(--hair)_var(--line)]',
                    big ? 'bg-destructive-soft shadow-[inset_0_0_0_1px_var(--off)]' : 'bg-sunken',
                  )}
                >
                  <span className="min-w-0">
                    <UserText className="text-[13px] font-medium">{f.name}</UserText>
                    <span className={cn('block text-[11px] tabular-nums', big ? 'text-destructive' : 'text-mute')}>
                      {big ? `${formatBytes(f.size)}, over 20 MB` : formatBytes(f.size)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                    className="relative grid size-8 shrink-0 place-items-center rounded-lg text-mute before:absolute before:-inset-1 hover:bg-line hover:text-ink pointer-coarse:size-11 pointer-coarse:before:hidden"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-end gap-1 p-1.5 [grid-template-areas:'attach_text_mode_send'] @[30rem]/composer:p-2 @[30rem]/composer:pt-0 @[30rem]/composer:[grid-template-areas:'text_text_text_text''attach_modes_count_send']">
          <label htmlFor="hb-composer" className="sr-only">
            {placeholder}
          </label>
          <textarea
            id="hb-composer"
            ref={box}
            rows={1}
            dir="auto"
            value={text}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            aria-describedby="hb-composer-status"
            className="block w-full resize-none self-center bg-transparent px-2 py-2.5 text-base leading-6 text-ink outline-none [grid-area:text] placeholder:text-faint @[30rem]/composer:pt-3 pointer-fine:text-[15px]"
          />
          {attachments && (
            <label
              className="grid size-10 cursor-pointer place-items-center rounded-full text-mute [grid-area:attach] hover:bg-sunken hover:text-ink has-focus-visible:ring-2 has-focus-visible:ring-ring pointer-coarse:size-11"
              title="Attach files"
            >
              <PaperclipIcon className="size-[18px]" aria-hidden />
              <input
                type="file"
                multiple
                className="sr-only"
                aria-label="Attach files"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? [])
                  setFiles((all) => [...all, ...picked])
                  e.target.value = ''
                }}
              />
            </label>
          )}
          {modes && <ModeChips options={options} mode={mode} setMode={setMode} />}
          {modes && <ModeMenu options={options} current={current} mode={mode} setMode={setMode} defaultLabel={defaultLabel} />}
          <span
            className={cn(
              'hidden self-center px-1 text-[12px] tabular-nums [grid-area:count] @[30rem]/composer:inline',
              count > MAX_CHARS * 0.8 ? '' : 'invisible',
              over ? 'font-medium text-destructive' : 'text-mute',
            )}
          >
            {(MAX_CHARS - count).toLocaleString('en-GB')}
          </span>
          <span className="flex items-center gap-1 [grid-area:send]">
            {voice}
            <button
              type="submit"
              disabled={!canSend}
              aria-label={sending ? 'Sending' : 'Send message'}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-strong text-accent-ink transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] disabled:bg-sunken disabled:text-faint pointer-coarse:size-11"
            >
              {sending ? <LoaderIcon className="size-[18px] motion-safe:animate-spin" aria-hidden /> : <ArrowUpIcon className="size-[18px]" aria-hidden />}
            </button>
          </span>
        </div>
      </div>
      <p id="hb-composer-status" role="status" className={cn(
          'min-h-5 px-3 text-[12px]',
          // A reason the page gives (Telegram off) is a state, not an error:
          // muted. Only something you can fix here (too long, a bad file) is red.
          disabledReason ? 'text-mute' : problem ? 'text-destructive' : 'text-faint',
        )}>
        {problem ??
          (count > MAX_CHARS * 0.8 ? (
            <span className="tabular-nums @[30rem]/composer:hidden">{(MAX_CHARS - count).toLocaleString('en-GB')} characters left</span>
          ) : (
            <span className="hidden pointer-fine:@[30rem]/composer:inline">
              Enter to send · Shift+Enter for a new line{modes && ' · /think, /heavy, /fast, /deepsearch set the mode'}
            </span>
          ))}
      </p>
    </form>
  )
}

/** In place of the composer when the topic can't take messages: says why, and
 * offers the way out (e.g. "Switched off" · Switch on). */
export function ComposerBlocked({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-sunken px-4 py-2 text-[14px] text-mute">
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  )
}

/** A wide composer: the five modes as a chip radio group (arrows move). */
function ModeChips({ options, mode, setMode }: { options: ModeOption[]; mode: Mode; setMode: (m: Mode) => void }) {
  const index = options.findIndex((m) => m.id === mode)
  return (
    <div
      role="radiogroup"
      aria-label="Mode for this message"
      className="hidden min-w-0 gap-1 self-center [grid-area:modes] @[30rem]/composer:flex"
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        e.preventDefault()
        const next = options[(index + step + options.length) % options.length]
        setMode(next.id)
        ;(e.currentTarget.querySelector(`[data-mode="${next.id}"]`) as HTMLElement | null)?.focus()
      }}
    >
      {options.map((m) => {
        const on = m.id === mode
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-mode={m.id}
            tabIndex={on ? 0 : -1}
            title={m.hint}
            aria-label={m.label}
            onClick={() => setMode(m.id)}
            className={cn(
              // 32px chips, 40px hit areas (44px tall on touch).
              'relative h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-1 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11',
              on ? 'bg-accent-soft text-accent-strong' : 'text-mute hover:bg-sunken hover:text-ink',
            )}
          >
            {m.chip}
          </button>
        )
      })}
    </div>
  )
}

/** A narrow composer: "Auto ▾", a menu with each mode's description. */
function ModeMenu({ options, current, mode, setMode, defaultLabel }: { options: ModeOption[]; current: ModeOption; mode: Mode; setMode: (m: Mode) => void; defaultLabel?: string }) {
  return (
    <div className="[grid-area:mode] @[30rem]/composer:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Mode for this message: ${current.label}`}
          className="flex h-11 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-mute data-[state=open]:bg-sunken"
        >
          {/* Short in a narrow row: the mode's own name ("Think"); the menu
              and the accessible name say when it's the topic's default. */}
          <span className="max-w-[7rem] truncate">{current.id === 'auto' ? (defaultLabel ?? current.label) : current.label}</span>
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="end"
            sideOffset={8}
            className="z-50 w-72 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl bg-pane p-1 text-ink shadow-raised data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100"
          >
            <DropdownMenu.Label className="px-3 pt-2 pb-1 text-[12px] text-mute">Mode for this message</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)}>
              {options.map((m) => (
                <DropdownMenu.RadioItem
                  key={m.id}
                  value={m.id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-sunken"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] font-medium">{m.label}</span>
                    <span className="text-[12.5px] text-mute">{m.hint}</span>
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon aria-hidden className="size-4 text-accent-strong" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
