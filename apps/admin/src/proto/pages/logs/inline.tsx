// Variant 3 "Inline" — disclosure axis: no detail page at all. A row opens
// in place to show the whole error under its own line; several can be open
// to compare. Same ledger look as LedgerTable, built here because the kit's
// table has no expandable row.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon } from 'lucide-react'
import { exact, when } from '../../../format'
import { errorQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { PageFrame, SearchBox, useUrlQuery } from './frame'
import { CopyButton, errorIdIn, firstLine, Kind, ListFooter, RelatedTopic, useErrorList, When, type ErrorSummary } from './shared'

const GRID = 'grid-cols-[1.25rem_6.5rem_minmax(6rem,11rem)_minmax(0,1fr)_6.5rem]'

export function InlineVariant() {
  const [draft, q, setQ] = useUrlQuery('q')
  const { query, rows } = useErrorList(q)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const asked = errorIdIn(q)

  // Searching for an E-id opens that error.
  useLayoutEffect(() => {
    if (asked !== null && rows.some((r) => r.id === asked)) setOpen((o) => new Set(o).add(asked))
  }, [asked, rows])

  function toggle(id: number) {
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <PageFrame>
      <ShellPage
        title="Logs"
        description="Every failure Herbot recorded, newest first. Open a row to read the whole error; open several to compare."
        back={<BackToAgents />}
        wide
        actions={
          open.size > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(new Set())}>
              Close {open.size === 1 ? 'the open error' : `all ${open.size} open`}
            </Button>
          ) : undefined
        }
      >
        <SearchBox
          id="inline-q"
          label="Search errors"
          value={draft}
          onChange={setQ}
          placeholder="E-1042, or words like “timeout”"
          busy={query.isFetching && !query.isFetchingNextPage}
        />
        {query.isPending ? (
          <ListSkeleton rows={10} lines={1} />
        ) : query.isError ? (
          <InPlaceError title="Couldn’t load the logs" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
        ) : rows.length === 0 ? (
          <InPlaceEmpty
            title={q ? `No error matches “${q}”` : 'No errors recorded'}
            action={q ? <Button onClick={() => setQ('')}>Clear search</Button> : undefined}
          >
            {q ? 'Try an E-id like E-1042, a kind like agent.timeout, or a word from the message.' : 'Failures show up here with an E-id you can quote.'}
          </InPlaceEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[13px] text-mute tabular-nums" aria-live="polite">
              {q ? `${exact(rows.length)}${query.hasNextPage ? '+' : ''} matching` : `Newest ${exact(rows.length)}${query.hasNextPage ? ' (older load as you scroll)' : ''}`}
            </p>
            <ExpandableLedger
              rows={rows}
              open={open}
              onToggle={toggle}
              onEnd={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
              footer={<ListFooter query={query} count={rows.length} noun="errors" />}
            />
          </div>
        )}
      </ShellPage>
    </PageFrame>
  )
}

