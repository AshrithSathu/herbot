import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon, SearchIcon, SearchXIcon, XIcon } from 'lucide-react'
import { searchMessages, type SearchHit } from '../../api'
import { clip, exact } from '../../format'
import { topicsQuery } from '../../queries'
import { EmptyState, ErrorNote, PageHeader } from '../../ui'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** herbot-core refuses longer searches. */
const MAX_QUERY = 500
/** herbot-core returns at most this many per page. */
const PAGE = 30

export const Route = createFileRoute('/_authed/search')({
  component: SearchPage,
  staticData: { crumb: 'Search' },
  head: () => ({ meta: [{ title: 'Search · Herbot admin' }] }),
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === 'string' && s.q.trim() ? { q: clip(s.q.trim(), MAX_QUERY) } : {},
})

function SearchPage() {
  const { q = '' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [draft, setDraft] = useState(q)
  const input = useRef<HTMLInputElement>(null)
  const topics = useQuery(topicsQuery)
  const names = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])

  // Follow back/forward.
  useEffect(() => setDraft(q), [q])
  // Search once you pause typing.
  useEffect(() => {
    const next = draft.trim()
    if (next === q) return
    const timer = setTimeout(() => go(next), 300)
    return () => clearTimeout(timer)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps
  // Focus the box on arrival, except on touch screens (it would pop the keyboard).
  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) input.current?.focus()
  }, [])

  function go(next: string) {
    void navigate({ search: next ? { q: next } : {}, replace: true })
  }

  const results = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam }) => searchMessages({ data: { q, before: pageParam } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.length === PAGE ? page.at(-1)?.id : undefined),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const hits = useMemo(() => (q ? (results.data?.pages.flat() ?? []) : []), [q, results.data])
  const searching = q.length > 0 && results.isFetching && !results.isFetchingNextPage

  return (
    <>
      <PageHeader title="Search" description="Every message in every topic, newest first." />

      <form
        role="search"
        className="flex max-w-2xl flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          go(draft.trim())
        }}
      >
        <label htmlFor="search-messages" className="sr-only">
          Search messages
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 grid place-items-center text-muted-foreground">
            {searching ? <Spinner className="size-4" /> : <SearchIcon className="size-4" aria-hidden />}
          </span>
          <input
            ref={input}
            id="search-messages"
            type="search"
            value={draft}
            maxLength={MAX_QUERY}
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            enterKeyHint="search"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && draft) {
                e.preventDefault()
                setDraft('')
              }
            }}
            placeholder="Search all conversations"
            className="h-12 w-full rounded-xl border border-input bg-card pr-12 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {draft && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setDraft('')
                input.current?.focus()
              }}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <p className="min-h-5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {!q
            ? 'Whole words match. Put a phrase in "quotes"; put - before a word to leave it out.'
            : searching
              ? 'Searching…'
              : hits.length > 0
                ? `${hits.length === 1 ? '1 message' : `${exact(hits.length)} messages`}${results.hasNextPage ? ' so far' : ''}`
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

      {q && hits.length === 0 && !results.isFetching && !results.isError && (
        <EmptyState
          icon={SearchXIcon}
          title={`No message matches “${clip(q, 60)}”`}
          action={
            <Button variant="outline" onClick={() => setDraft('')}>
              Clear the search
            </Button>
          }
        >
          Search matches whole words. Try fewer words, or another spelling.
        </EmptyState>
      )}

      {hits.length > 0 && (
        <div className={cn('flex flex-col gap-4 transition-opacity duration-150', results.isPlaceholderData && 'opacity-60')}>
          <ol className="flex flex-col gap-2" aria-busy={searching}>
            {hits.map((hit) => {
              const topic = names.get(hit.conversation_id)
              return <Hit key={hit.id} hit={hit} name={topic?.name ?? (hit.name || 'General')} general={topic?.is_general ?? !hit.name} />
            })}
          </ol>
          <MoreResults
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

/** One match: which topic, then the passage with the words highlighted.
 * The topic link stretches over the card, so the whole card opens it. */
function Hit({ hit, name, general }: { hit: SearchHit; name: string; general: boolean }) {
  const Icon = general ? MessageCircleIcon : HashIcon
  return (
    <li className="relative flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 shadow-xs transition-colors duration-150 focus-within:border-ring [@media(hover:hover)]:hover:bg-muted/40">
      <Link
        to="/topics/$id"
        params={{ id: hit.conversation_id }}
        search={{ message: hit.id }}
        className="flex max-w-full min-w-0 items-center gap-1.5 text-sm font-medium text-foreground no-underline outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <UserText className="min-w-0">{name}</UserText>
      </Link>
      <p dir="auto" className="user-text line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        <Snippet text={hit.snippet} />
      </p>
    </li>
  )
}

/** herbot-core marks matches with ⟦ ⟧ (`ts_headline`); everything else is
 * the message's own text, rendered as plain text. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/⟦([^⟧]*)⟧/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-warning-soft px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** Older results load as you reach the end; the button is for keyboards and retries. */
function MoreResults({ hasNextPage, loading, failed, error, load }: {
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

  if (!hasNextPage) return <p className="text-center text-xs text-muted-foreground">That’s every match.</p>
  return (
    <div ref={sentinel} className="flex flex-col items-center gap-3">
      {failed && <ErrorNote title="Couldn’t load more results">{error?.message}</ErrorNote>}
      <Button variant="outline" disabled={loading} onClick={load}>
        {loading && <Spinner />}
        {loading ? 'Loading older matches…' : failed ? 'Try again' : 'Load older matches'}
      </Button>
    </div>
  )
}
