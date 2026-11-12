// Tasks (docs/design/DECISIONS.md, "Tasks"): one Thread list with a status
// filter, a "Coming up" line with the next three runs, quiet always-visible
// actions, and New task as a form dialog. Every page of tasks loads, so the
// counts are exact and "Coming up" really is the soonest (herbot-core allows
// at most 50 active tasks).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon, PauseIcon, PlayIcon, PlusIcon, Trash2Icon, ZapIcon } from 'lucide-react'
import { changeTask, createTask, type Task, type TaskInput, type Topic } from '../../../api'
import { charCount, exact, when } from '../../../format'
import { tasksQuery, topicsQuery } from '../../../queries'
import { Button, Field, Segmented, TextArea, TextInput } from '@/components/hb/controls'
import { ConfirmDialog, FormDialog } from '@/components/hb/dialogs'
import { InPlaceEmpty, InPlaceError, ListSkeleton, notify } from '@/components/hb/feedback'
import { QuietAction, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { MetaLine, StatusDot, taskTone } from '@/components/hb/status'
import { TopicPicker } from '@/components/hb/topic-picker'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

type Filter = 'all' | Task['status']
const FILTERS: Filter[] = ['all', 'active', 'paused', 'done', 'cancelled']
const LABEL: Record<Filter, string> = { all: 'All', active: 'Active', paused: 'Paused', done: 'Done', cancelled: 'Deleted' }
const HINT: Record<Filter, string> = {
  all: 'Every task, newest first.',
  active: 'Running on their schedule.',
  paused: 'Kept, but won’t run until you resume them.',
  done: 'One-off tasks that already ran.',
  cancelled: 'Deleted tasks, kept for their history.',
}

export const Route = createFileRoute('/_authed/tasks/')({
  validateSearch: (s: Record<string, unknown>): { status?: Filter } =>
    FILTERS.includes(s.status as Filter) && s.status !== 'all' ? { status: s.status as Filter } : {},
  loader: async ({ context }) => {
    await Promise.all([context.queryClient.ensureInfiniteQueryData(tasksQuery), context.queryClient.ensureQueryData(topicsQuery)])
  },
  staticData: { crumb: 'Tasks', shell: 'page' },
  head: () => ({ meta: [{ title: 'Tasks · Herbot admin' }] }),
  component: TasksPage,
})

// ---------------------------------------------------------------------------
// Data

/** Every task, page after page, newest first. */
function useAllTasks() {
  const q = useInfiniteQuery(tasksQuery)
  const tasks = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError } = q
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
  return { ...q, tasks }
}

/** Re-renders every 30 s so "in 5 min" stays true; null until mounted
 * (the server renders absolute times, so hydration matches). */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ---------------------------------------------------------------------------
// Words

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

/** A task's name: its title, or the first line of its prompt. */
function taskName(task: Task): string {
  return task.title?.trim() || firstLine(task.prompt)
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NAMES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const isNum = (s: string) => /^\d+$/.test(s)
const pad = (n: string) => n.padStart(2, '0')

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

/** A five-field cron in words, or null when it doesn't read simply. */
// Exported only for the Stage 2 rows prototype (src/proto/rows/data.tsx); drop the export with src/proto.
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
  if (isNum(min) && every.test(hour) && dom === '*' && month === '*' && dow === '*') return `Every ${hour.match(every)![1]} hours at :${pad(min)}`
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
  if (isNum(dom) && isNum(month) && Number(month) >= 1 && Number(month) <= 12) return `Every ${Number(dom)} ${MONTHS[Number(month) - 1]} at ${at}`
  return null
}

/** "Weekdays at 09:00", "Once, 23 Nov 2026, 01:44", or "Custom schedule". */
function scheduleWords(task: Task): string {
  if (!task.cron) return task.once_at ? `Once, ${when(task.once_at)}` : 'Once'
  return describeCron(task.cron) ?? 'Custom schedule'
}

