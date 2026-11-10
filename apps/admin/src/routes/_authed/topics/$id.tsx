import { Composer } from '../../../components/composer'
import { TopicFiles } from '../../../components/topic-files'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useBlocker } from '@tanstack/react-router'
import { BrushCleaningIcon, ExternalLinkIcon, FileTextIcon, Trash2Icon } from 'lucide-react'
import { saveMode, saveVoice, savePurpose, setEnabled, wipeTopic, type Topic, type TopicDetail } from '../../../api'
import { PURPOSE_MAX, charCount, plural, purposeProblem } from '../../../format'
import { keys, messagesQuery, topicQuery } from '../../../queries'
import { ChatLog } from '@/components/chat-log'
import {
  CopyButton,
  EmptyState,
  ErrorNote,
  PageHeader,
  Section,
  StaleWarning,
  Time,
  TopicState,
  notify,
} from '../../../ui'
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
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useModifierKey } from '@/hooks/use-client'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/topics/$id')({
  validateSearch: (s: Record<string, unknown>): { message?: number } => ({
    message: Number.isSafeInteger(Number(s.message)) && Number(s.message) > 0 ? Number(s.message) : undefined,
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
    crumb: (data) => (data as TopicDetail | undefined)?.conversation.place.split('›').pop()?.trim(),
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.conversation.place ?? 'Topic'} · Herbot admin` }],
  }),
  component: TopicPage,
})

function TopicPage() {
  const { id } = Route.useParams()
  const { data: detail, error } = useSuspenseQuery(topicQuery(id))
  const t = detail.conversation
  const { message } = Route.useSearch()
  const [tab, setTab] = useState<'chat' | 'files' | 'settings'>('chat')
  return (
    <>
      <PageHeader title={t.place}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <TopicState topic={t} />
          <span className="tabular-nums">{plural(t.messages, 'message')}</span>
          <span>
            last active <Time iso={t.last_activity} relative />
          </span>
          {t.thread_link && (
            <Button variant="link" size="sm" asChild>
              <a href={t.thread_link} target="_blank" rel="noreferrer">
                Open its thread in T3 <ExternalLinkIcon aria-hidden />
              </a>
            </Button>
          )}
        </div>
      </PageHeader>
      <StaleWarning error={error} />

      <div role="tablist" aria-label="Topic views" className="flex gap-1 border-b">
        {(['chat', 'files', 'settings'] as const).map((v) => (
          <Button
            key={v}
            id={`tab-${v}`}
            role="tab"
            tabIndex={tab === v ? 0 : -1}
            onKeyDown={(e) => {
              const views = ['chat', 'files', 'settings'] as const
              const index = views.indexOf(v)
              const next =
                e.key === 'ArrowRight'
                  ? views[(index + 1) % 3]
                  : e.key === 'ArrowLeft'
                    ? views[(index + 2) % 3]
                    : e.key === 'Home'
                      ? views[0]
                      : e.key === 'End'
                        ? views[2]
                        : undefined
              if (next) {
                e.preventDefault()
                setTab(next)
                document.getElementById(`tab-${next}`)?.focus()
              }
            }}
            aria-selected={tab === v}
            aria-controls={`view-${v}`}
            variant={tab === v ? 'secondary' : 'ghost'}
            className="min-h-11 capitalize"
            onClick={() => setTab(v)}
          >
            {v}
          </Button>
        ))}
      </div>
      <div hidden={tab !== 'chat'}>
        <div role="tabpanel" id="view-chat" aria-labelledby="tab-chat" className="flex min-w-0 flex-col gap-3">
          <ChatLog key={t.id} topicId={t.id} total={t.messages} targetMessage={message} />
          <Composer key={t.id} id={t.id} enabled={t.enabled} />
        </div>
      </div>
      {tab === 'files' && (
        <div role="tabpanel" id="view-files" aria-labelledby="tab-files">
          <TopicFiles id={t.id} />
        </div>
      )}
      <div hidden={tab !== 'settings'}>
        <div key={t.id} role="tabpanel" id="view-settings" aria-labelledby="tab-settings" className="flex flex-col gap-8">
          <Answering topic={t} />
          <Purpose key={t.id} topic={t} />
          <Voice topic={t} />

          <Section
            id="agents-md"
            title="AGENTS.md"
            action={detail.agents_md && <CopyButton text={detail.agents_md} label="Copy" />}
          >
            {detail.agents_md ? (
              <>
                <pre
                  tabIndex={0}
                  aria-label="AGENTS.md contents"
                  className="scroller max-h-[28rem] overflow-auto rounded-xl border bg-muted/50 px-4 py-3.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap"
                >
                  {detail.agents_md}
                </pre>
                {detail.agents_md_path && (
                  <p className="font-mono text-xs text-muted-foreground">agents/{detail.agents_md_path}</p>
                )}
              </>
            ) : (
              <EmptyState icon={FileTextIcon} title="Not written yet">
                It’s created when this topic gets its purpose.
              </EmptyState>
            )}
          </Section>

          <CleanSlate topic={t} />
        </div>
      </div>
    </>
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
        queryClient.invalidateQueries({ queryKey: keys.messages(id) }),
      ])
    },
  }
}

/** shadcn's switch choice card: the whole card is the label. Flips at once,
 * and flips back if herbot-core refuses. */
function Answering({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const mode = useMutation({
    mutationFn: (value: string) => saveMode({ data: { id: topic.id, mode: value } }),
    onSuccess: () => cache.refresh(),
  })
  const toggling = useRef(false)
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { id: topic.id, enabled } }),
    onMutate: async (enabled) => {
      await cache.queryClient.cancelQueries({ queryKey: keys.topics })
      const before = topic.enabled
      cache.patch((t) => ({ ...t, enabled }))
      return { before }
    },
    onError: (_error, _enabled, saved) => {
      if (saved) cache.patch((t) => ({ ...t, enabled: saved.before }))
    },
    onSuccess: (updated) => cache.patch(() => updated),
    onSettled: async () => {
      try { await cache.refresh() } finally { toggling.current = false }
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
        Default mode
        <select
          aria-label="Default mode"
          value={topic.mode}
          disabled={mode.isPending}
          onChange={(e) => mode.mutate(e.target.value)}
          className="min-h-11 rounded-lg border bg-card px-3"
        >
          {['fast', 'auto', 'expert', 'heavy'].map((m) => (
            <option key={m} value={m}>
              {m[0]!.toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {mode.isError && <ErrorNote title="Couldn’t change mode">{mode.error.message}</ErrorNote>}
      <FieldLabel htmlFor="answering" className="bg-card shadow-xs">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle id="answering-title">Answer messages here</FieldTitle>
            <FieldDescription id="answering-help">
              {topic.enabled
                ? 'On. Your messages in this topic go to its agent.'
                : 'Off. Herbot stores nothing here and stays silent.'}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="answering"
            aria-labelledby="answering-title"
            aria-describedby="answering-help"
            checked={topic.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(on) => {
              if (toggling.current) return
              toggling.current = true
              toggle.mutate(on)
            }}
          />
        </Field>
      </FieldLabel>
      {toggle.isError && (
        <ErrorNote title={`Couldn’t turn it ${toggle.variables ? 'on' : 'off'}`}>{toggle.error.message}</ErrorNote>
      )}
    </div>
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

  // Set synchronously, so a double click can't slip a second save in before
  // React re-renders with isPending.
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
      await cache.refresh() // AGENTS.md changed too
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
  const mod = useModifierKey()

  // Leaving with unsaved changes asks first (in the app and on reload/close).
  const leaving = useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  return (
    <Section id="purpose-title" title="Purpose">
      <Card className="py-5 shadow-xs">
        <CardContent className="px-5">
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="purpose">What this agent is for</FieldLabel>
              <FieldDescription id="purpose-help">
                Saving rewrites its AGENTS.md, same as <span className="font-mono">/setup</span> in Telegram. The thread
                rereads it on the next message.
              </FieldDescription>
              <Textarea
                id="purpose"
                disabled={save.isPending}
                value={value}
                className="field-sizing-fixed max-h-[60dvh] min-h-40 resize-y leading-relaxed wrap-anywhere"
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? 'purpose-help purpose-error' : 'purpose-help'}
                onChange={(e) => {
                  setDraft(e.target.value)
                  save.reset()
                }}
                onBlur={() => dirty && setShowProblem(true)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <div className="flex items-baseline justify-between gap-3">
                {invalid ? <FieldError id="purpose-error">{problem}</FieldError> : <span />}
                <span
                  className={cn(
                    'shrink-0 text-xs text-muted-foreground tabular-nums',
                    count > PURPOSE_MAX && 'text-destructive',
                  )}
                >
                  {count.toLocaleString('en-GB')} / {PURPOSE_MAX.toLocaleString('en-GB')}
                </span>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending && <Spinner />}
                {save.isPending ? 'Saving…' : 'Save purpose'}
              </Button>
              {dirty && !save.isPending && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft(null)
                    setShowProblem(false)
                  }}
                >
                  Discard changes
                </Button>
              )}
              <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <KbdGroup>
                  <Kbd>{mod}</Kbd>
                  <Kbd>Enter</Kbd>
                </KbdGroup>
                saves
              </span>
            </div>
            {save.isError && <ErrorNote title="Couldn’t save">{save.error.message}</ErrorNote>}
          </form>
        </CardContent>
      </Card>
      <AlertDialog open={leaving.status === 'blocked'} onOpenChange={(open) => !open && leaving.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your purpose changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You edited what this agent is for but didn’t save it. Leaving now throws the edit away.
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
    </Section>
  )
}

const WIPE = {
  new: {
    title: 'Wipe the chat',
    icon: BrushCleaningIcon,
    what: 'Deletes this topic’s T3 threads and stored messages. The purpose and AGENTS.md stay, so the next message starts a fresh thread with the same role.',
    confirm: 'Yes, wipe the chat',
  },
  forget: {
    title: 'Forget everything',
    icon: Trash2Icon,
    what: 'Deletes this topic’s T3 threads, stored messages, purpose and AGENTS.md. The next message asks what it should be, like a brand-new topic.',
    confirm: 'Yes, forget everything',
  },
} as const

function CleanSlate({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const wipe = useMutation({
    mutationFn: (kind: 'new' | 'forget') => wipeTopic({ data: { id: topic.id, kind } }),
    onSuccess: (result) => notify(result.message),
    onSettled: () => cache.refresh(),
  })

  return (
    <Section id="clean-slate" title="Clean slate" className="mt-4 border-t pt-8">
      <ul className="flex flex-col rounded-xl border border-destructive/25">
        {(['new', 'forget'] as const).map((kind, i) => {
          const Icon = WIPE[kind].icon
          return (
            <li key={kind}>
              {i > 0 && <ItemSeparator />}
              <Item className="flex-col items-stretch sm:flex-row sm:items-center">
                <ItemMedia variant="icon" className="hidden text-destructive sm:flex">
                  <Icon aria-hidden />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {WIPE[kind].title}{' '}
                    <span className="font-mono text-xs font-normal text-muted-foreground">/{kind}</span>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none max-w-[60ch]">{WIPE[kind].what}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive sm:w-auto"
                        disabled={wipe.isPending}
                        onClick={() => wipe.reset()}
                      >
                        {wipe.isPending && wipe.variables === kind && <Spinner />}
                        {wipe.isPending && wipe.variables === kind ? 'Wiping…' : `${WIPE[kind].title}…`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="wrap-anywhere">
                          {WIPE[kind].title} in {topic.place}?
                        </AlertDialogTitle>
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
                </ItemActions>
              </Item>
            </li>
          )
        })}
      </ul>
      {wipe.isError && <ErrorNote title="Nothing was wiped">{wipe.error.message}</ErrorNote>}
    </Section>
  )
}

const VOICES = [
  ['alloy', 'Balanced'], ['ash', 'Grounded'], ['ballad', 'Expressive'],
  ['coral', 'Warm'], ['echo', 'Clear'], ['fable', 'Storytelling'],
  ['onyx', 'Deep'], ['nova', 'Bright'], ['sage', 'Calm'],
  ['shimmer', 'Gentle'], ['verse', 'Versatile'], ['marin', 'Conversational'], ['cedar', 'Steady'],
] as const

function Voice({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
  const saving = useRef(false)
  const save = useMutation({
    mutationFn: (settings: { voice_replies: boolean; voice: string }) =>
      saveVoice({ data: { id: topic.id, ...settings } }),
    onSuccess: (updated) => cache.patch(() => updated),
    onSettled: () => {
      saving.current = false
      return cache.queryClient.invalidateQueries({ queryKey: keys.topics })
    },
  })
  const update = (settings: { voice_replies: boolean; voice: string }) => {
    if (saving.current) return
    saving.current = true
    save.mutate(settings)
  }
  return (
    <Section id="voice" title="Voice">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6" aria-busy={save.isPending}>
          <FieldLabel htmlFor="voice-replies">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Spoken replies</FieldTitle>
                <FieldDescription id="voice-help">
                  Read agent replies aloud with an AI-generated voice, after the text arrives.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="voice-replies"
                aria-describedby="voice-help"
                checked={topic.voice_replies}
                disabled={save.isPending}
                onCheckedChange={(voice_replies) => update({ voice_replies, voice: topic.voice })}
              />
            </Field>
          </FieldLabel>
          <Field>
            <FieldLabel htmlFor="voice-choice">Voice</FieldLabel>
            <select
              id="voice-choice"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none pointer-coarse:h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              value={topic.voice}
              disabled={save.isPending}
              onChange={(event) => update({ voice_replies: topic.voice_replies, voice: event.target.value })}
            >
              {VOICES.map(([name, description]) => <option key={name} value={name}>{name} · {description}</option>)}
            </select>
            <FieldDescription>Also used by /speak when spoken replies are off.</FieldDescription>
          </Field>
          {save.isPending && <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Saving voice…</span>}
          {save.isError && <ErrorNote title="Couldn’t save voice">{save.error.message}</ErrorNote>}
        </CardContent>
      </Card>
    </Section>
  )
}
