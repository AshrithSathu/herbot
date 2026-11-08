// A topic's history as a bounded chat log: it never grows the page, opens at
// the newest message, loads older pages on demand, and picks up new messages
// live without yanking you away from what you're reading.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, useSuspenseInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { ArrowDownIcon, InboxIcon, MicIcon } from 'lucide-react'
import { getMessages, type Message, type MessagePage } from '../api'
import { clock, dayKey, dayLabel, plural, when } from '../format'
import { keys, messagesQuery } from '../queries'
import { EmptyState, ErrorNote } from '../ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ClampedText } from '@/components/clamped-text'
// Day grouping and clock times depend on your timezone, which the server doesn't know.
import { useHydrated } from '@/hooks/use-client'
import { cn } from '@/lib/utils'

/** Within this many pixels of the bottom counts as "reading the latest". */
const NEAR_BOTTOM = 72
/** Longer messages are clamped to this many lines until you expand them. */
const CLAMP_LINES = 12

export function ChatLog({ topicId, total }: { topicId: number; total: number }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, error } =
    useSuspenseInfiniteQuery(messagesQuery(topicId))
  // Pages are newest first; within a page, oldest first.
  const messages = useMemo(() => [...data.pages].reverse().flatMap((p) => p.messages), [data.pages])
  const liveError = useNewMessages(topicId, total, messages.at(-1)?.id)
  const hydrated = useHydrated()

  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLLIElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const lastSeen = useRef<number | undefined>(messages.at(-1)?.id)
  const [unseen, setUnseen] = useState(0)

  const firstId = messages[0]?.id
  const lastId = messages.at(-1)?.id

  // Open at the newest message, before the first paint.
  useLayoutEffect(() => {
    const el = scroller.current
    if (hydrated && el) el.scrollTop = el.scrollHeight
  }, [hydrated])

  // Stay pinned to the newest message while you're at the bottom, even when
  // something inside changes size after the first paint (clamping, fonts).
  useEffect(() => {
    const el = scroller.current
    const content = list.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !anchor.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [hydrated])

  // Older messages went in above: keep what you were reading where it was.
  useLayoutEffect(() => {
    const el = scroller.current
    const saved = anchor.current
    if (!el || !saved) return
    el.scrollTop = saved.top + (el.scrollHeight - saved.height)
    anchor.current = null
  }, [firstId])

  // Newer messages arrived: follow them if you were at the bottom, otherwise
  // count them and leave your scroll alone.
  useLayoutEffect(() => {
    const el = scroller.current
    const previous = lastSeen.current
    lastSeen.current = lastId
    if (!el || lastId === undefined || lastId === previous) return
    if (atBottom.current || previous === undefined) {
      el.scrollTop = el.scrollHeight
    } else {
      setUnseen((n) => n + messages.filter((m) => m.id > previous).length)
    }
  }, [lastId]) // eslint-disable-line react-hooks/exhaustive-deps

  function loadOlder() {
    const el = scroller.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    anchor.current = { height: el.scrollHeight, top: el.scrollTop }
    void fetchNextPage()
  }

  // Reaching the top loads the page before it.
  useEffect(() => {
    const target = sentinel.current
    const root = scroller.current
    if (!hydrated || !target || !root || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && loadOlder(), {
      root,
      rootMargin: '160px 0px 0px 0px',
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hydrated, hasNextPage, isFetchingNextPage, isFetchNextPageError]) // eslint-disable-line react-hooks/exhaustive-deps

  function jumpToLatest() {
    const el = scroller.current
    if (el) {
      el.scrollTop = el.scrollHeight
      el.focus({ preventScroll: true }) // the pill is about to vanish; keep focus in the log
    }
    setUnseen(0)
  }

  if (messages.length === 0) {
    return (
      <EmptyState icon={InboxIcon} title="Nothing stored yet">
        Messages appear here a few seconds after you send them.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative isolate">
        <div
          ref={scroller}
          role="region"
          aria-label="Message history"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
            if (atBottom.current && unseen > 0) setUnseen(0)
          }}
          className="scroller relative h-[min(36rem,65dvh)] overflow-y-auto overscroll-contain rounded-xl border bg-background px-3 pb-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-4"
        >
          {hydrated ? (
            <ol ref={list} className="flex min-h-full flex-col justify-end gap-1.5">
              <li ref={sentinel} className="flex justify-center pt-3 pb-1">
                {isFetchNextPageError ? (
                  <div className="flex flex-col items-center gap-2 text-center text-sm">
                    <span className="text-destructive">Couldn’t load older messages: {error?.message}</span>
                    <Button variant="outline" size="sm" onClick={loadOlder}>
                      Try again
                    </Button>
                  </div>
                ) : hasNextPage ? (
                  <Button variant="ghost" size="sm" disabled={isFetchingNextPage} onClick={loadOlder}>
                    {isFetchingNextPage && <Spinner />}
                    {isFetchingNextPage ? 'Loading older messages…' : 'Load older messages'}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Start of this conversation</span>
                )}
              </li>
              {messages.map((m, i) => (
                <Fragment key={m.id}>
                  {(i === 0 || dayKey(m.sent_at) !== dayKey(messages[i - 1]!.sent_at)) && <DaySeparator iso={m.sent_at} />}
                  <Bubble message={m} />
                </Fragment>
              ))}
            </ol>
          ) : (
            <ChatSkeleton />
          )}
        </div>
        {unseen > 0 && (
          <Button
            size="sm"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] animate-in fade-in-0 slide-in-from-bottom-2"
            onClick={jumpToLatest}
          >
            <ArrowDownIcon aria-hidden />
            {plural(unseen, 'new message')}
          </Button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {unseen > 0 ? `${plural(unseen, 'new message')} below` : ''}
      </p>
      {liveError && <ErrorNote title="Couldn’t load new messages">{liveError} Retrying with the next refresh.</ErrorNote>}
    </div>
  )
}

/** A day's heading: sticks to the top of the log while you scroll through
 * that day, and lets screen-reader users jump between days. */
function DaySeparator({ iso }: { iso: string }) {
  const label = dayLabel(iso)
  return (
    <li
      data-day={label}
      // A band, not a floating pill: messages fade out under it as they scroll.
      className="sticky top-0 z-[1] -mx-3 flex justify-center bg-gradient-to-b from-background from-55% to-transparent px-3 pt-2 pb-4 sm:-mx-4"
    >
      <h3 className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">
        {label}
      </h3>
    </li>
  )
}

function Bubble({ message: m }: { message: Message }) {
  return (
    <li
      data-message-id={m.id}
      className={cn(
        'flex max-w-[min(65ch,88%)] min-w-0 flex-col gap-1 rounded-2xl px-3.5 py-2',
        m.from_bot ? 'self-end rounded-br-md bg-accent text-accent-foreground' : 'self-start rounded-bl-md border bg-card',
      )}
    >
      <span className="sr-only">{m.from_bot ? 'Herbot said:' : 'You said:'}</span>
      <ClampedText
        lines={CLAMP_LINES}
        className={cn('leading-relaxed', !m.body && 'text-muted-foreground italic')}
        toggleClassName="text-[11px] leading-none"
        footer={
          <span className="flex items-center gap-2 text-[11px] leading-none text-muted-foreground">
            {m.is_voice && (
              <span className="inline-flex items-center gap-1">
                <MicIcon className="size-3" aria-hidden /> voice note
              </span>
            )}
            <time dateTime={m.sent_at} title={when(m.sent_at)}>
              {clock(m.sent_at)}
            </time>
          </span>
        }
      >
        {m.body || '(no text)'}
      </ClampedText>
    </li>
  )
}

/** Same box as the log, so nothing moves when the real messages arrive. */
function ChatSkeleton() {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5']
  return (
    <div className="flex h-full flex-col justify-end gap-2 py-3" aria-busy="true" aria-label="Loading messages">
      {widths.map((w, i) => (
        <Skeleton key={w} className={cn('h-12 rounded-2xl', w, i % 2 ? 'self-end' : 'self-start')} />
      ))}
    </div>
  )
}

/** When the topic's message count changes, fetch only what's new and append
 * it; if messages went away (a wipe), refetch from the newest page. */
function useNewMessages(topicId: number, total: number, newestId: number | undefined): string | null {
  const queryClient = useQueryClient()
  const known = useRef(total)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (total === known.current) return
    const before = known.current
    known.current = total
    if (total < before || newestId === undefined) {
      void queryClient.invalidateQueries({ queryKey: keys.messages(topicId) })
      return
    }
    getMessages({ data: { id: topicId, after: newestId, limit: 100 } })
      .then((page) => {
        setError(null)
        if (page.has_more) {
          void queryClient.invalidateQueries({ queryKey: keys.messages(topicId) })
          return
        }
        queryClient.setQueryData<InfiniteData<MessagePage, number | null>>(keys.messages(topicId), (old) => {
          if (!old || old.pages.length === 0) return old
          const [newest, ...older] = old.pages
          const have = new Set(newest!.messages.map((m) => m.id))
          const fresh = page.messages.filter((m) => !have.has(m.id))
          return { ...old, pages: [{ ...newest!, messages: [...newest!.messages, ...fresh] }, ...older] }
        })
      })
      .catch((e: unknown) => {
        known.current = before // try again on the next refresh
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [total]) // eslint-disable-line react-hooks/exhaustive-deps

  return error
}
