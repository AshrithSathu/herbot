// Shared, real data and frame for the agent-row prototype (throwaway).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SearchIcon, XIcon } from 'lucide-react'
import { getActivity, type Topic } from '../../api'
import { topicsQuery } from '../../queries'
import { compact, topicStatus } from '../../format'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import '@/proto/tokens.css'

/** Case- and accent-insensitive, as in the production sidebar. */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

/** First visible letter of a name (skips marks and spaces). */
export function initial(name: string): string {
  const ch = Array.from(name.normalize('NFC').replace(/[\p{M}\s]/gu, ''))[0]
  return (ch ?? '#').toLocaleUpperCase()
}

export function hueOf(id: number): number {
  return (id * 137.508) % 360
}

const SEEN_KEY = 'proto.agent-row.seen'
const FIRST_KEY = 'proto.agent-row.first-visit'
/** Agents you've never opened count as seen up to a day before your first visit. */
const NEVER_OPENED_WINDOW = 24 * 60 * 60 * 1000

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** "New since you last looked": the API has no read markers yet, so the
 * prototype keeps the last time you opened each agent in localStorage. */
function useSeen() {
  const [seen, setSeen] = useState<Record<number, number>>({})
  const [first, setFirst] = useState<number | null>(null)
  useEffect(() => {
    setSeen(readJson(SEEN_KEY, {}))
    let f = readJson<number | null>(FIRST_KEY, null)
    if (!f) {
      f = Date.now()
      try {
        localStorage.setItem(FIRST_KEY, JSON.stringify(f))
      } catch {
        /* storage blocked: unread just resets each visit */
      }
    }
    setFirst(f)
  }, [])
  const markSeen = useCallback((id: number) => {
    setSeen((s) => {
      const next = { ...s, [id]: Date.now() }
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])
  const isUnread = useCallback(
    (t: Topic) => {
      if (!t.last_activity || first === null) return false
      const last = new Date(t.last_activity).getTime()
      return last > (seen[t.id] ?? first - NEVER_OPENED_WINDOW)
    },
    [seen, first],
  )
  return { isUnread, markSeen }
}

/** Ids forced to "working" with ?working=2,5 (nothing runs in the stress
 * environment, so this lets the state be reviewed). Real activity is
 * polled for the rows in view. */
function forcedWorking(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  const raw = new URLSearchParams(location.search).get('working') ?? ''
  return new Set(raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))
}

export type Row = {
  topic: Topic
  status: ReturnType<typeof topicStatus>
  unread: boolean
  working: boolean
}

/** The row's accessible name: just the facts, never the whole purpose. */
export function rowLabel(row: Row): string {
  const name = row.topic.name.trim() || 'Untitled'
  return `${name}, ${row.status.label}${row.working ? ', working' : ''}${row.unread ? ', new messages' : ''}`
}

/** Everything a variant needs: the filtered list, virtualizer, selection. */
export function useAgentPane(rowHeight: number) {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const w = fold(q.trim())
    return w ? all.filter((t) => fold(t.name).includes(w)) : all
  }, [all, q])
  const [selected, setSelected] = useState(2)
  const { isUnread, markSeen } = useSeen()
  const forced = useMemo(forcedWorking, [])

  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    initialRect: { width: 304, height: 700 },
  })
  const items = virtual.getVirtualItems()
  const visibleIds = items.map((i) => shown[i.index]?.id).filter((id): id is number => id !== undefined)
  const activity = useQueries({
    queries: visibleIds.map((id) => ({
      queryKey: ['proto-activity', id],
      queryFn: () => getActivity({ data: id }),
      refetchInterval: 5_000,
      staleTime: 4_000,
    })),
  })
  const working = new Set<number>(forced)
  activity.forEach((a, i) => a.data?.in_progress && working.add(visibleIds[i]))

  const row = (t: Topic): Row => ({
    topic: t,
    status: topicStatus(t),
    unread: t.id !== selected && isUnread(t),
    working: working.has(t.id),
  })
  const select = (id: number) => {
    setSelected(id)
    markSeen(id)
  }
  const unreadCount = all.filter((t) => t.id !== selected && isUnread(t)).length
  return { topics, all, shown, q, setQ, selected, select, scroller, virtual, items, row, unreadCount }
}

