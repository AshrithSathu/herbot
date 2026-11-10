import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleCheckIcon, SearchIcon, SearchXIcon, XIcon } from 'lucide-react'
import type { ErrorSummary } from '../../../api'
import { clip, dayKey, dayLabel, exact, when } from '../../../format'
import { errorSearchQuery } from '../../../queries'
import { EmptyState, ErrorNote, PageHeader } from '../../../ui'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type Search = { q?: string }

/** Longer searches are cut here; nothing useful is that long. */
const MAX_QUERY = 200

export const Route = createFileRoute('/_authed/logs/')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.q === 'string' && search.q.trim() ? { q: clip(search.q.trim(), MAX_QUERY) } : {},
  // Only the first visit waits for data (so it renders on the server); after
  // that, typing re-queries in place without the router blocking the page.
  shouldReload: false,
  loader: ({ context, location }) => {
    const q = (location.search as Search).q ?? ''
    return context.queryClient.ensureInfiniteQueryData(errorSearchQuery(q))
  },
  staticData: { crumb: 'Logs' },
  head: () => ({ meta: [{ title: 'Logs · Herbot admin' }] }),
  component: LogsPage,
})

function LogsPage() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: '/logs/' })
  const [text, setText] = useState(q)
  const input = useRef<HTMLInputElement>(null)
  // Old results stay on screen (dimmed) while the next search runs.
  const results = useInfiniteQuery({ ...errorSearchQuery(q), placeholderData: keepPreviousData })
  const rows = useMemo(() => results.data?.pages.flat() ?? [], [results.data])
  const days = useMemo(() => byDay(rows), [rows])

  // Follow back/forward.
  useEffect(() => setText(q), [q])

  // Search as you type, once you pause.
  useEffect(() => {
    const next = text.trim()
    if (next === q) return
    const timer = setTimeout(() => go(next), 300)
    return () => clearTimeout(timer)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  function go(next: string) {
    void navigate({ search: next ? { q: next } : {}, replace: true })
  }

  const searching = results.isFetching && !results.isFetchingNextPage
  const empty = rows.length === 0 && !results.isFetching && !results.isError

  return (
    <>
      <PageHeader
        title="Logs"
        description="Every failure Herbot recorded, newest first. Paste the E-number from Telegram to jump to it."
      />

      <form
        role="search"
        className="flex max-w-xl flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          go(text.trim())
        }}
      >
        <label htmlFor="log-search" className="text-sm font-medium">
          Search errors
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground">
            {searching ? <Spinner className="size-4" /> : <SearchIcon className="size-4" aria-hidden />}
          </span>
          <input
            ref={input}
            id="log-search"
            type="search"
            placeholder="E-1042, turn.db, or any words"
            maxLength={MAX_QUERY}
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && text) {
                e.preventDefault()
                setText('')
              }
            }}
            className="h-11 w-full rounded-lg border border-input bg-card pr-11 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 md:h-10 md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText('')
                input.current?.focus()
              }}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <p className="min-h-5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {searching
            ? 'Searching…'
            : rows.length > 0
              ? `${count(rows.length)}${results.hasNextPage ? ' so far, newest first' : q ? ' found' : ''}`
              : ''}
        </p>
      </form>

      {results.isError && !results.isFetchNextPageError && (
        <ErrorNote title="Search failed">
          {results.error.message}{' '}
          <Button variant="link" className="align-baseline" onClick={() => void results.refetch()}>
            Try again
          </Button>
        </ErrorNote>
      )}

      {empty ? (
        q ? (
          <EmptyState
            icon={SearchXIcon}
            title={`Nothing matches “${clip(q, 60)}”`}
            action={
              <Button variant="outline" onClick={() => setText('')}>
                Clear the search
              </Button>
            }
          >
            Try an E-number, an error kind like turn.db, or fewer words.
          </EmptyState>
        ) : (
          <EmptyState icon={CircleCheckIcon} title="No errors recorded">
            When something fails, it lands here with its E-number.
          </EmptyState>
        )
      ) : (
        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity duration-150',
            results.isPlaceholderData && 'opacity-60',
          )}
          aria-busy={searching}
        >
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`day-${day.key}`} className="flex flex-col">
              {/* Sticks under the 56px site header while its errors scroll by. */}
              <h2
                id={`day-${day.key}`}
                className="sticky top-14 z-[5] -mx-1 mb-1 bg-background/95 px-1 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm"
              >
                {dayLabel(day.rows[0].created_at)}
                <span className="sr-only">: </span>
                <span className="ml-2 font-normal tracking-normal normal-case tabular-nums">{exact(day.rows.length)}</span>
                <span className="sr-only">{day.rows.length === 1 ? ' error' : ' errors'}</span>
              </h2>
              <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
                {day.rows.map((r) => (
                  <ErrorLine key={r.id} row={r} />
                ))}
              </ol>
            </section>
          ))}
          <MoreErrors
            any={rows.length > 0}
            hasNextPage={results.hasNextPage}
            loading={results.isFetchingNextPage}
            failed={results.isFetchNextPageError}
            error={results.error}
            load={() => void results.fetchNextPage()}
          />
        </div>
      )}
    </>
  )
}

