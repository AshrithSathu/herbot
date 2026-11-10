// A topic's history as a chat, scrolled by the page itself (one scrollbar,
// the native one). Only the rows on screen are in the DOM, however long the
// history: it opens at the newest message, loads older pages as you reach the
// top without moving what you're reading, follows new messages while you're at
// the bottom, and counts them when you aren't. The composer sits at the
// bottom of the screen; very long messages fold until you open them.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient, useSuspenseInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, ChevronDownIcon, ChevronUpIcon, InboxIcon, MicIcon } from 'lucide-react'
import { getMessages, type Message, type MessagePage } from '../api'
import { clock, dayKey, dayLabel, plural, when } from '../format'
import { keys, messagesQuery } from '../queries'
import { EmptyState, ErrorNote } from '../ui'
import { OutboxContext } from './composer'
import { FilePreview, RichMessage } from './rich-message'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
// Day grouping and clock times depend on your timezone, which the server doesn't know.
import { useHydrated } from '@/hooks/use-client'
import { cn } from '@/lib/utils'

/** Within this many pixels of the bottom counts as "reading the latest". */
const NEAR_BOTTOM = 96
/** Within this many pixels of the first row, the page before is loaded. */
const NEAR_TOP = 600
/** Height of what's pinned above the log: the site header (56) + the tabs (52). */
const PINNED_TOP = 108
/** Messages longer than this fold until opened. */
const FOLD_CHARS = 1500
const FOLD_LINES = 24

type Row =
  | { kind: 'top'; key: 'top' }
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'message'; key: number; message: Message }

const docHeight = () => document.documentElement.scrollHeight
const maxScroll = () => docHeight() - window.innerHeight

