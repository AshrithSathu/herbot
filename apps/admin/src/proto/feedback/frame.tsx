// K5 shared prototype frame: real stress data, the Conversation+ shell, and
// the pieces every feedback/dialog variant renders (throwaway).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, HashIcon, MessageCircleIcon, PaperclipIcon, SearchIcon, XIcon } from 'lucide-react'
import { getMessages, type Message, type Topic } from '../../api'
import { ago, topicStatus } from '../../format'
import { errorQuery, errorSearchQuery, memoriesQuery, topicsQuery } from '../../queries'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import '@/proto/tokens.css'
import './feedback.css'

// ---------------------------------------------------------------------------
// Data: the stress environment's worst content.

export function useStress() {
  const topics = useQuery(topicsQuery)
  const memories = useQuery(memoriesQuery)
  const errors = useInfiniteQuery(errorSearchQuery(''))
  const summaries = errors.data?.pages[0] ?? []
  // The multi-line panic trace and the 3,000-character wall.
  const panicId = summaries.find((e) => e.message.startsWith('thread '))?.error_id
  const panic = useQuery({ ...errorQuery(panicId ?? 'E-0'), enabled: Boolean(panicId) })
  const chat = useQuery({
    queryKey: ['k5-chat'],
    queryFn: () => getMessages({ data: { id: 2, before: 302, limit: 6 } }),
    staleTime: Infinity,
  })
  const all = topics.data ?? []
  const mem = memories.data ?? []
  return {
    topics: all,
    /** The 128-character name, for anything that quotes a topic. */
    hostile: all.find((t) => t.name.length >= 120) ?? all[1],
    zalgo: all.find((t) => /\p{M}{3,}/u.test(t.name)),
    longMemory: mem.find((m) => Array.from(m.content).length >= 480 && /\s/.test(m.content)) ?? mem[0],
    error: panic.data ? { id: panic.data.error_id, message: panic.data.message } : null,
    messages: chat.data?.messages ?? [],
    ready: topics.isSuccess && memories.isSuccess,
  }
}

export type Stress = ReturnType<typeof useStress>

// ---------------------------------------------------------------------------
// Which state the page shows (harness chrome, the same in every variant).

export const STATES = [
  { id: 'first-run', label: 'First run' },
  { id: 'no-results', label: 'No results' },
  { id: 'loading', label: 'Loading' },
  { id: 'failed', label: 'Failed load' },
  { id: 'stale', label: 'Stale data' },
  { id: 'offline', label: 'Telegram off' },
  { id: 'toasts', label: 'Toasts' },
] as const
export type State = (typeof STATES)[number]['id']

export function useHarnessState(): [State, (s: State) => void] {
  const [state, set] = useState<State>(() => {
    if (typeof window === 'undefined') return 'first-run'
    const s = new URLSearchParams(location.search).get('s')
    return STATES.some((x) => x.id === s) ? (s as State) : 'first-run'
  })
  const choose = useCallback((s: State) => {
    set(s)
    const url = new URL(location.href)
    url.searchParams.set('s', s)
    history.replaceState(history.state, '', url)
  }, [])
  return [state, choose]
}

