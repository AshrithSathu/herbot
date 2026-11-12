// Shared parts of the /proto/page-topic variants: the frame, the agents pane,
// the conversation and the details body. The variants differ only in WHERE
// the details live (pane, drawer, header); everything here is identical so
// the comparison is fair. Throwaway: deleted with src/proto.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, PlusIcon } from 'lucide-react'
import { saveMode, savePurpose, sendMessage, type Message as MessageData, type Topic } from '../../../api'
import { ago, compact, dayKey, dayLabel, exact, purposeProblem } from '../../../format'
import { activityQuery, keys, markReadMutation, messagesQuery, overviewQuery, topicQuery, topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { Composer, type Mode, type Outgoing } from '@/components/hb/composer'
import { Button, Segmented, TextArea, type Choice } from '@/components/hb/controls'
import { DangerAction, DangerZone, DetailRow, DetailsSection } from '@/components/hb/details-pane'
import { ChatSkeleton, InPlaceEmpty, InPlaceError, notify, StatusStrip } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { AgentsHeader, BackToAgents, Shell, useShell } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export const DEFAULT_TOPIC = 2

/** The topic shown, kept in ?topic= so a reload (and the picker) keeps it. */
export function useTopicParam(): [number, (id: number) => void] {
  const [id, setId] = useState(DEFAULT_TOPIC)
  useLayoutEffect(() => {
    const v = Number(new URLSearchParams(location.search).get('topic'))
    if (Number.isSafeInteger(v) && v > 0) setId(v)
  }, [])
  const select = useCallback((next: number) => {
    setId(next)
    const url = new URL(location.href)
    url.searchParams.set('topic', String(next))
    history.replaceState(history.state, '', url)
  }, [])
  return [id, select]
}

export function useWorking(): Set<number> {
  const activity = useQuery(activityQuery)
  return useMemo(() => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)), [activity.data])
}

/** Covers the production shell while the prototype is judged, and lays out
 * the real kit Shell with the agents pane, strip and ⌘K. */
export function Frame({ topicId, onSelect, details, children }: {
  topicId: number
  onSelect: (id: number) => void
  details?: ReactNode
  children: ReactNode
}) {
  const topics = useQuery(topicsQuery)
  const overview = useQuery(overviewQuery)
  const working = useWorking()
  return (
    <div className="fixed inset-0 z-[45]">
      <Shell
        topics={topics.data}
        onSignOut={() => notify('Signing out is disabled in the prototype.')}
        actions={[{ id: 'new-agent', label: 'New agent', icon: PlusIcon, run: () => notify('New agent opens its dialog here.') }]}
        strip={
          overview.data && !overview.data.bot ? (
            <StatusStrip>
              <span className="md:hidden">Telegram is off: messages can’t send.</span>
              <span className="max-md:hidden">Telegram isn’t connected: agents can’t receive or send messages until the bot is running.</span>
            </StatusStrip>
          ) : undefined
        }
        agents={<AgentsPane topicId={topicId} onSelect={onSelect} working={working} />}
        details={details}
      >
        {children}
      </Shell>
    </div>
  )
}

/** The agents pane. Rows are links to /topics/$id; inside the prototype a
 * pick switches the conversation (and, on a phone, shows it) instead of
 * leaving the page. */
function AgentsPane({ topicId, onSelect, working }: { topicId: number; onSelect: (id: number) => void; working: Set<number> }) {
  const topics = useQuery(topicsQuery)
  const { showMain } = useShell()
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a[href^="/topics/"]')
        const id = a ? Number(a.getAttribute('href')!.split('/')[2]) : Number.NaN
        if (!Number.isSafeInteger(id)) return
        e.preventDefault()
        onSelect(id)
        showMain()
      }}
    >
      <AgentList
        topics={topics.data}
        pending={topics.isPending}
        error={topics.error}
        onRetry={() => topics.refetch()}
        activeId={topicId}
        isUnread={(t) => t.unread > 0}
        isWorking={(t) => working.has(t.id)}
        header={<AgentsHeader count={topics.data?.length} />}
      />
    </div>
  )
}

type Row =
  | { kind: 'top'; key: 'top' }
  | { kind: 'day'; key: string; iso: string }
  | { kind: 'new'; key: 'new'; count: number }
  | { kind: 'message'; key: number; message: MessageData; grouped: boolean }

type Failed = { key: string; text: string; files: File[]; mode: Mode; at: string; error: string; retrying: boolean }

const NEAR_BOTTOM = 96
const NEAR_TOP = 600

