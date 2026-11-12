// Variant 2 "Split" — master-detail axis: the list stays on the left while
// the selected error fills the right, like a mail client. ↑/↓ walk the list
// and the detail follows. Below 68.75rem it's one column at a time.
import { useEffect, useRef } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { exact } from '../../../format'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { PageFrame, SearchBox, useUrlQuery } from './frame'
import { useUrlNumber } from './pages'
import { ErrorDetail, errorIdIn, firstLine, Kind, ListFooter, useErrorList, When, type ErrorSummary } from './shared'

export function SplitVariant() {
  const [draft, q, setQ] = useUrlQuery('q')
  const [selected, select] = useUrlNumber('e')
  const { query, rows } = useErrorList(q)
  const detailRef = useRef<HTMLDivElement>(null)

  // Wide screens open on the newest error, so the right side is never blank.
  useEffect(() => {
    if (selected === null && rows.length > 0 && matchMedia('(min-width: 68.75rem)').matches) select(rows[0].id)
  }, [rows, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new selection starts at the top of the detail.
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [selected])

  const columns: Column<ErrorSummary>[] = [
    {
      id: 'id',
      header: 'Error',
      width: '7.5rem',
      phone: 'below',
      cell: (e) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <button
            type="button"
            data-err={e.id}
            aria-current={selected === e.id ? 'true' : undefined}
            onClick={() => select(e.id)}
            onFocus={() => matchMedia('(min-width: 68.75rem)').matches && select(e.id)}
            onKeyDown={(ev) => {
              if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
              ev.preventDefault()
              const i = rows.findIndex((r) => r.id === e.id)
              const next = rows[ev.key === 'ArrowDown' ? i + 1 : i - 1]
              if (next) document.querySelector<HTMLButtonElement>(`[data-err="${next.id}"]`)?.focus()
            }}
            className={cn(
              'self-start whitespace-nowrap font-mono text-[13px] font-medium text-ink tabular-nums outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset',
              STRETCH,
              // The selected row: an accent rule on its leading edge.
              selected === e.id && 'before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-accent-strong',
            )}
          >
            {e.error_id}
          </button>
          <Kind kind={e.kind} className="max-w-full text-[12px]" />
        </span>
      ),
    },
    {
      id: 'msg',
      header: 'Message',
      width: 'minmax(0,1fr)',
      phone: 'title',
      cell: (e) => <UserText className={cn('text-[13.5px]', selected === e.id ? 'text-ink' : 'text-mute')}>{firstLine(e.message)}</UserText>,
    },
    { id: 'when', header: 'When', width: '5.5rem', align: 'end', phone: 'aside', cell: (e) => <When iso={e.created_at} className="text-[12.5px]" /> },
  ]

  return (
    <PageFrame>
      <div className="flex min-h-0 flex-1">
        {/* The list: a column on wide screens, the whole pane otherwise
            (hidden while an error is open). */}
        <section
          aria-label="Errors"
          className={cn('flex min-h-0 min-w-0 flex-col wide:w-[27rem] wide:shrink-0 wide:border-r wide:border-line', selected !== null ? 'max-wide:hidden' : 'flex-1')}
        >
          <header className="flex flex-col gap-3 px-4 pt-5 pb-3 md:px-5">
            <div className="flex items-start gap-2">
              <BackToAgents />
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="font-serif text-[30px] leading-[1.1] font-semibold tracking-[-0.015em]">Logs</h1>
                <p className="text-[13px] text-mute tabular-nums" aria-live="polite">
                  {query.isSuccess
                    ? q
                      ? `${exact(rows.length)}${query.hasNextPage ? '+' : ''} matching “${q}”`
                      : `Newest first · ${exact(rows.length)}${query.hasNextPage ? '+' : ''}`
                    : 'Every failure Herbot recorded'}
                </p>
              </div>
            </div>
            <SearchBox
              id="split-q"
              label="Search errors"
              value={draft}
              onChange={setQ}
              placeholder="E-1042 or words"
              busy={query.isFetching && !query.isFetchingNextPage}
              onEnter={() => {
                const id = errorIdIn(draft)
                if (id) select(id)
              }}
            />
          </header>
          <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-2">
            {query.isPending ? (
              <ListSkeleton rows={12} lines={2} className="px-3" />
            ) : query.isError ? (
              <InPlaceError title="Couldn’t load the logs" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} className="px-3" />
            ) : rows.length === 0 ? (
              <InPlaceEmpty
                className="px-3"
                title={q ? `No error matches “${q}”` : 'No errors recorded'}
                action={q ? <Button onClick={() => setQ('')}>Clear search</Button> : undefined}
              >
                {q ? 'Try an E-id, a kind like agent.timeout, or a word from the message.' : 'Failures show up here with an E-id you can quote.'}
              </InPlaceEmpty>
            ) : (
              <LedgerTable
                label="Errors"
                rows={rows}
                columns={columns}
                rowKey={(e) => e.id}
                estimate={58}
                onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
                footer={<ListFooter query={query} count={rows.length} noun="errors" />}
              />
            )}
          </div>
        </section>

        {/* The detail: beside the list on wide screens, alone otherwise. */}
        <section
          aria-label="Error detail"
          className={cn('min-h-0 min-w-0 flex-1 flex-col', selected === null ? 'hidden wide:flex' : 'flex')}
        >
          <div ref={detailRef} data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-8 md:pt-6">
              {selected === null ? (
                <p className="py-24 text-center text-[14px] text-mute">Choose an error to read it here.</p>
              ) : (
                <ErrorDetail
                  key={selected}
                  id={selected}
                  onGo={select}
                  compact
                  headerStart={
                    <Button variant="ghost" size="icon" aria-label="Back to the list" onClick={() => select(null)} className="-ml-2 wide:hidden">
                      <ChevronLeftIcon aria-hidden />
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
