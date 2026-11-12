// Shared real data, frame and local actions for the rows prototype
// (throwaway; nothing in production imports src/proto).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ErrorSummary, Task, Topic } from '../../api'
import { errorSearchQuery, tasksQuery, topicsQuery } from '../../queries'
import { cn } from '@/lib/utils'
import '@/proto/tokens.css'

export { describeCron } from '../../routes/_authed/tasks/index'

export type Lists = {
  topics: Topic[]
  topicName: (id: number) => string
  errors: ErrorSummary[]
  tasks: Task[]
  moreErrors: () => void
  moreTasks: () => void
  errorsDone: boolean
  tasksDone: boolean
  pending: boolean
  failed: Error | null
}

export function useLists(): Lists {
  const topics = useQuery(topicsQuery)
  const errors = useInfiniteQuery(errorSearchQuery(''))
  const tasks = useInfiniteQuery(tasksQuery)
  const names = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t.name])), [topics.data])
  return {
    topics: topics.data ?? [],
    topicName: (id) => names.get(id) ?? `Topic #${id}`,
    errors: useMemo(() => errors.data?.pages.flat() ?? [], [errors.data]),
    tasks: useMemo(() => tasks.data?.pages.flat() ?? [], [tasks.data]),
    moreErrors: () => {
      if (errors.hasNextPage && !errors.isFetchingNextPage) void errors.fetchNextPage()
    },
    moreTasks: () => {
      if (tasks.hasNextPage && !tasks.isFetchingNextPage) void tasks.fetchNextPage()
    },
    errorsDone: !errors.hasNextPage,
    tasksDone: !tasks.hasNextPage,
    pending: topics.isPending || errors.isPending || tasks.isPending,
    failed: topics.error ?? errors.error ?? tasks.error ?? null,
  }
}

/** Local, optimistic actions: the prototype never writes to the API. */
export function useLocalActions() {
  const [off, setOff] = useState<Set<number>>(new Set())
  const [paused, setPaused] = useState<Map<number, boolean>>(new Map())
  const [deleted, setDeleted] = useState<Set<number>>(new Set())
  const [note, setNote] = useState('')
  const say = useCallback((text: string) => {
    setNote(text)
    window.clearTimeout((say as unknown as { t?: number }).t)
    ;(say as unknown as { t?: number }).t = window.setTimeout(() => setNote(''), Math.max(2500, text.split(' ').length * 300))
  }, [])
  // `off` holds topics whose switch was flipped here.
  const isOff = (t: Topic) => (off.has(t.id) ? t.enabled : !t.enabled)
  return {
    note,
    isOff,
    toggleTopic: (t: Topic) => {
      const wasOff = isOff(t)
      setOff((s) => {
        const n = new Set(s)
        if (n.has(t.id)) n.delete(t.id)
        else n.add(t.id)
        return n
      })
      say(`Switched ${t.name.trim() || 'the topic'} ${wasOff ? 'on' : 'off'} (prototype: not saved)`)
    },
    taskStatus: (task: Task): Task['status'] => {
      if (deleted.has(task.id)) return 'cancelled'
      const p = paused.get(task.id)
      if (p === undefined) return task.status
      return p ? 'paused' : 'active'
    },
    togglePause: (task: Task) => {
      const now = paused.get(task.id) ?? task.status === 'paused'
      setPaused((m) => new Map(m).set(task.id, !now))
      say(`${now ? 'Resumed' : 'Paused'} task #${task.id} (prototype: not saved)`)
    },
    runNow: (task: Task) => say(`Task #${task.id} would run now (prototype: not sent)`),
    remove: (task: Task) => {
      setDeleted((s) => new Set(s).add(task.id))
      say(`Deleted task #${task.id} (prototype: not saved)`)
    },
    copy: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        say(`Copied ${text}`)
      } catch {
        say('Couldn’t copy: the browser blocked the clipboard')
      }
    },
  }
}
export type Actions = ReturnType<typeof useLocalActions>

