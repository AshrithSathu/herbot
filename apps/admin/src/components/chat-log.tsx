// A topic's history as a bounded, virtualized chat log: it never grows the
// page, only the rows on screen are in the DOM (however far back you scroll),
// it opens at the newest message, loads older pages as you reach the top, and
// picks up new messages live without yanking you away from what you're reading.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, useSuspenseInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, InboxIcon, MicIcon } from 'lucide-react'
import { getMessages, type Message, type MessagePage } from '../api'
import { clock, dayKey, dayLabel, plural, when } from '../format'
import { keys, messagesQuery } from '../queries'
import { EmptyState, ErrorNote } from '../ui'
import { RichMessage, FilePreview } from './rich-message'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
// Day grouping and clock times depend on your timezone, which the server doesn't know.
import { useHydrated } from '@/hooks/use-client'
import { cn } from '@/lib/utils'

/** Within this many pixels of the bottom counts as "reading the latest". */
const NEAR_BOTTOM = 72
/** Within this many pixels of the top, the page before is loaded. */
const NEAR_TOP = 240
/** Longer messages are clamped to this many lines until you expand them. */

type Row =
  | { kind: 'top'; key: 'top' }
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'message'; key: number; message: Message }

export function ChatLog({ topicId, total, targetMessage }: { topicId: number; total: number; targetMessage?: number }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, error } =
    useSuspenseInfiniteQuery(messagesQuery(topicId))
  // Pages are newest first; within a page, oldest first.
  const messages = useMemo(() => [...data.pages].reverse().flatMap((p) => p.messages), [data.pages])
  const rows = useMemo(() => {
    const out: Row[] = [{ kind: 'top', key: 'top' }]
    messages.forEach((m, i) => {
      if (i === 0 || dayKey(m.sent_at) !== dayKey(messages[i - 1]!.sent_at)) {
        out.push({ kind: 'day', key: `day-${dayKey(m.sent_at)}`, iso: m.sent_at })
      }
      out.push({ kind: 'message', key: m.id, message: m })
    })
    return out
  }, [messages])
  const liveError = useNewMessages(topicId, total, messages.at(-1)?.id)
  const hydrated = useHydrated()

  const scroller = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  // "Pinned to the newest message": set by reaching the bottom, cleared only
  // by scrolling up. Content growing underneath (rows measured taller, a
  // message expanded) never unpins you.
  const atBottom = useRef(true)
  const lastTop = useRef(0)
  const anchor = useRef<{ key: Row['key']; offset: number } | null>(null)
  const lastSeen = useRef<number | undefined>(messages.at(-1)?.id)
  const [unseen, setUnseen] = useState(0)
  const [viewport, setViewport] = useState(0)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === 'message' ? 76 : 48),
    getItemKey: (i) => rows[i]!.key,
    overscan: 6,
    paddingEnd: 12,
  })
  // Rows above you that turn out taller or shorter than estimated shift what
  // you're reading; the virtualizer corrects for that, except while you're
  // pinned to the newest message, where snapping to the bottom is the fix.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !atBottom.current && item.start < (instance.scrollOffset ?? 0)
  const items = virtualizer.getVirtualItems()
  // A short conversation sits at the bottom, like a chat.
  const gap = Math.max(0, viewport - virtualizer.getTotalSize())

  const firstId = messages[0]?.id
  const lastId = messages.at(-1)?.id

  // The box's own height, for bottom-aligning short conversations.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewport(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hydrated])

  // Open at the newest message, before the first paint.
  useLayoutEffect(() => {
    const el = scroller.current
    if (hydrated && el) el.scrollTop = el.scrollHeight
  }, [hydrated])

  // Stay pinned to the newest message while you're at the bottom, even as
  // rows are measured or something inside changes size.
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

  // Older messages went in above: put the message you were reading back
  // where it was. (Rows measured later above you are corrected by the
  // virtualizer itself.)
  useLayoutEffect(() => {
    const el = scroller.current
    const saved = anchor.current
    if (!el || !saved) return
    const index = rows.findIndex((r) => r.key === saved.key)
    const start = index >= 0 ? virtualizer.measurementsCache[index]?.start : undefined
    if (start !== undefined) el.scrollTop = start + gap - saved.offset
    anchor.current = null
  }, [firstId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const first = items.find((v) => v.end + gap > el.scrollTop && rows[v.index]?.kind === 'message')
    anchor.current = first ? { key: first.key as Row['key'], offset: first.start + gap - el.scrollTop } : null
    void fetchNextPage()
  }

  // If everything loaded so far fits without scrolling, keep loading: there
  // is no scroll to trigger it.
  useEffect(() => {
    const el = scroller.current
    if (!hydrated || !el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    if (el.scrollHeight <= el.clientHeight + 4) loadOlder()
  }, [hydrated, hasNextPage, isFetchingNextPage, isFetchNextPageError, firstId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!targetMessage || !hydrated) return
    const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === targetMessage)
    if (index < 0) {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
      return
    }
    atBottom.current = false
    virtualizer.scrollToIndex(index, { align: 'center' })
    const timer = setTimeout(
      () => document.getElementById(`message-${targetMessage}`)?.setAttribute('data-highlight', 'true'),
      150,
    )
    return () => clearTimeout(timer)
  }, [targetMessage, hydrated, rows, hasNextPage, isFetchingNextPage, isFetchNextPageError])

  function jumpToLatest() {
    const el = scroller.current
    atBottom.current = true // pinned first, so rows measured on the way down keep it at the end
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

  // Which day is at the top of the box right now (for the floating label).
  const scrollTop = virtualizer.scrollOffset ?? 0
  const topRow = items.find((v) => v.end + gap > scrollTop + 8)
  const topMessage = topRow
    ? rows.slice(topRow.index).find((r): r is Extract<Row, { kind: 'message' }> => r.kind === 'message')
    : undefined
  const floatingDay = hydrated && scrollTop > 48 && topMessage ? dayLabel(topMessage.message.sent_at) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="relative isolate">
        <div
          ref={scroller}
          role="region"
          aria-label="Message history"
          tabIndex={0}
          data-loaded={messages.length}
          onScroll={(e) => {
            const el = e.currentTarget
            const movedUp = el.scrollTop < lastTop.current - 1
            lastTop.current = el.scrollTop
            if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM) atBottom.current = true
            else if (movedUp) atBottom.current = false
            if (atBottom.current && unseen > 0) setUnseen(0)
            if (el.scrollTop < NEAR_TOP && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) loadOlder()
          }}
          className="scroller relative h-[clamp(16rem,calc(100dvh-29rem),36rem)] overflow-y-auto overscroll-contain rounded-xl border bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {hydrated ? (
            <ol ref={list} className="relative" style={{ height: virtualizer.getTotalSize() + gap }}>
              {items.map((v) => {
                const row = rows[v.index]!
                return (
                  <li
                    key={v.key}
                    data-index={v.index}
                    ref={virtualizer.measureElement}
                    className="absolute inset-x-0 top-0 flex flex-col px-3 pb-1.5 sm:px-4"
                    style={{ transform: `translateY(${v.start + gap}px)` }}
                  >
                    {row.kind === 'top' ? (
                      <Top
                        failed={isFetchNextPageError ? (error?.message ?? 'unknown error') : null}
                        more={hasNextPage}
                        loading={isFetchingNextPage}
                        onLoad={loadOlder}
                      />
                    ) : row.kind === 'day' ? (
                      <h3 className="flex justify-center pt-2 pb-1">
                        <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">
                          {dayLabel(row.iso)}
                        </span>
                      </h3>
                    ) : (
                      <Bubble message={row.message} />
                    )}
                  </li>
                )
              })}
            </ol>
          ) : (
            <ChatSkeleton />
          )}
        </div>
        {floatingDay && (
          // The day you're reading, over the top of the box; the real
          // headings are in the list for screen readers.
          <div
            aria-hidden
            data-floating-day
            className="pointer-events-none absolute inset-x-px top-px z-[1] flex justify-center rounded-t-xl bg-gradient-to-b from-background from-55% to-transparent pt-2 pb-4"
          >
            <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">
              {floatingDay}
            </span>
          </div>
        )}
        {unseen > 0 && (
          <Button
            size="sm"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md animation-duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] animate-in fade-in-0 slide-in-from-bottom-2"
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
      {liveError && (
        <ErrorNote title="Couldn’t load new messages">{liveError} Retrying with the next refresh.</ErrorNote>
      )}
    </div>
  )
}