export function StateBar({ state, onState }: { state: State; onState: (s: State) => void }) {
  return (
    <nav className="k5-states" aria-label="Prototype state">
      <span>State</span>
      {STATES.map((s) => (
        <button key={s.id} type="button" aria-pressed={state === s.id} onClick={() => onState(s.id)}>
          {s.label}
        </button>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// The Conversation+ shell: agents pane | main pane; one pane on phones.

export function Shell({ agents, main, below, overlay }: {
  agents: ReactNode
  main: ReactNode
  /** The harness strip, under the panes. */
  below: ReactNode
  /** Toasts and other floating layers. */
  overlay?: ReactNode
}) {
  const [phonePane, setPhonePane] = useState<'agents' | 'main'>('main')
  return (
    <div className="hb fixed inset-0 z-[45] flex flex-col antialiased">
      <div className="grid min-h-0 flex-1 gap-2 p-2 md:grid-cols-[300px_minmax(0,1fr)]">
        <section
          aria-label="Agents"
          className={cn(
            'min-h-0 flex-col overflow-hidden rounded-xl bg-[var(--c-pane)] shadow-[var(--c-raised)] md:flex',
            phonePane === 'agents' ? 'flex' : 'hidden',
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
            <span className="text-[15px] font-semibold tracking-tight">Herbot</span>
            <button
              type="button"
              onClick={() => setPhonePane('main')}
              className="-mr-2 grid size-11 place-items-center rounded-lg text-[var(--c-mute)] md:hidden"
              aria-label="Close agents"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
          {agents}
        </section>
        <section
          aria-label="Main"
          className={cn(
            'relative min-h-0 flex-col overflow-hidden rounded-xl bg-[var(--c-pane)] shadow-[var(--c-raised)] md:flex',
            phonePane === 'main' ? 'flex' : 'hidden',
          )}
        >
          <button
            type="button"
            onClick={() => setPhonePane('agents')}
            className="absolute top-1 left-1 z-[1] grid size-11 place-items-center rounded-lg text-[var(--c-mute)] md:hidden"
            aria-label="Show agents"
          >
            <MessageCircleIcon className="size-4" aria-hidden />
          </button>
          {main}
        </section>
      </div>
      {below}
      {overlay}
    </div>
  )
}

/** Main pane header, aligned to the shell's 48px rhythm. */
export function PaneHeader({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b-[length:var(--hair)] border-[var(--c-line)] pr-3 pl-12 md:pl-5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-left text-[15px] leading-tight font-semibold [&_[dir=auto]]:text-left">{title}</div>
        {meta && <div className="truncate text-xs text-[var(--c-mute)]">{meta}</div>}
      </div>
      {action}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Content pieces shared by every variant (the content isn't the contestant).

export function FilterField({ value, onChange, placeholder = 'Search agents' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="relative px-3 pb-2">
      <label htmlFor="k5-filter" className="sr-only">
        {placeholder}
      </label>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-[calc(50%+4px)] text-[var(--c-faint)]" />
      <input
        ref={ref}
        id="k5-filter"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-lg bg-[var(--c-sunken)] pr-9 pl-9 text-base outline-none placeholder:text-[var(--c-faint)] focus-visible:ring-2 focus-visible:ring-[var(--c-ink)]/25 md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className="absolute top-1/2 right-4 grid size-8 -translate-y-[calc(50%+4px)] place-items-center rounded-md text-[var(--c-mute)] hover:text-[var(--c-ink)]"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

const DOT: Record<string, string> = {
  success: 'bg-[var(--c-ok)]',
  warning: 'bg-[var(--c-warn)]',
  danger: 'bg-[var(--c-off)]',
  muted: 'bg-[var(--c-faint)]',
}

export function AgentRows({ topics }: { topics: Topic[] }) {
  return (
    <ul className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {topics.slice(0, 60).map((t) => {
        const status = topicStatus(t)
        return (
          <li key={t.id}>
            <a href="#" onClick={(e) => e.preventDefault()} className="flex h-12 items-center gap-3 rounded-lg px-2 transition-colors duration-150 hover:bg-[var(--c-sunken)]">
              {t.is_general ? (
                <MessageCircleIcon className="size-4 shrink-0 text-[var(--c-mute)]" aria-hidden />
              ) : (
                <HashIcon className="size-4 shrink-0 text-[var(--c-mute)]" aria-hidden />
              )}
              <UserText className="min-w-0 flex-1 text-sm">{t.name}</UserText>
              <span className="shrink-0 text-xs text-[var(--c-faint)] tabular-nums">{ago(t.last_activity)}</span>
              <span className={cn('size-1.5 shrink-0 rounded-full', DOT[status.tone])} title={status.label} aria-hidden />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** Ledger-style rows: hairline rules, tabular figures. */
export function TopicLedger({ topics }: { topics: Topic[] }) {
  return (
    <ul className="divide-y-[length:var(--hair)] divide-[var(--c-line)] border-y-[length:var(--hair)] border-[var(--c-line)]">
      {topics.slice(0, 14).map((t) => (
        <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2.5">
          <UserText className="text-sm font-medium">{t.name}</UserText>
          <span className="text-xs text-[var(--c-mute)] tabular-nums">{t.messages.toLocaleString('en-GB')}</span>
          <UserText className="col-span-2 text-xs text-[var(--c-mute)]" fallback="No purpose yet">
            {t.purpose}
          </UserText>
        </li>
      ))}
    </ul>
  )
}

export function Bubbles({ messages }: { messages: Message[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {messages.map((m) => (
        <li key={m.id} className={cn('flex', m.from_bot ? 'justify-start' : 'justify-end')}>
          <div
            className={cn(
              'max-w-[min(80%,560px)] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed',
              m.from_bot ? 'bg-[var(--c-sunken)]' : 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]',
            )}
          >
            <UserText lines={3} as="p" fallback={`${m.attachments.length} attachments`}>
              {m.body}
            </UserText>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Composer({ disabled = false, note, value, onChange, onSend }: {
  disabled?: boolean
  note?: ReactNode
  value: string
  onChange: (v: string) => void
  onSend: () => void
}) {
  return (
    <form
      className="shrink-0 border-t-[length:var(--hair)] border-[var(--c-line)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled) onSend()
      }}
    >
      {note}
      <div className="flex items-end gap-2">
        <button type="button" aria-label="Attach files" className="grid size-11 shrink-0 place-items-center rounded-lg text-[var(--c-mute)] hover:bg-[var(--c-sunken)]">
          <PaperclipIcon className="size-4" aria-hidden />
        </button>
        <label htmlFor="k5-composer" className="sr-only">
          Message
        </label>
        <textarea
          id="k5-composer"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!disabled) onSend()
            }
          }}
          placeholder="Message"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl bg-[var(--c-sunken)] px-3.5 py-2.5 text-base outline-none placeholder:text-[var(--c-faint)] focus-visible:ring-2 focus-visible:ring-[var(--c-ink)]/25 md:text-[15px]"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="h-11 shrink-0 rounded-xl bg-[var(--c-accent)] px-4 text-sm font-medium text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Small behaviours every variant needs.

/** An error id that copies itself, with a checkmark for 1.5 s. */
export function ErrorId({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked: the id is still on screen to read */
        }
      }}
      aria-label={copied ? `Copied ${id}` : `Copy error id ${id}`}
      className={cn(
        'relative inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-xs tabular-nums transition-colors duration-150 before:absolute before:-inset-y-2 hover:bg-[var(--c-sunken)]',
        className,
      )}
    >
      {id}
      {copied ? <CheckIcon className="size-3.5" aria-hidden /> : <CopyIcon className="size-3.5 opacity-60" aria-hidden />}
    </button>
  )
}

/** A fake server call: resolves or fails after a believable delay. */
export function fakeCall<T>(result: T, ms = 900, fail = false): Promise<T> {
  return new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error(String(result))) : resolve(result)), ms))
}

/** A countdown that freezes while the tab is hidden (emil-touch #9). */
export function useCountdown(seconds: number, onDone: () => void, running = true) {
  const [left, setLeft] = useState(seconds)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (document.hidden) return
      setLeft((s) => {
        if (s <= 1) {
          done.current()
          return seconds
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running, seconds])
  return left
}

// ---------------------------------------------------------------------------
// Toasts: a minimal stack with word-count durations, paused on hover and in
// background tabs. Variants style the toast itself.

export type Toast = {
  id: number
  tone: 'ok' | 'fail' | 'info'
  title: string
  body?: string
  eid?: string
  action?: { label: string; run: () => void }
  /** Stays until dismissed (failures that need a decision). */
  sticky?: boolean
  state: 'entering' | 'shown' | 'leaving'
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const remaining = useRef(new Map<number, number>())
  const paused = useRef(false)
  const next = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, state: 'leaving' } : t)))
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 160)
    remaining.current.delete(id)
  }, [])

  const push = useCallback((t: Omit<Toast, 'id' | 'state'>) => {
    const id = next.current++
    const words = `${t.title} ${t.body ?? ''}`.trim().split(/\s+/).length
    if (!t.sticky) remaining.current.set(id, Math.min(10_000, Math.max(4_000, words * 300)))
    setToasts((ts) => [...ts.slice(-3), { ...t, id, state: 'entering' }])
    requestAnimationFrame(() => requestAnimationFrame(() => setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, state: 'shown' } : x)))))
    return id
  }, [])

  useEffect(() => {
    const tick = setInterval(() => {
      if (paused.current || document.hidden) return
      for (const [id, ms] of remaining.current) {
        if (ms <= 200) dismiss(id)
        else remaining.current.set(id, ms - 200)
      }
    }, 200)
    return () => clearInterval(tick)
  }, [dismiss])

  const hover = useMemo(
    () => ({
      onPointerEnter: () => {
        paused.current = true
      },
      onPointerLeave: () => {
        paused.current = false
      },
      onFocus: () => {
        paused.current = true
      },
      onBlur: () => {
        paused.current = false
      },
    }),
    [],
  )
  return { toasts, push, dismiss, hover }
}

export function Loading() {
  return <div className="hb fixed inset-0 z-[45] grid place-items-center text-sm text-[var(--c-mute)]">Loading the stress data…</div>
}
