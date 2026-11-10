import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { CircleCheckIcon, SearchIcon, SearchXIcon } from 'lucide-react'
import { clip, exact } from '../../../format'
import { errorSearchQuery } from '../../../queries'
import { EmptyState, ErrorNote, PageHeader, Time } from '../../../ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
  // Old results stay on screen while the next search runs.
  const results = useInfiniteQuery({ ...errorSearchQuery(q), placeholderData: keepPreviousData })
  const rows = useMemo(() => results.data?.pages.flat() ?? [], [results.data])

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
  return (
    <>
      <PageHeader
        title="Logs"
        description="Every failure Herbot recorded, newest first. Find one by the E-number from Telegram."
      />
      <form
        role="search"
        className="max-w-xl"
        onSubmit={(e) => {
          e.preventDefault()
          go(text.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor="log-search">Search errors</FieldLabel>
          <InputGroup>
            <InputGroupAddon>{searching ? <Spinner /> : <SearchIcon aria-hidden />}</InputGroupAddon>
            <InputGroupInput
              id="log-search"
              type="search"
              placeholder="E-1042, t3.turn_timeout, or any words"
              maxLength={MAX_QUERY}
              spellCheck={false}
              autoComplete="off"
              data-1p-ignore
              enterKeyHint="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </InputGroup>
          <FieldDescription className="min-h-5 text-xs tabular-nums" aria-live="polite">
            {searching ? 'Searching…' : rows.length > 0 ? `${count(rows.length)} shown${results.hasNextPage ? ', newest first' : ''}` : ''}
          </FieldDescription>
        </Field>
      </form>

      {results.isError && !results.isFetchNextPageError && (
        <ErrorNote title="Search failed">{results.error.message}</ErrorNote>
      )}

      {rows.length === 0 && !results.isFetching && !results.isError ? (
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
            Try an E-number, an error kind, or fewer words.
          </EmptyState>
        ) : (
          <EmptyState icon={CircleCheckIcon} title="No errors recorded">
            When a turn fails, it lands here with its E-number.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              'w-full overflow-hidden rounded-xl border bg-card shadow-xs transition-opacity duration-150',
              results.isPlaceholderData && 'opacity-60',
            )}
          >
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Id</TableHead>
                  <TableHead className="hidden md:table-cell">Kind</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead className="pr-4">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableHead scope="row" className="pl-4">
                      <Link to="/logs/$id" params={{ id: r.error_id }} className="font-mono font-medium text-foreground">
                        {r.error_id}
                      </Link>
                    </TableHead>
                    <TableCell className="hidden max-w-[14rem] md:table-cell">
                      <Badge variant="danger" title={r.kind} className="max-w-full">
                        <span className="truncate">{r.kind}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-[12rem] whitespace-normal">
                      <span className="line-clamp-2 wrap-anywhere">{r.message}</span>
                    </TableCell>
                    <TableCell className="pr-4 whitespace-normal text-muted-foreground sm:whitespace-nowrap">
                      <Time iso={r.created_at} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {results.isFetchNextPageError && (
            <ErrorNote title="Couldn’t load older errors">{results.error?.message}</ErrorNote>
          )}
          {results.hasNextPage && (
            <Button variant="outline" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
              {results.isFetchingNextPage && <Spinner />}
              {results.isFetchingNextPage ? 'Loading older errors…' : 'Load older errors'}
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function count(n: number) {
  return n === 1 ? '1 error' : `${exact(n)} errors`
}
