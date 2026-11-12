// Overview variant 3, "Since" — axis: a quiet timeline. What happened,
// newest first, grouped by day: agents that replied, tasks that ran or
// failed, errors. No figures beyond one line; nothing shouts.
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ago, clock, dayKey, dayLabel, exact, plural } from '../../../format'
import { Button, Segmented, type Choice } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { QuietAction } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { Dot, type Tone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { firstLine, useOverviewData, type OverviewData } from './data'
import { Frame, useNewAgent } from './frame'

export function Since() {
  return (
    <Frame>
      <SincePage />
    </Frame>
  )
}

type Kind = 'reply' | 'task' | 'error'
type Event = {
  key: string
  kind: Kind
  at: string
  tone: Tone
  title: React.ReactNode
  detail?: string
  /** The detail is error text (monospace). */
  code?: boolean
  link: { to: '/topics/$id'; params: { id: number } } | { to: '/logs/$id'; params: { id: string } } | { to: '/tasks' }
}

const FILTERS: Choice<'all' | Kind>[] = [
  { value: 'all', label: 'Everything' },
  { value: 'reply', label: 'Replies', hint: 'Agents that answered since you last read them' },
  { value: 'task', label: 'Tasks', hint: 'Scheduled runs, and the ones that failed' },
  { value: 'error', label: 'Errors', hint: 'Every failure recorded with an E-id' },
]

function events(d: OverviewData): Event[] {
  const out: Event[] = []
  for (const t of d.all) {
    if (!t.last_activity) continue
    out.push({
      key: `t${t.id}`,
      kind: 'reply',
      at: t.last_activity,
      tone: t.unread > 0 ? 'active' : 'idle',
      title: (
        <>
          <UserText className="font-medium">{t.name}</UserText>
          <span className="shrink-0 text-mute">{t.unread > 0 ? `· ${t.unread >= 99 ? '99+' : t.unread} new` : '· read'}</span>
        </>
      ),
      detail: t.purpose ?? undefined,
      link: { to: '/topics/$id', params: { id: t.id } },
    })
  }
  for (const t of d.taskList) {
    if (!t.last_run_at) continue
    out.push({
      key: `k${t.id}`,
      kind: 'task',
      at: t.last_run_at,
      tone: t.last_error ? 'off' : 'ok',
      title: (
        <>
          <span className="shrink-0 text-mute">{t.last_error ? 'Task failed:' : 'Task ran:'}</span>
          <UserText className="font-medium">{t.title ?? firstLine(t.prompt)}</UserText>
        </>
      ),
      detail: t.last_error ?? (d.byId.get(t.conversation_id)?.name || undefined),
      code: Boolean(t.last_error),
      link: { to: '/tasks' },
    })
  }
  for (const e of d.errorList) {
    out.push({
      key: `e${e.id}`,
      kind: 'error',
      at: e.created_at,
      tone: 'off',
      title: (
        <>
          <span className="shrink-0 font-mono font-medium tabular-nums">{e.error_id}</span>
          <UserText className="min-w-0 font-mono text-mute">{e.kind}</UserText>
        </>
      ),
      detail: firstLine(e.message),
      code: true,
      link: { to: '/logs/$id', params: { id: e.error_id } },
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

const PAGE = 40

function SincePage() {
  const d = useOverviewData()
  const o = d.overview.data
  const newAgent = useNewAgent()
  const [filter, setFilter] = useState<'all' | Kind>('all')
  const [limit, setLimit] = useState(PAGE)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => events(d), [d.all, d.taskList, d.errorList])
  const shown = filter === 'all' ? all : all.filter((e) => e.kind === filter)
  const visible = shown.slice(0, limit)

  // Group consecutive events by local day.
  const days: { key: string; label: string; events: Event[] }[] = []
  for (const e of visible) {
    const k = dayKey(e.at)
    if (days.at(-1)?.key !== k) days.push({ key: k, label: dayLabel(e.at), events: [] })
    days.at(-1)!.events.push(e)
  }

  return (
    <ShellPage
      title="Since you were here"
      back={<BackToAgents />}
      actions={<Button onClick={newAgent}>New agent</Button>}
      description={
        o ? (
          <span className="tabular-nums">
            {exact(o.enabled_conversations)} of {exact(o.conversations)} agents answering · {plural(o.errors_last_24h, 'error')} in the last day
          </span>
        ) : undefined
      }
    >
      <Segmented label="Show" value={filter} options={FILTERS} onValueChange={(v) => { setFilter(v); setLimit(PAGE) }} className="max-w-md" />
      {d.error ? (
        <InPlaceError title="Couldn’t load what happened" error={d.error} onRetry={d.retry} />
      ) : d.pending ? (
        <ListSkeleton rows={8} lines={1} />
      ) : shown.length === 0 ? (
        <InPlaceEmpty title="Nothing happened yet" action={filter !== 'all' ? <Button onClick={() => setFilter('all')}>Show everything</Button> : undefined}>
          Replies, task runs and errors show up here as they happen.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label} className="flex flex-col">
              <h2 className="sticky top-0 z-[1] -mx-1 bg-pane/95 px-1 py-1.5 text-[11px] font-medium tracking-[0.06em] text-mute uppercase" suppressHydrationWarning>
                {day.label}
              </h2>
              <ol className="flex flex-col border-t border-line">
                {day.events.map((e) => (
                  <li key={e.key} className="relative grid grid-cols-[3.25rem_0.75rem_minmax(0,1fr)] items-baseline gap-x-2 border-b border-line py-2.5 hover:bg-sunken">
                    <time dateTime={e.at} title={ago(e.at)} className="pl-1 text-[12.5px] text-faint tabular-nums" suppressHydrationWarning>
                      {clock(e.at)}
                    </time>
                    <Dot tone={e.tone} className="translate-y-[-1px]" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        {...(e.link as { to: '/tasks' })}
                        className="flex min-w-0 items-baseline gap-1.5 text-[14px] outline-none after:absolute after:inset-0 focus-visible:underline"
                      >
                        {e.title}
                      </Link>
                      {e.detail && <UserText className={e.code ? 'font-mono text-[12.5px] text-mute' : 'text-[13px] text-mute'}>{e.detail}</UserText>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {shown.length > limit && (
            <div className="flex items-center justify-center gap-3 text-[13px] text-mute">
              <span className="tabular-nums">
                {exact(limit)} of {exact(shown.length)}
              </span>
              <QuietAction onClick={() => setLimit((l) => l + PAGE)}>Show earlier</QuietAction>
            </div>
          )}
        </div>
      )}
    </ShellPage>
  )
}