/** The conversation: one scroll in the main pane, virtualized; opens at the
 * newest message, pages older at the top without moving what you read,
 * draws a "New" line where unread replies begin, marks them read when you
 * reach the bottom, shows the agent working, and keeps sends that failed
 * with Retry, Edit and Discard. `header` sits above it (the variants'
 * difference); `below` is an optional slot under the header. */
export function Conversation({ topicId, header, below }: { topicId: number; header: ReactNode; below?: ReactNode }) {
  const client = useQueryClient()
  const detail = useQuery(topicQuery(topicId))
  const topic = detail.data?.conversation
  const query = useInfiniteQuery(messagesQuery(topicId))
  const working = useWorking().has(topicId)
  const workingSince = useRef(0)
  if (working && !workingSince.current) workingSince.current = Date.now()
  if (!working) workingSince.current = 0
  const markRead = useMutation(markReadMutation(client))

  const messages = useMemo(() => [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.messages), [query.data?.pages])

  // Unread at the moment you opened the topic: the line stays where it was
  // while you read, even after the marker moves.
  const [unreadAtOpen, setUnreadAtOpen] = useState<number | null>(null)
  useEffect(() => setUnreadAtOpen(null), [topicId])
  useEffect(() => {
    if (unreadAtOpen === null && topic) setUnreadAtOpen(topic.unread)
  }, [topic, unreadAtOpen])
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
      if (newDay) out.push({ kind: 'day', key: `day-${m.id}`, iso: m.sent_at })
      if (m.id === firstUnreadId) out.push({ kind: 'new', key: 'new', count: unreadAtOpen ?? 0 })
      out.push({ kind: 'message', key: m.id, message: m, grouped: !newDay && !!prev && prev.from_bot === m.from_bot && m.id !== firstUnreadId })
    })
    return out
  }, [messages, firstUnreadId, unreadAtOpen])

  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ key: Row['key']; offset: number } | null>(null)
  const [away, setAway] = useState(false)

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === 'message' ? 96 : 44),
    getItemKey: (i) => rows[i]!.key,
    overscan: 6,
    initialRect: { width: 720, height: 700 },
  })
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _d, instance) => !atBottom.current && item.start < (instance.scrollOffset ?? 0)

  const toBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // New topic: start pinned to its newest message.
  useLayoutEffect(() => {
    atBottom.current = true
    setAway(false)
    anchor.current = null
  }, [topicId])

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

  const loadOlder = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage || query.isFetchNextPageError || !scroller.current) return
    const top = scroller.current.scrollTop
    const first = virtual.getVirtualItems().find((v) => v.end > top && rows[v.index]?.kind === 'message')
    anchor.current = first ? { key: first.key as Row['key'], offset: first.start - top } : null
    void query.fetchNextPage()
  }, [query, virtual, rows])

  const lastId = messages.at(-1)?.id
  const read = useCallback(() => {
    if (!lastId || !topic || topic.unread === 0 || markRead.isPending) return
    markRead.mutate({ id: topicId, through_message_id: lastId })
  }, [lastId, topic, topicId, markRead])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (fromBottom < NEAR_BOTTOM) {
      atBottom.current = true
      read()
    } else if (fromBottom > NEAR_BOTTOM * 2) atBottom.current = false
    setAway(fromBottom > 600)
    if (el.scrollTop < NEAR_TOP) loadOlder()
  }

  // Everything loaded fits on screen: no scroll to page older.
  useEffect(() => {
    const el = scroller.current
    if (el && query.isSuccess && el.scrollHeight <= el.clientHeight + 4) loadOlder()
  }, [query.isSuccess, firstId, loadOlder])

  // Reaching the end on open also counts as read.
  useEffect(() => {
    if (query.isSuccess && atBottom.current) read()
  }, [query.isSuccess, read])

  const [failed, setFailed] = useState<Failed[]>([])
  const [draft, setDraft] = useState('')
  useEffect(() => setFailed([]), [topicId])
  const [sending, setSending] = useState(false)

  async function deliver(o: { text: string; files: File[]; mode: Mode }, key: string) {
    const form = new FormData()
    form.set('id', String(topicId))
    form.set('idempotencyKey', key)
    form.set('text', o.text)
    form.set('style', o.mode)
    o.files.forEach((f) => form.append('files', f))
    await sendMessage({ data: form })
    await client.invalidateQueries({ queryKey: keys.messages(topicId) })
  }

  async function send(o: Outgoing) {
    const key = crypto.randomUUID()
    setSending(true)
    try {
      await deliver(o, key)
      setDraft('')
    } catch (e) {
      setFailed((all) => [...all, { key, ...o, at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e), retrying: false }])
    } finally {
      setSending(false)
      atBottom.current = true
      requestAnimationFrame(toBottom)
    }
  }

  async function retry(f: Failed) {
    setFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: true } : x)))
    try {
      await deliver(f, f.key)
      setFailed((all) => all.filter((x) => x.key !== f.key))
    } catch (e) {
      setFailed((all) => all.map((x) => (x.key === f.key ? { ...x, retrying: false, error: e instanceof Error ? e.message : String(e) } : x)))
    }
  }

  const items = virtual.getVirtualItems()
  const disabledReason = topic && !topic.enabled ? 'This topic is switched off; switch it on to send.' : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {below}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-6">
            {query.isPending ? (
              <div className="py-6">
                <ChatSkeleton />
              </div>
            ) : query.error && messages.length === 0 ? (
              <InPlaceError title="Couldn’t load this conversation" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
            ) : messages.length === 0 && failed.length === 0 ? (
              <InPlaceEmpty title="No messages yet">
                Say what you need; the agent answers here and in Telegram.
              </InPlaceEmpty>
            ) : (
              <ol aria-label="Messages" className="relative w-full" style={{ height: virtual.getTotalSize() }}>
                {items.map((item) => {
                  const row = rows[item.index]!
                  return (
                    <li key={item.key} data-index={item.index} ref={virtual.measureElement} className="absolute inset-x-0 top-0 list-none" style={{ transform: `translateY(${item.start}px)` }}>
                      <RowView row={row} hasOlder={!!query.hasNextPage} loadingOlder={query.isFetchingNextPage} olderError={query.isFetchNextPageError} onOlder={loadOlder} />
                    </li>
                  )
                })}
              </ol>
            )}
            {(failed.length > 0 || working) && (
              <ol aria-label="Pending" className="flex flex-col pb-2">
                {failed.map((f) => (
                  <MessageRow key={f.key} side="you">
                    <FailedMessage
                      body={f.text || `${f.files.length} files`}
                      error={f.error}
                      sentAt={f.at}
                      retrying={f.retrying}
                      onRetry={() => void retry(f)}
                      onEdit={() => {
                        setDraft(f.text)
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
            <div className="h-4" />
          </div>
        </div>
        {away && (
          <button
            type="button"
            onClick={() => {
              atBottom.current = true
              toBottom()
            }}
            className="absolute right-4 bottom-3 grid size-11 place-items-center rounded-full bg-pane text-ink shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96]"
            aria-label="Jump to the latest message"
          >
            <ArrowDownIcon className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <Composer key={topicId} initialText={draft} sending={sending} disabledReason={disabledReason} onSend={(o) => void send(o)} />
      </div>
    </div>
  )
}

function RowView({ row, hasOlder, loadingOlder, olderError, onOlder }: { row: Row; hasOlder: boolean; loadingOlder: boolean; olderError: boolean; onOlder: () => void }) {
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
      <div role="separator" aria-label={`${row.count} new replies below`} className="flex items-center gap-3 pt-5 pb-1 text-[11.5px] font-semibold text-accent-strong">
        <span className="h-px flex-1 bg-accent-strong/40" />
        New{row.count >= 99 ? ' · 99+' : ` · ${row.count}`}
        <span className="h-px flex-1 bg-accent-strong/40" />
      </div>
    )
  }
  return (
    <div className={cn('flex min-w-0 flex-col', row.message.from_bot ? 'items-start' : 'items-end', row.grouped ? 'pt-1' : 'pt-4')}>
      <Message message={row.message} />
    </div>
  )
}

/** A topic's standing mode (server: fast/auto/expert/heavy). DeepSearch is
 * per message only, so it isn't offered here. */
type TopicMode = 'auto' | 'fast' | 'expert' | 'heavy'
export const TOPIC_MODES: Choice<TopicMode>[] = [
  { value: 'auto', label: 'Auto', hint: 'Thinks as hard as the question needs' },
  { value: 'fast', label: 'Fast', hint: 'Quick answers, light reasoning' },
  { value: 'expert', label: 'Think', hint: 'Thinks carefully before every answer' },
  { value: 'heavy', label: 'Heavy', hint: 'Several sub-agents in parallel' },
]
export const modeLabel = (mode: string) => TOPIC_MODES.find((m) => m.value === mode)?.label ?? mode

/** The details, as sections (no pane chrome): every variant wraps this. */
export function DetailsBody({ topic: t, compactFacts = false }: { topic: Topic; compactFacts?: boolean }) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: keys.topics })
  const mode = useMutation({ mutationFn: (m: TopicMode) => saveMode({ data: { id: t.id, mode: m } }), onSuccess: refresh })
  return (
    <>
      <DetailsSection>
        <DetailRow
          label="Purpose"
          block
          value={<UserText as="p" lines={3} fallback="No purpose yet">{t.purpose}</UserText>}
          edit={(done) => <PurposeEditor topic={t} onDone={done} />}
        />
      </DetailsSection>
      <DetailsSection title="Behaviour">
        <DetailRow
          label="Mode"
          value={
            <span className={cn(mode.isPending && 'text-faint')}>
              {modeLabel(mode.variables ?? t.mode)}
              {mode.isPending ? ' · saving…' : ''}
            </span>
          }
          edit={(done) => (
            <div className="flex flex-col gap-2">
              <Segmented
                label="Mode"
                value={(mode.variables ?? t.mode) as TopicMode}
                options={TOPIC_MODES}
                onValueChange={(v) => {
                  mode.mutate(v, { onSuccess: () => done(), onError: (e) => notify(`Couldn’t change the mode: ${e.message}`) })
                }}
              />
              <div>
                <Button size="sm" variant="ghost" onClick={done}>
                  Done
                </Button>
              </div>
            </div>
          )}
        />
        <DetailRow label="Spoken replies" value={t.voice_replies ? `On · ${t.voice}` : 'Off'} />
        <DetailRow label="Language" value={<UserText fallback="English">{t.language}</UserText>} />
        <DetailRow label="Private" value={t.private_mode ? 'On: nothing is stored' : 'Off'} />
      </DetailsSection>
      {!compactFacts && (
        <DetailsSection title="Activity">
          <DetailRow label="Messages" value={<span className="tabular-nums" title={exact(t.messages)}>{compact(t.messages)}</span>} />
          <DetailRow label="Last active" value={<span suppressHydrationWarning>{ago(t.last_activity)}</span>} />
          <DetailRow
            label="T3 thread"
            value={t.thread_link ? <a href={t.thread_link} className="text-accent-strong underline-offset-2 hover:underline">Open in T3</a> : 'Starts with the next message'}
          />
        </DetailsSection>
      )}
      <DangerZone>
        <DangerAction
          title="Start a clean slate"
          description="Deletes its history and threads; keeps the purpose."
          actionLabel="Start a clean slate"
          subject={t.name}
          consequences={['Deletes the message history in Herbot', 'Deletes its Codex threads in T3']}
          keeps="Keeps the purpose, tasks and the Telegram topic."
          guard={{ kind: 'separated' }}
          onConfirm={() => Promise.reject(new Error('E-0000: The prototype never deletes; the stress data stays.'))}
        />
        <DangerAction
          title="Forget this topic"
          description="Deletes everything, including the purpose and tasks."
          actionLabel="Forget this topic"
          subject={t.name}
          consequences={['Deletes the history, the threads and the purpose', 'Removes its tasks']}
          keeps="Keeps the Telegram topic and shared memories."
          guard={{ kind: 'typed', word: 'forget' }}
          onConfirm={() => Promise.reject(new Error('E-0000: The prototype never deletes; the stress data stays.'))}
        />
      </DangerZone>
    </>
  )
}

function PurposeEditor({ topic: t, onDone }: { topic: Topic; onDone: () => void }) {
  const client = useQueryClient()
  const [text, setText] = useState(t.purpose ?? '')
  const [touched, setTouched] = useState(false)
  const problem = purposeProblem(text)
  const save = useMutation({
    mutationFn: () => savePurpose({ data: { id: t.id, purpose: text.trim() } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.topics })
      notify('Purpose saved.')
      onDone()
    },
  })
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!problem) save.mutate()
      }}
    >
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setTouched(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
          if (e.key === 'Escape') onDone()
        }}
        rows={7}
        aria-label="Purpose"
        aria-invalid={touched && !!problem}
        dir="auto"
      />
      {touched && problem && <p className="text-[12.5px] text-destructive">{problem}</p>}
      {save.error && <p className="text-[12.5px] text-destructive">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" pending={save.isPending}>
          Save purpose
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** The conversation header's identity: back (phones), name, one status line. */
export function TitleBlock({ topic, facts }: { topic: Topic | undefined; facts?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <BackToAgents />
      <div className="flex min-w-0 flex-1 flex-col py-2">
        {topic ? <UserText className="text-[15px] font-semibold">{topic.name}</UserText> : <span className="h-5 w-40 rounded bg-sunken" />}
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-mute">
          {topic && <StatusDot status={topicTone(topic)} />}
          {facts}
        </div>
      </div>
    </div>
  )
}

export function useTopicDetail(id: number) {
  return useQuery(topicQuery(id)).data?.conversation
}
