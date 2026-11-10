import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient, useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlarmClockIcon, CheckIcon, ChevronsUpDownIcon, HashIcon, MessageCircleIcon, PauseIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon, ZapIcon } from 'lucide-react'
import { changeTask, createTask, type Task, type TaskInput, type Topic } from '../../../api'
import { charCount, exact, topicStatus, when } from '../../../format'
import { tasksQuery, topicsQuery } from '../../../queries'
import { EmptyState, ErrorNote, PageHeader, StaleWarning, notify } from '../../../ui'
import { ClampedText } from '@/components/clamped-text'
import { UserText } from '@/components/user-text'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'paused' | 'done' | 'cancelled'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Deleted' },
]

export const Route = createFileRoute('/_authed/tasks/')({
  validateSearch: (s: Record<string, unknown>): { status?: Filter } =>
    FILTERS.some((f) => f.value === s.status) && s.status !== 'all' ? { status: s.status as Filter } : {},
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureInfiniteQueryData(tasksQuery),
      context.queryClient.ensureQueryData(topicsQuery),
    ])
  },
  staticData: { crumb: 'Tasks' },
  head: () => ({ meta: [{ title: 'Tasks · Herbot admin' }] }),
  component: TasksPage,
})

function TasksPage() {
  const { status = 'all' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    useSuspenseInfiniteQuery(tasksQuery)
  const { data: topics } = useSuspenseQuery(topicsQuery)
  const [creating, setCreating] = useState(false)
  const tasks = useMemo(() => data.pages.flat(), [data])
  const byTopic = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, paused: 0, done: 0, cancelled: 0 }
    for (const t of tasks) {
      c[t.status]++
      if (t.status !== 'cancelled') c.all++
    }
    return c
  }, [tasks])
  const shown = tasks.filter((t) => (status === 'all' ? t.status !== 'cancelled' : t.status === status))

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Reminders and recurring prompts. Each one runs in its topic, and the agent answers there."
      >
        <div className="pt-2">
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            New task
          </Button>
        </div>
      </PageHeader>
      <StaleWarning error={error} />

      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Show tasks" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => void navigate({ search: f.value === 'all' ? {} : { status: f.value }, replace: true })}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] aria-pressed:bg-secondary aria-pressed:text-foreground md:h-9 [@media(hover:hover)]:hover:text-foreground"
            >
              {f.label}
              <span className="text-xs tabular-nums opacity-70">
                {exact(counts[f.value])}
                {hasNextPage ? '+' : ''}
              </span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          status === 'all' ? (
            <EmptyState
              icon={AlarmClockIcon}
              title="No tasks yet"
              action={<Button onClick={() => setCreating(true)}>New task</Button>}
            >
              Ask any agent “remind me every morning…”, or create one here.
            </EmptyState>
          ) : (
            <EmptyState icon={AlarmClockIcon} title={`No ${FILTERS.find((f) => f.value === status)?.label.toLowerCase()} tasks`}>
              {hasNextPage ? 'None among the tasks loaded so far.' : 'Nothing here right now.'}
            </EmptyState>
          )
        ) : (
          <ol className="flex flex-col gap-3">
            {shown.map((task) => (
              <TaskCard key={task.id} task={task} topic={byTopic.get(task.conversation_id)} />
            ))}
          </ol>
        )}

        {hasNextPage ? (
          <div className="flex flex-col items-center gap-3">
            {isFetchNextPageError && <ErrorNote title="Couldn’t load older tasks">{error?.message}</ErrorNote>}
            <Button variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {isFetchingNextPage && <Spinner />}
              {isFetchingNextPage ? 'Loading older tasks…' : `Load older tasks (${exact(tasks.length)} loaded)`}
            </Button>
          </div>
        ) : (
          tasks.length > 0 && <p className="text-center text-xs text-muted-foreground">That’s every task.</p>
        )}
      </div>

      <CreateTaskSheet open={creating} onOpenChange={setCreating} topics={topics} />
    </>
  )
}

// ---------------------------------------------------------------------------
// One task

