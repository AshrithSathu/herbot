import { useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useBlocker } from '@tanstack/react-router'
import {
  BrushCleaningIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Trash2Icon,
} from 'lucide-react'
import { saveMode, saveVoice, savePurpose, setEnabled, wipeTopic, type Topic, type TopicDetail } from '../../../api'
import { PURPOSE_MAX, charCount, compact, plural, purposeProblem } from '../../../format'
import { keys, messagesQuery, topicQuery } from '../../../queries'
import { ChatLog } from '@/components/chat-log'
import { Composer } from '@/components/composer'
import { TopicFiles } from '@/components/topic-files'
import { UserText } from '@/components/user-text'
import { CopyButton, EmptyState, ErrorNote, StaleWarning, Time, TopicState, notify } from '../../../ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useModifierKey } from '@/hooks/use-client'
import { cn } from '@/lib/utils'

const TABS = ['chat', 'files', 'settings'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { chat: 'Chat', files: 'Files', settings: 'Settings' }

export const Route = createFileRoute('/_authed/topics/$id')({
  validateSearch: (s: Record<string, unknown>): { message?: number; tab?: Tab } => ({
    message: Number.isSafeInteger(Number(s.message)) && Number(s.message) > 0 ? Number(s.message) : undefined,
    tab: TABS.includes(s.tab as Tab) && s.tab !== 'chat' ? (s.tab as Tab) : undefined,
  }),
  params: {
    parse: ({ id }) => {
      const n = Number(id)
      if (!Number.isSafeInteger(n) || n <= 0) throw notFound()
      return { id: n }
    },
    stringify: ({ id }) => ({ id: String(id) }),
  },
  loader: async ({ context, params }) => {
    const [detail] = await Promise.all([
      context.queryClient.ensureQueryData(topicQuery(params.id)),
      context.queryClient.ensureInfiniteQueryData(messagesQuery(params.id)),
    ])
    return detail
  },
  staticData: {
    crumbParent: { label: 'Topics', to: '/topics' },
    crumb: (data) => (data as TopicDetail | undefined)?.conversation.name,
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.conversation.name.trim() || 'Topic'} · Herbot admin` }],
  }),
  component: TopicPage,
})

function TopicPage() {
  const { id } = Route.useParams()
  const { data: detail, error } = useSuspenseQuery(topicQuery(id))
  const t = detail.conversation
  const { message, tab = 'chat' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const setTab = (next: Tab) =>
    void navigate({ search: (s) => ({ ...s, tab: next === 'chat' ? undefined : next }), replace: true, resetScroll: false })

  return (
    <>
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">
          <UserText lines={2} as="span" className="block">
            {t.name}
          </UserText>
        </h1>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
          <TopicState topic={t} />
          <Dot />
          <UserText className="max-w-[min(36ch,100%)]" fallback="Untitled group">
            {t.group}
          </UserText>
          <Dot />
          <span className="tabular-nums" title={plural(t.messages, 'message')}>
            {compact(t.messages)} {t.messages === 1 ? 'message' : 'messages'}
          </span>
          <Dot />
          <span>
            active <Time iso={t.last_activity} relative />
          </span>
          {t.thread_link && (
            <>
              <Dot />
              <a
                href={t.thread_link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
              >
                Open in T3 <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            </>
          )}
        </div>
      </header>
      <StaleWarning error={error} />

      <Tabs value={tab} onChange={setTab} />

      {tab === 'chat' && (
        <div role="tabpanel" id="view-chat" aria-labelledby="tab-chat" className="-mt-8 flex min-w-0 flex-col">
          <ChatLog
            key={t.id}
            topicId={t.id}
            total={t.messages}
            targetMessage={message}
            composer={<Composer key={t.id} id={t.id} enabled={t.enabled} />}
          />
        </div>
      )}
      {tab === 'files' && (
        <div role="tabpanel" id="view-files" aria-labelledby="tab-files" className="min-w-0">
          <TopicFiles id={t.id} />
        </div>
      )}
      {tab === 'settings' && (
        <div key={t.id} role="tabpanel" id="view-settings" aria-labelledby="tab-settings" className="flex min-w-0 flex-col gap-10">
          <Behaviour topic={t} />
          <Purpose topic={t} />
          <AgentsMd detail={detail} />
          <CleanSlate topic={t} />
        </div>
      )}
    </>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  )
}

/** Underlined tabs pinned under the site header (56px), 52px tall; the chat
 * log's sticky day label sits right under them. Arrow keys move between them. */
function Tabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div className="sticky top-14 z-[4] -mx-4 bg-background px-4 md:-mx-8 md:px-8">
      <div role="tablist" aria-label="Topic views" className="flex h-[52px] items-end gap-1 border-b">
        {TABS.map((v, i) => (
          <button
            key={v}
            type="button"
            id={`tab-${v}`}
            role="tab"
            aria-selected={value === v}
            aria-controls={`view-${v}`}
            tabIndex={value === v ? 0 : -1}
            onClick={() => onChange(v)}
            onKeyDown={(e) => {
              const next =
                e.key === 'ArrowRight'
                  ? TABS[(i + 1) % TABS.length]
                  : e.key === 'ArrowLeft'
                    ? TABS[(i + TABS.length - 1) % TABS.length]
                    : e.key === 'Home'
                      ? TABS[0]
                      : e.key === 'End'
                        ? TABS[TABS.length - 1]
                        : undefined
              if (next) {
                e.preventDefault()
                onChange(next)
                document.getElementById(`tab-${next}`)?.focus()
              }
            }}
            className={cn(
              'relative -mb-px h-11 rounded-t-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
              value === v && 'text-foreground after:bg-foreground',
            )}
          >
            {TAB_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Writes a new Topic into both caches that show it. */
function useTopicCache(id: number) {
  const queryClient = useQueryClient()
  return {
    queryClient,
    patch(update: (t: Topic) => Topic) {
      queryClient.setQueryData<TopicDetail>(keys.topic(id), (old) =>
        old ? { ...old, conversation: update(old.conversation) } : old,
      )
      queryClient.setQueryData<Topic[]>(keys.topicList, (old) => old?.map((t) => (t.id === id ? update(t) : t)))
    },
    /** Refetch everything that might show this topic. */
    refresh() {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.topics }),
        queryClient.invalidateQueries({ queryKey: keys.overview }),
      ])
    },
  }
}

function SectionTitle({ id, children, description }: { id: string; children: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-base font-semibold tracking-tight">
        {children}
      </h2>
      {description && <p className="max-w-[65ch] text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** One setting: what it is on the left, its control on the right (under it on
 * a phone), and its own saving state and error. */
function SettingRow({
  title,
  description,
  htmlFor,
  control,
  status,
  stack = false,
}: {
  title: string
  description: ReactNode
  htmlFor: string
  control: ReactNode
  status?: ReactNode
  /** Put the control under the text on narrow screens (selects); switches stay beside it. */
  stack?: boolean
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
      <div className={cn('flex gap-x-6 gap-y-3', stack ? 'flex-col sm:flex-row sm:items-center' : 'items-center')}>
        <div className="min-w-0 flex-1">
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {title}
          </label>
          <p id={`${htmlFor}-help`} className="text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <div className={cn('flex shrink-0 items-center gap-2', stack && 'w-full sm:w-auto')}>{control}</div>
      </div>
      {status}
    </li>
  )
}

/** A native select, styled like the panel's inputs, 16px on touch screens. */
function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        className="h-10 w-full min-w-44 appearance-none rounded-lg border border-input bg-background pr-9 pl-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 pointer-coarse:h-11 sm:text-sm"
      />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function Saving({ label }: { label: string }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      {label}
    </span>
  )
}

function RowError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-destructive wrap-anywhere">{children}</p>
}

const MODES = [
  ['fast', 'Fast', 'quick answers'],
  ['auto', 'Auto', 'thinks as hard as needed'],
  ['expert', 'Expert', 'thinks carefully'],
  ['heavy', 'Heavy', 'several sub-agents'],
] as const

const VOICES = [
  ['alloy', 'Balanced'], ['ash', 'Grounded'], ['ballad', 'Expressive'],
  ['coral', 'Warm'], ['echo', 'Clear'], ['fable', 'Storytelling'],
  ['onyx', 'Deep'], ['nova', 'Bright'], ['sage', 'Calm'],
  ['shimmer', 'Gentle'], ['verse', 'Versatile'], ['marin', 'Conversational'], ['cedar', 'Steady'],
] as const

/** On/off, mode and voice: each flips at once and reports its own failure. */
function Behaviour({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)

  const toggling = useRef(false)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { id: topic.id, enabled } }),
    onMutate: async (enabled) => {
      await cache.queryClient.cancelQueries({ queryKey: keys.topics })
      const before = topic.enabled
      cache.patch((t) => ({ ...t, enabled }))
      return { before }
    },
    onError: (_e, _v, saved) => saved && cache.patch((t) => ({ ...t, enabled: saved.before })),
    onSuccess: (updated) => cache.patch(() => updated),
    onSettled: async () => {
      try {
        await cache.refresh()
      } finally {
        toggling.current = false
      }
    },
  })

  const mode = useMutation({
    mutationFn: (value: string) => saveMode({ data: { id: topic.id, mode: value } }),
    onMutate: (value) => {
      const before = topic.mode
      cache.patch((t) => ({ ...t, mode: value }))
      return { before }
    },
    onError: (_e, _v, saved) => saved && cache.patch((t) => ({ ...t, mode: saved.before })),
    onSettled: () => cache.refresh(),
  })

  const voiceLock = useRef(false)
  const voice = useMutation({
    mutationFn: (settings: { voice_replies: boolean; voice: string }) => saveVoice({ data: { id: topic.id, ...settings } }),
    onSuccess: (updated) => cache.patch(() => updated),
    onSettled: () => {
      voiceLock.current = false
      return cache.refresh()
    },
  })
  const setVoice = (settings: { voice_replies: boolean; voice: string }) => {
    if (voiceLock.current) return
    voiceLock.current = true
    voice.mutate(settings)
  }

  return (
    <section aria-labelledby="behaviour" className="flex flex-col gap-3">
      <SectionTitle id="behaviour">Behaviour</SectionTitle>
      <ul className="divide-y rounded-xl border bg-card">
        <SettingRow
          htmlFor="answering"
          title="Answer messages"
          description={
            topic.enabled
              ? 'On. Your messages in this topic go to its agent.'
              : 'Off. Herbot stores nothing here and stays silent.'
          }
          control={
            <>
              {toggle.isPending && <Spinner className="size-3.5 text-muted-foreground" />}
              <Switch
                className="relative before:absolute before:-inset-x-2 before:-inset-y-3"
                id="answering"
                aria-describedby="answering-help"
                checked={topic.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(on) => {
                  if (toggling.current) return
                  toggling.current = true
                  toggle.mutate(on)
                }}
              />
            </>
          }
          status={
            toggle.isError && (
              <RowError>
                Couldn’t turn it {toggle.variables ? 'on' : 'off'}. {toggle.error.message}
              </RowError>
            )
          }
        />
        <SettingRow
          stack
          htmlFor="default-mode"
          title="Default mode"
          description="How hard the agent thinks when a message doesn’t pick a mode."
          control={
            <Select
              id="default-mode"
              aria-describedby="default-mode-help"
              value={topic.mode}
              disabled={mode.isPending}
              onChange={(e) => mode.mutate(e.target.value)}
              className="w-full sm:w-56"
            >
              {MODES.map(([value, label, hint]) => (
                <option key={value} value={value}>
                  {label} · {hint}
                </option>
              ))}
            </Select>
          }
          status={
            mode.isPending ? (
              <Saving label="Saving mode…" />
            ) : (
              mode.isError && <RowError>Couldn’t change the mode. {mode.error.message}</RowError>
            )
          }
        />
        <SettingRow
          htmlFor="voice-replies"
          title="Spoken replies"
          description="Read each reply aloud with an AI-generated voice, after the text arrives."
          control={
            <>
              {voice.isPending && voice.variables?.voice_replies !== topic.voice_replies && (
                <Spinner className="size-3.5 text-muted-foreground" />
              )}
              <Switch
                className="relative before:absolute before:-inset-x-2 before:-inset-y-3"
                id="voice-replies"
                aria-describedby="voice-replies-help"
                checked={topic.voice_replies}
                disabled={voice.isPending}
                onCheckedChange={(voice_replies) => setVoice({ voice_replies, voice: topic.voice })}
              />
            </>
          }
        />
        <SettingRow
          stack
          htmlFor="voice-choice"
          title="Voice"
          description="Used for spoken replies, and by /speak when they’re off."
          control={
            <Select
              id="voice-choice"
              aria-describedby="voice-choice-help"
              value={topic.voice}
              disabled={voice.isPending}
              onChange={(e) => setVoice({ voice_replies: topic.voice_replies, voice: e.target.value })}
              className="w-full sm:w-56"
            >
              {VOICES.map(([name, description]) => (
                <option key={name} value={name}>
                  {name[0]!.toUpperCase() + name.slice(1)} · {description}
                </option>
              ))}
            </Select>
          }
          status={
            voice.isPending ? (
              <Saving label="Saving voice…" />
            ) : (
              voice.isError && <RowError>Couldn’t save the voice. {voice.error.message}</RowError>
            )
          }
        />
      </ul>
    </section>
  )
}

function Purpose({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const saved = topic.purpose ?? ''
  // null while you aren't editing, so a /setup from Telegram shows up live.
  const [draft, setDraft] = useState<string | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  const value = draft ?? saved
  const dirty = draft !== null && draft.trim() !== saved
  const problem = purposeProblem(value)
  const mod = useModifierKey()

  // Set synchronously, so a double click can't slip a second save in.
  const submitting = useRef(false)
  const save = useMutation({
    mutationFn: (purpose: string) => savePurpose({ data: { id: topic.id, purpose } }),
    onSettled: () => {
      submitting.current = false
    },
    onSuccess: async (updated) => {
      cache.patch(() => updated)
      setDraft(null)
      setShowProblem(false)
      notify('Purpose saved. AGENTS.md was rewritten.')
      await Promise.all([cache.refresh(), cache.queryClient.invalidateQueries({ queryKey: keys.topic(topic.id) })])
    },
  })

  function submit() {
    if (!dirty || submitting.current) return
    if (problem) {
      setShowProblem(true)
      return
    }
    submitting.current = true
    save.mutate(value.trim())
  }

  const count = charCount(value.trim())
  const invalid = showProblem && problem !== null

  // Leaving with unsaved changes asks first (in the app and on reload/close).
  const leaving = useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  return (
    <section aria-labelledby="purpose-title" className="flex flex-col gap-3">
      <SectionTitle
        id="purpose-title"
        description={
          <>
            What this agent is for. Saving rewrites its AGENTS.md, like <span className="font-mono">/setup</span> in
            Telegram; the agent rereads it on its next message.
          </>
        }
      >
        Purpose
      </SectionTitle>
      <form
        className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor="purpose" className="sr-only">
          Purpose
        </label>
        <textarea
          id="purpose"
          dir="auto"
          value={value}
          disabled={save.isPending}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'purpose-error' : undefined}
          placeholder="For example: Help me plan trips. Ask about dates and budget before suggesting anything."
          className={cn(
            'max-h-[60dvh] min-h-40 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-base leading-relaxed outline-none wrap-anywhere [field-sizing:content] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60 sm:text-[15px]',
            invalid && 'border-destructive focus-visible:ring-destructive/30',
          )}
          onChange={(e) => {
            setDraft(e.target.value)
            if (save.isError) save.reset()
          }}
          onBlur={() => dirty && setShowProblem(true)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="flex items-start justify-between gap-3">
          {invalid ? (
            <p id="purpose-error" className="text-sm text-destructive">
              {problem}
            </p>
          ) : (
            <span />
          )}
          <span className={cn('shrink-0 text-xs text-muted-foreground tabular-nums', count > PURPOSE_MAX && 'text-destructive')}>
            {count.toLocaleString('en-GB')} / {PURPOSE_MAX.toLocaleString('en-GB')}
          </span>
        </div>
        {save.isError && <ErrorNote title="Couldn’t save the purpose">{save.error.message}</ErrorNote>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="pointer-coarse:h-11" disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner />}
            {save.isPending ? 'Saving…' : 'Save purpose'}
          </Button>
          {dirty && !save.isPending && (
            <Button
              type="button"
              variant="ghost"
              className="pointer-coarse:h-11"
              onClick={() => {
                setDraft(null)
                setShowProblem(false)
              }}
            >
              Discard changes
            </Button>
          )}
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground pointer-fine:sm:flex">
            <KbdGroup>
              <Kbd>{mod}</Kbd>
              <Kbd>Enter</Kbd>
            </KbdGroup>
            saves
          </span>
        </div>
      </form>
      <AlertDialog open={leaving.status === 'blocked'} onOpenChange={(open) => !open && leaving.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your purpose changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You edited what this agent is for but didn’t save it. Leaving throws the edit away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus onClick={() => leaving.reset?.()}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => leaving.proceed?.()}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function AgentsMd({ detail }: { detail: TopicDetail }) {
  const [open, setOpen] = useState(false)
  const text = detail.agents_md
  const long = (text?.length ?? 0) > 2000
  return (
    <section aria-labelledby="agents-md" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle
          id="agents-md"
          description={
            detail.agents_md_path ? (
              <span dir="ltr" className="font-mono text-xs break-all">
                agents/{detail.agents_md_path}
              </span>
            ) : undefined
          }
        >
          AGENTS.md
        </SectionTitle>
        {text && <CopyButton text={text} label="Copy" />}
      </div>
      {text ? (
        <div className="overflow-hidden rounded-xl border bg-muted/40">
          <pre
            id="agents-md-text"
            tabIndex={0}
            aria-label="AGENTS.md contents"
            className={cn(
              'scroller overflow-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-anywhere',
              !open && long ? 'max-h-72' : 'max-h-[70dvh]',
            )}
          >
            {text}
          </pre>
          {long && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="agents-md-text"
              onClick={() => setOpen((o) => !o)}
              className="flex h-11 w-full items-center justify-center gap-1.5 border-t bg-card text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon className={cn('size-4 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
              {open ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>
      ) : (
        <EmptyState icon={FileTextIcon} title="Not written yet">
          It’s created when this topic gets its purpose.
        </EmptyState>
      )}
    </section>
  )
}

const WIPE = {
  new: {
    title: 'Wipe the chat',
    icon: BrushCleaningIcon,
    what: 'Deletes this topic’s T3 threads and stored messages. The purpose and AGENTS.md stay, so the next message starts a fresh thread with the same role.',
    confirm: 'Wipe the chat',
  },
  forget: {
    title: 'Forget everything',
    icon: Trash2Icon,
    what: 'Deletes this topic’s T3 threads, stored messages, purpose and AGENTS.md. The next message asks what it should be, like a brand-new topic.',
    confirm: 'Forget everything',
  },
} as const

function CleanSlate({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const wipe = useMutation({
    mutationFn: (kind: 'new' | 'forget') => wipeTopic({ data: { id: topic.id, kind } }),
    onSuccess: (result) => notify(result.message),
    onSettled: () =>
      Promise.all([
        cache.refresh(),
        cache.queryClient.resetQueries({ queryKey: keys.messages(topic.id) }),
        cache.queryClient.invalidateQueries({ queryKey: keys.topic(topic.id) }),
      ]),
  })

  return (
    <section aria-labelledby="clean-slate" className="mt-2 flex flex-col gap-3 border-t pt-10">
      <SectionTitle id="clean-slate" description="These can’t be undone. Each asks before it does anything.">
        Danger zone
      </SectionTitle>
      <ul className="divide-y divide-destructive/15 rounded-xl border border-destructive/30 bg-card">
        {(['new', 'forget'] as const).map((kind) => {
          const Icon = WIPE[kind].icon
          const busy = wipe.isPending && wipe.variables === kind
          return (
            <li key={kind} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
              <Icon className="hidden size-5 shrink-0 text-destructive sm:block" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {WIPE[kind].title}{' '}
                  <span className="font-mono text-xs font-normal text-muted-foreground">/{kind}</span>
                </p>
                <p className="max-w-[60ch] text-sm text-muted-foreground">{WIPE[kind].what}</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full shrink-0 border-destructive/40 text-destructive pointer-coarse:h-11 hover:bg-destructive-soft hover:text-destructive sm:w-auto"
                    disabled={wipe.isPending}
                    onClick={() => wipe.reset()}
                  >
                    {busy && <Spinner />}
                    {busy ? 'Working…' : `${WIPE[kind].title}…`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{WIPE[kind].title}?</AlertDialogTitle>
                    <UserText lines={2} as="p" className="text-sm font-medium">
                      {topic.name}
                    </UserText>
                    <AlertDialogDescription>{WIPE[kind].what} This can’t be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel autoFocus>Keep everything</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive)_86%,black)] dark:text-background"
                      onClick={() => wipe.mutate(kind)}
                    >
                      {WIPE[kind].confirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          )
        })}
      </ul>
      {wipe.isError && <ErrorNote title="Nothing was wiped">{wipe.error.message}</ErrorNote>}
    </section>
  )
}
