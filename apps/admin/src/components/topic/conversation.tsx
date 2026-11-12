// A topic's conversation (docs/design/DECISIONS.md: "Topic (chat home)",
// "Chat message", "Composer"). One scroll in the main pane, virtualized so
// 6,000 messages stay smooth. It opens at the newest message, pages older at
// the top without moving what you read, follows new replies while you're at
// the bottom (and counts them when you aren't), draws a "New" line where
// unread replies began, marks them read when you reach the bottom, jumps to
// ?message= from search, shows the agent working, and keeps sends that
// failed with Retry, Edit and Discard.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon } from 'lucide-react'
import { getMessages, sendMessage, type MessagePage, type Message as MessageData, type Topic } from '../../api'
import { dayKey, dayLabel } from '../../format'
import { activityQuery, keys, markReadMutation, messagesQuery } from '../../queries'
import { Composer, type Mode, type Outgoing } from '@/components/hb/composer'
import { Button } from '@/components/hb/controls'
import { ChatSkeleton, InPlaceEmpty, InPlaceError } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { measureNonZero } from '@/components/hb/rows'
import { cn } from '@/lib/utils'

type Row =
  | { kind: 'top'; key: 'top' }
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'new'; key: 'new'; count: number }
  | { kind: 'message'; key: number; message: MessageData; grouped: boolean }

type Failed = { key: string; text: string; files: File[]; mode: Mode; at: string; error: string; retrying: boolean }

/** Within this of the bottom counts as "at the bottom" (follow, mark read). */
const NEAR_BOTTOM = 96
/** Start loading older messages this far from the top. */
const NEAR_TOP = 600

/** Whether the agent is working on a reply here (batched activity poll). */
function useWorking(topicId: number): boolean {
  const activity = useQuery(activityQuery)
  return (activity.data ?? []).some((a) => a.conversation_id === topicId && a.in_progress)
}