function fromNow(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  const span = abs < 60 ? null : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 172_800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86_400)} days`
  if (!span) return seconds > 0 ? 'in under a minute' : 'just now'
  return seconds > 0 ? `in ${span}` : `${span} ago`
}

/** Relative time with the exact time on hover; absolute until mounted. */
function Moment({ iso, now }: { iso: string; now: number | null }) {
  return (
    <time dateTime={iso} title={when(iso)} suppressHydrationWarning className="tabular-nums">
      {now == null ? when(iso) : fromNow(iso, now)}
    </time>
  )
}

// ---------------------------------------------------------------------------
// The page

function TasksPage() {
  const { status } = Route.useSearch()
  const filter: Filter = status ?? 'all'
  const navigate = useNavigate({ from: Route.fullPath })
  const setFilter = (f: Filter) => void navigate({ search: f === 'all' ? {} : { status: f }, replace: true })
  const q = useAllTasks()
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])
  const now = useNow()
  const [creating, setCreating] = useState(false)
  // Counts are exact once every page is in; until then they say "+".
  const more = q.hasNextPage ? '+' : ''
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: q.tasks.length, active: 0, paused: 0, done: 0, cancelled: 0 }
    for (const t of q.tasks) c[t.status]++
    return c
  }, [q.tasks])
  const shown = useMemo(() => (filter === 'all' ? q.tasks : q.tasks.filter((t) => t.status === filter)), [q.tasks, filter])
  const options = FILTERS.map((f) => ({ value: f, label: `${LABEL[f]} ${exact(counts[f])}${more}`, hint: HINT[f] }))
  const newTask = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden />
      New task
    </Button>
  )

  return (
    <ShellPage
      title="Tasks"
      description="Reminders and recurring prompts. Each one runs in its topic, and the agent answers there."
      back={<BackToAgents />}
      actions={q.tasks.length > 0 ? newTask : undefined}
    >
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError && q.tasks.length === 0 ? (
        <InPlaceError title="Couldn’t load tasks" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : q.tasks.length === 0 ? (
        <InPlaceEmpty title="No tasks yet" action={newTask}>
          A task is a prompt that runs in a topic on a schedule, like “every weekday at 9, summarise yesterday”. Agents also add them when
          you ask in a topic.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-6">
          {(filter === 'all' || filter === 'active') && <ComingUp tasks={q.tasks} complete={!q.hasNextPage} byId={byId} now={now} />}
          <div className="flex flex-col gap-4">
            <Segmented label="Show" value={filter} options={options} onValueChange={setFilter} />
            {shown.length === 0 && !q.hasNextPage ? (
              <InPlaceEmpty
                title={`No ${LABEL[filter].toLowerCase()} tasks`}
                action={
                  <Button variant="secondary" onClick={() => setFilter('all')}>
                    Show all tasks
                  </Button>
                }
              />
            ) : (
              <ThreadList
                label={`${LABEL[filter]} tasks`}
                items={shown}
                itemKey={(t) => t.id}
                estimate={150}
                title={(t) => <TaskTitle task={t} />}
                aside={(t) => <StatusDot status={taskTone(t.status)} dense />}
                body={(t) => <TaskBody task={t} />}
                meta={(t) => <TaskMeta task={t} topic={byId.get(t.conversation_id)} now={now} />}
                actions={(t) => <TaskActions task={t} />}
                footer={<PagesFooter q={q} />}
              />
            )}
          </div>
        </div>
      )}
      <NewTaskDialog open={creating} onOpenChange={setCreating} topics={topics.data ?? []} />
    </ShellPage>
  )
}

/** The next three runs, soonest first. */
function ComingUp({ tasks, complete, byId, now }: { tasks: Task[]; complete: boolean; byId: Map<number, Topic>; now: number | null }) {
  const next = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'active' && t.next_run_at)
        .sort((a, b) => a.next_run_at!.localeCompare(b.next_run_at!))
        .slice(0, 3),
    [tasks],
  )
  if (next.length === 0) return null
  return (
    <section aria-labelledby="coming-up" className="flex flex-col gap-1.5">
      <h2 id="coming-up" className="text-[12px] font-semibold tracking-[0.06em] text-mute uppercase">
        Coming up{!complete && <span className="font-normal tracking-normal normal-case"> · checking every task…</span>}
      </h2>
      <ol className="flex flex-col border-y border-line">
        {next.map((t) => (
          <li key={t.id} className="flex min-w-0 items-baseline gap-3 border-b border-line py-2 last:border-b-0">
            <span className="w-[9ch] shrink-0 text-[13px] font-medium text-ink">
              {now != null && new Date(t.next_run_at!).getTime() <= now ? (
                // Past its time: the scheduler should have run it (or will at
                // its next tick, every 15 s); say so instead of "35 min ago".
                <span className="text-warning" title={`Was due ${when(t.next_run_at!)}`}>
                  Overdue
                </span>
              ) : (
                <Moment iso={t.next_run_at!} now={now} />
              )}
            </span>
            <UserText className="min-w-0 flex-1 text-[14px]">{taskName(t)}</UserText>
            <span className="hidden max-w-[22ch] min-w-0 text-[12.5px] text-faint sm:block">
              <TopicLink topic={byId.get(t.conversation_id)} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Row parts

function TopicLink({ topic }: { topic: Topic | undefined }) {
  if (!topic) return <span className="italic">a deleted topic</span>
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <Link
      to="/topics/$id"
      params={{ id: topic.id }}
      className="relative z-[1] inline-flex max-w-[24ch] min-w-0 items-center gap-1 align-bottom text-mute underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 hover:text-ink hover:underline"
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <UserText className="min-w-0">{topic.name}</UserText>
    </Link>
  )
}

function TaskTitle({ task }: { task: Task }) {
  return (
    <UserText lines={2} className={cn('text-[15px] font-medium', task.status === 'cancelled' && 'text-mute line-through decoration-1')}>
      {taskName(task)}
    </UserText>
  )
}

/** The prompt when it says more than the title (two lines, the rest on
 * request), then the last run's failure. */
function TaskBody({ task }: { task: Task }) {
  const [open, setOpen] = useState(false)
  const repeatsTitle = !task.title?.trim() && task.prompt.trim() === firstLine(task.prompt)
  const long = charCount(task.prompt) > 160 || task.prompt.includes('\n')
  if (repeatsTitle && !task.last_error) return null
  return (
    <div className="flex flex-col items-start gap-1.5">
      {!repeatsTitle && (
        <>
          <UserText as="p" lines={open ? 'all' : 2} className={cn('text-[14px] text-mute', open && 'max-h-80 overflow-y-auto pr-2')}>
            {task.prompt}
          </UserText>
          {long && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="relative z-[1] text-[13px] font-medium text-ink underline-offset-2 before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline"
            >
              {open ? 'Show less' : `Show the whole prompt (${exact(charCount(task.prompt))} characters)`}
            </button>
          )}
        </>
      )}
      {task.last_error && (
        <p className="flex w-full min-w-0 items-baseline gap-1.5 text-[13px] text-destructive">
          <span className="shrink-0 font-medium">Last run failed:</span>
          <UserText className="min-w-0 font-mono text-[12.5px]">{task.last_error}</UserText>
        </p>
      )}
    </div>
  )
}

/** Small facts: topic · schedule · raw cron when it doesn't read simply ·
 * next run · runs. */
function TaskMeta({ task, topic, now }: { task: Task; topic: Topic | undefined; now: number | null }) {
  const words = scheduleWords(task)
  const live = task.status === 'active' || task.status === 'paused'
  const due = now != null && task.next_run_at != null && new Date(task.next_run_at).getTime() <= now
  return (
    <MetaLine>
      {[
        <TopicLink key="topic" topic={topic} />,
        <span key="schedule" title={task.cron ? `${task.cron} (${task.timezone})` : undefined}>
          {words}
        </span>,
        task.cron && words === 'Custom schedule' ? (
          <span key="cron" className="max-w-full truncate font-mono text-[12px]">
            {task.cron} · {task.timezone}
          </span>
        ) : null,
        live && task.next_run_at ? (
          <span key="next">
            {task.status === 'paused' ? 'would run ' : due ? 'due ' : 'next '}
            <Moment iso={task.next_run_at} now={now} />
          </span>
        ) : null,
        <span key="runs" className="tabular-nums">
          {task.run_count === 0 ? 'not run yet' : `ran ${exact(task.run_count)}×`}
        </span>,
      ]}
    </MetaLine>
  )
}

type TaskAction = 'pause' | 'resume' | 'cancel' | 'run'
const DONE: Record<TaskAction, string> = { pause: 'Task paused.', resume: 'Task resumed.', run: 'Task queued to run now.', cancel: 'Task deleted.' }
const VERB: Record<TaskAction, string> = { pause: 'pause it', resume: 'resume it', run: 'run it', cancel: 'delete it' }

/** Pause or Resume, Run now, and a separated Delete…; each shows its own
 * pending state, and a failure shows on the row. Delete is confirmed. */
function TaskActions({ task }: { task: Task }) {
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const act = useMutation({
    mutationFn: (action: TaskAction) => changeTask({ data: { id: task.id, action } }),
    onSuccess: async (_t, action) => {
      setConfirm(false)
      notify(DONE[action])
      await client.invalidateQueries({ queryKey: tasksQuery.queryKey })
    },
  })
  const pending = act.isPending ? act.variables : null
  if (task.status === 'cancelled') return null
  return (
    <>
      {task.status === 'active' && (
        <QuietAction onClick={() => act.mutate('pause')} pending={pending === 'pause'} disabled={act.isPending}>
          <PauseIcon aria-hidden />
          Pause
        </QuietAction>
      )}
      {task.status === 'paused' && (
        <QuietAction onClick={() => act.mutate('resume')} pending={pending === 'resume'} disabled={act.isPending}>
          <PlayIcon aria-hidden />
          Resume
        </QuietAction>
      )}
      <QuietAction onClick={() => act.mutate('run')} pending={pending === 'run'} disabled={act.isPending}>
        <ZapIcon aria-hidden />
        Run now
      </QuietAction>
      <span aria-hidden className="ml-auto" />
      <QuietAction tone="danger" onClick={() => setConfirm(true)} disabled={act.isPending}>
        <Trash2Icon aria-hidden />
        Delete…
      </QuietAction>
      {act.isError && act.variables !== 'cancel' && (
        <p role="alert" className="basis-full px-2 text-[12.5px] text-destructive">
          Couldn’t {VERB[act.variables]}: {act.error.message}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o)
          if (!o && act.variables === 'cancel') act.reset()
        }}
        title="Delete this task?"
        subject={taskName(task)}
        consequences={['Stops its schedule; it won’t run again', 'Moves it to Deleted']}
        keeps="Replies it already posted stay in its topic."
        actionLabel="Delete task"
        keepLabel="Keep the task"
        guard={{ kind: 'separated' }}
        pending={pending === 'cancel'}
        error={act.isError && act.variables === 'cancel' ? act.error : null}
        onConfirm={() => act.mutate('cancel')}
      />
    </>
  )
}

/** "Loading every task… 150 so far" while pages arrive; Retry if one fails. */
function PagesFooter({ q }: { q: ReturnType<typeof useAllTasks> }) {
  if (q.isFetchNextPageError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 px-1 py-4 text-[13px] text-destructive">
        Couldn’t load older tasks: {q.error?.message}
        <Button size="sm" variant="secondary" onClick={() => q.fetchNextPage()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!q.hasNextPage) return null
  return (
    <p role="status" className="px-1 py-4 text-[13px] text-mute">
      Loading older tasks… {exact(q.tasks.length)} so far
    </p>
  )
}

// ---------------------------------------------------------------------------
// New task

type Repeat = 'once' | 'daily' | 'weekly' | 'custom'
const REPEATS = [
  { value: 'once', label: 'Once', hint: 'Runs one time, at the moment you pick.' },
  { value: 'daily', label: 'Every day', hint: 'Runs every day at the same time.' },
  { value: 'weekly', label: 'Every week', hint: 'Runs on one weekday at the same time.' },
  { value: 'custom', label: 'Custom', hint: 'A five-field cron: minute hour day month weekday.' },
] as const
const TITLE_MAX = 200
const PROMPT_MAX = 16_000
const ZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']

type Draft = { topic: number | null; title: string; prompt: string; repeat: Repeat; when: string; time: string; weekday: string; cron: string; timezone: string }

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

/** Problems by field, checked the way herbot-core checks them (tasks.rs). */
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
    if (d.repeat === 'custom' && d.cron.trim().split(/\s+/).length !== 5) p.cron = 'Use five fields: minute hour day month weekday, like 0 9 * * 1-5.'
    if (!d.timezone.trim()) p.timezone = 'Pick a time zone, like Asia/Kolkata.'
    else if (!validZone(d.timezone.trim())) p.timezone = 'That isn’t a time zone. Try Asia/Kolkata or Europe/London.'
  }
  return p
}

const ORDER = ['topic', 'prompt', 'title', 'when', 'time', 'cron', 'timezone'] as const

function NewTaskDialog({ open, onOpenChange, topics }: { open: boolean; onOpenChange: (open: boolean) => void; topics: Topic[] }) {
  const client = useQueryClient()
  const empty = (): Draft => ({ topic: null, title: '', prompt: '', repeat: 'once', when: '', time: '09:00', weekday: '1', cron: '', timezone: browserZone() })
  const [draft, setDraft] = useState<Draft>(empty)
  // Errors appear after the first submit, then follow your edits.
  const [tried, setTried] = useState(false)
  const errors = tried ? problems(draft, topics) : {}
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const create = useMutation({
    mutationFn: (data: TaskInput) => createTask({ data }),
    onSuccess: async () => {
      notify('Task created. It runs in its topic on schedule.')
      onOpenChange(false)
      setDraft(empty())
      setTried(false)
      await client.invalidateQueries({ queryKey: tasksQuery.queryKey })
    },
  })

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (create.isPending) return
    setTried(true)
    const found = problems(draft, topics)
    const first = ORDER.find((k) => found[k])
    if (first) {
      document.getElementById(`new-task-${first}`)?.focus()
      return
    }
    const base = { conversation_id: draft.topic!, prompt: draft.prompt.trim(), title: draft.title.trim() || undefined }
    create.mutate(
      draft.repeat === 'once' ? { ...base, when: new Date(draft.when).toISOString() } : { ...base, cron: cronOf(draft), timezone: draft.timezone.trim() },
    )
  }

  const preview = draft.repeat === 'custom' && draft.cron.trim() ? describeCron(draft.cron) : null
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) create.reset()
        onOpenChange(o)
      }}
      title="New task"
      description="A prompt that runs in a topic on a schedule; the agent answers there."
      submitLabel="Create task"
      pendingLabel="Creating…"
      onSubmit={submit}
      pending={create.isPending}
      error={create.error}
    >
      <Field id="new-task-topic" label="Topic" error={errors.topic}>
        {(p) => (
          <TopicPicker
            {...p}
            topics={topics}
            value={draft.topic}
            onChange={(id) => set('topic', id)}
            warnUnready={(label) => `This topic is ${label.toLowerCase()}; the task runs once it’s on and set up.`}
          />
        )}
      </Field>
      <Field id="new-task-prompt" label="What the agent should do" error={errors.prompt} counter={{ count: charCount(draft.prompt), max: PROMPT_MAX }}>
        {(p) => (
          <TextArea {...p} value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="Summarise yesterday’s messages in this topic" className="min-h-24" />
        )}
      </Field>
      <Field
        id="new-task-title"
        label="Title (optional)"
        error={errors.title}
        hint="Shown in the list; otherwise the prompt’s first line is."
        counter={{ count: charCount(draft.title), max: TITLE_MAX }}
      >
        {(p) => <TextInput {...p} dir="auto" value={draft.title} onChange={(e) => set('title', e.target.value)} autoComplete="off" />}
      </Field>
      <Segmented label="Repeat" value={draft.repeat} options={REPEATS} onValueChange={(v) => set('repeat', v)} />
      {draft.repeat === 'once' && (
        <Field id="new-task-when" label="When" error={errors.when}>
          {(p) => <TextInput {...p} type="datetime-local" value={draft.when} onChange={(e) => set('when', e.target.value)} />}
        </Field>
      )}
      {(draft.repeat === 'daily' || draft.repeat === 'weekly') && (
        <div className="grid gap-4 sm:grid-cols-2">
          {draft.repeat === 'weekly' && (
            <Field id="new-task-weekday" label="Day">
              {(p) => (
                <select
                  {...p}
                  value={draft.weekday}
                  onChange={(e) => set('weekday', e.target.value)}
                  className="h-10 w-full rounded-lg bg-sunken px-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] pointer-fine:text-[14px]"
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={String(i)}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field id="new-task-time" label="Time" error={errors.time}>
            {(p) => <TextInput {...p} type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} />}
          </Field>
        </div>
      )}
      {draft.repeat === 'custom' && (
        <Field id="new-task-cron" label="Cron" error={errors.cron} hint={preview ?? 'minute hour day month weekday, like 0 9 * * 1-5 for weekdays at 09:00'}>
          {(p) => (
            <TextInput
              {...p}
              value={draft.cron}
              onChange={(e) => set('cron', e.target.value)}
              placeholder="0 9 * * 1-5"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
            />
          )}
        </Field>
      )}
      {draft.repeat !== 'once' && (
        <Field id="new-task-timezone" label="Time zone" error={errors.timezone}>
          {(p) => (
            <>
              <TextInput {...p} list="new-task-zones" value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" />
              <datalist id="new-task-zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      )}
    </FormDialog>
  )
}
