import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2Icon, SearchIcon } from 'lucide-react'
import { errorSearchQuery } from '../../../queries'
import { Empty, ErrorNote, PageHeader, Time } from '../../../ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type Search = { q?: string }

export const Route = createFileRoute('/_authed/logs/')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.q === 'string' && search.q.trim() ? { q: search.q.trim() } : {},
  // Only the first visit waits for data (so it renders on the server); after
  // that, typing re-queries in place without the router blocking the page.
  shouldReload: false,
  loader: ({ context, location }) => {
    const q = (location.search as Search).q ?? ''
    return context.queryClient.ensureQueryData(errorSearchQuery(q))
  },
  head: () => ({ meta: [{ title: 'Logs · Herbot admin' }] }),
  component: LogsPage,
})

function LogsPage() {
  const { q = '' } = Route.useSearch()
  const navigate = useNavigate({ from: '/logs/' })
  const [text, setText] = useState(q)
  // Old results stay on screen while the next search runs.
  const results = useQuery({ ...errorSearchQuery(q), placeholderData: keepPreviousData })

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

  const rows = results.data ?? []
  return (
    <>
      <PageHeader
        title="Logs"
        description="Every failure Herbot recorded, newest first. Find one by the E-number from Telegram."
      />
      <form
        role="search"
        className="flex max-w-xl flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          go(text.trim())
        }}
      >
        <Label htmlFor="log-search">Search errors</Label>
        <div className="relative">
          {results.isFetching ? (
            <Loader2Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          )}
          <Input
            id="log-search"
            type="search"
            className="pl-9"
            placeholder="E-1042, t3.turn_timeout, or any words"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
          {results.isFetching ? 'Searching…' : rows.length > 0 ? `${plural(rows.length)} shown` : ''}
        </p>
      </form>

      {results.isError && <ErrorNote title="Search failed">{results.error.message}</ErrorNote>}

      {rows.length === 0 && !results.isFetching && !results.isError ? (
        q ? (
          <Empty>
            <p>Nothing matches “{q}”.</p>
            <div>
              <Button variant="link" onClick={() => setText('')}>
                Clear the search
              </Button>
            </div>
          </Empty>
        ) : (
          <Empty>No errors recorded yet. When a turn fails, it lands here with its E-number.</Empty>
        )
      ) : (
        <div
          className={cn(
            'overflow-hidden rounded-xl border bg-card shadow-xs transition-opacity duration-150',
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
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="danger">{r.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[48ch] whitespace-normal">
                    <span className="line-clamp-2">{r.message}</span>
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    <Time iso={r.created_at} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

function plural(n: number) {
  return n === 1 ? '1 error' : `${n} errors`
}
