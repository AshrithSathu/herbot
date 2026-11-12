// Variant 2 "Flat" — order axis: one list, newest match first, each with its
// topic and the words around the match. Fastest way to the message itself.
// (herbot-core has no relevance ranking; newest-first is its only order.)
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { STRETCH, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { PageFrame, SearchBox, useUrlQuery } from '../logs/frame'
import { JumpLink, MAX_QUERY, ResultsFooter, SearchHelp, Snippet, TopicLabel, useSearch, useTopicNames } from './shared'

export function FlatVariant() {
  const [draft, q, setQ] = useUrlQuery('q')
  const { query, hits } = useSearch(q)
  const names = useTopicNames()

  return (
    <PageFrame>
      <ShellPage title="Search" description="Every message in every topic, newest match first." back={<BackToAgents />}>
        <SearchBox
          id="flat-q"
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
          <ListSkeleton rows={8} />
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
              {query.hasNextPage ? '+' : ''} {hits.length === 1 ? 'match' : 'matches'}
            </p>
            <ThreadList
              label="Matches"
              items={hits}
              itemKey={(h) => h.id}
              estimate={104}
              title={(h) => {
                const topic = names.get(h.conversation_id)
                return (
                  <JumpLink hit={h} className={cn('block min-w-0 outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset', STRETCH)}>
                    <TopicLabel topic={topic} fallback={h.name || `Topic #${h.conversation_id}`} className="text-[14px] font-medium" />
                  </JumpLink>
                )
              }}
              body={(h) => <Snippet text={h.snippet} />}
              onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
              footer={<ResultsFooter query={query} count={hits.length} />}
            />
          </div>
        )}
      </ShellPage>
    </PageFrame>
  )
}