/** Full-screen Conversation+ canvas with one pane, the page a list lives on. */
export function Frame({ className, children, note }: { className?: string; children: ReactNode; note?: string }) {
  return (
    <div className={cn('hb fixed inset-0 z-[45] overflow-y-auto antialiased md:p-2', className)}>
      <main className="mx-auto min-h-full w-full max-w-[1180px] bg-[var(--c-pane)] px-4 pt-6 pb-28 md:rounded-2xl md:px-8 md:pt-8 md:shadow-[var(--c-raised)]">
        {children}
      </main>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed top-4 left-1/2 z-[46] max-w-[min(92vw,480px)] -translate-x-1/2 rounded-full bg-[var(--c-ink)] px-4 py-2 text-sm text-[var(--c-pane)] transition-opacity duration-150 ease-out',
          note ? 'opacity-100' : 'opacity-0',
        )}
      >
        {note}
      </p>
    </div>
  )
}

export function PageTitle({ children, sub }: { children: ReactNode; sub: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-1.5">
      <h1 className="serif text-[32px] leading-[1.1] font-semibold tracking-[-0.015em] text-balance md:text-[38px]">{children}</h1>
      <p className="max-w-[65ch] text-[15px] text-[var(--c-mute)] text-pretty">{sub}</p>
    </header>
  )
}

/** A section with a bounded, virtualized scroller: only the rows in view
 * render, and nearing the end asks for the next page. */
export function VirtualList<T>({
  items,
  estimate,
  render,
  onEnd,
  done,
  height = 'h-[min(460px,62vh)]',
  className,
  label,
  getKey,
}: {
  items: T[]
  estimate: number
  render: (item: T, index: number) => ReactNode
  onEnd?: () => void
  done?: boolean
  height?: string
  className?: string
  label: string
  getKey: (item: T) => string | number
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    overscan: 6,
    getItemKey: (i) => getKey(items[i]),
    initialRect: { width: 900, height: 460 },
  })
  const visible = rows.getVirtualItems()
  const lastIndex = visible.at(-1)?.index ?? -1
  useEffect(() => {
    if (onEnd && !done && lastIndex >= 0 && lastIndex >= items.length - 8) onEnd()
  }, [lastIndex, items.length, done, onEnd])
  return (
    <div ref={scroller} role="region" aria-label={label} tabIndex={0} className={cn('scroller relative overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40', height, className)}>
      <ul className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {visible.map((row) => (
          <li
            key={row.key}
            data-index={row.index}
            ref={rows.measureElement}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {render(items[row.index], row.index)}
          </li>
        ))}
      </ul>
      {!done && onEnd && <p className="py-3 text-center text-xs text-[var(--c-faint)]">Loading more…</p>}
    </div>
  )
}

export function Section({ id, title, count, children, hint }: { id: string; title: string; count: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-10 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight">
          {title} <span className="ml-1 font-normal text-[var(--c-mute)] tabular-nums">{count}</span>
        </h2>
        {hint && <span className="text-xs text-[var(--c-faint)]">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

export const TONE: Record<'success' | 'warning' | 'danger' | 'muted', string> = {
  success: 'var(--c-ok)',
  warning: 'var(--c-warn)',
  danger: 'var(--c-off)',
  muted: 'var(--c-faint)',
}

export const TASK_TONE: Record<Task['status'], { label: string; tone: keyof typeof TONE }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  done: { label: 'Done', tone: 'muted' },
  cancelled: { label: 'Deleted', tone: 'danger' },
}

/** Dot + word: the plain status used by all three row variants, so the
 * comparison is about rows, not badges (that's /proto/status). */
export function Status({ label, tone, className }: { label: string; tone: keyof typeof TONE; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap text-[var(--c-mute)]', className)}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: TONE[tone] }} />
      {label}
    </span>
  )
}

/** "Every day at 09:00" or the raw cron. */
export function schedule(task: Task, describe: (c: string) => string | null): { words: string; raw: string | null } {
  if (task.cron) return { words: describe(task.cron) ?? 'Custom schedule', raw: `${task.cron} · ${task.timezone}` }
  return { words: 'Once', raw: null }
}
