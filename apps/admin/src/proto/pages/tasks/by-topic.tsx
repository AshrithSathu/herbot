// Tasks, variant "By topic" — axis: grouped by the topic each task runs in.
// One row per topic (virtualized), its tasks inside; topics whose next run
// is soonest come first; "New task here" prefills the topic.
import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HashIcon, MessageCircleIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { Task, Topic } from '../../../api'
import { exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { QuietAction, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { PageFrame } from './frame'
import { LastError, NewTaskDialog, TaskActions, TaskMeta, TaskPrompt, TaskStatus, TaskTitle, topicsById, useNow, useTasks } from './shared'

type Group = { id: number; topic: Topic | undefined; tasks: Task[]; next: number }

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export function ByTopicVariant() {
  return (
    <PageFrame>
      <ByTopicPage />
    </PageFrame>
  )
}

function ByTopicPage() {
  const q = useTasks({ all: true })
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => topicsById(topics.data), [topics.data])
  const now = useNow()
  const [creating, setCreating] = useState<{ topic?: number } | null>(null)
  const [filter, setFilter] = useState('')
  const wanted = fold(useDeferredValue(filter).trim())

  const groups = useMemo(() => {
    const map = new Map<number, Group>()
    for (const t of q.tasks) {
      let g = map.get(t.conversation_id)
      if (!g) map.set(t.conversation_id, (g = { id: t.conversation_id, topic: byId.get(t.conversation_id), tasks: [], next: Infinity }))
      g.tasks.push(t)
      if (t.status === 'active' && t.next_run_at) g.next = Math.min(g.next, new Date(t.next_run_at).getTime())
    }
    const rank = (t: Task) => (t.status === 'active' ? 0 : t.status === 'paused' ? 1 : 2)
    for (const g of map.values()) g.tasks.sort((a, b) => rank(a) - rank(b) || (a.next_run_at ?? '').localeCompare(b.next_run_at ?? '') || b.id - a.id)
    return [...map.values()].sort((a, b) => a.next - b.next || b.tasks.length - a.tasks.length || a.id - b.id)
  }, [q.tasks, byId])
  const shown = wanted ? groups.filter((g) => fold(g.topic?.name ?? '').includes(wanted)) : groups

  return (
    <ShellPage
      title="Tasks"
      description="Tasks by the topic they run in; the topic running something soonest comes first."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={() => setCreating({})}>
          <PlusIcon aria-hidden />
          New task
        </Button>
      }
    >
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError && q.tasks.length === 0 ? (
        <InPlaceError title="Couldn’t load tasks" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : q.tasks.length === 0 ? (
        <InPlaceEmpty
          title="No topic has a task yet"
          action={
            <Button variant="primary" onClick={() => setCreating({})}>
              <PlusIcon aria-hidden />
              New task
            </Button>
          }
        >
          A task is a prompt that runs in a topic on a schedule: “every weekday at 9, summarise yesterday”.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <label htmlFor="tasks-topic-filter" className="sr-only">
                Filter topics
              </label>
              <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                id="tasks-topic-filter"
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
                placeholder={`Filter ${exact(groups.length)} topics`}
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-lg bg-sunken pr-3 pl-9 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            <p role="status" className="text-[13px] text-mute tabular-nums">
              {q.hasNextPage ? `Loading every task… ${exact(q.tasks.length)} so far` : `${exact(q.tasks.length)} tasks in ${exact(groups.length)} topics`}
            </p>
          </div>
          {q.isFetchNextPageError && (
            <InPlaceError title="Couldn’t load the rest of the tasks" error={q.error!} onRetry={() => q.fetchNextPage()} className="min-h-0 py-2" />
          )}
          {shown.length === 0 ? (
            <InPlaceEmpty
              title="No topic matches that name"
              action={
                <Button variant="secondary" onClick={() => setFilter('')}>
                  Clear filter
                </Button>
              }
            />
          ) : (
            <ThreadList
              label="Topics with tasks"
              items={shown}
              itemKey={(g) => g.id}
              estimate={220}
              title={(g) => <GroupTitle group={g} />}
              aside={(g) => (
                <span className="text-[13px] text-mute tabular-nums">
                  {exact(g.tasks.length)} {g.tasks.length === 1 ? 'task' : 'tasks'}
                </span>
              )}
              body={(g) => (
                <ol className="mt-1 flex flex-col">
                  {g.tasks.map((t) => (
                    <li key={t.id} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-1">
                      <div className="flex min-w-0 items-baseline gap-3 text-ink">
                        <div className="min-w-0 flex-1">
                          <TaskTitle task={t} />
                        </div>
                        <TaskStatus task={t} />
                      </div>
                      <TaskPrompt task={t} />
                      <LastError task={t} />
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] text-faint">
                        <TaskMeta task={t} topic={g.topic} now={now} hide={['topic']} />
                      </div>
                      <div className="relative z-[1] -mx-2 flex flex-wrap items-center gap-1">
                        <TaskActions task={t} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              actions={(g) =>
                g.topic ? (
                  <QuietAction onClick={() => setCreating({ topic: g.id })}>
                    <PlusIcon aria-hidden />
                    New task here
                  </QuietAction>
                ) : null
              }
            />
          )}
        </div>
      )}
      <NewTaskDialog open={creating != null} onOpenChange={(o) => !o && setCreating(null)} topics={topics.data ?? []} topic={creating?.topic} />
    </ShellPage>
  )
}

function GroupTitle({ group }: { group: Group }) {
  if (!group.topic) return <span className="text-mute italic">A deleted topic</span>
  const Icon = group.topic.is_general ? MessageCircleIcon : HashIcon
  const status = topicTone(group.topic)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Link
        to="/topics/$id"
        params={{ id: group.topic.id }}
        className={cn('relative z-[1] inline-flex min-w-0 items-center gap-1.5 underline-offset-2 hover:underline')}
      >
        <Icon aria-hidden className="size-3.5 shrink-0 text-mute" />
        <UserText className="min-w-0 text-[15px] font-semibold">{group.topic.name}</UserText>
      </Link>
      {status.tone !== 'ok' && <StatusDot status={status} dense className="shrink-0" />}
    </span>
  )
}
