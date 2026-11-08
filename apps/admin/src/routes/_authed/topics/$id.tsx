import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { ExternalLinkIcon, MicIcon } from 'lucide-react'
import { savePurpose, setEnabled, wipeTopic, type Topic, type TopicDetail } from '../../../api'
import { PURPOSE_MAX, charCount, plural, purposeProblem } from '../../../format'
import { keys, topicQuery } from '../../../queries'
import { CopyButton, Empty, ErrorNote, PageHeader, Section, StaleWarning, Time, TopicState, notify } from '../../../ui'
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
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/topics/$id')({
  params: {
    parse: ({ id }) => {
      const n = Number(id)
      if (!Number.isSafeInteger(n) || n <= 0) throw notFound()
      return { id: n }
    },
    stringify: ({ id }) => ({ id: String(id) }),
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(topicQuery(params.id)),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.conversation.place ?? 'Topic'} · Herbot admin` }],
  }),
  component: TopicPage,
})

function TopicPage() {
  const { id } = Route.useParams()
  const { data: detail, error } = useSuspenseQuery(topicQuery(id))
  const t = detail.conversation
  return (
    <>
      <PageHeader title={t.place}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <TopicState topic={t} />
          <span>{plural(t.messages, 'message')}</span>
          <span>
            last active <Time iso={t.last_activity} relative />
          </span>
          {t.thread_link && (
            <a href={t.thread_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground">
              Open its thread in T3 <ExternalLinkIcon className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      </PageHeader>
      <StaleWarning error={error} />

      <Answering topic={t} />
      <Purpose key={t.id} topic={t} />

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
          <Empty>Not written yet. It’s created when this topic gets its purpose.</Empty>
        )}
      </Section>

      <Messages detail={detail} />
      <CleanSlate topic={t} />
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
      ])
    },
  }
}

/** The on/off switch flips instantly and flips back if herbot-core refuses. */
function Answering({ topic }: { topic: Topic }) {
  const cache = useTopicCache(topic.id)
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
    onSettled: () => cache.refresh(),
  })

  return (
    <Card className="gap-3 px-5 py-4 shadow-xs">
      <div className="flex items-center justify-between gap-6">
        <Label htmlFor="answering" className="flex cursor-pointer flex-col items-start gap-1 leading-snug">
          <span className="font-medium">Answer messages here</span>
          <span className="font-normal text-muted-foreground">
            {topic.enabled
              ? 'On. Your messages in this topic go to its agent.'
              : 'Off. Herbot stores nothing here and stays silent.'}
          </span>
        </Label>
        <Switch id="answering" checked={topic.enabled} onCheckedChange={(on) => toggle.mutate(on)} />
      </div>
      {toggle.isError && (
        <ErrorNote title={`Couldn’t turn it ${toggle.variables ? 'on' : 'off'}`}>{toggle.error.message}</ErrorNote>
      )}
    </Card>
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

  const save = useMutation({
    mutationFn: (purpose: string) => savePurpose({ data: { id: topic.id, purpose } }),
    onSuccess: async (updated) => {
      cache.patch(() => updated)
      setDraft(null)
      setShowProblem(false)
      notify('Purpose saved. AGENTS.md was rewritten.')
      await cache.refresh() // AGENTS.md changed too
    },
  })

  function submit() {
    if (!dirty || save.isPending) return
    if (problem) {
      setShowProblem(true)
      return
    }
    save.mutate(value.trim())
  }

  const count = charCount(value.trim())
  const invalid = showProblem && problem !== null

  return (
    <Section id="purpose-title" title="Purpose">
      <Card className="px-5 py-5 shadow-xs">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="purpose">What this agent is for</Label>
            <p id="purpose-help" className="text-sm text-muted-foreground">
              Saving rewrites its AGENTS.md, same as <span className="font-mono">/setup</span> in Telegram. The thread
              rereads it on the next message.
            </p>
            <Textarea
              id="purpose"
              value={value}
              className="field-sizing-fixed min-h-40 resize-y leading-relaxed"
              aria-invalid={invalid ? true : undefined}
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
              {invalid ? (
                <p id="purpose-error" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : (
                <span />
              )}
              <span
                className={cn(
                  'shrink-0 text-xs text-muted-foreground tabular-nums',
                  count > PURPOSE_MAX && 'text-destructive',
                )}
              >
                {count.toLocaleString('en-GB')} / {PURPOSE_MAX.toLocaleString('en-GB')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!dirty || save.isPending}>
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
            <kbd className="ml-auto hidden font-sans text-xs text-muted-foreground sm:block">⌘/Ctrl + Enter saves</kbd>
          </div>
          {save.isError && <ErrorNote title="Couldn’t save">{save.error.message}</ErrorNote>}
        </form>
      </Card>
    </Section>
  )
}

function Messages({ detail }: { detail: TopicDetail }) {
  const messages = detail.recent_messages
  return (
    <Section
      id="recent"
      title="Recent messages"
      action={
        messages.length > 0 && (
          <span className="text-sm text-muted-foreground">Last {messages.length}, newest at the bottom</span>
        )
      }
    >
      {messages.length === 0 ? (
        <Empty>Nothing stored yet. Messages appear here a few seconds after you send them.</Empty>
      ) : (
        <ol className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <li
              key={`${m.sent_at}-${i}`}
              className={cn(
                'flex max-w-[min(65ch,85%)] flex-col gap-0.5 rounded-2xl px-3.5 py-2.5',
                m.from_bot
                  ? 'self-end rounded-br-md bg-accent text-accent-foreground'
                  : 'self-start rounded-bl-md border bg-card',
              )}
            >
              <span className="text-xs text-muted-foreground">
                {m.from_bot ? 'Herbot' : 'You'}
                {m.is_voice && (
                  <>
                    {' · '}
                    <MicIcon className="inline size-3 align-[-2px]" aria-hidden /> voice note
                  </>
                )}
                {' · '}
                <Time iso={m.sent_at} />
              </span>
              <p className="break-words whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

const WIPE = {
  new: {
    title: 'Wipe the chat',
    what: 'Deletes this topic’s T3 threads and stored messages. The purpose and AGENTS.md stay, so the next message starts a fresh thread with the same role.',
    confirm: 'Yes, wipe the chat',
  },
  forget: {
    title: 'Forget everything',
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
      <Card className="gap-0 border-destructive/25 px-5 py-1 shadow-none">
        <ul className="divide-y">
          {(['new', 'forget'] as const).map((kind) => (
            <li key={kind} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <p className="font-medium">
                  {WIPE[kind].title} <span className="font-mono text-xs font-normal text-muted-foreground">/{kind}</span>
                </p>
                <p className="max-w-[60ch] text-sm text-muted-foreground">{WIPE[kind].what}</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
                    disabled={wipe.isPending}
                    onClick={() => wipe.reset()}
                  >
                    {wipe.isPending && wipe.variables === kind ? 'Wiping…' : `${WIPE[kind].title}…`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {WIPE[kind].title} in {topic.place}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>{WIPE[kind].what} This can’t be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel autoFocus>Keep everything</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90 dark:text-background"
                      onClick={() => wipe.mutate(kind)}
                    >
                      {WIPE[kind].confirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
        {wipe.isError && (
          <div className="pb-4">
            <ErrorNote title="Nothing was wiped">{wipe.error.message}</ErrorNote>
          </div>
        )}
      </Card>
    </Section>
  )
}