/** The top of the log: load older, loading, failed, or the very beginning. */
function Top({
  failed,
  more,
  loading,
  onLoad,
}: {
  failed: string | null
  more: boolean
  loading: boolean
  onLoad: () => void
}) {
  return (
    <div className="flex min-h-12 items-center justify-center pt-3 pb-1">
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <span className="text-destructive">Couldn’t load older messages: {failed}</span>
          <Button variant="outline" size="sm" onClick={onLoad}>
            Try again
          </Button>
        </div>
      ) : more ? (
        <Button variant="ghost" size="sm" disabled={loading} onClick={onLoad}>
          {loading && <Spinner />}
          {loading ? 'Loading older messages…' : 'Load older messages'}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Start of this conversation</span>
      )}
    </div>
  )
}

function Bubble({ message: m }: { message: Message }) {
  return (
    <div
      id={`message-${m.id}`}
      data-message-id={m.id}
      className={cn(
        'flex max-w-[min(65ch,88%)] min-w-0 flex-col gap-1 rounded-2xl px-3.5 py-2',
        m.from_bot
          ? 'self-start rounded-bl-md border bg-card'
          : 'self-end rounded-br-md bg-accent text-accent-foreground',
      )}
    >
      {/* Virtualized: day headings off screen aren't in the page, so each
          message carries its own day for screen readers. */}
      <span className="sr-only">
        {m.from_bot ? 'Herbot' : 'You'}, {dayLabel(m.sent_at)} at {clock(m.sent_at)}:
      </span>
      <RichMessage body={m.body} />
      {m.attachments?.map((f) => (
        <FilePreview key={f.path} file={f} />
      ))}
      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {m.is_voice && <MicIcon className="size-3" />}
        <time dateTime={m.sent_at} title={when(m.sent_at)}>
          {clock(m.sent_at)}
        </time>
      </span>
    </div>
  )
}

/** Same box as the log, so nothing moves when the real messages arrive. */
function ChatSkeleton() {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5']
  return (
    <div className="flex h-full flex-col justify-end gap-2 p-3" aria-busy="true" aria-label="Loading messages">
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
