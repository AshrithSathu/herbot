// Non-happy states (docs/design/DECISIONS.md, "Feedback states"): every
// state appears where the content would be, at its size; one strip at the
// top of the shell carries system-wide state only; toasts only confirm a
// finished action, with Undo when possible. Failures never arrive as toasts.
import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Button } from './controls'

type EmptyProps = {
  title: ReactNode
  /** One line: why it's empty and what belongs here. */
  children?: ReactNode
  /** The action that fills it (or "Clear filter" for no results). */
  action?: ReactNode
  className?: string
}

/** First-run empty or no-results, sized like the content it replaces. */
export function InPlaceEmpty({ title, children, action, className }: EmptyProps) {
  return (
    <div className={cn('flex min-h-48 flex-col items-start justify-center gap-2 px-1 py-8', className)}>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children && <p className="max-w-[52ch] text-[14px] text-mute">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** "E-1042: the agent run failed" → { id: "E-1042", text: "the agent run failed" }. */
export function splitErrorId(message: string): { id: string | null; text: string } {
  const m = /^(E-\d+):\s*([\s\S]*)$/.exec(message.trim())
  return m ? { id: m[1], text: m[2] } : { id: null, text: message.trim() }
}

type ErrorProps = {
  title: ReactNode
  error: Error | string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

/** A failed load, in place: what failed, Retry first, the full error on
 * request, and the E-id ready to copy. */
export function InPlaceError({ title, error, onRetry, retrying = false, className }: ErrorProps) {
  const { id, text } = splitErrorId(typeof error === 'string' ? error : error.message)
  const [full, setFull] = useState(false)
  return (
    <div role="alert" className={cn('flex min-h-48 flex-col items-start justify-center gap-3 px-1 py-8', className)}>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <div className="w-full max-w-[64ch] rounded-lg bg-sunken px-3 py-2.5 shadow-[inset_0_0_0_var(--hair)_var(--line)]">
        <UserText as="p" lines={full ? 'all' : 2} className={cn('font-mono text-[12.5px] leading-relaxed text-mute', full && 'max-h-72 overflow-y-auto')}>
          {text}
        </UserText>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry && (
          <Button variant="primary" onClick={onRetry} pending={retrying}>
            {!retrying && <RotateCcwIcon aria-hidden />}
            Try again
          </Button>
        )}
        {text.length > 140 && (
          <Button variant="ghost" onClick={() => setFull((f) => !f)} aria-expanded={full}>
            {full ? 'Show less' : 'Show full error'}
          </Button>
        )}
        {id && <CopyId id={id} />}
      </div>
    </div>
  )
}

function CopyId({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id)
          setState('copied')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('failed')
        }
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 font-mono text-[12.5px] text-mute hover:bg-sunken hover:text-ink pointer-coarse:h-11"
      aria-label={`Copy ${id}`}
    >
      {id}
      {state === 'copied' ? <CheckIcon aria-hidden className="size-3.5 text-ok" /> : <CopyIcon aria-hidden className="size-3.5" />}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  )
}

/** Skeleton rows shaped like a list (one or two lines). */
export function ListSkeleton({ rows = 8, lines = 2, className }: { rows?: number; lines?: 1 | 2; className?: string }) {
  return (
    <ul aria-hidden className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex flex-col gap-2 border-b border-line px-1 py-3">
          <span className="h-3.5 rounded bg-sunken" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
          {lines === 2 && <span className="h-3 rounded bg-sunken" style={{ width: `${55 + ((i * 23) % 30)}%` }} />}
        </li>
      ))}
    </ul>
  )
}

/** Skeleton bubbles shaped like a conversation. */
export function ChatSkeleton() {
  return (
    <ol aria-hidden className="flex flex-col gap-4 px-4 py-6">
      {[62, 40, 75, 30, 55].map((w, i) => (
        <li key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <span className="h-14 rounded-[18px] bg-sunken" style={{ width: `${w}%` }} />
        </li>
      ))}
    </ol>
  )
}

type StripProps = { tone?: 'warn' | 'off'; children: ReactNode; action?: ReactNode }

/** System-wide state (Telegram off, the panel offline), shown on every pane. */
export function StatusStrip({ tone = 'warn', children, action }: StripProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-10 items-center gap-3 px-4 py-1.5 text-[13px]',
        tone === 'off' ? 'bg-destructive-soft text-destructive' : 'bg-warning-soft text-warning',
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone === 'off' ? 'bg-off' : 'bg-warn')} />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}

/** Confirms a finished action; offers Undo when it can be undone. Reading
 * time scales with the words (about 250 per minute, 3–10 s). */
export function notify(message: string, undo?: { label?: string; run: () => void }) {
  const words = message.trim().split(/\s+/).length
  const duration = Math.min(10_000, Math.max(3_000, words * 250 + (undo ? 3_000 : 0)))
  toast.success(message, {
    duration,
    action: undo ? { label: undo.label ?? 'Undo', onClick: undo.run } : undefined,
  })
}