export function ChatLog({
  topicId,
  total,
  targetMessage,
  composer,
}: {
  topicId: number
  total: number
  targetMessage?: number
  composer: ReactNode
}) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, error } =
    useSuspenseInfiniteQuery(messagesQuery(topicId))
  // Pages are newest first; within a page, oldest first.
  const messages = useMemo(() => [...data.pages].reverse().flatMap((p) => p.messages), [data.pages])
  const hydrated = useHydrated()
  const rows = useMemo(() => {
    const out: Row[] = [{ kind: 'top', key: 'top' }]
    messages.forEach((m, i) => {
      if (i === 0 || dayKey(m.sent_at) !== dayKey(messages[i - 1]!.sent_at)) {
        // Keyed by its first message: a day can come round twice when
        // messages arrive out of order (a replay), and keys must stay unique.
        out.push({ kind: 'day', key: `day-${m.id}`, iso: m.sent_at })
      }
      out.push({ kind: 'message', key: m.id, message: m })
    })
    return out
  }, [messages])
  const liveError = useNewMessages(topicId, total, messages.at(-1)?.id)

  const section = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const [outbox, setOutbox] = useState<HTMLDivElement | null>(null)
  // Where the list starts on the page; the virtualizer works in page pixels.
  const [margin, setMargin] = useState(0)
  // The section is at least one screen tall, so a short chat sits on the composer.
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined)
  // "Pinned to the newest message": set by reaching the bottom, cleared only
  // by scrolling up. Content growing underneath never unpins you.
  const atBottom = useRef(true)
  const lastY = useRef(0)
  const anchor = useRef<{ key: Row['key']; offset: number } | null>(null)
  const lastSeen = useRef<number | undefined>(messages.at(-1)?.id)
  const [unseen, setUnseen] = useState(0)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.kind === 'message' ? 84 : 44),
    getItemKey: (i) => rows[i]!.key,
    overscan: 8,
    scrollMargin: margin,
  })
  // Rows above you that measure taller or shorter than estimated would shift
  // what you're reading; the virtualizer corrects that, except while you're
  // pinned to the newest message, where snapping to the bottom is the fix.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !atBottom.current && item.start < (instance.scrollOffset ?? 0) + PINNED_TOP
  const items = virtualizer.getVirtualItems()

  const firstId = messages[0]?.id
  const lastId = messages.at(-1)?.id

  // Track the list's page position and the room left under the header.
  useLayoutEffect(() => {
    if (!hydrated) return
    const measure = () => {
      const top = list.current?.getBoundingClientRect().top
      if (top !== undefined) setMargin(Math.round(top + window.scrollY))
      const box = section.current?.getBoundingClientRect()
      if (box) {
        // Whatever the page puts below this section (padding, margins) is
        // left out, so a short chat fills exactly one screen.
        const below = docHeight() - (box.bottom + window.scrollY)
        setMinHeight(Math.max(0, Math.floor(window.innerHeight - (box.top + window.scrollY) - below)))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [hydrated])

  const toBottom = useCallback(() => window.scrollTo({ top: maxScroll(), behavior: 'instant' }), [])

  // The virtualizer keeps your place itself, with instant corrections. The
  // page's smooth scrolling would animate each correction (and fight the
  // next), and the browser's scroll anchoring would apply them twice.
  useLayoutEffect(() => {
    const root = document.documentElement
    const before = { anchor: root.style.overflowAnchor, behavior: root.style.scrollBehavior }
    root.style.overflowAnchor = 'none'
    root.style.scrollBehavior = 'auto'
    return () => {
      root.style.overflowAnchor = before.anchor
      root.style.scrollBehavior = before.behavior
    }
  }, [])

  // Open at the newest message.
  useLayoutEffect(() => {
    if (hydrated && !targetMessage) toBottom()
  }, [hydrated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stay pinned to the newest message while rows are measured or grow.
  useEffect(() => {
    if (!hydrated) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !anchor.current) toBottom()
    })
    if (list.current) observer.observe(list.current)
    if (outbox) observer.observe(outbox)
    return () => observer.disconnect()
  }, [hydrated, outbox, toBottom])

  // Older messages went in above: put the message you were reading back where it was.
  useLayoutEffect(() => {
    const saved = anchor.current
    if (!saved) return
    const index = rows.findIndex((r) => r.key === saved.key)
    const start = index >= 0 ? virtualizer.measurementsCache[index]?.start : undefined
    if (start !== undefined) window.scrollTo({ top: start - saved.offset, behavior: 'instant' })
    anchor.current = null
  }, [firstId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Newer messages: follow them if you were at the bottom, else count them.
  useLayoutEffect(() => {
    const previous = lastSeen.current
    lastSeen.current = lastId
    if (lastId === undefined || lastId === previous) return
    if (atBottom.current || previous === undefined) toBottom()
    else setUnseen((n) => n + messages.filter((m) => m.id > previous).length)
  }, [lastId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const y = window.scrollY + PINNED_TOP
    const first = virtualizer
      .getVirtualItems()
      .find((v) => v.end > y && rows[v.index]?.kind === 'message')
    anchor.current = first ? { key: first.key as Row['key'], offset: first.start - window.scrollY } : null
    void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, virtualizer, rows, fetchNextPage])

  // Scrolling: pinned or not, and load older near the top.
  useEffect(() => {
    if (!hydrated) return
    const onScroll = () => {
      const y = window.scrollY
      const movedUp = y < lastY.current - 1
      lastY.current = y
      if (maxScroll() - y < NEAR_BOTTOM) atBottom.current = true
      else if (movedUp) atBottom.current = false
      if (atBottom.current) setUnseen(0)
      if (y < margin + NEAR_TOP && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) loadOlder()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [hydrated, margin, hasNextPage, isFetchingNextPage, isFetchNextPageError, loadOlder])

  // Everything loaded fits on screen: there's no scroll to trigger the next page.
  useEffect(() => {
    if (!hydrated || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    if (docHeight() <= window.innerHeight + 4) loadOlder()
  }, [hydrated, hasNextPage, isFetchingNextPage, isFetchNextPageError, firstId, loadOlder])

  // Arriving from search with ?message=: page back until it's loaded, then centre it.
  const jumpedTo = useRef<number | undefined>(undefined)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(settle.current), [])
  useEffect(() => {
    if (!targetMessage || !hydrated || jumpedTo.current === targetMessage) return
    const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === targetMessage)
    if (index < 0) {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
      return
    }
    jumpedTo.current = targetMessage
    atBottom.current = false
    virtualizer.scrollToIndex(index, { align: 'center' })
    // Rows measure taller than estimated once rendered: settle, then put the
    // message's top just under the tabs.
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const el = document.getElementById(`message-${targetMessage}`)
      if (el) window.scrollBy({ top: el.getBoundingClientRect().top - PINNED_TOP - 24, behavior: 'instant' })
      else virtualizer.scrollToIndex(index, { align: 'start' })
    }, 350)
  }, [targetMessage, hydrated, rows, hasNextPage, isFetchingNextPage, isFetchNextPageError]) // eslint-disable-line react-hooks/exhaustive-deps

  function jumpToLatest() {
    atBottom.current = true
    toBottom()
    setUnseen(0)
  }

  const toggle = useCallback((id: number) => {
    setOpen((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // The day at the top of the screen, pinned under the tabs while you scroll.
  const y = (virtualizer.scrollOffset ?? 0) + PINNED_TOP
  const topRow = items.find((v) => v.end > y)
  const topMessage = topRow
    ? rows.slice(topRow.index).find((r): r is Extract<Row, { kind: 'message' }> => r.kind === 'message')
    : undefined
  const floatingDay =
    hydrated && topMessage && (virtualizer.scrollOffset ?? 0) > margin - PINNED_TOP + 40
      ? dayLabel(topMessage.message.sent_at)
      : null

  return (
    <OutboxContext.Provider value={outbox}>
      {/* The page's bottom padding is taken over here, so the composer can
          sit flush with the bottom edge. */}
      <div ref={section} className="-mb-[max(4rem,env(safe-area-inset-bottom))] flex flex-col" style={{ minHeight }}>
        {/* Short conversations sit just above the composer, like a chat. */}
        <div className="flex-1" />
        <div aria-hidden className="pointer-events-none sticky top-[108px] z-[2] h-0">
          {floatingDay && (
            <div className="flex justify-center pt-2">
              <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">
                {floatingDay}
              </span>
            </div>
          )}
        </div>
        {messages.length === 0 ? (
          <div className="py-10">
            <EmptyState icon={InboxIcon} title="No messages yet">
              Send this agent a message below or in Telegram. Messages show up here a few seconds later.
            </EmptyState>
          </div>
        ) : hydrated ? (
          <ol
            ref={list}
            aria-label="Message history"
            data-loaded={messages.length}
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((v) => {
              const row = rows[v.index]!
              return (
                <li
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0 flex flex-col pb-2"
                  style={{ transform: `translateY(${v.start - margin}px)` }}
                >
                  {row.kind === 'top' ? (
                    <Top
                      failed={isFetchNextPageError ? (error?.message ?? 'unknown error') : null}
                      more={hasNextPage}
                      loading={isFetchingNextPage}
                      onLoad={loadOlder}
                    />
                  ) : row.kind === 'day' ? (
                    <h3 className="flex justify-center py-1">
                      <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {dayLabel(row.iso)}
                      </span>
                    </h3>
                  ) : (
                    <Bubble
                      message={row.message}
                      highlighted={row.message.id === targetMessage}
                      open={open.has(row.message.id)}
                      onToggle={toggle}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        ) : (
          <ChatSkeleton />
        )}
        <div ref={setOutbox} className="flex flex-col" />
        {liveError && (
          <ErrorNote title="Couldn’t load new messages">{liveError} Trying again every few seconds.</ErrorNote>
        )}
        <p className="sr-only" aria-live="polite">
          {unseen > 0 ? `${plural(unseen, 'new message')} below` : ''}
        </p>
        {/* The composer stays on screen. */}
        <div className="sticky bottom-0 z-[3] bg-gradient-to-t from-background from-70% to-transparent pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {unseen > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-1">
              <Button
                size="sm"
                className="pointer-events-auto h-9 rounded-full shadow-md duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] animate-in fade-in-0 slide-in-from-bottom-2"
                onClick={jumpToLatest}
              >
                <ArrowDownIcon aria-hidden />
                {plural(unseen, 'new message')}
              </Button>
            </div>
          )}
          {composer}
        </div>
      </div>
    </OutboxContext.Provider>
  )
}

/** The top of the log: load older, loading, failed, or the very beginning. */
function Top({ failed, more, loading, onLoad }: { failed: string | null; more: boolean; loading: boolean; onLoad: () => void }) {
  return (
    <div className="flex min-h-14 items-center justify-center py-2">
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <span className="text-destructive">Couldn’t load older messages. {failed}</span>
          <Button variant="outline" size="sm" className="h-9" onClick={onLoad}>
            Try again
          </Button>
        </div>
      ) : more ? (
        <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" disabled={loading} onClick={onLoad}>
          {loading && <Spinner />}
          {loading ? 'Loading older messages…' : 'Load older messages'}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Start of this conversation</span>
      )}
    </div>
  )
}

function foldable(body: string): boolean {
  if (body.length > FOLD_CHARS) return true
  let lines = 1
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10 && ++lines > FOLD_LINES) return true
  return false
}

function Bubble({
  message: m,
  highlighted,
  open,
  onToggle,
}: {
  message: Message
  highlighted: boolean
  open: boolean
  onToggle: (id: number) => void
}) {
  const folds = foldable(m.body)
  const folded = folds && !open
  const bodyId = `message-body-${m.id}`
  return (
    <div
      id={`message-${m.id}`}
      data-message-id={m.id}
      data-highlight={highlighted || undefined}
      className={cn(
        // Combining marks and odd glyphs stay inside the bubble.
        'flex max-w-[min(72ch,92%)] min-w-0 flex-col gap-1.5 rounded-2xl px-3.5 py-2 text-[15px] [overflow:clip] [overflow-clip-margin:0.2em] sm:max-w-[min(72ch,85%)]',
        m.from_bot
          ? 'self-start rounded-bl-md border bg-card'
          : 'self-end rounded-br-md bg-accent text-accent-foreground',
        // File cards need room for their names, whatever the caption's length.
        m.attachments?.length > 0 && 'w-[min(24rem,100%)]',
      )}
    >
      {/* Virtualized: day headings off screen aren't in the page, so each
          message carries its own day for screen readers. */}
      <span className="sr-only">
        {m.from_bot ? 'Herbot' : 'You'}, {dayLabel(m.sent_at)} at {clock(m.sent_at)}:
      </span>
      {m.body.trim() && (
        <div
          id={bodyId}
          className={cn(
            'relative',
            folded &&
              'max-h-80 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent)]',
          )}
        >
          <RichMessage body={m.body} />
        </div>
      )}
      {folds && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(m.id)}
          className="relative flex w-fit items-center gap-1 text-sm font-medium text-foreground/80 before:absolute before:-inset-x-2 before:-inset-y-3 hover:text-foreground"
        >
          {open ? <ChevronUpIcon className="size-4" aria-hidden /> : <ChevronDownIcon className="size-4" aria-hidden />}
          {open ? 'Show less' : `Show full message (${m.body.length.toLocaleString('en-GB')} characters)`}
        </button>
      )}
      {m.attachments?.length > 0 && (
        <ul className="grid gap-1.5 pt-0.5">
          {m.attachments.map((f, i) => (
            <li key={`${f.path}-${i}`} className="min-w-0">
              <FilePreview file={f} className="bg-background/60" />
            </li>
          ))}
        </ul>
      )}
      <span className="flex items-center gap-1.5 self-end text-[11px] text-muted-foreground tabular-nums">
        {m.is_voice && (
          <>
            <MicIcon className="size-3" aria-hidden />
            <span className="sr-only">Voice note,</span>
          </>
        )}
        <time dateTime={m.sent_at} title={when(m.sent_at)}>
          {clock(m.sent_at)}
        </time>
      </span>
    </div>
  )
}

/** Shapes like the real log, so nothing jumps when it arrives. */
function ChatSkeleton() {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5']
  return (
    <div className="flex flex-col justify-end gap-2 py-3" aria-busy="true" aria-label="Loading messages">
      {widths.map((w, i) => (
        <Skeleton key={w} className={cn('h-14 rounded-2xl', w, i % 2 ? 'self-end' : 'self-start')} />
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
    let disposed = false
    let fetching = false
    async function refresh() {
      if (total === known.current || fetching) return
      fetching = true
      try {
        if (total < known.current || newestId === undefined) {
          await queryClient.resetQueries({ queryKey: keys.messages(topicId) })
        } else {
          const page = await getMessages({ data: { id: topicId, after: newestId, limit: 100 } })
          if (disposed) return
          if (page.has_more) {
            await queryClient.resetQueries({ queryKey: keys.messages(topicId) })
          } else {
            queryClient.setQueryData<InfiniteData<MessagePage, number | null>>(keys.messages(topicId), (old) => {
              if (!old || old.pages.length === 0) return old
              const [newest, ...older] = old.pages
              const have = new Set(old.pages.flatMap((p) => p.messages.map((m) => m.id)))
              const fresh = page.messages.filter((m) => !have.has(m.id))
              return { ...old, pages: [{ ...newest!, messages: [...newest!.messages, ...fresh] }, ...older] }
            })
          }
        }
        if (!disposed) {
          known.current = total
          setError(null)
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e))
      } finally {
        fetching = false
      }
    }
    void refresh()
    // A failed delta must retry even when the server's count hasn't changed.
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [topicId, total, newestId, queryClient])

  return error
}
