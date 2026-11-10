import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { searchMessages } from '../../api'
import { EmptyState, ErrorNote, PageHeader } from '../../ui'
import { Button } from '../../components/ui/button'
export const Route = createFileRoute('/_authed/search')({
  component: SearchPage,
  staticData: { crumb: 'Search' },
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === 'string' ? s.q : '',
  }),
})
function SearchPage() {
  const { q: searchQ } = Route.useSearch(),
    navigate = Route.useNavigate()
  const q = searchQ ?? ''
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  useEffect(() => {
    if (draft === q) return
    const timer = setTimeout(() => {
      void navigate({ search: { q: draft }, replace: true })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, q, navigate])
  const query = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam }) => searchMessages({ data: { q, before: pageParam } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.length === 30 ? page.at(-1)?.id : undefined),
    enabled: !!q.trim(),
  })
  return (
    <>
      <PageHeader title="Search" description="Find a thought across every agent." />
      <label className="sr-only" htmlFor="search-messages">
        Search messages
      </label>
      <input
        id="search-messages"
        type="search"
        value={draft}
        maxLength={500}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search all conversations…"
        className="min-h-12 rounded-xl border bg-card px-4 text-base"
      />
      {query.isError && <ErrorNote title="Search failed">{query.error.message} <Button variant="link" onClick={() => void query.refetch()}>Retry</Button></ErrorNote>}
      {q && query.isFetching && <p role="status">Searching…</p>}
      {query.data && query.data.pages.flat().length === 0 && (
        <EmptyState title="No matching messages">Try a different word or phrase.</EmptyState>
      )}
      <div className="flex flex-col gap-3">
        {query.data?.pages.flat().map((hit) => (
          <Link
            key={hit.id}
            to="/topics/$id"
            params={{ id: hit.conversation_id }}
            search={{ message: hit.id }}
            className="rounded-xl border bg-card p-4 hover:bg-muted/50"
          >
            <span className="text-sm font-medium">{hit.name || 'General'}</span>
            <p className="mt-2 text-sm leading-relaxed wrap-anywhere">
              {hit.snippet.split(/(⟦.*?⟧)/g).map((part, i) =>
                part.startsWith('⟦') ? (
                  <mark key={i} className="rounded bg-accent text-accent-foreground">
                    {part.slice(1, -1)}
                  </mark>
                ) : (
                  part
                ),
              )}
            </p>
          </Link>
        ))}
      </div>
      {query.hasNextPage && (
        <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load older results
        </Button>
      )}
    </>
  )
}
