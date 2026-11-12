// A topic's conversation (docs/design/DECISIONS.md: "Topic (chat home)",
// "Chat message", "Composer"). One scroll in the main pane, virtualized so
// 6,000 messages stay smooth. Two sources feed it:
// - live (the default): the newest messages, paging older at the top
//   without moving what you read, following new replies while you're at the
//   bottom (and counting them when you aren't), a "New" line where unread
//   replies began, marked read when you reach the bottom;
// - a window around ?message= (a search hit): the messages either side of
//   it in one round trip, paging both ways from there, never walking back
//   from the newest one page at a time.
// Drafts (the composer's draftKey) and sends that failed (failed-sends.ts)
// are kept per topic, so switching agents or reloading loses nothing.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { infiniteQueryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, PowerIcon } from 'lucide-react'
import { getMessages, getMessagesAround, sendMessage, setEnabled, type MessagePage, type Message as MessageData, type Topic } from '../../api'
import { dayKey, dayLabel } from '../../format'
import { activityQuery, keys, markReadMutation, messagesQuery, overviewQuery } from '../../queries'
import { Composer, ComposerBlocked, type Mode, type Outgoing } from '@/components/hb/composer'
import { Button } from '@/components/hb/controls'
import { ChatSkeleton, InPlaceEmpty, InPlaceError, notify } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { topicModeLabel } from '@/components/hb/modes'
import { measureNonZero } from '@/components/hb/rows'
import { useTopicCache } from '@/components/topic/details'
import { filesFor, loadFailed, rememberFiles, saveFailed, type FailedSend } from '@/components/topic/failed-sends'
import { cn } from '@/lib/utils'

type Row =
  | { kind: 'top'; key: 'top' }
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'new'; key: 'new'; count: number }
  | { kind: 'message'; key: number; message: MessageData; grouped: boolean }
  | { kind: 'bottom'; key: 'bottom' }

type Failed = FailedSend & { retrying: boolean }

/** Within this of the bottom counts as "at the bottom" (follow, mark read). */
const NEAR_BOTTOM = 96
/** Start loading more this far from either end. */
const NEAR_EDGE = 600

/** Where you were reading, per topic (and search window), so switching to
 * Files and back (which remounts the conversation) puts you back. In memory
 * for the session; at the latest message nothing is kept. */
type Kept = { id: number; offset: number; tail: number }
const kept = new Map<string, Kept>()
/** Messages fetched on each side of a search hit. */
const AROUND = 40

/** A page of the window around a search hit, oldest first. */
type WindowPage = { messages: MessageData[]; olderMore: boolean; newerMore: boolean }
type Cursor = { around: number } | { before: number } | { after: number }

/** Why sending (and retrying a failed send) can't work while the bot is down. */
const TELEGRAM_OFF = 'Telegram is off: messages can’t be sent until the bot is running.'

/** The messages around one message, paging older (previous pages) and newer
 * (next pages) from there. The route prefetches it for a search hit. */
export function windowQuery(topicId: number, target: number) {
  return infiniteQueryOptions({
    queryKey: [...keys.messages(topicId), 'window', target],
    initialPageParam: { around: target } as Cursor,
    queryFn: async ({ pageParam }): Promise<WindowPage> => {
      if ('around' in pageParam) {
        // One round trip: the hit with messages either side of it.
        const w = await getMessagesAround({ data: { id: topicId, around: pageParam.around, limit: AROUND * 2 } })
        return { messages: w.messages, olderMore: w.has_more_before, newerMore: w.has_more_after }
      }
      if ('before' in pageParam) {
        const p = await getMessages({ data: { id: topicId, before: pageParam.before, limit: 50 } })
        return { messages: p.messages, olderMore: p.has_more, newerMore: true }
      }
      const p = await getMessages({ data: { id: topicId, after: pageParam.after, limit: 50 } })
      return { messages: p.messages, olderMore: true, newerMore: p.has_more }
    },
    getPreviousPageParam: (first) => (first.olderMore && first.messages[0] ? ({ before: first.messages[0].id } as Cursor) : undefined),
    getNextPageParam: (last) => (last.newerMore && last.messages.at(-1) ? ({ after: last.messages.at(-1)!.id } as Cursor) : undefined),
    staleTime: Infinity,
    gcTime: 60_000,
  })
}

