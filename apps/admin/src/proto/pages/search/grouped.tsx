// Variant 1 "By topic" — grouping axis: matches gather under the topic they
// came from, three at a time, so "where did I talk about this?" is answered
// before "which message?". Groups keep the order of their newest match.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { STRETCH } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { PageFrame, SearchBox, useUrlQuery } from '../logs/frame'
import { JumpLink, MAX_QUERY, ResultsFooter, SearchHelp, Snippet, TopicLabel, usePaneScroller, useSearch, useTopicNames, type SearchHit } from './shared'

const SHOWN = 3

type Group = { conversation_id: number; name: string; hits: SearchHit[] }

export function GroupedVariant() {
  const [draft, q, setQ] = useUrlQuery('q')
  const { query, hits } = useSearch(q)
  const names = useTopicNames()
  const groups = useMemo(() => {
    const byTopic = new Map<number, Group>()
    for (const h of hits) {
      const g = byTopic.get(h.conversation_id) ?? { conversation_id: h.conversation_id, name: h.name, hits: [] }
      g.hits.push(h)
      byTopic.set(h.conversation_id, g)
    }
    return [...byTopic.values()]
  }, [hits])

  return (
    <PageFrame>
      <ShellPage title="Search" description="Every message in every topic. Matches are grouped by the topic they’re in." back={<BackToAgents />}>
        <SearchBox
          id="grouped-q"
          label="Search messages"
          value={draft}
          onChange={(v) => setQ(v.slice(0, MAX_QUERY))}
          placeholder="Search messages"
          autoFocus
          busy={query.isFetching && !query.isFetchingNextPage}
        />
        {!q ? (
          <SearchHelp />
        ) : query.isPending ? (
          <ListSkeleton rows={6} />
        ) : query.isError ? (
          <InPlaceError title="Search failed" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
        ) : hits.length === 0 ? (
          <InPlaceEmpty title={`Nothing matches “${q}”`} action={<Button onClick={() => setQ('')}>Clear search</Button>}>
            Search matches whole words. Try fewer words, or another spelling.
          </InPlaceEmpty>
        ) : (
          <div className={cn('flex flex-col gap-2 transition-opacity duration-150', query.isPlaceholderData && 'opacity-60')}>
            <p className="px-1 text-[13px] text-mute tabular-nums" aria-live="polite">
              {hits.length.toLocaleString('en-GB')}
              {query.hasNextPage ? '+' : ''} {hits.length === 1 ? 'match' : 'matches'} in {groups.length.toLocaleString('en-GB')}
              {query.hasNextPage ? '+' : ''} {groups.length === 1 ? 'topic' : 'topics'}
            </p>
            <Groups
              groups={groups}
              names={names}
              onEnd={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
            />
            <ResultsFooter query={query} count={hits.length} />
          </div>
        )}
      </ShellPage>
    </PageFrame>
  )
}

function Groups({ groups, names, onEnd }: { groups: Group[]; names: ReturnType<typeof useTopicNames>; onEnd: () => void }) {
  const { ref, scroller, margin } = usePaneScroller<HTMLDivElement>()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const virtual = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => 64 + Math.min(groups[i].hits.length, open.has(groups[i].conversation_id) ? 99 : SHOWN) * 92,
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

  return (
    <div ref={ref}>
      <ul aria-label="Matches by topic" className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const g = groups[item.index]
          const topic = names.get(g.conversation_id)
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
                    <TopicLabel topic={topic} fallback={g.name || `Topic #${g.conversation_id}`} />
                  </h2>
                  <span className="shrink-0 text-[12.5px] text-mute tabular-nums">
                    {g.hits.length} {g.hits.length === 1 ? 'match' : 'matches'}
                  </span>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/topics/$id" params={{ id: g.conversation_id }} aria-label={`Open ${topic?.name ?? 'topic'}`}>
                      Open
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                </header>
                <ol className="flex flex-col">
                  {shown.map((h) => (
                    <li key={h.id} className="relative border-b border-line px-1 py-3 transition-[background-color] duration-150 ease-out hover:bg-sunken md:px-3">
                      <JumpLink hit={h} className={cn('block outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset', STRETCH)}>
                        <span className="sr-only">Open this message in {topic?.name ?? 'its topic'}: </span>
                        <Snippet text={h.snippet} />
                      </JumpLink>
                    </li>
                  ))}
                </ol>
                {rest > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 self-start"
                    aria-expanded={expanded}
                    onClick={() =>
                      setOpen((o) => {
                        const next = new Set(o)
                        if (next.has(g.conversation_id)) next.delete(g.conversation_id)
                        else next.add(g.conversation_id)
                        return next
                      })
                    }
                  >
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