/** One error: id, kind, the message's first line, and the time. The id link
 * stretches over the whole row, so the row is one big target. */
function ErrorLine({ row }: { row: ErrorSummary }) {
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 transition-colors duration-150 focus-within:bg-muted/60 md:grid-cols-[6.5rem_minmax(0,11rem)_minmax(0,1fr)_3.5rem] [@media(hover:hover)]:hover:bg-muted/50">
      <Link
        to="/logs/$id"
        params={{ id: row.error_id }}
        className="font-mono text-sm font-medium text-foreground tabular-nums no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      >
        {row.error_id}
      </Link>
      <time
        dateTime={row.created_at}
        title={when(row.created_at)}
        suppressHydrationWarning
        className="text-right text-xs text-muted-foreground tabular-nums md:order-last"
      >
        {clock(row.created_at)}
      </time>
      <span className="col-span-2 min-w-0 font-mono text-xs text-muted-foreground md:col-span-1">
        <UserText fallback="unknown kind">{row.kind}</UserText>
      </span>
      <span className="col-span-2 min-w-0 text-sm md:col-span-1">
        <UserText fallback="(no message)">{firstLine(row.message)}</UserText>
      </span>
    </li>
  )
}

/** Older errors load as you reach the end; the button is there for keyboards
 * and for when automatic loading failed. */
function MoreErrors({ any, hasNextPage, loading, failed, error, load }: {
  any: boolean
  hasNextPage: boolean
  loading: boolean
  failed: boolean
  error: Error | null
  load: () => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || failed) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && !loading && load(), {
      rootMargin: '600px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, failed, loading, load])

  if (!hasNextPage) {
    return any ? <p className="text-center text-xs text-muted-foreground">That’s every error.</p> : null
  }
  return (
    <div ref={sentinel} className="flex flex-col items-center gap-3">
      {failed && <ErrorNote title="Couldn’t load older errors">{error?.message}</ErrorNote>}
      <Button variant="outline" disabled={loading} onClick={load}>
        {loading && <Spinner />}
        {loading ? 'Loading older errors…' : failed ? 'Try again' : 'Load older errors'}
      </Button>
    </div>
  )
}

function byDay(rows: ErrorSummary[]) {
  const days: { key: string; rows: ErrorSummary[] }[] = []
  for (const row of rows) {
    const key = dayKey(row.created_at)
    const last = days.at(-1)
    if (last?.key === key) last.rows.push(row)
    else days.push({ key, rows: [row] })
  }
  return days
}

/** A panic or trace is many lines; the list shows the first one that says something. */
function firstLine(message: string): string {
  return message.split('\n').find((line) => line.trim())?.trim() ?? ''
}

/** 14:05: the day is in the group heading above. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function count(n: number) {
  return n === 1 ? '1 error' : `${exact(n)} errors`
}
