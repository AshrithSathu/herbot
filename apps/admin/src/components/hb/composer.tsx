// The message composer (docs/design/DECISIONS.md, "Composer"):
// - desktop: one card, attachment chips on top, a growing textarea, the five
//   modes as a chip radio group, Enter sends, Shift+Enter a new line;
// - phones: one compact row (attach · input · "Auto ▾" mode menu · send),
//   keeping the small file chips; Enter makes a new line on touch screens;
// - typing /fast, /think, /heavy or /deepsearch at the start sets that mode,
//   the same commands as in Telegram.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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

type ComposerProps = {
  onSend: (message: Outgoing) => void
  /** Blocks sending (and says why), e.g. "This topic is switched off". */
  disabledReason?: string
  /** A send is in flight. */
  sending?: boolean
  placeholder?: string
  /** Text to start with. */
  initialText?: string
  /** Puts text back into the box (Edit on a failed message, or a voice
   * turn that failed). A new `key` restores again, even the same text. */
  restore?: { text: string; key: string | number }
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

export function Composer({ onSend, disabledReason, sending = false, placeholder = 'Message this agent', initialText = '', restore, voice, attachments = true, modes = true, className }: ComposerProps) {
  const [text, setText] = useState(initialText)
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<Mode>('auto')
  const box = useRef<HTMLTextAreaElement>(null)

  // Grows with its content up to ~10 lines (writes style, returns nothing).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])
  // Restoring writes state, never returns anything from the effect.
  useLayoutEffect(() => {
    if (!restore) return
    setText(restore.text)
    box.current?.focus()
  }, [restore?.key]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setText('')
    setFiles([])
    setMode('auto')
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

  const current = MODES.find((m) => m.id === mode) ?? MODES[0]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      className={cn('flex flex-col gap-1.5', className)}
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
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-mute hover:bg-line hover:text-ink pointer-coarse:size-10"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {/* Phones: attach · text · mode · send in one row. Desktop: the text
            on top, the toolbar underneath. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-end gap-1 p-1.5 [grid-template-areas:'attach_text_mode_send'] md:grid-cols-[auto_minmax(0,1fr)_auto_auto] md:p-2 md:pt-0 md:[grid-template-areas:'text_text_text_text''attach_modes_count_send']">
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
            className="block w-full resize-none self-center bg-transparent px-2 py-2.5 text-base leading-6 text-ink outline-none [grid-area:text] placeholder:text-faint md:px-2 md:pt-3 pointer-fine:text-[15px]"
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
          {modes && <ModeChips mode={mode} setMode={setMode} />}
          {modes && <ModeMenu current={current} mode={mode} setMode={setMode} />}
          <span className={cn('hidden self-center px-1 text-[12px] tabular-nums [grid-area:count] md:inline', count > MAX_CHARS * 0.8 ? '' : 'invisible', over ? 'font-medium text-destructive' : 'text-mute')}>
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
      <p id="hb-composer-status" role="status" className={cn('min-h-5 px-3 text-[12px]', problem ? 'text-destructive' : 'text-faint')}>
        {problem ??
          (count > MAX_CHARS * 0.8 ? (
            <span className="tabular-nums md:hidden">{(MAX_CHARS - count).toLocaleString('en-GB')} characters left</span>
          ) : (
            <span className="max-md:hidden">
              Enter to send · Shift+Enter for a new line{modes && ' · /think, /heavy, /fast, /deepsearch set the mode'}
            </span>
          ))}
      </p>
    </form>
  )
}

/** Desktop: the five modes as a chip radio group (arrows move). */
function ModeChips({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const index = MODES.findIndex((m) => m.id === mode)
  return (
    <div
      role="radiogroup"
      aria-label="Mode for this message"
      className="hidden min-w-0 gap-1 self-center [grid-area:modes] md:flex"
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        e.preventDefault()
        const next = MODES[(index + step + MODES.length) % MODES.length]
        setMode(next.id)
        ;(e.currentTarget.querySelector(`[data-mode="${next.id}"]`) as HTMLElement | null)?.focus()
      }}
    >
      {MODES.map((m) => {
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
            onClick={() => setMode(m.id)}
            className={cn(
              'h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-accent-soft text-accent-strong' : 'text-mute hover:bg-sunken hover:text-ink',
            )}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

/** Phones: "Auto ▾", a menu with each mode's description. */
function ModeMenu({ current, mode, setMode }: { current: (typeof MODES)[number]; mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="[grid-area:mode] md:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Mode for this message: ${current.label}`}
          className="flex h-11 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-mute data-[state=open]:bg-sunken"
        >
          {current.label}
          <ChevronDownIcon aria-hidden className="size-3.5" />
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
              {MODES.map((m) => (
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
