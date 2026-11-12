// Throwaway showcase (emil-prototype Phase 7): every promoted component in
// components/hb on real stress data, so the page stage can see the kit.
// Deleted with the other prototypes; nothing in production links here.
import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { PlusIcon, SparklesIcon } from 'lucide-react'
import type { Memory, Topic } from '../../../api'
import { ago, charCount, compact, exact, PURPOSE_MAX } from '../../../format'
import { activityQuery, errorSearchQuery, memoriesQuery, messagesQuery, overviewQuery, topicQuery, topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { Composer, MODES, type Mode } from '@/components/hb/composer'
import { Button, Field, Segmented, SwitchRow, TextArea, TextInput, type Choice } from '@/components/hb/controls'
import { DangerAction, DangerZone, DetailRow, DetailsPane, DetailsSection } from '@/components/hb/details-pane'
import { ConfirmDialog, FormDialog } from '@/components/hb/dialogs'
import { ChatSkeleton, InPlaceEmpty, InPlaceError, ListSkeleton, notify, StatusStrip } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { LedgerTable, QuietAction, STRETCH, ThreadList, type Column } from '@/components/hb/rows'
import { AgentsHeader, BackToAgents, Shell, ShellPage, useShell } from '@/components/hb/shell'
import { BigNumber, StatusDot, taskTone, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'

export const Route = createFileRoute('/_authed/proto/kit')({
  staticData: { crumb: 'Kit' },
  head: () => ({ meta: [{ title: 'Kit · Herbot admin' }] }),
  component: Kit,
})

const DETAIL_TOPIC = 5

function Kit() {
  const topics = useQuery(topicsQuery)
  const activity = useQuery(activityQuery)
  const overview = useQuery(overviewQuery)
  const working = useMemo(() => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)), [activity.data])
  return (
    // Covers the current production shell while the kit is reviewed.
    <div className="fixed inset-0 z-[45]">
      <Shell
        topics={topics.data}
        onSignOut={() => notify('Signing out is disabled in the kit.')}
        actions={[{ id: 'new-agent', label: 'New agent', icon: PlusIcon, run: () => notify('New agent opens its dialog here.') }]}
        strip={
          overview.data && !overview.data.bot ? (
            <StatusStrip action={<Button size="sm" variant="ghost" asChild><a href="#kit-feedback">What this means</a></Button>}>
              Telegram isn’t connected: agents can’t receive or send messages until the bot is running.
            </StatusStrip>
          ) : undefined
        }
        agents={
          <AgentList
            topics={topics.data}
            pending={topics.isPending}
            error={topics.error}
            onRetry={() => topics.refetch()}
            activeId={2}
            isUnread={(t) => t.unread > 0}
            isWorking={(t) => working.has(t.id)}
            header={<KitAgentsHeader count={topics.data?.length} />}
          />
        }
        details={<KitDetails />}
      >
        <KitBody />
      </Shell>
    </div>
  )
}

function KitAgentsHeader({ count }: { count?: number }) {
  const { showMain } = useShell()
  return (
    <AgentsHeader
      count={count}
      action={
        <Button size="icon" variant="ghost" aria-label="New agent" onClick={() => { notify('New agent opens its dialog here.'); showMain() }}>
          <PlusIcon aria-hidden />
        </Button>
      }
    />
  )
}

type Section = 'figures' | 'controls' | 'rows' | 'feedback' | 'dialogs' | 'chat'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'figures', label: 'Figures & status' },
  { id: 'controls', label: 'Controls' },
  { id: 'rows', label: 'Rows' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'dialogs', label: 'Dialogs' },
  { id: 'chat', label: 'Chat' },
]

