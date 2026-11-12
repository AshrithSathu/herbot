// Logs: every failure Herbot recorded (docs/design/DECISIONS.md, "Logs").
// Split: the error list beside the selected error, like a mail client; ↑/↓
// walk the list and the detail follows. Below 68.75rem it's one column at a
// time (the list, then the error with a way back). The selected error lives
// in the URL (?e=3999), so /logs/E-3999 links, reloads and Back all land on
// it.
import { useMedia } from '@/components/hb/use-media'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon, HashIcon, MessageCircleIcon } from 'lucide-react'
import type { ErrorSummary } from '../../../api'
import { ago, clip, exact, when } from '../../../format'
import { errorQuery, errorSearchQuery, errorsTotalQuery, topicsQuery } from '../../../queries'
import { Button, SearchInput } from '@/components/hb/controls'
import { CopyButton, InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

type Search = { q?: string; e?: number }

/** Longer searches are cut here; nothing useful is that long. */
const MAX_QUERY = 200
/** A message longer than this is cut on screen; Copy still takes all of it. */
const SHOWN_MESSAGE = 20_000
/** Wide enough for list and detail side by side (the shell's `wide:`). */
const WIDE = '(min-width: 68.75rem)'

export const Route = createFileRoute('/_authed/logs/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {}
    if (typeof search.q === 'string' && search.q.trim()) out.q = clip(search.q.trim(), MAX_QUERY)
    const e = errorIdIn(String(search.e ?? ''))
    if (e) out.e = e
    return out
  },
  // Only the first visit waits for data (so it renders on the server); after
  // that, typing and selecting re-query in place without blocking the page.
  shouldReload: false,
  loader: ({ context, location }) =>
    context.queryClient.ensureInfiniteQueryData(errorSearchQuery((location.search as Search).q ?? '')),
  staticData: { shell: 'page', crumb: 'Logs' },
  head: () => ({ meta: [{ title: 'Logs · Herbot admin' }] }),
  component: LogsPage,
})

/** "E-3999", "e3999", "3999" → 3999 when the text is just an error id. */
export function errorIdIn(text: string): number | null {
  const m = /^e?-?(\d{1,12})$/i.exec(text.trim())
  const n = m ? Number(m[1]) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** The first line with text in it (panics start with a useful one). */
function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim())?.trim() ?? ''
}

