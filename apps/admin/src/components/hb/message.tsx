// A chat message (docs/design/DECISIONS.md, "Chat message"): Bubbles as the
// base (agent left, you right in a soft accent, time in the corner, long
// content folding inside the bubble), with a message's files collapsed to one
// summary line and Copy always visible on agent replies.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, CopyIcon, PaperclipIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import type { Attachment, Message as MessageData } from '../../api'
import { clock } from '../../format'
import { FilePreview, RichMessage, formatBytes, isOnlyCode } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { DisclosureButton } from './controls'
import { ErrorText } from './feedback'

/** Fold past this many characters or lines (production's chat rules). */
export const FOLD_CHARS = 1500
export const FOLD_LINES = 24

export function isLong(body: string): boolean {
  return body.length > FOLD_CHARS || body.split('\n').length > FOLD_LINES
}

/** The start of a long message, as Markdown that still parses: cut at a line,
 * then close a code fence the cut left open. Only this much is rendered (and
 * highlighted) until "Show all", so a 20,000-character body costs nothing
 * while folded. */
export function foldedPreview(body: string): string {
  const lines = body.split('\n').slice(0, 14)
  let out = ''
  for (const line of lines) {
    if (out.length + line.length > 900) {
      if (!out) out = line.slice(0, 900)
      break
    }
    out += (out ? '\n' : '') + line
  }
  const fences = out.match(/^\s*(```|~~~)/gm)?.length ?? 0
  return fences % 2 === 1 ? `${out}\n\`\`\`` : out
}

const BUBBLE = 'relative min-w-0 max-w-[min(42rem,88%)] rounded-[18px] px-3.5 py-2.5 text-[15px] leading-relaxed'

type RowProps = {
  side: 'you' | 'agent'
  /** Same speaker as the message above: tighter spacing. */
  grouped?: boolean
  children: ReactNode
}

/** One entry in the conversation, aligned to its speaker. */
export function MessageRow({ side, grouped = false, children }: RowProps) {
  return <li className={cn('flex min-w-0 flex-col', side === 'you' ? 'items-end' : 'items-start', grouped ? 'mt-1' : 'mt-5 first:mt-0')}>{children}</li>
}

type MessageProps = {
  message: MessageData
  /** Highlight (a search jump). */
  highlighted?: boolean
}

/** The code inside a message that is one fenced block (fences dropped). */
function codeOf(body: string): string {
  const lines = body.trim().split('\n').slice(1)
  const fence = body.trim().slice(0, 3)
  const close = lines.findIndex((l) => l.trim().startsWith(fence))
  return (close === -1 ? lines : lines.slice(0, close)).join('\n')
}

/** A search jump's landing: a soft accent halo that fades after ~2 s
 * (instantly under reduced motion, where transitions are off). */
function useFlash(on: boolean): boolean {
  const [flash, setFlash] = useState(on)
  useEffect(() => {
    if (!on) return
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), 2000)
    return () => window.clearTimeout(t)
  }, [on])
  return on && flash
}

export function Message({ message: m, highlighted = false }: MessageProps) {
  const you = !m.from_bot
  const long = isLong(m.body)
  const [open, setOpen] = useState(false)
  const flash = useFlash(highlighted)
  const onlyCode = isOnlyCode(m.body)
  // Copy lives in the meta line, except when the message is one code block
  // whose own header has Copy. Folded, that header is in the inert preview
  // and can't be pressed, so the meta line copies the whole code instead.
  const copy = !you && m.body.trim() ? (!onlyCode ? m.body : long && !open ? codeOf(m.body) : null) : null
  return (
    <article
      // Search results and ?message= jumps land here.
      id={`message-${m.id}`}
      aria-label={`${you ? 'You' : 'Agent'}, ${clock(m.sent_at)}`}
      className={cn(
        BUBBLE,
        you ? 'rounded-br-md bg-accent-soft text-ink' : 'rounded-bl-md bg-pane shadow-raised',
        'transition-[box-shadow] duration-700 ease-out',
        flash && 'shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-strong)_24%,transparent)]',
      )}
    >
      {m.is_voice && <p className="mb-1 text-[12px] font-medium text-mute">Voice note · transcript</p>}
      {m.body.trim() &&
        (long && !open ? (
          // Folded: a short preview, inert so nothing hidden by the fade can
          // take focus; the full, interactive message mounts on "Show all".
          <div inert className="user-text max-h-72 [mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent)]">
            <RichMessage body={foldedPreview(m.body)} />
          </div>
        ) : (
          <div className="user-text">
            <RichMessage body={m.body} />
          </div>
        ))}
      {long && (
        <DisclosureButton open={open} onClick={() => setOpen((o) => !o)} className="mt-1">
          {open ? 'Show less' : `Show all ${m.body.length.toLocaleString('en-GB')} characters`}
        </DisclosureButton>
      )}
      {m.attachments.length > 0 && <Files files={m.attachments} />}
      <div className="mt-1 flex items-center justify-end gap-1">
        {copy !== null && <CopyText text={copy} label={onlyCode ? 'Copy code' : undefined} />}
        <time dateTime={m.sent_at} className="text-[11px] text-faint tabular-nums" suppressHydrationWarning>
          {clock(m.sent_at)}
        </time>
      </div>
    </article>
  )
}