function KitBody() {
  const [section, setSection] = useState<Section>('figures')
  const { setDetailsOpen, detailsOpen } = useShell()
  const tabs = (
    <div role="tablist" aria-label="Kit sections" className="flex flex-wrap gap-1">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          role="tab"
          type="button"
          aria-selected={section === s.id}
          onClick={() => setSection(s.id)}
          className={`h-8 rounded-full px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out pointer-coarse:h-11 ${section === s.id ? 'bg-accent-soft text-accent-strong' : 'text-mute hover:bg-sunken hover:text-ink'}`}
        >
          {s.label}
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(!detailsOpen)}>
        {detailsOpen ? 'Hide details pane' : 'Show details pane'}
      </Button>
    </div>
  )
  if (section === 'chat') return <KitChat tabs={tabs} />
  return (
    <ShellPage title="Kit" description="Every promoted component on worst-case data. The page stage composes pages from these." back={<BackToAgents />} wide={section === 'rows'}>
      {tabs}
      {section === 'figures' && <Figures />}
      {section === 'controls' && <Controls />}
      {section === 'rows' && <Rows />}
      {section === 'feedback' && <Feedback />}
      {section === 'dialogs' && <Dialogs />}
    </ShellPage>
  )
}

function Figures() {
  const overview = useQuery(overviewQuery)
  const topics = useQuery(topicsQuery)
  const o = overview.data
  const sample = (topics.data ?? []).slice(0, 8)
  return (
    <>
      {o ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-5 md:grid-cols-4">
          <BigNumber label="Answering" value={o.enabled_conversations} of={o.conversations} />
          <BigNumber label="Threads" value={o.active_threads} />
          <BigNumber label="Messages" value={o.messages} />
          <BigNumber label="Errors · 24 h" value={o.errors_last_24h} alarm={o.errors_last_24h > 0} />
        </dl>
      ) : (
        <ListSkeleton rows={2} lines={1} />
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Status words</h2>
        <ul className="flex flex-col">
          {sample.map((t) => (
            <li key={t.id} className="flex min-h-11 items-center gap-4 border-b border-line">
              <UserText className="min-w-0 flex-1 text-[14px]">{t.name}</UserText>
              <StatusDot status={topicTone(t)} />
              <StatusDot status={topicTone(t)} dense className="w-24" />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-4">
          {['active', 'paused', 'done', 'cancelled'].map((s) => (
            <StatusDot key={s} status={taskTone(s)} />
          ))}
        </div>
      </section>
    </>
  )
}

const MODE_CHOICES: Choice<Mode>[] = MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))

function Controls() {
  const [mode, setMode] = useState<Mode>('auto')
  const [voice, setVoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('<script>alert("xss")</script><img src=x onerror=alert(1)>')
  const [touched, setTouched] = useState(false)
  const [purpose, setPurpose] = useState('Help me plan trips. '.repeat(380))
  const count = charCount(purpose)
  const nameError = touched && !name.trim() ? 'Give the agent a name.' : undefined
  return (
    <form className="flex max-w-xl flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
      <Field label="Name" error={nameError}>
        {(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} autoComplete="off" />}
      </Field>
      <Field label="Purpose" counter={{ count, max: PURPOSE_MAX }} error={count > PURPOSE_MAX ? `Keep it under ${exact(PURPOSE_MAX)} characters.` : undefined} hint="What this agent is for, in your words.">
        {(p) => <TextArea {...p} value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={5} />}
      </Field>
      <Segmented label="Default mode" value={mode} options={MODE_CHOICES} onValueChange={setMode} />
      <SwitchRow
        label="Spoken replies"
        description="Also send each reply as a voice note"
        checked={voice}
        pending={saving}
        onCheckedChange={(v) => {
          setSaving(true)
          setTimeout(() => {
            setVoice(v)
            setSaving(false)
          }, 900)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Save changes</Button>
        <Button>Discard</Button>
        <Button variant="ghost">Preview</Button>
        <Button variant="danger">Clean slate…</Button>
        <Button variant="primary" pending>
          Saving…
        </Button>
      </div>
    </form>
  )
}

function Rows() {
  const topics = useQuery(topicsQuery)
  const memories = useQuery(memoriesQuery)
  const [busy, setBusy] = useState<number | null>(null)
  const columns: Column<Topic>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(10rem,1.3fr)',
      phone: 'title',
      cell: (t) => (
        <Link to="/topics/$id" params={{ id: t.id }} className={`block min-w-0 font-medium outline-none focus-visible:underline ${STRETCH}`}>
          <UserText>{t.name}</UserText>
        </Link>
      ),
    },
    { id: 'purpose', header: 'Purpose', width: 'minmax(10rem,2fr)', phone: 'below', cell: (t) => <UserText className="text-mute" fallback="No purpose yet">{t.purpose}</UserText> },
    { id: 'messages', header: 'Messages', width: '6.5rem', numeric: true, phone: 'hide', cell: (t) => <span title={exact(t.messages)}>{compact(t.messages)}</span> },
    { id: 'active', header: 'Active', width: '6.5rem', phone: 'below', cell: (t) => <span className="text-mute" suppressHydrationWarning>{ago(t.last_activity)}</span> },
    { id: 'state', header: 'State', width: '8.5rem', phone: 'aside', cell: (t) => <StatusDot status={topicTone(t)} dense /> },
  ]
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">
          Topics <span className="text-mute tabular-nums">{exact(topics.data?.length ?? 0)}</span>
        </h2>
        {topics.isPending ? <ListSkeleton lines={1} /> : <LedgerTable label="Topics" rows={topics.data ?? []} columns={columns} rowKey={(t) => t.id} />}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">
          Memories <span className="text-mute tabular-nums">{exact(memories.data?.length ?? 0)}</span>
        </h2>
        <ThreadList<Memory>
          label="Memories"
          items={memories.data ?? []}
          itemKey={(m) => m.id}
          title={(m) => <UserText lines={3} as="p" className="font-normal">{m.content}</UserText>}
          meta={(m) => (
            <>
              <span className="tabular-nums">#{m.id}</span>
              <span aria-hidden>·</span>
              <span suppressHydrationWarning>updated {ago(m.updated_at)}</span>
            </>
          )}
          actions={(m) => (
            <>
              <QuietAction onClick={() => notify('Edit opens in place here.')}>Edit</QuietAction>
              <QuietAction
                tone="danger"
                pending={busy === m.id}
                onClick={() => {
                  setBusy(m.id)
                  setTimeout(() => {
                    setBusy(null)
                    notify('Memory forgotten.', { run: () => notify('Memory restored.') })
                  }, 700)
                }}
              >
                Forget…
              </QuietAction>
            </>
          )}
        />
      </section>
    </>
  )
}

function Feedback() {
  const errors = useInfiniteQuery(errorSearchQuery(''))
  const worst = (errors.data?.pages ?? []).flat().reduce<{ message: string; error_id: string } | null>((w, e) => (!w || e.message.length > w.message.length ? e : w), null)
  return (
    <section id="kit-feedback" className="flex flex-col gap-6">
      <InPlaceEmpty title="No tasks yet" action={<Button variant="primary"><PlusIcon aria-hidden />New task</Button>}>
        Ask any agent to remind you of something, or schedule a recurring prompt here.
      </InPlaceEmpty>
      <InPlaceEmpty title="No topic matches “zzqx”" action={<Button>Clear filter</Button>}>
        Names and purposes are searched, ignoring case and accents.
      </InPlaceEmpty>
      <InPlaceError title="Couldn’t load this conversation" error={worst ? `${worst.error_id}: ${worst.message}` : 'E-4005: Telegram is disabled'} onRetry={() => errors.refetch()} retrying={errors.isRefetching} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-pane shadow-[inset_0_0_0_var(--hair)_var(--line)]">
          <ListSkeleton rows={4} />
        </div>
        <div className="rounded-xl bg-canvas shadow-[inset_0_0_0_var(--hair)_var(--line)]">
          <ChatSkeleton />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => notify('Task paused.')}>Toast: success</Button>
        <Button onClick={() => notify('Memory forgotten.', { run: () => notify('Memory restored.') })}>Toast: with Undo</Button>
      </div>
    </section>
  )
}

function Dialogs() {
  const topics = useQuery(topicsQuery)
  const memories = useQuery(memoriesQuery)
  const hostile = topics.data?.find((t) => t.name.length >= 128) ?? topics.data?.[0]
  const longest = (memories.data ?? []).reduce<Memory | null>((w, m) => (!w || m.content.length > w.content.length ? m : w), null)
  const [open, setOpen] = useState<'forget' | 'memory' | 'new' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const fail = (message: string) => {
    setPending(true)
    setError(null)
    setTimeout(() => {
      setPending(false)
      setError(message)
    }, 900)
  }
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null)
      setError(null)
    }
  }
  return (
    <section className="flex flex-wrap gap-2">
      <Button variant="danger" onClick={() => setOpen('forget')}>Forget this topic…</Button>
      <Button variant="danger" onClick={() => setOpen('memory')}>Forget a memory…</Button>
      <Button variant="primary" onClick={() => setOpen('new')}><PlusIcon aria-hidden />New agent</Button>
      <ConfirmDialog
        open={open === 'forget'}
        onOpenChange={close}
        title="Forget this topic?"
        subject={hostile?.name}
        consequences={['Deletes its history, threads and purpose', 'Removes its tasks']}
        keeps="Keeps the Telegram topic and shared memories."
        actionLabel="Forget this topic"
        guard={{ kind: 'typed', word: 'forget' }}
        pending={pending}
        error={error}
        onConfirm={() => fail('E-4012: Telegram is disabled; the topic was not changed')}
      />
      <ConfirmDialog
        open={open === 'memory'}
        onOpenChange={close}
        title="Forget this memory?"
        subject={longest?.content}
        consequences={['Agents stop recalling it in every topic']}
        actionLabel="Forget memory"
        guard={{ kind: 'separated' }}
        pending={pending}
        error={error}
        onConfirm={() => {
          setOpen(null)
          notify('Memory forgotten.', { run: () => notify('Memory restored.') })
        }}
      />
      <FormDialog
        open={open === 'new'}
        onOpenChange={close}
        title="New agent"
        description="Creates a topic in the Herbot group with this purpose."
        submitLabel="Create agent"
        pendingLabel="Creating…"
        pending={pending}
        error={error}
        canSubmit={name.trim().length > 0 && purpose.trim().split(/\s+/).length >= 3}
        onSubmit={() => fail('E-4000: Telegram is disabled; chat and topic creation need the running bot')}
      >
        <Field label="Name">{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus={!matchMedia('(pointer: coarse)').matches} />}</Field>
        <Field label="Purpose" hint="At least three words, like “Help me plan trips”." counter={{ count: charCount(purpose), max: PURPOSE_MAX }}>
          {(p) => <TextArea {...p} value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={4} />}
        </Field>
      </FormDialog>
    </section>
  )
}