function ExpandableLedger({ rows, open, onToggle, onEnd, footer }: {
  rows: ErrorSummary[]
  open: Set<number>
  onToggle: (id: number) => void
  onEnd: () => void
  footer: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.parentElement?.closest('[data-hb-scroll]') as HTMLElement | null
    if (!el || !parent) return
    setScroller(parent)
    const measure = () => setMargin(el.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (open.has(rows[i].id) ? 520 : 45),
    overscan: 8,
    scrollMargin: margin,
    initialRect: { width: 1000, height: 800 },
  })
  const items = virtual.getVirtualItems()
  const last = items.at(-1)?.index ?? -1
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  useLayoutEffect(() => {
    if (last >= rows.length - 5 && rows.length > 0) endRef.current()
  }, [last, rows.length])

  return (
    <div ref={ref} className="min-w-0">
      <div aria-hidden className={cn('hidden items-end gap-x-4 border-b border-line px-3 pb-2 text-[11px] font-medium tracking-[0.06em] text-mute uppercase md:grid', GRID)}>
        <span />
        <span>Error</span>
        <span>Kind</span>
        <span>Message</span>
        <span className="text-right">When</span>
      </div>
      <ul aria-label="Errors" className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const e = rows[item.index]
          const isOpen = open.has(e.id)
          return (
            <li
              key={e.id}
              data-index={item.index}
              ref={virtual.measureElement}
              className={cn('absolute inset-x-0 top-0 border-b border-line', isOpen && 'bg-sunken/60')}
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`inline-err-${e.id}`}
                onClick={() => onToggle(e.id)}
                className={cn(
                  'w-full px-3 py-2.5 text-left outline-none transition-[background-color] duration-150 ease-out hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  'flex flex-col gap-1 md:grid md:min-h-11 md:items-center md:gap-x-4 md:gap-y-0',
                  GRID,
                )}
              >
                <ChevronRightIcon aria-hidden className={cn('hidden size-4 text-faint transition-[rotate] duration-150 ease-out md:block', isOpen && 'rotate-90')} />
                {/* Phones: message, then id · kind · when. */}
                <span className="whitespace-nowrap font-mono text-[13px] font-medium text-ink tabular-nums max-md:order-2 max-md:text-[12.5px] max-md:text-mute">
                  {e.error_id}
                  <span className="md:hidden">
                    {' · '}
                    <span className="font-sans">
                      <When iso={e.created_at} className="text-[12.5px]" />
                    </span>
                  </span>
                </span>
                <Kind kind={e.kind} className="max-md:order-3 max-md:text-[12px]" />
                <UserText className="text-[14px] text-ink max-md:order-1 max-md:text-[15px]">{firstLine(e.message)}</UserText>
                <When iso={e.created_at} className="hidden text-right md:block" />
              </button>
              {isOpen && <Expanded id={e.id} summary={e} />}
            </li>
          )
        })}
      </ul>
      {footer}
    </div>
  )
}

/** The whole error under its row: message, context, the topic, copy. */
function Expanded({ id, summary }: { id: number; summary: ErrorSummary }) {
  const detail = useQuery(errorQuery(`E-${id}`))
  const [full, setFull] = useState(false)
  const json = useMemo(() => (detail.data ? JSON.stringify(detail.data.context, null, 2) : ''), [detail.data])
  // The list carries a clipped message; the full one comes with the detail.
  const message = detail.data?.message ?? summary.message
  const lines = message.split('\n').length
  const long = message.length > 1200 || lines > 16
  return (
    <div id={`inline-err-${id}`} className="flex flex-col gap-4 px-3 pt-1 pb-5 md:pl-[calc(1.25rem+1.75rem)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute tabular-nums">
        <span>{when(summary.created_at)}</span>
        {detail.data && <RelatedTopic context={detail.data.context as Record<string, unknown>} />}
        <span className="flex-1" />
        <CopyButton value={summary.error_id} label={`Copy ${summary.error_id}`}>
          {summary.error_id}
        </CopyButton>
        <CopyButton value={message} label="Copy message">
          Copy message
        </CopyButton>
      </div>
      <div className="flex flex-col gap-2">
        <pre
          dir="auto"
          className={cn(
            'user-text rounded-lg bg-pane px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)]',
            long && !full && 'max-h-[21rem] [mask-image:linear-gradient(to_bottom,black_80%,transparent)]',
          )}
        >
          {message}
        </pre>
        {long && (
          <Button variant="ghost" size="sm" className="self-start" aria-expanded={full} onClick={() => setFull((f) => !f)}>
            {full ? 'Show less' : `Show the whole message (${exact(message.length)} characters)`}
          </Button>
        )}
      </div>
      <details className="group flex flex-col gap-2">
        <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 self-start rounded-md px-2 -ml-2 text-[13px] font-medium text-mute hover:bg-pane hover:text-ink pointer-coarse:h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon aria-hidden className="size-4 transition-[rotate] duration-150 ease-out group-open:rotate-90" />
          Context
        </summary>
        {detail.isPending ? (
          <span aria-hidden className="h-28 rounded-lg bg-pane" />
        ) : detail.isError ? (
          <InPlaceError title="Couldn’t load the context" error={detail.error} onRetry={() => detail.refetch()} className="min-h-0 py-2" />
        ) : (
          <div className="flex flex-col gap-1">
            <pre className="scroller max-h-[24rem] overflow-auto rounded-lg bg-pane px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] [overflow-wrap:anywhere] whitespace-pre-wrap">
              {json}
            </pre>
            <CopyButton value={json} label="Copy context JSON" className="self-start">
              Copy JSON
            </CopyButton>
          </div>
        )}
      </details>
    </div>
  )
}