/** Whether the agent is working on a reply here (batched activity poll). */
function useWorking(topicId: number, visible: boolean): boolean {
  const activity = useQuery({ ...activityQuery, refetchInterval: visible ? 2_000 : false })
  return (activity.data ?? []).some((a) => a.conversation_id === topicId && a.in_progress)
}

export function Conversation({ topic, target, header, visible = true, onLeaveTarget }: {
  topic: Topic
  /** ?message= from search: open a window around it and highlight it. */
  target?: number
  /** Rendered above the scroller (the page usually renders its own). */
  header?: ReactNode
  /** The pane is on screen (phones hide it behind the agents list). */
  visible?: boolean
  /** Back to the live end (clears ?message=). */
  onLeaveTarget: () => void
}) {
  const topicId = topic.id
  const client = useQueryClient()
  const windowed = Boolean(target)
  const live = useInfiniteQuery({ ...messagesQuery(topicId), enabled: !windowed })
  const around = useInfiniteQuery({ ...windowQuery(topicId, target ?? 0), enabled: windowed })
  const working = useWorking(topicId, visible)
  const workingSince = useRef(0)
  if (working && !workingSince.current) workingSince.current = Date.now()
  if (!working) workingSince.current = 0
  const markRead = useMutation(markReadMutation(client))

  const liveMessages = useMemo(() => [...(live.data?.pages ?? [])].reverse().flatMap((p) => p.messages), [live.data?.pages])
  const windowMessages = useMemo(() => (around.data?.pages ?? []).flatMap((p) => p.messages), [around.data?.pages])
  const messages = windowed ? windowMessages : liveMessages
  const liveNewestId = liveMessages.at(-1)?.id
  const syncError = useNewMessages(topicId, topic.messages, liveNewestId, !windowed && live.isSuccess && visible)

  const source = windowed ? around : live
  const pending = source.isPending
  const loadError = source.error
  const older = windowed
    ? { has: around.hasPreviousPage, busy: around.isFetchingPreviousPage, failed: around.isFetchPreviousPageError, fetch: () => around.fetchPreviousPage() }
    : { has: live.hasNextPage, busy: live.isFetchingNextPage, failed: live.isFetchNextPageError, fetch: () => live.fetchNextPage() }
  const newer = windowed
    ? { has: around.hasNextPage, busy: around.isFetchingNextPage, failed: around.isFetchNextPageError, fetch: () => around.fetchNextPage() }
    : null

  // Unread when you opened the topic: the line stays put while you read,
  // even after the marker moves. Only the live end has one.
  const [unreadAtOpen, setUnreadAtOpen] = useState<number | null>(null)
  useEffect(() => {
    if (unreadAtOpen === null) setUnreadAtOpen(topic.unread)
  }, [topic.unread, unreadAtOpen])
  const firstUnreadId = useMemo(() => {
    if (windowed || !unreadAtOpen) return null
    const agent = messages.filter((m) => m.from_bot)
    return agent.length >= unreadAtOpen ? (agent[agent.length - unreadAtOpen]?.id ?? null) : (agent[0]?.id ?? null)
  }, [messages, unreadAtOpen, windowed])

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
    if (windowed) out.push({ kind: 'bottom', key: 'bottom' })
    return out
  }, [messages, firstUnreadId, unreadAtOpen, windowed])

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(!target)
  // When you last scrolled yourself (wheel, touch, keys, scrollbar). Only
  // your own scrolling may unpin the conversation from the latest message;
  // programmatic scrolls (measuring rows, a jump, restoring) never do.
  const userScrolledAt = useRef(0)
  const markUserScroll = useCallback(() => {
    userScrolledAt.current = Date.now()
  }, [])
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
  }, [toBottom, live.isSuccess])

  // Opening a topic: at its latest message, before the first paint.
  const opened = useRef(false)
  const keptKey = `${topicId}:${target ?? 'live'}`
  const restoring = useRef<Kept | null>(kept.get(keptKey) ?? null)
  useLayoutEffect(() => {
    if (windowed || !live.isSuccess || opened.current) return
    opened.current = true
    if (restoring.current) {
      atBottom.current = false
      setAway(true)
      restoreTo(restoring.current)
      // React can unmount and remount effects (development, a cached
      // route): stop this restore and let the remount start it again.
      return () => {
        window.clearTimeout(settleTimer.current)
        opened.current = false
      }
    }
    atBottom.current = true
    toBottom()
  }, [windowed, live.isSuccess, toBottom]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Back from Files: the message you were reading at the same height. Rows
   * measure over a few frames, so check a few times (bounded). */
  function restoreTo(k: Kept) {
    const index = rowsRef.current.findIndex((r) => r.kind === 'message' && r.message.id === k.id)
    if (index < 0) {
      restoring.current = null
      atBottom.current = !windowed
      if (!windowed) toBottom()
      return
    }
    if (k.tail) {
      tailRef.current = k.tail
      setTail(k.tail)
    }
    // Like a search jump: scroll to the row until it's mounted, then hold
    // its height until it stays put for two checks (bounded, ~2.5 s).
    let tries = 0
    let steady = 0
    const step = () => {
      const box = scroller.current
      const el = document.getElementById(`message-${k.id}`)
      if (box && !el) {
        const offset = virtual.getOffsetForIndex(index, 'start')?.[0]
        if (offset !== undefined) box.scrollTop = offset - k.offset
        else virtual.scrollToIndex(index, { align: 'start' })
        steady = 0
      } else if (box && el) {
        // The saved offset is the row's (its <li>), not the bubble inside it.
        const row = el.closest('li') ?? el
        const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top - k.offset
        if (Math.abs(delta) <= 2) steady++
        else {
          box.scrollTop += delta
          steady = 0
        }
      }
      if (steady >= 2 || ++tries >= 40) restoring.current = null
      else settleTimer.current = window.setTimeout(step, 60)
    }
    settleTimer.current = window.setTimeout(step, 0)
  }

  // Back from a search hit to the live end: fresh newest page, at the bottom.
  const wasWindowed = useRef(windowed)
  useEffect(() => {
    if (wasWindowed.current && !windowed) {
      atBottom.current = true
      setAway(false)
      void client.resetQueries({ queryKey: keys.messages(topicId), exact: true }).then(() => requestAnimationFrame(toBottom))
    }
    if (windowed) atBottom.current = false
    wasWindowed.current = windowed
  }, [windowed, client, topicId, toBottom])

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

  // Newer messages at the live end: follow them at the bottom, otherwise count them.
  const lastSeen = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (windowed) return
    const previous = lastSeen.current
    lastSeen.current = liveNewestId
    if (liveNewestId === undefined || previous === undefined || liveNewestId === previous) return
    if (atBottom.current) toBottom()
    else setUnseen((n) => n + liveMessages.filter((m) => m.id > previous).length)
  }, [liveNewestId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Automatic edge loading stops after a failure; `retry` (the button) doesn't. */
  const loadOlder = useCallback((retry = false) => {
    if (!older.has || older.busy || (older.failed && !retry) || !scroller.current) return
    const top = scroller.current.scrollTop
    const first = virtual.getVirtualItems().find((v) => v.end > top && rows[v.index]?.kind === 'message')
    anchor.current = first ? { key: first.key as Row['key'], offset: first.start - top } : null
    void older.fetch()
  }, [older, virtual, rows])

  const loadNewer = useCallback((retry = false) => {
    if (!newer?.has || newer.busy || (newer.failed && !retry)) return
    void newer.fetch()
  }, [newer])

  const read = useCallback(() => {
    if (windowed || !liveNewestId || topic.unread === 0 || markRead.isPending) return
    markRead.mutate({ id: topicId, through_message_id: liveNewestId })
  }, [windowed, liveNewestId, topic.unread, topicId, markRead])

  // Arriving from search: bring the hit into view, then put its top just
  // under the header. Rows measure over several frames and can move it, so
  // keep scrolling to its index until it's mounted and has stayed aligned
  // (bounded); only then is the jump done and edge loading allowed.
  const jumping = useRef(windowed)
  const jumpedTo = useRef<number | undefined>(undefined)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [missing, setMissing] = useState(false)
  // A target near the end can't scroll to the top on its own: add just enough
  // space below the list for it to sit under the header. Only while targeted.
  const [tail, setTail] = useState(0)
  const tailRef = useRef(0)
  tailRef.current = tail
  useEffect(() => {
    if (!windowed) setTail(0)
  }, [windowed])
  const [flashId, setFlashId] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!target || !around.isSuccess || jumpedTo.current === target) return
    jumpedTo.current = target
    if (restoring.current) {
      // Back from Files to a search window: where you were, no new jump.
      jumping.current = false
      restoreTo(restoring.current)
      return
    }
    setFlashId(target)
    const indexOf = () => rowsRef.current.findIndex((r) => r.kind === 'message' && r.message.id === target)
    if (indexOf() < 0) {
      // Deleted since the search, or in another topic: show where it was.
      setMissing(true)
      jumping.current = false
      return
    }
    setMissing(false)
    jumping.current = true
    let tries = 0
    let steady = 0
    const settle = () => {
      const box = scroller.current
      const index = indexOf()
      if (index < 0) {
        jumping.current = false
        return
      }
      const el = box ? document.getElementById(`message-${target}`) : null
      if (!box) {
        // The pane isn't mounted yet (a client-side navigation): try again.
        steady = 0
      } else if (!el) {
        // Scroll the box ourselves: the virtualizer may not have attached to
        // it yet, and then its scrollToIndex does nothing.
        const offset = virtual.getOffsetForIndex(index, 'start')?.[0]
        if (offset !== undefined) box.scrollTop = offset
        else virtual.scrollToIndex(index, { align: 'start' })
        steady = 0
      } else {
        const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top
        // Space the list needs below it for the target to reach 24 px.
        const want = box.scrollTop + top - 24
        const most = box.scrollHeight - tailRef.current - box.clientHeight
        const need = Math.max(0, Math.ceil(want - most))
        if (Math.abs(need - tailRef.current) > 2) {
          tailRef.current = need
          setTail(need)
          steady = 0
          settleTimer.current = window.setTimeout(settle, 30)
          return
        }
        const delta = top - 24
        if (Math.abs(delta) <= 2) steady++
        else {
          box.scrollTop += delta
          steady = 0
        }
      }
      // Done once it has held still for two checks, or after ~2.5 s.
      if (steady >= 2 || ++tries >= 40) jumping.current = false
      else settleTimer.current = window.setTimeout(settle, 60)
    }
    settleTimer.current = window.setTimeout(settle, 0)
  }, [target, around.isSuccess, rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const settleTimer = useRef<number | undefined>(undefined)
  // Unmounting stops a jump in progress and forgets it, so a remount (React
  // remounts effects in development, and a cached route can remount too)
  // starts it again instead of skipping it as done.
  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current)
      jumpedTo.current = undefined
    },
    [],
  )

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    // Putting you back where you were scrolls programmatically: those
    // scrolls must neither pin you to the bottom nor record a position.
    if (restoring.current) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    {
      const at = !windowed && fromBottom < NEAR_BOTTOM
      const top = el.scrollTop
      const first = at ? undefined : virtual.getVirtualItems().find((v) => v.end > top && rowsRef.current[v.index]?.kind === 'message')
      const row = first ? rowsRef.current[first.index] : undefined
      if (row?.kind === 'message') kept.set(keptKey, { id: row.message.id, offset: first!.start - top, tail: tailRef.current })
      else kept.delete(keptKey)
    }
    if (!windowed) {
      if (fromBottom < NEAR_BOTTOM) {
        atBottom.current = true
        setUnseen(0)
        read()
      } else if (fromBottom > NEAR_BOTTOM * 2 && Date.now() - userScrolledAt.current < 1000) atBottom.current = false
      setAway(fromBottom > 600)
    }
    if (jumping.current) return
    if (el.scrollTop < NEAR_EDGE) loadOlder()
    if (windowed && fromBottom < NEAR_EDGE) loadNewer()
  }

  // Everything loaded fits on screen: there's no scroll to page older.
  useEffect(() => {
    const el = scroller.current
    if (el && live.isSuccess && !windowed && el.scrollHeight <= el.clientHeight + 4) loadOlder()
  }, [live.isSuccess, firstId, loadOlder, windowed])

  // Opening at the end counts as read.
  useEffect(() => {
    if (live.isSuccess && atBottom.current) read()
  }, [live.isSuccess, read])

  // Sends that failed, kept per topic (sessionStorage; files in memory).
  const failedRef = useRef<Failed[]>([])
  const [failed, setFailedState] = useState<Failed[]>([])
  const updateFailed = useCallback(
    (next: (all: Failed[]) => Failed[]) => {
      const list = next(failedRef.current)
      failedRef.current = list
      setFailedState(list)
      saveFailed(topicId, list.map(({ retrying: _r, ...f }) => f))
    },
    [topicId],
  )
  useEffect(() => {
    const loaded = loadFailed(topicId).map((f) => ({ ...f, retrying: false }))
    failedRef.current = loaded
    setFailedState(loaded)
  }, [topicId])

  // Edit on a failed send puts the whole draft back (text, files, mode).
  const [restore, setRestore] = useState<{ text: string; files?: File[]; mode?: Mode; key: string | number } | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  // Telegram off (the overview the shell already polls): say so before you
  // try, not after. Typing and drafts still work; Send waits for the bot.
  const overview = useQuery(overviewQuery).data
  const telegramOff = overview !== undefined && !overview.bot

  async function deliver(o: { text: string; files: File[]; mode: Mode }, key: string) {
    const form = new FormData()
    form.set('id', String(topicId))
    form.set('idempotencyKey', key)
    form.set('text', o.text)
    // Auto means "the topic's own mode": send no style, so it applies.
    if (o.mode !== 'auto') form.set('style', o.mode)
    o.files.forEach((f) => form.append('files', f))
    await sendMessage({ data: form })
    await client.invalidateQueries({ queryKey: keys.topic(topicId) })
  }

  async function send(o: Outgoing) {
    const key = `${topicId}:${crypto.randomUUID()}`
    setSending(true)
    setNote(null)
    // What you just sent belongs at the live end.
    if (windowed) onLeaveTarget()
    atBottom.current = true
    try {
      await deliver(o, key)
    } catch (e) {
      rememberFiles(key, o.files)
      updateFailed((all) => [
        ...all,
        { key, text: o.text, mode: o.mode, fileNames: o.files.map((f) => f.name), at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e), retrying: false },
      ])
    } finally {
      setSending(false)
      requestAnimationFrame(toBottom)
    }
  }

  /** Back into the composer: text, mode and files (files only while this
   * session still has them; after a reload, say which to attach again). */
  function edit(f: Failed) {
    const files = filesFor(f.key)
    setRestore({ text: f.text, mode: f.mode, files, key: f.key })
    const lost = f.fileNames.length - files.length
    setNote(lost > 0 ? `Attach ${lost === 1 ? f.fileNames[0] : `${lost} files`} again: files don’t survive a reload.` : null)
    updateFailed((all) => all.filter((x) => x.key !== f.key))
  }

  /** Discard, with Undo for a while (the entry comes back where it was). */
  function discard(f: Failed) {
    const at = failedRef.current.findIndex((x) => x.key === f.key)
    // Removing the entry drops its in-memory files; keep them for the Undo window.
    const files = filesFor(f.key)
    updateFailed((all) => all.filter((x) => x.key !== f.key))
    notify('Unsent message discarded.', {
      run: () => {
        rememberFiles(f.key, files)
        updateFailed((all) => {
          if (all.some((x) => x.key === f.key)) return all
          const next = [...all]
          next.splice(Math.min(Math.max(at, 0), next.length), 0, { ...f, retrying: false })
          return next
        })
      },
    })
  }

  async function retry(f: Failed) {
    const files = filesFor(f.key)
    if (files.length < f.fileNames.length) {
      edit(f)
      return
    }
    updateFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: true } : x)))
    try {
      // The same key: if the first try did arrive, the server sends it once.
      await deliver({ text: f.text, files, mode: f.mode }, f.key)
      updateFailed((all) => all.filter((x) => x.key !== f.key))
    } catch (e) {
      updateFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: false, error: e instanceof Error ? e.message : String(e) } : x)))
    }
  }

  const items = virtual.getVirtualItems()
  const empty = !pending && !loadError && messages.length === 0 && failed.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
          onKeyDown={markUserScroll}
          onPointerDown={markUserScroll}
          data-hb-scroll
          className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <div className={cn('mx-auto w-full max-w-3xl px-3 sm:px-6', empty && 'flex min-h-full flex-col justify-center')}>
            {pending ? (
              <div className="py-6">
                {windowed && (
                  <p role="status" className="pb-4 text-center text-[13px] text-mute">
                    Jumping to the message…
                  </p>
                )}
                <ChatSkeleton />
              </div>
            ) : loadError && messages.length === 0 ? (
              <InPlaceError title="Couldn’t load this conversation" error={loadError} onRetry={() => void source.refetch()} retrying={source.isRefetching} />
            ) : empty ? (
              <InPlaceEmpty title="No messages yet">
                {!topic.enabled
                  ? 'This topic is switched off, so it isn’t answering.'
                  : telegramOff
                    ? topic.setup_state === 'ready'
                      ? 'Telegram is off. Once the bot is running, the agent answers what you send here.'
                      : 'It doesn’t have a purpose yet. Once the bot is running, your first message here becomes it.'
                    : topic.setup_state === 'ready'
                      ? 'Say what you need. The agent answers here and in Telegram.'
                      : 'It doesn’t have a purpose yet: your first message here becomes it.'}
              </InPlaceEmpty>
            ) : (
              <>
                {missing && (
                  <p role="status" className="pt-4 text-center text-[13px] text-mute">
                    That message isn’t in this topic any more. These are the ones around where it was.
                  </p>
                )}
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
                        <RowView row={row} target={flashId} older={older} newer={newer} onOlder={() => loadOlder(true)} onNewer={() => loadNewer(true)} onLatest={onLeaveTarget} />
                      </li>
                    )
                  })}
                </ol>
                {windowed && tail > 0 && <div aria-hidden style={{ height: tail }} />}
              </>
            )}
            {(failed.length > 0 || working) && (
              <ol aria-label="Sending" className="flex flex-col pb-2">
                {failed.map((f) => (
                  <MessageRow key={f.key} side="you">
                    <FailedMessage
                      body={f.text || `${f.fileNames.length} ${f.fileNames.length === 1 ? 'file' : 'files'}`}
                      error={f.error}
                      sentAt={f.at}
                      files={f.text ? f.fileNames.length : 0}
                      retryBlocked={telegramOff ? TELEGRAM_OFF : undefined}
                      retrying={f.retrying}
                      onRetry={() => void retry(f)}
                      onEdit={() => edit(f)}
                      onDiscard={() => discard(f)}
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
            {!empty && <div className="h-4" />}
          </div>
        </div>
        {(windowed ? !pending : away || unseen > 0) && (
          <button
            type="button"
            onClick={() => {
              if (windowed) {
                onLeaveTarget()
                return
              }
              atBottom.current = true
              setUnseen(0)
              toBottom()
            }}
            className={cn(
              'absolute right-4 bottom-3 flex h-11 items-center justify-center gap-1.5 rounded-full bg-pane text-ink shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96]',
              unseen > 0 || windowed ? 'px-4 text-[13px] font-medium' : 'w-11',
            )}
            aria-label={unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}: jump to the latest` : 'Jump to the latest message'}
          >
            <ArrowDownIcon className="size-4" aria-hidden />
            {unseen > 0 ? <span className="tabular-nums">{unseen > 99 ? '99+' : unseen} new</span> : windowed ? <span>Latest</span> : null}
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
        {note && topic.enabled && (
          <p role="status" className="px-2 pb-1.5 text-[12.5px] text-warning">
            {note}
          </p>
        )}
        <Composer
          sending={sending}
          restore={restore}
          draftKey={String(topicId)}
          // Auto sends no mode, so the topic's own applies: say which.
          defaultLabel={topic.mode === 'auto' ? undefined : topicModeLabel(topic.mode)}
          blocked={topic.enabled ? undefined : <SwitchedOff topic={topic} />}
          disabledReason={telegramOff ? TELEGRAM_OFF : undefined}
          onSend={(o) => void send(o)}
        />
      </div>
    </div>
  )
}

/** In place of the composer while a topic is off: say so, and switch it on. */
function SwitchedOff({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const on = useMutation({
    mutationFn: () => setEnabled({ data: { id: topic.id, enabled: true } }),
    onMutate: () => cache.patch({ enabled: true }),
    onError: () => cache.patch({ enabled: false }),
    onSettled: () => void cache.refresh(),
  })
  return (
    <ComposerBlocked
      action={
        <span className="flex items-center gap-2">
          {on.isError && <span className="text-[12.5px] text-destructive">Couldn’t switch it on. Try again.</span>}
          <Button size="sm" variant="secondary" pending={on.isPending} onClick={() => on.mutate()}>
            Switch on
          </Button>
        </span>
      }
    >
      <span className="flex items-center gap-2">
        <PowerIcon className="size-4 shrink-0" aria-hidden />
        Switched off: messages here are ignored.
      </span>
    </ComposerBlocked>
  )
}

type Pager = { has: boolean; busy: boolean; failed: boolean }

function RowView({ row, target, older, newer, onOlder, onNewer, onLatest }: {
  row: Row
  target?: number
  older: Pager
  newer: Pager | null
  onOlder: () => void
  onNewer: () => void
  onLatest: () => void
}) {
  if (row.kind === 'top') {
    return (
      <div className="flex min-h-11 items-center justify-center pt-4 text-[12.5px] text-faint">
        {older.busy ? (
          'Loading older messages…'
        ) : older.failed ? (
          <Button size="sm" variant="ghost" onClick={onOlder}>
            Couldn’t load older messages. Try again
          </Button>
        ) : older.has ? (
          <Button size="sm" variant="ghost" onClick={onOlder}>
            Load older messages
          </Button>
        ) : (
          'The beginning of this conversation'
        )}
      </div>
    )
  }
  if (row.kind === 'bottom') {
    return (
      <div className="flex min-h-11 items-center justify-center pt-3 text-[12.5px] text-faint">
        {newer?.busy ? (
          'Loading newer messages…'
        ) : newer?.failed ? (
          <Button size="sm" variant="ghost" onClick={onNewer}>
            Couldn’t load newer messages. Try again
          </Button>
        ) : newer?.has ? (
          <Button size="sm" variant="ghost" onClick={onNewer}>
            Load newer messages
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onLatest}>
            Back to the latest
          </Button>
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
          await client.resetQueries({ queryKey: keys.messages(topicId), exact: true })
        } else {
          const page = await getMessages({ data: { id: topicId, after: newestId, limit: 100 } })
          if (disposed) return
          if (page.has_more) await client.resetQueries({ queryKey: keys.messages(topicId), exact: true })
          else
            client.setQueryData<InfiniteData<MessagePage, number | null>>(keys.messages(topicId), (old) => {
              if (!old || old.pages.length === 0) return old
              const [newest, ...olderPages] = old.pages
              const have = new Set(old.pages.flatMap((p) => p.messages.map((m) => m.id)))
              const fresh = page.messages.filter((m) => !have.has(m.id))
              return fresh.length ? { ...old, pages: [{ ...newest!, messages: [...newest!.messages, ...fresh] }, ...olderPages] } : old
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
