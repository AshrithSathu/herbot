import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { MessagesSquareIcon, SearchIcon, SearchXIcon, XIcon } from 'lucide-react'
import type { Topic } from '../../../api'
import { NewAgent } from '../../../components/new-agent'
import { UserText } from '../../../components/user-text'
import { compact, exact, plural } from '../../../format'
import { topicsQuery } from '../../../queries'
import { EmptyState, PageHeader, StaleWarning, Time, TopicState } from '../../../ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUSES = ['all', 'ready', 'setup', 'off'] as const
type Status = (typeof STATUSES)[number]
const SORTS = ['made', 'active'] as const
type Sort = (typeof SORTS)[number]

type Search = { q?: string; status?: Status; sort?: Sort }

export const Route = createFileRoute('/_authed/topics/')({
  // Filters live in the URL: shareable, and Back restores them.
  validateSearch: (raw: Record<string, unknown>): Search => ({
    q: typeof raw.q === 'string' && raw.q ? raw.q.slice(0, 200) : undefined,
    status: STATUSES.includes(raw.status as Status) && raw.status !== 'all' ? (raw.status as Status) : undefined,
    sort: raw.sort === 'active' ? 'active' : undefined,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  staticData: { crumb: 'Topics' },
  head: () => ({ meta: [{ title: 'Topics · Herbot admin' }] }),
  component: TopicsPage,
})

const STATUS_LABEL: Record<Status, string> = {
  all: 'All',
  ready: 'Ready',
  setup: 'Needs setup',
  off: 'Off',
}

function statusOf(t: Topic): Exclude<Status, 'all'> {
  if (!t.enabled) return 'off'
  return t.setup_state === 'ready' ? 'ready' : 'setup'
}

/** Folds case and accents, so "cafe" finds "Café". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

function TopicsPage() {
  const { data: topics, error } = useSuspenseQuery(topicsQuery)
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const status = search.status ?? 'all'
  const sort = search.sort ?? 'made'
  // Typing stays instant; the URL and the filtering catch up.
  const [query, setQuery] = useState(search.q ?? '')
  const deferredQuery = useDeferredValue(query)

  const setSearch = (next: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true, resetScroll: false })

  const counts = useMemo(() => {
    const c: Record<Status, number> = { all: topics.length, ready: 0, setup: 0, off: 0 }
    for (const t of topics) c[statusOf(t)]++
    return c
  }, [topics])

  const shown = useMemo(() => {
    const wanted = fold(deferredQuery.trim())
    const list = topics.filter(
      (t) =>
        (status === 'all' || statusOf(t) === status) &&
        (!wanted || fold(t.name).includes(wanted) || fold(t.purpose ?? '').includes(wanted)),
    )
    if (sort === 'active') {
      // Newest activity first; never-used topics last, in the order they were made.
      list.sort((a, b) => (b.last_activity ?? '').localeCompare(a.last_activity ?? ''))
    }
    return list
  }, [topics, deferredQuery, status, sort])

  // Show the group only when topics come from more than one.
  const manyGroups = useMemo(() => new Set(topics.map((t) => t.group)).size > 1, [topics])
  const filtered = query.trim() !== '' || status !== 'all'

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <PageHeader
          title="Topics"
          description="Each topic is its own agent with its own purpose. General is the everyday chat."
        />
        <NewAgent className="self-start sm:self-auto" />
      </div>
      <StaleWarning error={error} />

      {topics.length === 0 ? (
        <EmptyState
          icon={MessagesSquareIcon}
          title="No topics yet"
          action={<NewAgent />}
        >
          Write in your Herbot group’s General, or make an agent here. Each topic shows up as soon as the bot sees it.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative md:w-72">
              <label htmlFor="topic-filter" className="sr-only">
                Filter topics by name or purpose
              </label>
              <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="topic-filter"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearch({ q: e.target.value || undefined })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    setQuery('')
                    setSearch({ q: undefined })
                  }
                }}
                placeholder="Filter by name or purpose"
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-input bg-card pr-9 pl-9 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 md:text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => {
                    setQuery('')
                    setSearch({ q: undefined })
                  }}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground before:absolute before:-inset-2 hover:text-foreground"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="radiogroup" aria-label="Show topics" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setSearch({ status: s === 'all' ? undefined : s })}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-9 hover:text-foreground',
                      status === s && 'bg-card text-foreground shadow-xs',
                    )}
                  >
                    {s === 'setup' ? (
                      <>
                        <span className="sm:hidden">Setup</span>
                        <span className="hidden sm:inline">Needs setup</span>
                      </>
                    ) : (
                      STATUS_LABEL[s]
                    )}
                    <span className="text-xs tabular-nums opacity-70">{compact(counts[s])}</span>
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSearch({ sort: e.target.value === 'active' ? 'active' : undefined })}
                  className="h-8 rounded-md border border-input bg-card px-2 text-base text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 md:text-sm"
                >
                  <option value="made">Order made</option>
                  <option value="active">Recently active</option>
                </select>
              </label>
            </div>
          </div>

          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {filtered
              ? `Showing ${exact(shown.length)} of ${plural(topics.length, 'topic')}`
              : plural(topics.length, 'topic')}
          </p>

          {shown.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title="No topic matches"
              className="min-h-64"
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('')
                    setSearch({ q: undefined, status: undefined })
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              {query.trim() ? (
                <>
                  Nothing called <UserText className="font-medium text-foreground">{query.trim()}</UserText>
                  {status !== 'all' && <> among {STATUS_LABEL[status].toLowerCase()} topics</>}.
                </>
              ) : (
                <>No {STATUS_LABEL[status].toLowerCase()} topics right now.</>
              )}
            </EmptyState>
          ) : (
            <TopicList topics={shown} showGroup={manyGroups} />
          )}
        </div>
      )}
    </>
  )
}

/** Desktop: one aligned grid. Phone: each topic as a compact card. */
const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_8.5rem_11rem] md:items-center md:gap-x-6'

function TopicList({ topics, showGroup }: { topics: Topic[]; showGroup: boolean }) {
  const list = useRef<HTMLUListElement>(null)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    const measure = () => setOffset((list.current?.getBoundingClientRect().top ?? 0) + window.scrollY)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const rows = useWindowVirtualizer({
    count: topics.length,
    estimateSize: () => 88,
    overscan: 8,
    scrollMargin: offset,
    // Server and first client render agree: the first screenful of rows.
    initialRect: { width: 1024, height: 900 },
    getItemKey: (i) => topics[i].id,
  })

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div
        aria-hidden
        className={cn(
          'hidden border-b bg-muted/50 px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase',
          COLUMNS,
        )}
      >
        <span>Topic</span>
        <span className="text-right">Messages</span>
        <span>Last active</span>
        <span>State</span>
      </div>
      <ul ref={list} aria-label="Topics" className="relative" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => {
          const t = topics[row.index]
          return (
            <li
              key={row.key}
              data-index={row.index}
              ref={rows.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${row.start - rows.options.scrollMargin}px)` }}
            >
              <TopicRow topic={t} showGroup={showGroup} last={row.index === topics.length - 1} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TopicRow({ topic: t, showGroup, last }: { topic: Topic; showGroup: boolean; last: boolean }) {
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-1 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50',
        !last && 'border-b',
        COLUMNS,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link
            to="/topics/$id"
            params={{ id: t.id }}
            className="min-w-0 font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
          >
            <UserText className={cn(!t.enabled && 'text-muted-foreground')}>{t.name}</UserText>
          </Link>
          {/* Phone: the state sits beside the name. */}
          <span className="shrink-0 md:hidden">
            <TopicState topic={t} />
          </span>
        </div>
        {showGroup && <UserText className="text-xs text-muted-foreground">{t.group}</UserText>}
        <UserText lines={2} fallback="No purpose yet" className="max-w-[70ch] text-sm text-muted-foreground">
          {t.purpose}
        </UserText>
        {/* Phone: counts and time as one quiet line. */}
        <p className="text-xs text-muted-foreground tabular-nums md:hidden">
          <span title={exact(t.messages)}>
            {compact(t.messages)} {t.messages === 1 ? 'message' : 'messages'}
          </span>{' '}
          ·{' '}
          <Time iso={t.last_activity} relative />
        </p>
      </div>
      <span className="hidden text-right text-sm tabular-nums md:block" title={exact(t.messages)}>
        {compact(t.messages)}
      </span>
      <span className="hidden truncate text-sm text-muted-foreground md:block">
        <Time iso={t.last_activity} relative />
      </span>
      <span className="hidden md:block">
        <TopicState topic={t} />
      </span>
    </div>
  )
}