function LogsPage() {
  const { q = '', e } = Route.useSearch()
  const navigate = useNavigate({ from: '/logs/' })
  const wide = useMedia(WIDE)
  const [draft, setDraft] = useState(q)
  // Old results stay on screen (dimmed) while the next search runs.
  const query = useInfiniteQuery({ ...errorSearchQuery(q), placeholderData: keepPreviousData })
  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  const detailRef = useRef<HTMLDivElement>(null)

  // Wide screens show the newest error rather than an empty half.
  const selected = e ?? (wide ? (rows[0]?.id ?? null) : null)

  // Follow back/forward; search once you pause typing.
  useEffect(() => setDraft(q), [q])
  useEffect(() => {
    const next = clip(draft.trim(), MAX_QUERY)
    if (next === q) return
    const timer = setTimeout(() => void navigate({ search: (s) => ({ ...s, q: next || undefined }), replace: true }), 300)
    return () => clearTimeout(timer)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new selection starts at the top of the detail.
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [selected])

  /** Opens an error. On a phone that's a new view (Back returns to the
   * list); beside the list it just swaps the detail. */
  function select(id: number | null) {
    void navigate({ search: (s) => ({ ...s, e: id ?? undefined }), replace: wide || id === null })
  }

  function walk(ev: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
    ev.preventDefault()
    const i = rows.findIndex((r) => r.id === id)
    const next = rows[ev.key === 'ArrowDown' ? i + 1 : i - 1]
    if (!next) return
    if (wide) select(next.id)
    // The next row is rendered (the list overscans); focusing scrolls to it.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-err="${next.id}"]`)?.focus())
  }

  const columns: Column<ErrorSummary>[] = [
    {
      id: 'id',
      header: 'Error',
      width: '7.5rem',
      phone: 'below',
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <button
            type="button"
            data-err={r.id}
            aria-current={selected === r.id ? 'true' : undefined}
            onClick={() => select(r.id)}
            onKeyDown={(ev) => walk(ev, r.id)}
            className={cn(
              'self-start font-mono text-[13px] font-medium whitespace-nowrap text-ink tabular-nums outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset',
              STRETCH,
            )}
          >
            {r.error_id}
          </button>
          <Kind kind={r.kind} className="max-w-full text-[12px]" />
        </span>
      ),
    },
    {
      id: 'msg',
      header: 'Message',
      width: 'minmax(0,1fr)',
      phone: 'title',
      cell: (r) => (
        <UserText className={cn('text-[13.5px]', selected === r.id ? 'text-ink' : 'text-mute')} fallback="(no message)">
          {firstLine(r.message)}
        </UserText>
      ),
    },
    {
      id: 'when',
      header: 'When',
      width: '5.5rem',
      align: 'end',
      phone: 'aside',
      cell: (r) => <When iso={r.created_at} className="text-[12.5px]" />,
    },
  ]

  const asked = errorIdIn(draft)
  // A total only when it's known (herbot-core counts, capped at 10,000);
  // otherwise say what's showing.
  const total = useQuery(errorsTotalQuery(q)).data
  const count = !query.hasNextPage
    ? `${exact(rows.length)} ${rows.length === 1 ? 'error' : 'errors'}`
    : total
      ? total.capped
        ? `more than ${exact(total.total)} errors`
        : `${exact(total.total)} ${total.total === 1 ? 'error' : 'errors'}`
      : `newest ${exact(rows.length)} shown`

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* The list: a column beside the detail on wide screens, the whole
          pane otherwise (hidden while an error is open). */}
      <section
        aria-label="Errors"
        className={cn(
          'flex min-h-0 min-w-0 flex-col wide:w-[27rem] wide:shrink-0 wide:border-r wide:border-line',
          e != null ? 'max-wide:hidden' : 'flex-1',
        )}
      >
        <header className="flex flex-col gap-3 px-4 pt-5 pb-3 md:px-5">
          <div className="flex flex-col items-start gap-1">
            <BackToAgents />
            <h1 className="font-serif text-[30px] leading-[1.1] font-semibold tracking-[-0.015em]">Logs</h1>
            <p className="text-[13px] text-mute tabular-nums" aria-live="polite">
              {query.isSuccess
                ? q
                  ? `Matching “${clip(q, 40)}” · ${count}`
                  : `Every failure Herbot recorded, newest first · ${count}`
                : 'Every failure Herbot recorded'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <SearchInput
              label="Search errors"
              value={draft}
              onValueChange={setDraft}
              placeholder="E-1042, or words like “timeout”"
              maxLength={MAX_QUERY}
              enterKeyHint="search"
              aria-busy={(query.isFetching && !query.isFetchingNextPage) || undefined}
              aria-describedby={asked ? 'logs-q-hint' : undefined}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && asked) {
                  ev.preventDefault()
                  select(asked)
                }
              }}
            />
            {asked !== null && (
              <p id="logs-q-hint" className="px-1 text-[12.5px] text-mute">
                Press Enter to open E-{asked}.
              </p>
            )}
          </div>
        </header>
        <div
          data-hb-scroll
          className={cn(
            'scroller min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-150 ease-out md:px-2',
            query.isPlaceholderData && 'opacity-60',
          )}
        >
          {query.isPending ? (
            <ListSkeleton rows={12} lines={2} className="px-3" />
          ) : query.isError && !query.isFetchNextPageError ? (
            <InPlaceError title="Couldn’t load the logs" error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} className="px-3" />
          ) : rows.length === 0 ? (
            <InPlaceEmpty
              className="px-3"
              title={q ? `No error matches “${clip(q, 60)}”` : 'No errors recorded'}
              action={q ? <Button onClick={() => setDraft('')}>Clear search</Button> : undefined}
            >
              {q ? 'Try an E-id like E-1042, a kind like agent.timeout, or a word from the message.' : 'When something fails, it shows up here with an E-id you can quote.'}
            </InPlaceEmpty>
          ) : (
            <LedgerTable
              label="Errors"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              selectedKey={selected}
              estimate={58}
              onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && void query.fetchNextPage()}
              footer={<ListFooter query={query} count={rows.length} />}
            />
          )}
        </div>
      </section>

      {/* The detail: beside the list on wide screens, alone otherwise. */}
      <section aria-label="Error detail" className={cn('min-h-0 min-w-0 flex-1 flex-col', e != null ? 'flex' : 'hidden wide:flex')}>
        <div ref={detailRef} data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-8 md:pt-6">
            {selected === null ? (
              query.isPending ? null : (
                <p className="py-24 text-center text-[14px] text-mute">Choose an error to read it here.</p>
              )
            ) : (
              <ErrorDetail
                key={selected}
                id={selected}
                onGo={select}
                back={
                  <Button variant="ghost" size="sm" onClick={() => select(null)} className="-ml-2 self-start wide:hidden">
                    <ChevronLeftIcon aria-hidden />
                    All errors
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function Kind({ kind, className }: { kind: string; className?: string }) {
  return <UserText className={cn('font-mono text-[12.5px] text-mute', className)}>{kind}</UserText>
}

function When({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={when(iso)} className={cn('text-[13px] whitespace-nowrap text-mute tabular-nums', className)} suppressHydrationWarning>
      {ago(iso)}
    </time>
  )
}

/** Under the list: loading older, every error shown, or a retry. */
function ListFooter({ query, count }: { query: { isFetchNextPageError: boolean; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown }; count: number }) {
  if (query.isFetchNextPageError)
    return (
      <div className="flex items-center gap-3 px-3 py-4 text-[13px] text-destructive">
        Couldn’t load older errors.
        <Button size="sm" onClick={() => void query.fetchNextPage()}>
          Try again
        </Button>
      </div>
    )
  if (query.hasNextPage)
    return (
      <div className="flex items-center gap-3 px-3 py-4 text-[13px] text-mute tabular-nums">
        {query.isFetchingNextPage ? 'Loading older errors…' : `${exact(count)} loaded`}
        {!query.isFetchingNextPage && (
          <Button size="sm" variant="ghost" onClick={() => void query.fetchNextPage()}>
            Load older
          </Button>
        )}
      </div>
    )
  return <p className="px-3 py-4 text-[13px] text-faint tabular-nums">That’s every error: {exact(count)}.</p>
}

/** The topic an error's context names, as a link (when it still exists). */
function RelatedTopic({ context }: { context: Record<string, unknown> }) {
  const topics = useQuery(topicsQuery)
  const id = typeof context.conversation_id === 'number' ? context.conversation_id : null
  if (id === null) return null
  const topic = topics.data?.find((t) => t.id === id)
  if (!topic) return <span className="text-[13px] text-faint">{topics.isPending ? `Topic #${id}` : `Topic #${id} (gone)`}</span>
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <Link
      to="/topics/$id"
      params={{ id: topic.id }}
      className="relative inline-flex max-w-full min-w-0 items-center gap-1.5 self-start text-[13.5px] text-accent-strong before:absolute before:-inset-x-1 before:-inset-y-3 hover:underline"
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <UserText className="min-w-0">{topic.name}</UserText>
    </Link>
  )
}

/** Older/newer: looks the neighbour up (preloading it); disabled when there
 * is none, as after the newest error. */
function NeighbourButton({ id, label, icon, onGo }: { id: number; label: string; icon: 'older' | 'newer'; onGo: (id: number) => void }) {
  const n = useQuery({ ...errorQuery(`E-${id}`), enabled: id >= 1, retry: false })
  const none = id < 1 || n.isError
  const Icon = icon === 'older' ? ChevronLeftIcon : ChevronRightIcon
  return (
    <Button size="icon" variant="ghost" aria-label={none ? `${label} (none)` : label} title={label} disabled={none} onClick={() => onGo(id)}>
      <Icon aria-hidden />
    </Button>
  )
}

function SectionHead({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2">
      <h3 id={id} className="text-[12px] font-medium tracking-[0.06em] text-mute uppercase">
        {title}
      </h3>
      {action}
    </div>
  )
}

/** One error in full: header, message, context, related topic. */
function ErrorDetail({ id, onGo, back }: { id: number; onGo: (id: number) => void; back: ReactNode }) {
  const detail = useQuery(errorQuery(`E-${id}`))
  if (detail.isPending)
    return (
      <div aria-hidden className="flex flex-col gap-4">
        <span className="h-5 w-32 rounded bg-sunken" />
        <span className="h-4 w-56 rounded bg-sunken" />
        <span className="h-40 rounded-lg bg-sunken" />
        <span className="h-28 rounded-lg bg-sunken" />
      </div>
    )
  if (detail.isError)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <InPlaceError title={`Couldn’t load E-${id}`} error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isRefetching} />
      </div>
    )
  const err = detail.data
  const context = (err.context ?? {}) as Record<string, unknown>
  const empty = Object.keys(context).length === 0
  const json = empty ? '' : JSON.stringify(context, null, 2)
  const message = err.message.length > SHOWN_MESSAGE ? `${err.message.slice(0, SHOWN_MESSAGE)}\n…` : err.message
  return (
    <article aria-labelledby={`err-${err.id}`} className="flex min-w-0 flex-col gap-6">
      {back}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <h2 id={`err-${err.id}`} className="font-mono text-[17px] font-semibold tracking-tight tabular-nums">
            {err.error_id}
          </h2>
          {/* Icon only: the E-id beside it says what gets copied. */}
          <CopyButton value={err.error_id} label={`Copy ${err.error_id}`} className="px-2">
            <></>
          </CopyButton>
          <span className="flex-1" />
          <nav aria-label="Other errors" className="flex items-center gap-0.5">
            <NeighbourButton id={err.id - 1} label="Older error" icon="older" onGo={onGo} />
            <NeighbourButton id={err.id + 1} label="Newer error" icon="newer" onGo={onGo} />
          </nav>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Kind kind={err.kind} className="max-w-full" />
          <span className="text-[13px] text-mute tabular-nums">
            {when(err.created_at)} · <When iso={err.created_at} className="text-[13px]" />
          </span>
        </div>
        <RelatedTopic context={context} />
      </header>

      <section aria-labelledby={`msg-${err.id}`} className="flex flex-col gap-2">
        <SectionHead id={`msg-${err.id}`} title="Message" action={<CopyButton value={err.message} label="Copy the message" />} />
        <pre
          dir="auto"
          className="user-text rounded-lg bg-sunken px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)]"
        >
          {message}
        </pre>
      </section>

      <section aria-labelledby={`ctx-${err.id}`} className="flex flex-col gap-2">
        <SectionHead id={`ctx-${err.id}`} title="Context" action={empty ? undefined : <CopyButton value={json} label="Copy the context JSON" />} />
        {empty ? (
          <p className="text-[13.5px] text-mute">Nothing else was recorded with this error.</p>
        ) : (
          <pre className="scroller max-h-[28rem] overflow-auto rounded-lg bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] [overflow-wrap:anywhere]">
            {json}
          </pre>
        )}
      </section>
    </article>
  )
}