export function Conversation({ topic, target, header }: {
  topic: Topic
  /** ?message= from search: page back to it, centre it, highlight it. */
  target?: number
  header: ReactNode
}) {
  const topicId = topic.id
  const client = useQueryClient()
  const query = useInfiniteQuery(messagesQuery(topicId))
  const working = useWorking(topicId)
  const workingSince = useRef(0)
  if (working && !workingSince.current) workingSince.current = Date.now()
  if (!working) workingSince.current = 0
  const markRead = useMutation(markReadMutation(client))

  const messages = useMemo(() => [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.messages), [query.data?.pages])
  const newestId = messages.at(-1)?.id
  const syncError = useNewMessages(topicId, topic.messages, newestId, query.isSuccess)

  // Unread when you opened the topic: the line stays put while you read,
  // even after the marker moves.
  const [unreadAtOpen, setUnreadAtOpen] = useState<number | null>(null)
  useEffect(() => {
    if (unreadAtOpen === null) setUnreadAtOpen(topic.unread)
  }, [topic.unread, unreadAtOpen])
  const firstUnreadId = useMemo(() => {
    if (!unreadAtOpen) return null
    const agent = messages.filter((m) => m.from_bot)
    return agent.length >= unreadAtOpen ? (agent[agent.length - unreadAtOpen]?.id ?? null) : (agent[0]?.id ?? null)
  }, [messages, unreadAtOpen])

  const rows = useMemo(() => {
    const out: Row[] = [{ kind: 'top', key: 'top' }]
    messages.forEach((m, i) => {
      const prev = messages[i - 1]
      const newDay = !prev || dayKey(m.sent_at) !== dayKey(prev.sent_at)
      // Keyed by the message, not the date: out-of-order history can repeat a day.
      if (newDay) out.push({ kind: 'day', key: `day-${m.id}`, iso: m.sent_at })
      if (m.id === firstUnreadId) out.push({ kind: 'new', key: 'new', count: unreadAtOpen ?? 0 })
      out.push({ kind: 'message', key: m.id, message: m, grouped: !newDay && !!prev && prev.from_bot === m.from_bot && m.id !== firstUnreadId })
    })
    return out
  }, [messages, firstUnreadId, unreadAtOpen])

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(!target)
  const anchor = useRef<{ key: Row['key']; offset: number } | null>(null)
  const [away, setAway] = useState(false)
  const [unseen, setUnseen] = useState(0)

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === 'message' ? 96 : 44),
    getItemKey: (i) => rows[i]!.key,
    measureElement: measureNonZero,
    overscan: 6,
    initialRect: { width: 720, height: 700 },
  })
  // Rows above you that grow keep what you're reading still; at the bottom
  // the resize observer below pins you instead.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _d, instance) => !atBottom.current && item.start < (instance.scrollOffset ?? 0)

  const toBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Pinned: stay at the bottom while rows are measured or grow.
  useEffect(() => {
    const el = scroller.current?.firstElementChild
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !anchor.current) toBottom()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [toBottom, query.isSuccess])

  // Older messages went in above: put what you were reading back.
  const firstId = messages[0]?.id
  useLayoutEffect(() => {
    const saved = anchor.current
    if (!saved || !scroller.current) return
    const index = rows.findIndex((r) => r.key === saved.key)
    const start = index >= 0 ? virtual.measurementsCache[index]?.start : undefined
    if (start !== undefined) scroller.current.scrollTop = start - saved.offset
    anchor.current = null
  }, [firstId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Newer messages: follow them at the bottom, otherwise count them.
  const lastSeen = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const previous = lastSeen.current
    lastSeen.current = newestId
    if (newestId === undefined || previous === undefined || newestId === previous) return
    if (atBottom.current) toBottom()
    else setUnseen((n) => n + messages.filter((m) => m.id > previous).length)
  }, [newestId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage || query.isFetchNextPageError || !scroller.current) return
    const top = scroller.current.scrollTop
    const first = virtual.getVirtualItems().find((v) => v.end > top && rows[v.index]?.kind === 'message')
    anchor.current = first ? { key: first.key as Row['key'], offset: first.start - top } : null
    void query.fetchNextPage()
  }, [query, virtual, rows])

  const read = useCallback(() => {
    if (!newestId || topic.unread === 0 || markRead.isPending) return
    markRead.mutate({ id: topicId, through_message_id: newestId })
  }, [newestId, topic.unread, topicId, markRead])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (fromBottom < NEAR_BOTTOM) {
      atBottom.current = true
      setUnseen(0)
      read()
    } else if (fromBottom > NEAR_BOTTOM * 2) atBottom.current = false
    setAway(fromBottom > 600)
    if (el.scrollTop < NEAR_TOP && !jumping.current) loadOlder()
  }

  // Everything loaded fits on screen: there's no scroll to page older.
  useEffect(() => {
    const el = scroller.current
    if (el && query.isSuccess && !target && el.scrollHeight <= el.clientHeight + 4) loadOlder()
  }, [query.isSuccess, firstId, loadOlder, target])

  // Opening at the end counts as read.
  useEffect(() => {
    if (query.isSuccess && atBottom.current) read()
  }, [query.isSuccess, read])

  // Arriving from search (?message=): page back until it's loaded, centre
  // it, then put its top just under the header once rows have measured.
  const jumping = useRef(Boolean(target))
  const jumpedTo = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!target || !query.isSuccess || jumpedTo.current === target) return
    const index = rows.findIndex((r) => r.kind === 'message' && r.message.id === target)
    if (index < 0) {
      if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage()
      else if (!query.hasNextPage || query.isFetchNextPageError) jumping.current = false
      return
    }
    jumpedTo.current = target
    atBottom.current = false
    virtual.scrollToIndex(index, { align: 'center' })
    const settle = setTimeout(() => {
      const el = document.getElementById(`message-${target}`)
      const box = scroller.current
      if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 24
      jumping.current = false
    }, 300)
    return () => clearTimeout(settle)
  }, [target, query.isSuccess, rows, query.hasNextPage, query.isFetchingNextPage, query.isFetchNextPageError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sending.
  const [failed, setFailed] = useState<Failed[]>([])
  const [restore, setRestore] = useState<{ text: string; key: number } | undefined>(undefined)
  const [sending, setSending] = useState(false)

  async function deliver(o: { text: string; files: File[]; mode: Mode }, key: string) {
    const form = new FormData()
    form.set('id', String(topicId))
    form.set('idempotencyKey', key)
    form.set('text', o.text)
    if (o.mode !== 'auto') form.set('style', o.mode)
    o.files.forEach((f) => form.append('files', f))
    await sendMessage({ data: form })
    await client.invalidateQueries({ queryKey: keys.topic(topicId) })
  }

  async function send(o: Outgoing) {
    const key = crypto.randomUUID()
    setSending(true)
    atBottom.current = true
    try {
      await deliver(o, key)
    } catch (e) {
      setFailed((all) => [...all, { key, ...o, at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e), retrying: false }])
    } finally {
      setSending(false)
      requestAnimationFrame(toBottom)
    }
  }

  async function retry(f: Failed) {
    setFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: true } : x)))
    try {
      // The same key: if the first try did arrive, the server sends it once.
      await deliver(f, f.key)
      setFailed((all) => all.filter((x) => x.key !== f.key))
    } catch (e) {
      setFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: false, error: e instanceof Error ? e.message : String(e) } : x)))
    }
  }

  const items = virtual.getVirtualItems()
  const disabledReason = !topic.enabled ? 'This topic is switched off. Switch it on in its details to send.' : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-6">
            {query.isPending ? (
              <div className="py-6">
                <ChatSkeleton />
              </div>
            ) : query.error && messages.length === 0 ? (
              <InPlaceError title="Couldn’t load this conversation" error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
            ) : messages.length === 0 && failed.length === 0 ? (
              <InPlaceEmpty title="No messages yet">
                {!topic.enabled
                  ? 'This topic is switched off, so it isn’t answering.'
                  : topic.setup_state === 'ready'
                    ? 'Say what you need. The agent answers here and in Telegram.'
                    : 'It doesn’t have a purpose yet: your first message here becomes it.'}
              </InPlaceEmpty>
            ) : (
              <ol aria-label="Messages" className="relative w-full" style={{ height: virtual.getTotalSize() }}>
                {items.map((item) => {
                  const row = rows[item.index]!
                  return (
                    <li
                      key={item.key}
                      data-index={item.index}
                      ref={virtual.measureElement}
                      className="absolute inset-x-0 top-0 list-none"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      <RowView row={row} target={target} hasOlder={!!query.hasNextPage} loadingOlder={query.isFetchingNextPage} olderError={query.isFetchNextPageError} onOlder={loadOlder} />
                    </li>
                  )
                })}
              </ol>
            )}
            {(failed.length > 0 || working) && (
              <ol aria-label="Sending" className="flex flex-col pb-2">
                {failed.map((f) => (
                  <MessageRow key={f.key} side="you">
                    <FailedMessage
                      body={f.text || `${f.files.length} ${f.files.length === 1 ? 'file' : 'files'}`}
                      error={f.error}
                      sentAt={f.at}
                      retrying={f.retrying}
                      onRetry={() => void retry(f)}
                      onEdit={() => {
                        setRestore({ text: f.text, key: Date.now() })
                        setFailed((all) => all.filter((x) => x.key !== f.key))
                      }}
                      onDiscard={() => setFailed((all) => all.filter((x) => x.key !== f.key))}
                    />
                  </MessageRow>
                ))}
                {working && (
                  <MessageRow side="agent">
                    <Thinking since={workingSince.current || Date.now()} label="Working" />
                  </MessageRow>
                )}
              </ol>
            )}
            {syncError && messages.length > 0 && (
              <p role="status" className="pb-2 text-center text-[12.5px] text-mute">
                Couldn’t check for new messages ({syncError}). Retrying…
              </p>
            )}
            <div className="h-4" />
          </div>
        </div>
        {(away || unseen > 0) && (
          <button
            type="button"
            onClick={() => {
              atBottom.current = true
              setUnseen(0)
              toBottom()
            }}
            className={cn(
              'absolute right-4 bottom-3 flex h-11 items-center justify-center gap-1.5 rounded-full bg-pane text-ink shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96]',
              unseen > 0 ? 'px-4 text-[13px] font-medium' : 'w-11',
            )}
            aria-label={unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}: jump to the latest` : 'Jump to the latest message'}
          >
            <ArrowDownIcon className="size-4" aria-hidden />
            {unseen > 0 && <span className="tabular-nums">{unseen > 99 ? '99+' : unseen} new</span>}
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <Composer sending={sending} disabledReason={disabledReason} restore={restore} onSend={(o) => void send(o)} />
      </div>
    </div>
  )
}

function RowView({ row, target, hasOlder, loadingOlder, olderError, onOlder }: {
  row: Row
  target?: number
  hasOlder: boolean
  loadingOlder: boolean
  olderError: boolean
  onOlder: () => void
}) {
  if (row.kind === 'top') {
    return (
      <div className="flex min-h-11 items-center justify-center pt-4 text-[12.5px] text-faint">
        {loadingOlder ? (
          'Loading older messages…'
        ) : olderError ? (
          <Button size="sm" variant="ghost" onClick={onOlder}>
            Couldn’t load older messages. Try again
          </Button>
        ) : hasOlder ? (
          <Button size="sm" variant="ghost" onClick={onOlder}>
            Load older messages
          </Button>
        ) : (
          'The beginning of this conversation'
        )}
      </div>
    )
  }
  if (row.kind === 'day') {
    return (
      <div className="flex justify-center pt-5 pb-1">
        <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[11.5px] font-medium text-mute" suppressHydrationWarning>
          {dayLabel(row.iso)}
        </span>
      </div>
    )
  }
  if (row.kind === 'new') {
    return (
      <div role="separator" aria-label={`${row.count} new ${row.count === 1 ? 'reply' : 'replies'} below`} className="flex items-center gap-3 pt-5 pb-1 text-[11.5px] font-semibold text-accent-strong">
        <span className="h-px flex-1 bg-accent-strong/40" />
        New · {row.count >= 99 ? '99+' : row.count}
        <span className="h-px flex-1 bg-accent-strong/40" />
      </div>
    )
  }
  return (
    <div className={cn('flex min-w-0 flex-col', row.message.from_bot ? 'items-start' : 'items-end', row.grouped ? 'pt-1' : 'pt-4')}>
      <Message message={row.message} highlighted={row.message.id === target} />
    </div>
  )
}

/** When the topic's message count changes, fetch only what's new and append
 * it to the newest page; if messages went away (a clean slate), refetch from
 * the newest page. Returns the last sync error, if any. */
function useNewMessages(topicId: number, total: number, newestId: number | undefined, ready: boolean): string | null {
  const client = useQueryClient()
  const known = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (known.current === null) {
      known.current = total
      return
    }
    let disposed = false
    let fetching = false
    async function refresh() {
      if (total === known.current || fetching) return
      fetching = true
      try {
        if (known.current !== null && (total < known.current || newestId === undefined)) {
          await client.resetQueries({ queryKey: keys.messages(topicId) })
        } else {
          const page = await getMessages({ data: { id: topicId, after: newestId, limit: 100 } })
          if (disposed) return
          if (page.has_more) await client.resetQueries({ queryKey: keys.messages(topicId) })
          else
            client.setQueryData<InfiniteData<MessagePage, number | null>>(keys.messages(topicId), (old) => {
              if (!old || old.pages.length === 0) return old
              const [newest, ...older] = old.pages
              const have = new Set(old.pages.flatMap((p) => p.messages.map((m) => m.id)))
              const fresh = page.messages.filter((m) => !have.has(m.id))
              return fresh.length ? { ...old, pages: [{ ...newest!, messages: [...newest!.messages, ...fresh] }, ...older] } : old
            })
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
    // A failed sync retries even when the count hasn't changed again.
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [topicId, total, newestId, ready, client])

  return error
}
