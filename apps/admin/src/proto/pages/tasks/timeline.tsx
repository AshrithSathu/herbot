// Tasks, variant "Timeline" — axis: grouped by when they run next (due now,
// the next 24 hours, this week, later), then paused and finished. The time
// leads each row; the status only shows when it isn't "active".
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import type { Task } from '../../../api'
import { exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { PageFrame } from './frame'
import { GroupHeading, LastError, Moment, NewTaskDialog, TaskActions, TaskMeta, TaskPrompt, TaskStatus, TaskTitle, topicsById, useNow, useTasks } from './shared'

type GroupId = 'due' | 'day' | 'week' | 'later' | 'paused' | 'finished'
const GROUPS: { id: GroupId; label: string; hint?: string; folded?: boolean }[] = [
  { id: 'due', label: 'Due now', hint: 'waiting for the scheduler' },
  { id: 'day', label: 'Next 24 hours' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'paused', label: 'Paused', hint: 'won’t run until resumed' },
  { id: 'finished', label: 'Finished', hint: 'done and deleted', folded: true },
]

const HOUR = 3_600_000

function groupOf(t: Task, now: number): GroupId {
  if (t.status === 'paused') return 'paused'
  if (t.status !== 'active' || !t.next_run_at) return 'finished'
  const at = new Date(t.next_run_at).getTime() - now
  if (at <= 0) return 'due'
  if (at <= 24 * HOUR) return 'day'
  if (at <= 7 * 24 * HOUR) return 'week'
  return 'later'
}

export function TimelineVariant() {
  return (
    <PageFrame>
      <TimelinePage />
    </PageFrame>
  )
}

function TimelinePage() {
  // Grouping by next run needs every task: the last page can hold the next one.
  const q = useTasks({ all: true })
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => topicsById(topics.data), [topics.data])
  const now = useNow()
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Record<GroupId, boolean>>({ due: true, day: true, week: true, later: true, paused: true, finished: false })

  const groups = useMemo(() => {
    const at = now ?? 0
    const map = new Map<GroupId, Task[]>(GROUPS.map((g) => [g.id, []]))
    for (const t of q.tasks) map.get(groupOf(t, at))!.push(t)
    const time = (t: Task) => (t.next_run_at ? new Date(t.next_run_at).getTime() : Infinity)
    for (const [id, list] of map) {
      if (id === 'finished') list.sort((a, b) => (b.last_run_at ?? '').localeCompare(a.last_run_at ?? '') || b.id - a.id)
      else list.sort((a, b) => time(a) - time(b) || a.id - b.id)
    }
    return map
  }, [q.tasks, now])

  // Lists below a group re-measure their offset when anything above changes.
  let above = ''
  return (
    <ShellPage
      title="Tasks"
      description="What runs next, in order. Each task runs in its topic, and the agent answers there."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden />
          New task
        </Button>
      }
    >
      {q.isPending || now == null ? (
        <ListSkeleton rows={6} />
      ) : q.isError && q.tasks.length === 0 ? (
        <InPlaceError title="Couldn’t load tasks" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : q.tasks.length === 0 ? (
        <InPlaceEmpty
          title="Nothing scheduled"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />
              New task
            </Button>
          }
        >
          A task is a prompt that runs in a topic on a schedule: “every weekday at 9, summarise yesterday”.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-8">
          {q.hasNextPage && (
            <p role="status" className="text-[13px] text-mute">
              Loading every task to put them in order… {exact(q.tasks.length)} so far
            </p>
          )}
          {q.isFetchNextPageError && (
            <InPlaceError title="Couldn’t load the rest of the tasks; the order may be incomplete" error={q.error!} onRetry={() => q.fetchNextPage()} className="min-h-0 py-2" />
          )}
          {GROUPS.map((g) => {
            const list = groups.get(g.id)!
            if (list.length === 0) return null
            const expanded = open[g.id]
            const key = `${g.id}:${above}`
            above += `${g.id}${list.length}${expanded ? 'o' : 'c'}`
            return (
              <section key={g.id} aria-labelledby={`tl-${g.id}`} className="flex flex-col">
                <GroupHeading
                  id={`tl-${g.id}`}
                  count={list.length}
                  hint={g.hint}
                  action={
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`tl-list-${g.id}`}
                      onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                      className="relative inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-mute hover:bg-sunken hover:text-ink pointer-coarse:h-11"
                    >
                      {expanded ? 'Hide' : 'Show'}
                      <ChevronDownIcon aria-hidden className={cn('size-3.5 transition-transform duration-150 ease-out', expanded && 'rotate-180')} />
                    </button>
                  }
                >
                  {g.label}
                </GroupHeading>
                <div id={`tl-list-${g.id}`} hidden={!expanded}>
                  {expanded && (
                    <ThreadList
                      key={key}
                      label={g.label}
                      items={list}
                      itemKey={(t) => t.id}
                      estimate={140}
                      title={(t) => <TaskTitle task={t} />}
                      aside={(t) =>
                        t.status === 'active' && t.next_run_at ? (
                          <span className="text-[13px] font-medium text-ink tabular-nums">
                            {g.id === 'due' && 'due '}
                            <Moment iso={t.next_run_at} now={now} />
                          </span>
                        ) : (
                          <TaskStatus task={t} />
                        )
                      }
                      body={(t) => (
                        <div className="flex flex-col gap-1.5">
                          <TaskPrompt task={t} />
                          <LastError task={t} />
                        </div>
                      )}
                      meta={(t) => <TaskMeta task={t} topic={byId.get(t.conversation_id)} now={now} hide={t.status === 'active' ? ['next'] : []} />}
                      actions={(t) => <TaskActions task={t} />}
                    />
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
      <NewTaskDialog open={creating} onOpenChange={setCreating} topics={topics.data ?? []} />
    </ShellPage>
  )
}