const STATUS: Record<Task['status'], { label: string; tone: 'success' | 'warning' | 'muted' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  done: { label: 'Done', tone: 'muted' },
  cancelled: { label: 'Deleted', tone: 'danger' },
}

type Action = 'pause' | 'resume' | 'cancel' | 'run'

function TaskCard({ task, topic }: { task: Task; topic: Topic | undefined }) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (action: Action) => changeTask({ data: { id: task.id, action } }),
    onSuccess: (_task, action) =>
      notify(
        action === 'run'
          ? 'Run requested. It starts within 15 seconds if the topic is ready and on.'
          : action === 'cancel'
            ? 'Task deleted.'
            : action === 'pause'
              ? 'Task paused.'
              : 'Task resumed.',
      ),
    onSettled: () => client.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const pending = change.isPending ? change.variables : null
  const status = STATUS[task.status]
  const heading = task.title?.trim() || firstLine(task.prompt)
  // Without a title the heading already is the prompt's first line; show the
  // prompt again only if there's more of it.
  const showPrompt = Boolean(task.title?.trim()) || task.prompt.trim() !== heading
  const live = task.status === 'active' || task.status === 'paused'

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 shadow-xs md:px-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-medium leading-snug">
          <UserText lines={2} fallback="Untitled task">
            {heading}
          </UserText>
        </h3>
        <Badge variant={status.tone} className="mt-0.5 shrink-0">
          {status.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Topic</dt>
        <dd className="min-w-0">
          {topic ? (
            <Link to="/topics/$id" params={{ id: topic.id }} className="relative inline-flex max-w-full items-center gap-1 before:absolute before:-inset-x-1 before:-inset-y-3">
              {topic.is_general ? (
                <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <HashIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <UserText className="min-w-0">{topic.name}</UserText>
            </Link>
          ) : (
            <span className="text-muted-foreground tabular-nums">#{task.conversation_id} (removed)</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd className="min-w-0">
          <Schedule task={task} />
        </dd>
        {live && (
          <>
            <dt className="text-muted-foreground">Next run</dt>
            <dd className="tabular-nums">
              {task.status === 'paused' ? (
                <span className="text-muted-foreground">Paused</span>
              ) : (
                <Moment iso={task.next_run_at} />
              )}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Runs</dt>
        <dd className="tabular-nums">
          {task.run_count === 0 ? (
            <span className="text-muted-foreground">Not run yet</span>
          ) : (
            <>
              {exact(task.run_count)} · last <Moment iso={task.last_run_at} />
            </>
          )}
        </dd>
      </dl>

      {showPrompt && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <ClampedText lines={3} className="user-text max-w-[65ch]" toggleClassName="text-xs">
            <span dir="auto">{task.prompt}</span>
          </ClampedText>
        </div>
      )}

      {task.last_error && (
        <div role="note" className="flex flex-col gap-1 rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-sm">
          <p className="font-medium text-destructive">Last run failed</p>
          <ClampedText lines={2} className="user-text font-mono text-xs" toggleClassName="text-xs">
            {task.last_error}
          </ClampedText>
        </div>
      )}

      {change.isError && (
        <ErrorNote title={`Couldn’t ${change.variables === 'cancel' ? 'delete' : change.variables === 'run' ? 'run' : change.variables} the task`}>
          {change.error.message}
        </ErrorNote>
      )}

      {task.status !== 'cancelled' && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {live && (
            <ActionButton
              icon={task.status === 'active' ? PauseIcon : PlayIcon}
              pending={pending === 'pause' || pending === 'resume'}
              disabled={pending != null}
              onClick={() => change.mutate(task.status === 'active' ? 'pause' : 'resume')}
            >
              {task.status === 'active' ? 'Pause' : 'Resume'}
            </ActionButton>
          )}
          <ActionButton icon={ZapIcon} pending={pending === 'run'} disabled={pending != null} onClick={() => change.mutate('run')}>
            Run now
          </ActionButton>
          {/* Destructive, so it sits apart from the everyday actions. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending != null}
                className="ml-auto min-h-11 text-destructive hover:bg-destructive-soft hover:text-destructive md:min-h-9"
              >
                {pending === 'cancel' ? <Spinner /> : <Trash2Icon aria-hidden />}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                <AlertDialogDescription>
                  “<span dir="auto">{clipChars(heading, 80)}</span>” stops running. A run that already started may still
                  finish.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel autoFocus>Keep task</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive)_86%,black)]"
                  onClick={() => change.mutate('cancel')}
                >
                  Delete task
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </li>
  )
}

function ActionButton({ icon: Icon, pending, disabled, onClick, children }: {
  icon: typeof PauseIcon
  pending: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" disabled={disabled} onClick={onClick}>
      {pending ? <Spinner /> : <Icon aria-hidden />}
      {children}
    </Button>
  )
}

/** The schedule in words, with the cron itself underneath for precision. */
function Schedule({ task }: { task: Task }) {
  if (!task.cron) {
    return (
      <span>
        Once
        {task.once_at && (
          <>
            , <time dateTime={task.once_at} suppressHydrationWarning>{when(task.once_at)}</time>
          </>
        )}
      </span>
    )
  }
  const words = describeCron(task.cron)
  return (
    <span className="flex min-w-0 flex-col">
      <span>{words ?? 'Custom schedule'}</span>
      <span className="truncate font-mono text-xs text-muted-foreground" title={`${task.cron} (${task.timezone})`}>
        {task.cron} · {task.timezone}
      </span>
    </span>
  )
}

/** "in 3 h" / "2 days ago", with the exact time on hover. */
function Moment({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (!iso) return <span className="text-muted-foreground">—</span>
  return (
    <time dateTime={iso} title={when(iso)} suppressHydrationWarning>
      {now == null ? when(iso) : fromNow(iso, now)}
    </time>
  )
}

function fromNow(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const future = seconds > 0
  const abs = Math.abs(seconds)
  const span =
    abs < 60 ? null : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 172_800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86_400)} days`
  if (!span) return future ? 'in under a minute' : 'just now'
  return future ? `in ${span}` : `${span} ago`
}

// ---------------------------------------------------------------------------
// Cron in words (herbot-core uses five-field cron: minute hour day month weekday)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NAMES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function dayNumber(token: string): number | null {
  const upper = token.toUpperCase()
  if (upper in DAY_NAMES) return DAY_NAMES[upper]
  const n = Number(token)
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n % 7 : null
}

function weekdays(field: string): string | null {
  const upper = field.toUpperCase()
  if (upper === '1-5' || upper === 'MON-FRI') return 'Weekdays'
  const list = field.split(',').map(dayNumber)
  if (list.some((d) => d == null)) return null
  const days = [...new Set(list as number[])].sort()
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return 'Weekends'
  if (days.length === 1) return `Every ${DAYS[days[0]]}`
  return `${days.slice(0, -1).map((d) => `${DAYS[d]}s`).join(', ')} and ${DAYS[days.at(-1)!]}s`
}

const isNum = (s: string) => /^\d+$/.test(s)
const pad = (n: string) => n.padStart(2, '0')

export function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, month, dow] = parts
  const every = /^\*\/(\d+)$/
  if (every.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const n = Number(min.match(every)![1])
    return n === 1 ? 'Every minute' : `Every ${n} minutes`
  }
  if (isNum(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Every hour at :${pad(min)}`
  if (isNum(min) && every.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `Every ${hour.match(every)![1]} hours at :${pad(min)}`
  }
  if (!isNum(min) || !isNum(hour)) return null
  const at = `${pad(hour)}:${pad(min)}`
  if (dom === '*' && month === '*') {
    if (dow === '*') return `Every day at ${at}`
    const days = weekdays(dow)
    return days ? `${days} at ${at}` : null
  }
  if (dow !== '*') return null
  if (dom.toUpperCase() === 'L' && month === '*') return `Last day of every month at ${at}`
  if (isNum(dom) && month === '*') return `Day ${Number(dom)} of every month at ${at}`
  if (isNum(dom) && isNum(month) && Number(month) >= 1 && Number(month) <= 12) {
    return `Every ${Number(dom)} ${MONTHS[Number(month) - 1]} at ${at}`
  }
  return null
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

// ---------------------------------------------------------------------------
// New task

type Repeat = 'once' | 'daily' | 'weekly' | 'custom'
const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'custom', label: 'Custom' },
]
const TITLE_MAX = 200
const PROMPT_MAX = 16_000

type Draft = {
  topic: number | null
  title: string
  prompt: string
  repeat: Repeat
  when: string
  time: string
  weekday: string
  cron: string
  timezone: string
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  } catch {
    return 'Asia/Kolkata'
  }
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function cronOf(d: Draft): string {
  const [h = '9', m = '0'] = d.time.split(':')
  if (d.repeat === 'daily') return `${Number(m)} ${Number(h)} * * *`
  if (d.repeat === 'weekly') return `${Number(m)} ${Number(h)} * * ${d.weekday}`
  return d.cron.trim()
}

/** Problems by field, worked out the way herbot-core checks them. */
function problems(d: Draft, topics: Topic[]): Partial<Record<keyof Draft, string>> {
  const p: Partial<Record<keyof Draft, string>> = {}
  if (d.topic == null || !topics.some((t) => t.id === d.topic)) p.topic = 'Pick the topic this task runs in.'
  if (charCount(d.title.trim()) > TITLE_MAX) p.title = `Keep the title under ${TITLE_MAX} characters.`
  const prompt = d.prompt.trim()
  if (!prompt) p.prompt = 'Say what the agent should do when the task runs.'
  else if (charCount(prompt) > PROMPT_MAX) p.prompt = `Keep it under ${exact(PROMPT_MAX)} characters. It’s ${exact(charCount(prompt))} now.`
  if (d.repeat === 'once') {
    const at = new Date(d.when)
    if (!d.when || Number.isNaN(at.getTime())) p.when = 'Pick a date and time.'
    else if (at.getTime() <= Date.now()) p.when = 'Pick a time in the future.'
  } else {
    if ((d.repeat === 'daily' || d.repeat === 'weekly') && !/^\d{1,2}:\d{2}$/.test(d.time)) p.time = 'Pick a time.'
    if (d.repeat === 'custom' && d.cron.trim().split(/\s+/).length !== 5) {
      p.cron = 'Use five fields: minute hour day month weekday, like 0 9 * * 1-5.'
    }
    if (!d.timezone.trim()) p.timezone = 'Pick a time zone, like Asia/Kolkata.'
    else if (!validZone(d.timezone.trim())) p.timezone = `“${clipChars(d.timezone.trim(), 40)}” isn’t a time zone. Try Asia/Kolkata or Europe/London.`
  }
  return p
}

function CreateTaskSheet({ open, onOpenChange, topics }: { open: boolean; onOpenChange: (open: boolean) => void; topics: Topic[] }) {
  const client = useQueryClient()
  const empty = (): Draft => ({
    topic: null,
    title: '',
    prompt: '',
    repeat: 'once',
    when: '',
    time: '09:00',
    weekday: '1',
    cron: '',
    timezone: browserZone(),
  })
  const [draft, setDraft] = useState<Draft>(empty)
  // Errors show after the first try, then update as you fix them.
  const [tried, setTried] = useState(false)
  const errors = tried ? problems(draft, topics) : {}
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const create = useMutation({
    mutationFn: (data: TaskInput) => createTask({ data }),
    onSuccess: async () => {
      notify('Task created.')
      onOpenChange(false)
      setDraft(empty())
      setTried(false)
      await client.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (create.isPending) return
    setTried(true)
    const found = problems(draft, topics)
    if (Object.keys(found).length > 0) {
      // Take the user to the first thing to fix.
      const first = (['topic', 'prompt', 'title', 'when', 'time', 'cron', 'timezone'] as const).find((k) => found[k])
      if (first) document.getElementById(`task-${first}`)?.focus()
      return
    }
    const base = { conversation_id: draft.topic!, prompt: draft.prompt.trim(), title: draft.title.trim() || undefined }
    create.mutate(
      draft.repeat === 'once'
        ? { ...base, when: new Date(draft.when).toISOString() }
        : { ...base, cron: cronOf(draft), timezone: draft.timezone.trim() },
    )
  }

  const preview = draft.repeat === 'once' ? null : describeCron(cronOf(draft))
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return []
    }
  }, [])

  return (
    <Sheet open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-lg"
        // On a phone, don't pop the keyboard the moment the sheet opens.
        onOpenAutoFocus={(e) => matchMedia('(pointer: coarse)').matches && e.preventDefault()}
      >
        <form noValidate onSubmit={submit} className="flex h-full min-h-0 flex-col">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="flex flex-col gap-1">
              <SheetTitle className="text-lg font-semibold tracking-tight">New task</SheetTitle>
              <SheetDescription>The agent in the topic runs the prompt on schedule and answers there.</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon" className="-mr-2 size-11 shrink-0 md:size-9" aria-label="Close">
                <XIcon aria-hidden />
              </Button>
            </SheetClose>
          </div>

          <fieldset disabled={create.isPending} className="scroller flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <FormField id="task-topic" label="Topic" error={errors.topic}>
              <TopicPicker
                id="task-topic"
                topics={topics}
                value={draft.topic}
                invalid={Boolean(errors.topic)}
                onChange={(id) => set('topic', id)}
              />
            </FormField>

            <FormField
              id="task-prompt"
              label="What should the agent do?"
              error={errors.prompt}
              hint={`${exact(charCount(draft.prompt))} / ${exact(PROMPT_MAX)}`}
            >
              <textarea
                id="task-prompt"
                value={draft.prompt}
                onChange={(e) => set('prompt', e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={5}
                dir="auto"
                placeholder="Summarise yesterday’s news about Rust, with links."
                aria-invalid={Boolean(errors.prompt)}
                aria-describedby={errors.prompt ? 'task-prompt-error' : undefined}
                className={cn(fieldClass, 'min-h-28 resize-y py-2.5 leading-relaxed')}
              />
            </FormField>

            <FormField id="task-title" label="Title" optional error={errors.title}>
              <input
                id="task-title"
                value={draft.title}
                onChange={(e) => set('title', e.target.value)}
                dir="auto"
                autoComplete="off"
                placeholder="Morning Rust news"
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'task-title-error' : undefined}
                className={fieldClass}
              />
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Repeat</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4">
                {REPEATS.map((r) => (
                  <label
                    key={r.value}
                    className="relative grid h-11 cursor-pointer place-items-center rounded-md text-sm text-muted-foreground transition-[color,background-color] duration-150 has-checked:bg-card has-checked:text-foreground has-checked:shadow-xs has-focus-visible:ring-2 has-focus-visible:ring-ring md:h-9"
                  >
                    <input
                      type="radio"
                      name="repeat"
                      value={r.value}
                      checked={draft.repeat === r.value}
                      onChange={() => set('repeat', r.value)}
                      className="sr-only"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {draft.repeat === 'once' && (
              <FormField id="task-when" label="Date and time" error={errors.when} hint={`Your time: ${browserZone()}`}>
                <input
                  id="task-when"
                  type="datetime-local"
                  value={draft.when}
                  onChange={(e) => set('when', e.target.value)}
                  aria-invalid={Boolean(errors.when)}
                  aria-describedby={errors.when ? 'task-when-error' : undefined}
                  className={fieldClass}
                />
              </FormField>
            )}

            {(draft.repeat === 'daily' || draft.repeat === 'weekly') && (
              <div className="grid gap-4 sm:grid-cols-2">
                {draft.repeat === 'weekly' && (
                  <FormField id="task-weekday" label="Day">
                    <select
                      id="task-weekday"
                      value={draft.weekday}
                      onChange={(e) => set('weekday', e.target.value)}
                      className={fieldClass}
                    >
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <option key={d} value={String(d)}>
                          {DAYS[d]}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}
                <FormField id="task-time" label="Time" error={errors.time}>
                  <input
                    id="task-time"
                    type="time"
                    value={draft.time}
                    onChange={(e) => set('time', e.target.value)}
                    aria-invalid={Boolean(errors.time)}
                    aria-describedby={errors.time ? 'task-time-error' : undefined}
                    className={fieldClass}
                  />
                </FormField>
              </div>
            )}

            {draft.repeat === 'custom' && (
              <FormField
                id="task-cron"
                label="Cron schedule"
                error={errors.cron}
                hint="minute hour day month weekday · 0 9 * * 1-5 is weekdays at 09:00"
              >
                <input
                  id="task-cron"
                  value={draft.cron}
                  onChange={(e) => set('cron', e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  placeholder="0 9 * * 1-5"
                  aria-invalid={Boolean(errors.cron)}
                  aria-describedby={errors.cron ? 'task-cron-error' : undefined}
                  className={cn(fieldClass, 'font-mono')}
                />
              </FormField>
            )}

            {draft.repeat !== 'once' && (
              <>
                <FormField id="task-timezone" label="Time zone" error={errors.timezone}>
                  <input
                    id="task-timezone"
                    list="task-zones"
                    value={draft.timezone}
                    onChange={(e) => set('timezone', e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-invalid={Boolean(errors.timezone)}
                    aria-describedby={errors.timezone ? 'task-timezone-error' : undefined}
                    className={fieldClass}
                  />
                  <datalist id="task-zones">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </FormField>
                <p className="-mt-2 text-sm text-muted-foreground" aria-live="polite">
                  {preview ? `${preview}, ${draft.timezone.trim() || 'no time zone'}.` : draft.repeat === 'custom' && draft.cron.trim() ? 'A custom schedule.' : ''}
                </p>
              </>
            )}

            {create.isError && <ErrorNote title="Couldn’t create the task">{create.error.message}</ErrorNote>}
          </fieldset>

          <div className="flex items-center justify-end gap-2 border-t px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={create.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" disabled={create.isPending} title="Create task (⌘/Ctrl + Enter in the prompt)">
              {create.isPending && <Spinner />}
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

const fieldClass =
  'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:h-10 md:text-sm'

function FormField({ id, label, optional = false, hint, error, children }: {
  id: string
  label: string
  optional?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {optional && <span className="ml-1.5 font-normal text-muted-foreground">optional</span>}
        </label>
        {hint && <span className="truncate text-xs text-muted-foreground tabular-nums">{hint}</span>}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-destructive">
          <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-current" />
          {error}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Topic picker: a filterable combobox, because a native select can't show
// hundreds of names in every script, nor say which topics are off.

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

function TopicPicker({ id, topics, value, invalid, onChange }: {
  id: string
  topics: Topic[]
  value: number | null
  invalid: boolean
  onChange: (id: number | null) => void
}) {
  const listId = useId()
  const selected = topics.find((t) => t.id === value) ?? null
  const [text, setText] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // Show the chosen name whenever the choice changes from outside.
  useEffect(() => setText(selected?.name ?? ''), [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typed = selected && text === selected.name ? '' : text
  const matches = useMemo(() => {
    const wanted = fold(typed.trim())
    return wanted ? topics.filter((t) => fold(t.name).includes(wanted)) : topics
  }, [topics, typed])

  useEffect(() => setActive(0), [typed])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(t: Topic) {
    onChange(t.id)
    setText(t.name)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        value={text}
        dir="auto"
        placeholder={`Search ${exact(topics.length)} topics`}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          if (selected && e.target.value !== selected.name) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            setOpen(false)
          }
        }}
        className={cn(fieldClass, 'pr-10')}
      />
      <ChevronsUpDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Topics"
          className="scroller absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">No topic matches that name.</li>
          ) : (
            matches.map((t, i) => {
              const status = topicStatus(t)
              const ready = status.label === 'Ready'
              return (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={t.id === value}
                  // mousedown would blur the input first and close the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(t)}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm md:min-h-9',
                    i === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  {t.is_general ? (
                    <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <HashIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <UserText className="min-w-0 flex-1">{t.name}</UserText>
                  {!ready && <span className="shrink-0 text-xs text-muted-foreground">{status.label}</span>}
                  <CheckIcon className={cn('size-4 shrink-0', t.id === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                </li>
              )
            })
          )}
        </ul>
      )}
      {selected && topicStatus(selected).label !== 'Ready' && (
        <p className="mt-1.5 text-xs text-warning">
          This topic is {topicStatus(selected).label.toLowerCase()}; the task runs once it’s on and set up.
        </p>
      )}
    </div>
  )
}
