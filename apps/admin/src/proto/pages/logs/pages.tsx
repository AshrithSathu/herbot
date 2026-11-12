// Variant 1 "Pages" — navigation axis: the list is one page, an error is
// another. The list gets the whole pane width; the detail gets a reading
// column with older/newer to walk through errors.
import { useLayoutEffect, useState } from 'react'
import { ChevronLeftIcon } from 'lucide-react'
import { exact } from '../../../format'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { PageFrame, SearchBox, useUrlQuery } from './frame'
import { ErrorDetail, errorIdIn, firstLine, Kind, ListFooter, useErrorList, When, type ErrorSummary } from './shared'

/** A number kept in the URL (?e=3999), applied after mount. */
export function useUrlNumber(param: string): [number | null, (v: number | null) => void] {
  const [value, setValue] = useState<number | null>(null)
  useLayoutEffect(() => {
    const n = Number(new URLSearchParams(location.search).get(param))
    setValue(Number.isInteger(n) && n > 0 ? n : null)
  }, [param])
  function set(v: number | null) {
    setValue(v)
    const url = new URL(location.href)
    if (v) url.searchParams.set(param, String(v))
    else url.searchParams.delete(param)
    history.replaceState(history.state, '', url)
  }
  return [value, set]
}

export function PagesVariant() {
  const [open, setOpen] = useUrlNumber('e')
  return <PageFrame>{open ? <Detail id={open} onBack={() => setOpen(null)} onGo={setOpen} /> : <List onOpen={setOpen} />}</PageFrame>
}

function List({ onOpen }: { onOpen: (id: number) => void }) {
  const [draft, q, setQ] = useUrlQuery('q')
  const { query, rows } = useErrorList(q)
  const asked = errorIdIn(q)

  const columns: Column<ErrorSummary>[] = [
    {
      id: 'id',
      header: 'Error',
      width: '6.5rem',
      phone: 'below',
      cell: (e) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <button type="button" onClick={() => onOpen(e.id)} className={`shrink-0 whitespace-nowrap font-mono text-[13px] font-medium text-ink tabular-nums outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring ${STRETCH}`}>
            {e.error_id}
          </button>
          <Kind kind={e.kind} className="min-w-0 md:hidden" />
        </span>
      ),
    },
    { id: 'kind', header: 'Kind', width: 'minmax(6rem,11rem)', phone: 'hide', cell: (e) => <Kind kind={e.kind} /> },
    {
      id: 'msg',
      header: 'Message',
      width: 'minmax(0,1fr)',
      phone: 'title',
      cell: (e) => <UserText className="text-[14px] text-ink">{firstLine(e.message)}</UserText>,
    },
    { id: 'when', header: 'When', width: '6.5rem', align: 'end', phone: 'aside', cell: (e) => <When iso={e.created_at} /> },
  ]

  return (
    <ShellPage
      title="Logs"
      description="Every failure Herbot recorded, newest first. Search by E-id or by words in the error."
      back={<BackToAgents />}
      wide
    >
      <div className="flex flex-col gap-2">
        <SearchBox
          id="logs-q"
          label="Search errors"
          value={draft}
          onChange={setQ}
          placeholder="E-1042, or words like “timeout”"
          busy={query.isFetching && !query.isFetchingNextPage}
          onEnter={() => {
            const id = errorIdIn(draft)
            if (id) onOpen(id)
          }}
          describedBy={asked ? 'logs-q-hint' : undefined}
        />
        {asked !== null && (
          <p id="logs-q-hint" className="px-1 text-[13px] text-mute">
            Press Enter to open E-{asked}.
          </p>
        )}
      </div>
      {query.isPending ? (
        <ListSkeleton rows={10} lines={1} />
      ) : query.isError ? (
        <InPlaceError title="Couldn’t load the logs" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
      ) : rows.length === 0 ? (
        q ? (
          <InPlaceEmpty title={`No error matches “${q}”`} action={<Button onClick={() => setQ('')}>Clear search</Button>}>
            Try an E-id like E-1042, a kind like agent.timeout, or a word from the message.
          </InPlaceEmpty>
        ) : (
          <InPlaceEmpty title="No errors recorded">When something fails, it shows up here with an E-id you can quote.</InPlaceEmpty>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-[13px] text-mute tabular-nums" aria-live="polite">
            {q ? `${exact(rows.length)}${query.hasNextPage ? '+' : ''} matching` : `Newest ${exact(rows.length)}${query.hasNextPage ? ' (older load as you scroll)' : ''}`}
          </p>
          <LedgerTable
            label="Errors"
            rows={rows}
            columns={columns}
            rowKey={(e) => e.id}
            estimate={45}
            onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
            footer={<ListFooter query={query} count={rows.length} noun="errors" />}
          />
        </div>
      )}
    </ShellPage>
  )
}

function Detail({ id, onBack, onGo }: { id: number; onBack: () => void; onGo: (id: number) => void }) {
  return (
    <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-8 md:pt-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 self-start">
          <ChevronLeftIcon aria-hidden />
          All errors
        </Button>
        <ErrorDetail key={id} id={id} onGo={onGo} />
      </div>
    </div>
  )
}
