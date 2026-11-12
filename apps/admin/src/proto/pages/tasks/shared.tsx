// Throwaway (emil-prototype): what the three Tasks layouts share, so they
// differ only in how the list is organised. Row parts follow DECISIONS.md
// (Thread rows, quiet always-visible actions, Signal status); the New task
// form is the kit's FormDialog.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronsUpDownIcon, HashIcon, MessageCircleIcon, PauseIcon, PlayIcon, Trash2Icon, ZapIcon, CheckIcon } from 'lucide-react'
import { changeTask, createTask, type Task, type TaskInput, type Topic } from '../../../api'
import { charCount, exact, when } from '../../../format'
import { tasksQuery } from '../../../queries'
import { Button, Field, Segmented, TextArea, TextInput } from '@/components/hb/controls'
import { ConfirmDialog, FormDialog } from '@/components/hb/dialogs'
import { notify } from '@/components/hb/feedback'
import { QuietAction } from '@/components/hb/rows'
import { StatusDot, taskTone, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Data

/** Every task, page by page. Grouped layouts need all of them: a task on
 * the last page can run in the next hour. */
export function useTasks({ all }: { all: boolean }) {
  const q = useInfiniteQuery(tasksQuery)
  const tasks = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = q
  useEffect(() => {
    if (all && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage()
  }, [all, hasNextPage, isFetchingNextPage, isError, fetchNextPage])
  return { ...q, tasks }
}

export function topicsById(topics: Topic[] | undefined): Map<number, Topic> {
  return new Map((topics ?? []).map((t) => [t.id, t]))
}

// ---------------------------------------------------------------------------
// Words

export function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? ''
}

/** A task's name: its title, or the first line of its prompt. */
export function taskName(task: Task): string {
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

/** Five-field cron in words, or null when it doesn't read simply. */
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

/** "Every weekday at 09:00", "Once, 23 Nov 2026 at 01:44", or the raw cron. */
export function scheduleWords(task: Task): string {
  if (!task.cron) return task.once_at ? `Once, ${when(task.once_at)}` : 'Once'
  return describeCron(task.cron) ?? 'Custom schedule'
}

export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function fromNow(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  const span = abs < 60 ? null : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 172_800 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86_400)} days`
  if (!span) return seconds > 0 ? 'in under a minute' : 'just now'
  return seconds > 0 ? `in ${span}` : `${span} ago`
}

/** Relative time with the exact time on hover; absolute before hydration. */
export function Moment({ iso, now }: { iso: string | null; now: number | null }) {
  if (!iso) return <span>—</span>
  return (
    <time dateTime={iso} title={when(iso)} suppressHydrationWarning>
      {now == null ? when(iso) : fromNow(iso, now)}
    </time>
  )
}

// ---------------------------------------------------------------------------
// Row parts (ThreadList renderers)

export function TopicLink({ topic, id }: { topic: Topic | undefined; id: number }) {
  if (!topic) return <span className="italic">a deleted topic</span>
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <Link
      to="/topics/$id"
      params={{ id: topic.id }}
      className="relative z-[1] inline-flex max-w-[24ch] min-w-0 items-center gap-1 text-mute underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 hover:text-ink hover:underline"
      title={`Topic ${id}`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <UserText className="min-w-0">{topic.name}</UserText>
    </Link>
  )
}

export function TaskTitle({ task }: { task: Task }) {
  return (
    <UserText as="span" lines={2} className={cn('text-[15px] font-medium', task.status === 'cancelled' && 'text-mute line-through decoration-1')}>
      {taskName(task)}
    </UserText>
  )
}

/** The prompt, when it says more than the title; two lines, full on demand. */
export function TaskPrompt({ task }: { task: Task }) {
  const [open, setOpen] = useState(false)
  const same = !task.title?.trim() && task.prompt.trim() === firstLine(task.prompt)
  if (same) return null
  const long = charCount(task.prompt) > 160 || task.prompt.includes('\n')
  return (
    <div className="flex flex-col items-start gap-1">
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
    </div>
  )
}

/** Small facts: topic, schedule, next run, runs, raw cron. */
export function TaskMeta({ task, topic, now, hide = [] }: { task: Task; topic: Topic | undefined; now: number | null; hide?: ('topic' | 'next')[] }) {
  const words = scheduleWords(task)
  return (
    <>
      {!hide.includes('topic') && (
        <>
          <TopicLink topic={topic} id={task.conversation_id} />
          <span aria-hidden>·</span>
        </>
      )}
      <span title={task.cron ? `${task.cron} (${task.timezone})` : undefined}>{words}</span>
      {task.cron && words === 'Custom schedule' && (
        <span className="max-w-full truncate font-mono text-[12px]">
          {task.cron} · {task.timezone}
        </span>
      )}
      {!hide.includes('next') && task.next_run_at && (task.status === 'active' || task.status === 'paused') && (
        <>
          <span aria-hidden>·</span>
          <span>
            {task.status === 'paused' ? 'would run ' : now != null && new Date(task.next_run_at).getTime() <= now ? 'due ' : 'next '}
            <Moment iso={task.next_run_at} now={now} />
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="tabular-nums">{task.run_count === 0 ? 'not run yet' : `ran ${exact(task.run_count)}×`}</span>
    </>
  )
}

/** The last run's failure: red, two lines, the rest on request. */
export function LastError({ task }: { task: Task }) {
  if (!task.last_error) return null
  return (
    <p className="flex min-w-0 gap-1.5 text-[13px] text-destructive">
      <span className="shrink-0 font-medium">Last run failed:</span>
      <UserText lines={1} className="min-w-0 font-mono text-[12.5px]">
        {task.last_error}
      </UserText>
    </p>
  )
}

export type TaskAction = 'pause' | 'resume' | 'cancel' | 'run'

/** Pause/Resume, Run now and Delete…, each with its own pending state and
 * its own error line; Delete is separated and confirmed. */
export function TaskActions({ task }: { task: Task }) {
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const act = useMutation({
    mutationFn: (action: TaskAction) => changeTask({ data: { id: task.id, action } }),
    onSuccess: async (_t, action) => {
      setConfirm(false)
      notify(
        action === 'pause' ? 'Task paused.' : action === 'resume' ? 'Task resumed.' : action === 'run' ? 'Task queued to run now.' : 'Task deleted.',
      )
      await client.invalidateQueries({ queryKey: ['tasks'] })
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
      <span className="ml-auto" />
      <QuietAction tone="danger" onClick={() => setConfirm(true)} disabled={act.isPending}>
        <Trash2Icon aria-hidden />
        Delete…
      </QuietAction>
      {act.isError && act.variables !== 'cancel' && (
        <p role="alert" className="basis-full px-2 text-[12.5px] text-destructive">
          Couldn’t {act.variables === 'run' ? 'run it' : act.variables}: {act.error.message}
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
        guard={{ kind: 'separated' }}
        pending={pending === 'cancel'}
        error={act.isError && act.variables === 'cancel' ? act.error : null}
        onConfirm={() => act.mutate('cancel')}
      />
    </>
  )
}

/** One status word for the row's corner. */
export function TaskStatus({ task }: { task: Task }) {
  return <StatusDot status={taskTone(task.status)} dense />
}

/** "Loading older tasks… 150 of 300+" while pages arrive; a retry if one fails. */
export function LoadingMore({ q, count }: { q: ReturnType<typeof useTasks>; count: number }) {
  if (q.isFetchNextPageError) {
    return (
      <div role="alert" className="flex items-center gap-3 px-1 py-4 text-[13px] text-destructive">
        Couldn’t load older tasks: {q.error?.message}
        <Button size="sm" variant="secondary" onClick={() => q.fetchNextPage()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!q.hasNextPage) return null
  return (
    <p className="px-1 py-4 text-[13px] text-mute" role="status">
      {q.isFetchingNextPage ? `Loading older tasks… ${exact(count)} so far` : `${exact(count)} loaded`}
    </p>
  )
}

/** A section heading inside a page: the label, a count, an optional action. */
export function GroupHeading({ id, children, count, action, hint }: { id: string; children: ReactNode; count?: number; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-end justify-between gap-3 border-b border-line pb-2">
      <h2 id={id} className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold tracking-[0.04em] text-ink uppercase">
        <span className="min-w-0 truncate">{children}</span>
        {count !== undefined && <span className="font-normal tracking-normal text-mute tabular-nums">{exact(count)}</span>}
        {hint && <span className="truncate font-normal tracking-normal text-faint normal-case">{hint}</span>}
      </h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// New task

type Repeat = 'once' | 'daily' | 'weekly' | 'custom'
const REPEATS = [
  { value: 'once', label: 'Once', hint: 'Runs one time, at the moment you pick.' },
  { value: 'daily', label: 'Every day', hint: 'Runs every day at the same time.' },
  { value: 'weekly', label: 'Every week', hint: 'Runs on one weekday at the same time.' },
  { value: 'custom', label: 'Custom', hint: 'Five-field cron: minute hour day month weekday.' },
] as const
export const TITLE_MAX = 200
export const PROMPT_MAX = 16_000

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

/** Problems by field, the way herbot-core checks them. */
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

const ZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']

/** The New task form. `topic` prefills the topic (by-topic layout). */
export function NewTaskDialog({ open, onOpenChange, topics, topic }: { open: boolean; onOpenChange: (open: boolean) => void; topics: Topic[]; topic?: number }) {
  const client = useQueryClient()
  const empty = (): Draft => ({ topic: topic ?? null, title: '', prompt: '', repeat: 'once', when: '', time: '09:00', weekday: '1', cron: '', timezone: browserZone() })
  const [draft, setDraft] = useState<Draft>(empty)
  const [tried, setTried] = useState(false)
  // Re-prefill when opened from a different topic.
  useEffect(() => {
    if (open) setDraft((d) => (topic != null && d.topic !== topic ? { ...d, topic } : d))
  }, [open, topic])
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
    const first = (['topic', 'prompt', 'title', 'when', 'time', 'cron', 'timezone'] as const).find((k) => found[k])
    if (first) {
      document.getElementById(`new-task-${first}`)?.focus()
      return
    }
    const base = { conversation_id: draft.topic!, prompt: draft.prompt.trim(), title: draft.title.trim() || undefined }
    create.mutate(
      draft.repeat === 'once'
        ? { ...base, when: new Date(draft.when).toISOString() }
        : { ...base, cron: cronOf(draft), timezone: draft.timezone.trim() },
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
        {(p) => <TopicPicker {...p} topics={topics} value={draft.topic} onChange={(id) => set('topic', id)} />}
      </Field>
      <Field id="new-task-prompt" label="What the agent should do" error={errors.prompt} counter={{ count: charCount(draft.prompt), max: PROMPT_MAX }}>
        {(p) => (
          <TextArea
            {...p}
            value={draft.prompt}
            onChange={(e) => set('prompt', e.target.value)}
            placeholder="Summarise yesterday’s messages in this topic"
            className="min-h-24"
          />
        )}
      </Field>
      <Field id="new-task-title" label="Title (optional)" error={errors.title} hint="Shown in the list; the prompt’s first line otherwise." counter={{ count: charCount(draft.title), max: TITLE_MAX }}>
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
                <select {...p} value={draft.weekday} onChange={(e) => set('weekday', e.target.value)} className="h-10 w-full rounded-lg bg-sunken px-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px]">
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
        <Field
          id="new-task-cron"
          label="Cron"
          error={errors.cron}
          hint={preview ?? 'minute hour day month weekday, like 0 9 * * 1-5 for weekdays at 09:00'}
        >
          {(p) => (
            <TextInput {...p} value={draft.cron} onChange={(e) => set('cron', e.target.value)} placeholder="0 9 * * 1-5" className="font-mono" autoComplete="off" spellCheck={false} autoCapitalize="off" />
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

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

/** A combobox over every topic: type to filter (case and accents folded). */
function TopicPicker({ id, topics, value, onChange, ...aria }: {
  id: string
  topics: Topic[]
  value: number | null
  onChange: (id: number | null) => void
  'aria-invalid'?: true
  'aria-describedby'?: string
}) {
  const listId = useId()
  const selected = topics.find((t) => t.id === value) ?? null
  const [text, setText] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => setText(selected?.name ?? ''), [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const typed = selected && text === selected.name ? '' : text
  const matches = useMemo(() => {
    const wanted = fold(typed.trim())
    return wanted ? topics.filter((t) => fold(t.name).includes(wanted)) : topics
  }, [topics, typed])
  useEffect(() => setActive(0), [typed])
  useEffect(() => {
    // scrollIntoView may return a promise here: never return it from the effect.
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])
  const pick = (t: Topic) => {
    onChange(t.id)
    setText(t.name)
    setOpen(false)
  }
  const warn = selected ? topicTone(selected) : null
  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        {...aria}
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
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className="h-10 w-full min-w-0 rounded-lg bg-sunken pr-9 pl-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] md:text-[14px]"
      />
      <ChevronsUpDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mute" />
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label="Topics" className="scroller absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg bg-pane p-1 shadow-raised">
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-[14px] text-mute">No topic matches that name.</li>
          ) : (
            matches.map((t, i) => {
              const s = topicTone(t)
              const Icon = t.is_general ? MessageCircleIcon : HashIcon
              return (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={t.id === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(t)}
                  onMouseMove={() => setActive(i)}
                  className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] md:min-h-9', i === active && 'bg-sunken')}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-mute" />
                  <UserText className="min-w-0 flex-1">{t.name}</UserText>
                  {s.tone !== 'ok' && <span className="shrink-0 text-[12px] text-mute">{s.short}</span>}
                  <CheckIcon aria-hidden className={cn('size-4 shrink-0', t.id === value ? 'opacity-100' : 'opacity-0')} />
                </li>
              )
            })
          )}
        </ul>
      )}
      {warn && warn.tone !== 'ok' && (
        <p className="mt-1.5 text-[12.5px] text-warning">This topic is {warn.label.toLowerCase()}; the task runs once it’s on and set up.</p>
      )}
    </div>
  )
}
