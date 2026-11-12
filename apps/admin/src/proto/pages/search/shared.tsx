// What every search variant shares: the paged search, the topic names, the
// highlighted snippet, and the jump into a conversation.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon } from 'lucide-react'
import { searchMessages, type SearchHit, type Topic } from '../../../api'
import { topicsQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

/** herbot-core returns at most this many per page and refuses longer queries. */
export const PAGE = 30
export const MAX_QUERY = 500

export function useSearch(q: string) {
  const query = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam }) => searchMessages({ data: { q, before: pageParam } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.length === PAGE ? page.at(-1)?.id : undefined),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const hits = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  return { query, hits }
}

export function useTopicNames() {
  const topics = useQuery(topicsQuery)
  return useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])
}

/** herbot-core marks matches with ⟦ ⟧ (ts_headline); everything else is the
 * message's own text, rendered as plain text. */
export function Snippet({ text, className, lines = 3 }: { text: string; className?: string; lines?: 2 | 3 }) {
  const parts = text.split(/⟦([^⟧]*)⟧/g)
  return (
    <p dir="auto" className={cn('user-text text-[14px] leading-relaxed text-mute', lines === 3 ? 'line-clamp-3' : 'line-clamp-2', className)}>
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
export function TopicLabel({ topic, fallback, className }: { topic?: Topic; fallback: string; className?: string }) {
  const Icon = topic?.is_general ? MessageCircleIcon : HashIcon
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <Icon aria-hidden className="size-3.5 shrink-0 text-faint" />
      <UserText className="min-w-0">{topic?.name ?? fallback}</UserText>
    </span>
  )
}

/** Opens the conversation scrolled to this message. */
export function JumpLink({ hit, className, children }: { hit: SearchHit; className?: string; children: React.ReactNode }) {
  return (
    <Link to="/topics/$id" params={{ id: hit.conversation_id }} search={{ message: hit.id }} className={className}>
      {children}
    </Link>
  )
}

/** Under the results: loading older, every match, or a retry. */
export function ResultsFooter({ query, count }: { query: ReturnType<typeof useSearch>['query']; count: number }) {
  if (query.isFetchNextPageError)
    return (
      <div className="flex items-center gap-3 px-1 py-4 text-[13px] text-destructive">
        Couldn’t load older matches.
        <Button size="sm" onClick={() => query.fetchNextPage()}>
          Try again
        </Button>
      </div>
    )
  if (query.hasNextPage)
    return (
      <div className="flex items-center gap-3 px-1 py-4 text-[13px] text-mute tabular-nums">
        {query.isFetchingNextPage ? 'Loading older matches…' : `${count.toLocaleString('en-GB')} shown`}
        {!query.isFetchingNextPage && (
          <Button size="sm" variant="ghost" onClick={() => query.fetchNextPage()}>
            Load older matches
          </Button>
        )}
      </div>
    )
  return <p className="px-1 py-4 text-[13px] text-faint">That’s every match: {count.toLocaleString('en-GB')}.</p>
}

/** Before you type: what search looks through and how to phrase it. */
export function SearchHelp() {
  return (
    <div className="flex flex-col gap-3 px-1 py-6 text-[14px] text-mute">
      <p className="text-ink">Search every message in every topic.</p>
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

/** The pane that scrolls a list ([data-hb-scroll]) and the list's offset in
 * it, for a virtualizer. (The kit has this inside rows.tsx, unexported.) */
export function usePaneScroller<T extends HTMLElement>() {
  const ref = useRef<T>(null)
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
  return { ref, scroller, margin }
}

export type { SearchHit }
