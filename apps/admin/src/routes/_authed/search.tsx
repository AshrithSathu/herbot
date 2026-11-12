// Search: every message in every topic (docs/design/DECISIONS.md, "Search").
// By topic: matches gather under the topic they came from, three at a time,
// so "where did I talk about this?" is answered before "which message?".
// Each match opens the conversation at that message. ⌘K searches messages
// from anywhere and links here with the query.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowRightIcon, HashIcon, MessageCircleIcon } from 'lucide-react'
import { searchMessages, type SearchHit, type Topic } from '../../api'
import { clip, exact } from '../../format'
import { topicsQuery } from '../../queries'
import { Button, SearchInput } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { STRETCH, measureNonZero, useScrollParent } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

/** herbot-core refuses longer searches. */
const MAX_QUERY = 500
/** herbot-core returns at most this many per page. */
const PAGE = 30
/** Matches shown per topic before "Show N more". */
const SHOWN = 3

export const Route = createFileRoute('/_authed/search')({
  component: SearchPage,
  staticData: { shell: 'page', crumb: 'Search' },
  head: () => ({ meta: [{ title: 'Search · Herbot admin' }] }),
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === 'string' && s.q.trim() ? { q: clip(s.q.trim(), MAX_QUERY) } : {},
})

type Group = { conversation_id: number; name: string; hits: SearchHit[] }

function SearchPage() {
  const { q = '' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [draft, setDraft] = useState(q)
  const topics = useQuery(topicsQuery)
  const names = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])
  const [mod, setMod] = useState('Ctrl')

  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  // Follow back/forward; search once you pause typing.
  useEffect(() => setDraft(q), [q])
  useEffect(() => {
    const next = clip(draft.trim(), MAX_QUERY)
    if (next === q) return
    const timer = setTimeout(() => void navigate({ search: next ? { q: next } : {}, replace: true }), 300)
    return () => clearTimeout(timer)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam }) => searchMessages({ data: { q, before: pageParam } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.length === PAGE ? page.at(-1)?.id : undefined),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const hits = useMemo(() => (q ? (query.data?.pages.flat() ?? []) : []), [q, query.data])
  const groups = useMemo(() => {
    const byTopic = new Map<number, Group>()
    for (const h of hits) {
      const g = byTopic.get(h.conversation_id) ?? { conversation_id: h.conversation_id, name: h.name, hits: [] }
      g.hits.push(h)
      byTopic.set(h.conversation_id, g)
    }
    return [...byTopic.values()]
  }, [hits])
  const more = query.hasNextPage ? '+' : ''

  return (
    <ShellPage
      title="Search"
      description={
        <>
          Every message in every topic, grouped by the topic it’s in.
          <span className="hidden pointer-fine:inline"> {mod} K searches from anywhere.</span>
        </>
      }
      back={<BackToAgents />}
    >
      <div className="flex flex-col gap-1.5" role="search">
        <SearchInput
          label="Search messages"
          value={draft}
          onValueChange={(v) => setDraft(v.slice(0, MAX_QUERY))}
          placeholder="Search messages"
          maxLength={MAX_QUERY}
          enterKeyHint="search"
          aria-busy={(query.isFetching && !query.isFetchingNextPage) || undefined}
          data-autofocus
        />
        <AutoFocus />
      </div>

      {!q ? (
        <SearchHelp />
      ) : query.isPending ? (
        <ListSkeleton rows={6} />
      ) : query.isError && !query.isFetchNextPageError ? (
        <InPlaceError title="Search failed" error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
      ) : hits.length === 0 ? (
        <InPlaceEmpty title={`Nothing matches “${clip(q, 60)}”`} action={<Button onClick={() => setDraft('')}>Clear search</Button>}>
          Search matches whole words. Try fewer words, another spelling, or a phrase in "quotes".
        </InPlaceEmpty>
      ) : (
        <div className={cn('flex flex-col gap-2 transition-opacity duration-150 ease-out', query.isPlaceholderData && 'opacity-60')}>
          <p className="px-1 text-[13px] text-mute tabular-nums" aria-live="polite">
            {exact(hits.length)}
            {more} {hits.length === 1 ? 'match' : 'matches'} in {exact(groups.length)}
            {more} {groups.length === 1 ? 'topic' : 'topics'}
          </p>
          <Groups
            groups={groups}
            names={names}
            onEnd={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && void query.fetchNextPage()}
          />
          <ResultsFooter query={query} count={hits.length} />
        </div>
      )}
    </ShellPage>
  )
}

/** Focuses the search box on arrival, except on touch screens (it would pop
 * the keyboard over the results). */
function AutoFocus() {
  useEffect(() => {
    if (matchMedia('(pointer: coarse)').matches) return
    document.querySelector<HTMLInputElement>('[data-autofocus]')?.focus()
  }, [])
  return null
}