function KitChat({ tabs }: { tabs: React.ReactNode }) {
  const topic = useQuery(topicsQuery).data?.find((t) => t.id === 2)
  const messages = useInfiniteQuery(messagesQuery(2))
  const [failed, setFailed] = useState<{ id: number; text: string; at: string }[]>([])
  const [retrying, setRetrying] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const list = (messages.data?.pages ?? []).slice().reverse().flatMap((p) => p.messages).slice(-14)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
        <BackToAgents />
        <div className="flex min-w-0 flex-1 flex-col">
          <UserText className="text-[15px] font-semibold">{topic?.name}</UserText>
          {topic && <StatusDot status={topicTone(topic)} className="text-[12.5px]" />}
        </div>
      </header>
      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 sm:px-6">
          {tabs}
          {messages.isPending ? (
            <ChatSkeleton />
          ) : messages.error ? (
            <InPlaceError title="Couldn’t load this conversation" error={messages.error} onRetry={() => messages.refetch()} />
          ) : (
            <ol aria-label="Messages" className="flex flex-col">
              {list.map((m, i) => (
                <MessageRow key={m.id} side={m.from_bot ? 'agent' : 'you'} grouped={i > 0 && list[i - 1].from_bot === m.from_bot}>
                  <Message message={m} />
                </MessageRow>
              ))}
              {failed.map((f) => (
                <MessageRow key={f.id} side="you">
                  <FailedMessage
                    body={f.text}
                    sentAt={f.at}
                    error="E-4005: Telegram is disabled; chat and topic creation need the running bot"
                    retrying={retrying === f.id}
                    onRetry={() => {
                      setRetrying(f.id)
                      setTimeout(() => setRetrying(null), 1000)
                    }}
                    onEdit={() => {
                      setDraft(f.text)
                      setFailed((all) => all.filter((x) => x.id !== f.id))
                    }}
                    onDiscard={() => setFailed((all) => all.filter((x) => x.id !== f.id))}
                  />
                </MessageRow>
              ))}
              <MessageRow side="agent">
                <Thinking since={Date.now() - 42_000} />
              </MessageRow>
            </ol>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
        <Composer
          initialText={draft}
          onSend={(m) => setFailed((all) => [...all, { id: Date.now(), text: m.text || `${m.files.length} files`, at: new Date().toISOString() }])}
        />
      </div>
    </div>
  )
}

function KitDetails() {
  const { setDetailsOpen } = useShell()
  const detail = useQuery(topicQuery(DETAIL_TOPIC))
  const t = detail.data?.conversation
  const [mode, setMode] = useState<string | null>(null)
  if (!t) return <ListSkeleton rows={6} lines={1} className="px-4 pt-14" />
  const status = topicTone(t)
  return (
    <DetailsPane
      title={t.name}
      subtitle={
        <>
          <StatusDot status={status} />
          <span aria-hidden>·</span>
          <UserText className="min-w-0 flex-1">{t.group}</UserText>
        </>
      }
      onClose={() => setDetailsOpen(false)}
    >
      <DetailsSection>
        <DetailRow
          label="Purpose"
          block
          value={<UserText as="p" lines={3} fallback="No purpose yet">{t.purpose}</UserText>}
          edit={(done) => (
            <div className="flex flex-col gap-2">
              <TextArea defaultValue={t.purpose ?? ''} rows={6} aria-label="Purpose" />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => { done(); notify('Purpose saved.') }}>Save</Button>
                <Button size="sm" variant="ghost" onClick={done}>Cancel</Button>
              </div>
            </div>
          )}
        />
      </DetailsSection>
      <DetailsSection title="Behaviour">
        <DetailRow
          label="Mode"
          value={MODES.find((m) => m.id === (mode ?? t.mode))?.label ?? t.mode}
          edit={(done) => (
            <Segmented
              label="Mode"
              value={(mode ?? t.mode) as Mode}
              options={MODE_CHOICES}
              onValueChange={(v) => {
                setMode(v)
                done()
              }}
            />
          )}
        />
        <DetailRow label="Spoken replies" value={t.voice_replies ? `On · ${t.voice}` : 'Off'} />
        <DetailRow label="Language" value={<UserText fallback="Not reported">{t.language}</UserText>} />
        <DetailRow label="Private" value={t.private_mode ? 'On: nothing is stored' : 'Off'} />
      </DetailsSection>
      <DetailsSection title="Activity">
        <DetailRow label="Messages" value={<span className="tabular-nums" title={exact(t.messages)}>{compact(t.messages)}</span>} />
        <DetailRow label="Last active" value={<span suppressHydrationWarning>{ago(t.last_activity)}</span>} />
        <DetailRow label="T3 thread" value={t.thread_link ? <a href={t.thread_link} className="text-accent-strong underline-offset-2 hover:underline">Open in T3</a> : 'Starts with the next message'} />
      </DetailsSection>
      <DangerZone>
        <DangerAction
          title="Start a clean slate"
          description="Deletes its history and threads; keeps the purpose."
          actionLabel="Start a clean slate"
          subject={t.name}
          consequences={['Deletes the message history in Herbot', 'Deletes its Codex threads in T3']}
          keeps="Keeps the purpose, tasks and the Telegram topic."
          guard={{ kind: 'separated' }}
          onConfirm={() => Promise.reject(new Error('E-4011: Telegram is disabled; nothing was deleted'))}
        />
        <DangerAction
          title="Forget this topic"
          description="Deletes everything, including the purpose and tasks."
          actionLabel="Forget this topic"
          subject={t.name}
          consequences={['Deletes the history, the threads and the purpose', 'Removes its tasks']}
          keeps="Keeps the Telegram topic and shared memories."
          guard={{ kind: 'typed', word: 'forget' }}
          onConfirm={() => Promise.reject(new Error('E-4012: Telegram is disabled; nothing was deleted'))}
        />
      </DangerZone>
      <div className="px-4 pt-2">
        <Button variant="ghost" size="sm" onClick={() => notify('Spoken preview plays here.')}>
          <SparklesIcon aria-hidden />
          Preview the voice
        </Button>
      </div>
    </DetailsPane>
  )
}