/** One file shows as a card; more collapse to "12 files · 74.4 MB". */
function Files({ files }: { files: Attachment[] }) {
  const [open, setOpen] = useState(false)
  if (files.length === 1) {
    return (
      <div className="mt-2 w-[min(24rem,70vw)] max-w-full">
        <FilePreview file={files[0]} className="border-line bg-pane" />
      </div>
    )
  }
  const total = files.reduce((n, f) => n + (Number.isFinite(f.size) ? f.size : 0), 0)
  return (
    <div className="mt-2 flex w-[min(24rem,70vw)] max-w-full flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 self-start rounded-md px-1 text-[13px] text-mute hover:text-ink pointer-coarse:h-11"
      >
        <PaperclipIcon aria-hidden className="size-3.5" />
        <span className="tabular-nums">
          {files.length} files · {formatBytes(total)}
        </span>
        <ChevronDownIcon aria-hidden className={cn('size-3.5 transition-transform duration-150 ease-out', open && 'rotate-180')} />
      </button>
      {open && files.map((f, i) => <FilePreview key={`${f.path}-${i}`} file={f} className="border-line bg-pane" />)}
    </div>
  )
}

function CopyText({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState('copied')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('failed')
        }
      }}
      className="relative inline-flex h-6 items-center gap-1 rounded px-1 text-[11.5px] text-faint before:absolute before:-inset-x-1 before:-inset-y-2 hover:text-ink pointer-coarse:before:-inset-y-3"
    >
      {state === 'copied' ? <CheckIcon aria-hidden className="size-3 text-ok" /> : <CopyIcon aria-hidden className="size-3" />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  )
}

type FailedProps = {
  body: string
  error: string
  sentAt: string
  retrying?: boolean
  onRetry: () => void
  onEdit: () => void
  onDiscard: () => void
}

/** A message that didn't send: dashed, says why (with its E-id), and offers
 * Retry, Edit and Discard. */
export function FailedMessage({ body, error, sentAt, retrying = false, onRetry, onEdit, onDiscard }: FailedProps) {
  return (
    <>
      <article
        aria-label={`You, ${clock(sentAt)}, not sent`}
        className={cn(BUBBLE, 'rounded-br-md border border-dashed border-off bg-transparent', retrying && 'opacity-60')}
      >
        <UserText as="p" lines="all">
          {body}
        </UserText>
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-destructive">
          <AlertCircleIcon className="size-3" aria-hidden />
          {retrying ? 'Sending…' : 'Not sent'}
        </p>
      </article>
      <div role="alert" className="mt-1 flex max-w-[min(42rem,88%)] flex-col items-end gap-1">
        <p className="text-right text-[12.5px] text-mute">
          <ErrorText error={error} lines={2} />
        </p>
        <div className="flex gap-1">
          <Action icon={RotateCcwIcon} onClick={onRetry} disabled={retrying}>
            Retry
          </Action>
          <Action icon={PencilIcon} onClick={onEdit} disabled={retrying}>
            Edit
          </Action>
          <Action icon={Trash2Icon} onClick={onDiscard} disabled={retrying}>
            Discard
          </Action>
        </div>
      </div>
    </>
  )
}

function Action({ icon: Icon, children, onClick, disabled }: { icon: typeof CopyIcon; children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      // 36px to look at, 40px to hit on desktop (44px on touch); a muted
      // token, not opacity, when disabled.
      className="relative flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-ink transition-[background-color,scale] duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] hover:bg-sunken active:scale-[0.96] disabled:pointer-events-none disabled:text-faint pointer-coarse:h-11 pointer-coarse:before:inset-y-0"
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

/** The agent is working: three dots and the time it's taken (paused while
 * the tab is hidden). */
export function Thinking({ since, label = 'Thinking' }: { since: number; label?: string }) {
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(() => {
    const start = () => {
      clearInterval(timer.current)
      timer.current = setInterval(() => setNow(Date.now()), 1000)
    }
    const onVisibility = () => (document.hidden ? clearInterval(timer.current) : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <div role="status" className={cn(BUBBLE, 'flex items-center gap-2.5 rounded-bl-md bg-pane shadow-raised')}>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-mute motion-safe:animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      <span className="text-[13.5px] text-mute tabular-nums" suppressHydrationWarning>
        {label} · {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </span>
    </div>
  )
}