function Groups({ groups, names, onEnd }: { groups: Group[]; names: Map<number, Topic>; onEnd: () => void }) {
  const { ref, scroller, margin } = useScrollParent<HTMLDivElement>()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const virtual = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => 64 + Math.min(groups[i].hits.length, open.has(groups[i].conversation_id) ? 99 : SHOWN) * 92,
    measureElement: measureNonZero,
    overscan: 4,
    scrollMargin: margin,
    initialRect: { width: 800, height: 800 },
  })
  const items = virtual.getVirtualItems()
  const last = items.at(-1)?.index ?? -1
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  useLayoutEffect(() => {
    if (last >= groups.length - 2 && groups.length > 0) endRef.current()
  }, [last, groups.length])

  function toggle(id: number) {
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div ref={ref}>
      <ul aria-label="Matches by topic" className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const g = groups[item.index]
          const topic = names.get(g.conversation_id)
          const label = topic?.name ?? (g.name || `Topic #${g.conversation_id}`)
          const expanded = open.has(g.conversation_id)
          const shown = expanded ? g.hits : g.hits.slice(0, SHOWN)
          const rest = g.hits.length - SHOWN
          return (
            <li
              key={g.conversation_id}
              data-index={item.index}
              ref={virtual.measureElement}
              className="absolute inset-x-0 top-0 pb-6"
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              <section aria-labelledby={`grp-${g.conversation_id}`} className="flex flex-col">
                <header className="flex min-w-0 items-center gap-3 border-b border-line px-1 pb-2">
                  <h2 id={`grp-${g.conversation_id}`} className="min-w-0 flex-1 text-[15px] font-medium">
                    <TopicLabel topic={topic} fallback={label} />
                  </h2>
                  <span className="shrink-0 text-[12.5px] text-mute tabular-nums">
                    {g.hits.length} {g.hits.length === 1 ? 'match' : 'matches'}
                  </span>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/topics/$id" params={{ id: g.conversation_id }} aria-label={`Open ${clip(label, 60)}`}>
                      Open
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                </header>
                <ol className="flex flex-col">
                  {shown.map((h) => (
                    <li key={h.id} className="relative border-b border-line px-1 py-3 transition-[background-color] duration-150 ease-out hover:bg-sunken md:px-3">
                      <Link
                        to="/topics/$id"
                        params={{ id: h.conversation_id }}
                        search={{ message: h.id }}
                        className={cn('block outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset', STRETCH)}
                      >
                        <span className="sr-only">Open this message in {clip(label, 60)}: </span>
                        <Snippet text={h.snippet} />
                      </Link>
                    </li>
                  ))}
                </ol>
                {rest > 0 && (
                  <Button size="sm" variant="ghost" className="mt-1 self-start" aria-expanded={expanded} onClick={() => toggle(g.conversation_id)}>
                    {expanded ? 'Show fewer' : `Show ${rest} more in this topic`}
                  </Button>
                )}
              </section>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** herbot-core marks matches with ⟦ ⟧ (ts_headline); everything else is the
 * message's own text, rendered as plain text. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/⟦([^⟧]*)⟧/g)
  return (
    <p dir="auto" className="user-text line-clamp-3 text-[14px] leading-relaxed text-mute">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-warning-soft px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  )
}

/** "General" or the topic's name, with its glyph. */
function TopicLabel({ topic, fallback }: { topic?: Topic; fallback: string }) {
  const Icon = topic?.is_general ? MessageCircleIcon : HashIcon
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-3.5 shrink-0 text-faint" />
      <UserText className="min-w-0">{topic?.name ?? fallback}</UserText>
    </span>
  )
}

/** Under the results: loading older, every match, or a retry. */
function ResultsFooter({ query, count }: { query: { isFetchNextPageError: boolean; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown }; count: number }) {
  if (query.isFetchNextPageError)
    return (
      <div className="flex items-center gap-3 px-1 py-4 text-[13px] text-destructive">
        Couldn’t load older matches.
        <Button size="sm" onClick={() => void query.fetchNextPage()}>
          Try again
        </Button>
      </div>
    )
  if (query.hasNextPage)
    return (
      <div className="flex items-center gap-3 px-1 py-4 text-[13px] text-mute tabular-nums">
        {query.isFetchingNextPage ? 'Loading older matches…' : `${exact(count)} shown`}
        {!query.isFetchingNextPage && (
          <Button size="sm" variant="ghost" onClick={() => void query.fetchNextPage()}>
            Load older matches
          </Button>
        )}
      </div>
    )
  return <p className="px-1 py-4 text-[13px] text-faint tabular-nums">That’s every match: {exact(count)}.</p>
}

/** Before you type: what search looks through and how to phrase it. */
function SearchHelp() {
  return (
    <div className="flex flex-col gap-3 px-1 py-2 text-[14px] text-mute">
      <p className="text-ink">Whole words match, newest first.</p>
      <ul className="flex flex-col gap-1.5">
        <li>
          <code className="rounded bg-sunken px-1 font-mono text-[12.5px] text-ink">"exact phrase"</code> matches words in that order
        </li>
        <li>
          <code className="rounded bg-sunken px-1 font-mono text-[12.5px] text-ink">rust -python</code> leaves out messages with a word
        </li>
        <li>
          <code className="rounded bg-sunken px-1 font-mono text-[12.5px] text-ink">timeout or panic</code> matches either word
        </li>
      </ul>
    </div>
  )
}