/** The search box at the top of the agents pane (one design for all
 * variants, so the comparison is about the rows). */
export function FilterBox({ q, setQ, id, className }: { q: string; setQ: (v: string) => void; id: string; className?: string }) {
  return (
    // Padding lives on the outer box so the icon centres on the input itself.
    <div className={className}>
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Filter agents
      </label>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--c-faint)]" />
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        placeholder="Filter agents"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-lg bg-[var(--c-sunken)] pr-10 pl-9 text-base text-[var(--c-ink)] outline-none placeholder:text-[var(--c-faint)] focus-visible:shadow-[0_0_0_2px_var(--c-mute)] md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ('')}
          aria-label="Clear filter"
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-[var(--c-faint)] hover:text-[var(--c-ink)] pointer-coarse:size-11"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
    </div>
  )
}

/** Empty, error and loading states for the list body. */
export function ListState({ pane }: { pane: ReturnType<typeof useAgentPane> }) {
  if (pane.topics.isPending)
    return (
      <ul aria-hidden className="flex flex-col gap-1 px-2 py-1">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="h-11 rounded-lg bg-[var(--c-sunken)]" />
        ))}
      </ul>
    )
  if (pane.topics.isError)
    return (
      <div className="flex flex-col gap-2 px-4 py-3 text-[13px]">
        <p className="text-[var(--c-off)]">Couldn’t load agents. {pane.topics.error.message}</p>
        <button type="button" onClick={() => pane.topics.refetch()} className="w-fit rounded-md bg-[var(--c-sunken)] px-3 py-2 font-medium">
          Try again
        </button>
      </div>
    )
  if (pane.shown.length === 0)
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-3 text-[13px] text-[var(--c-mute)]">
        <p>{pane.all.length === 0 ? 'No agents yet. Create a topic in Telegram or from Topics.' : 'No agent matches that name.'}</p>
        {pane.q && (
          <button type="button" onClick={() => pane.setQ('')} className="rounded-md bg-[var(--c-sunken)] px-3 py-2 font-medium text-[var(--c-ink)]">
            Clear filter
          </button>
        )}
      </div>
    )
  return null
}

/** The three-pane frame: the variant's agents pane, then the selected
 * agent's conversation shell (just enough context to judge the row). */
export function Frame({ pane, children, label }: { pane: ReturnType<typeof useAgentPane>; children: ReactNode; label: string }) {
  const topic = pane.all.find((t) => t.id === pane.selected)
  const [phoneList, setPhoneList] = useState(true)
  return (
    <div className="hb fixed inset-0 z-[45] flex gap-2 text-[14px] leading-normal antialiased md:p-2">
      <style>{`.hb :focus-visible { outline: 2px solid var(--c-mute); outline-offset: 2px; }`}</style>
      <aside
        aria-label={label}
        className={cn(
          'flex w-full shrink-0 flex-col bg-[var(--c-pane)] md:w-[19rem] md:rounded-2xl md:shadow-[var(--c-raised)]',
          !phoneList && 'max-md:hidden',
        )}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('[data-agent]')) setPhoneList(false)
        }}
      >
        {children}
      </aside>
      <main className={cn('flex min-w-0 flex-1 flex-col bg-[var(--c-pane)] md:rounded-2xl md:shadow-[var(--c-raised)]', phoneList && 'max-md:hidden')}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--c-line)] px-2 md:px-4">
          <button
            type="button"
            onClick={() => setPhoneList(true)}
            className="grid h-11 place-items-center rounded-lg px-2 text-[13px] font-medium text-[var(--c-accent)] md:hidden"
          >
            ‹ Agents{pane.unreadCount > 0 ? ` (${pane.unreadCount})` : ''}
          </button>
          <UserText className="min-w-0 flex-1 font-semibold">{topic?.name}</UserText>
          {topic && (
            <span className="shrink-0 text-[12px] text-[var(--c-mute)] tabular-nums">{compact(topic.messages)} messages</span>
          )}
        </header>
        <div className="grid flex-1 place-items-center p-6 text-center text-[13px] text-[var(--c-faint)]">
          <p className="max-w-[40ch]">The conversation with this agent goes here. Judge the list on the left: 220 hostile names, the filter, unread and working states.</p>
        </div>
      </main>
    </div>
  )
}
