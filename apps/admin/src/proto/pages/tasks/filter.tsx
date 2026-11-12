// Tasks, variant "Filter" — axis: one list, newest first, narrowed by a
// status filter. Pages load as you scroll; counts say "+" until they're all in.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import type { Task } from '../../../api'
import { exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { Button, Segmented } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { PageFrame } from './frame'
import { LastError, LoadingMore, NewTaskDialog, TaskActions, TaskMeta, TaskPrompt, TaskStatus, TaskTitle, topicsById, useNow, useTasks } from './shared'

type Filter = 'all' | Task['status']
const LABEL: Record<Filter, string> = { all: 'All', active: 'Active', paused: 'Paused', done: 'Done', cancelled: 'Deleted' }
const HINT: Record<Filter, string> = {
  all: 'Every task, newest first.',
  active: 'Running on their schedule.',
  paused: 'Kept, but won’t run until you resume them.',
  done: 'One-off tasks that already ran.',
  cancelled: 'Deleted tasks, kept for their history.',
}

export function FilterVariant() {
  return (
    <PageFrame>
      <FilterPage />
    </PageFrame>
  )
}

function FilterPage() {
  const q = useTasks({ all: false })
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => topicsById(topics.data), [topics.data])
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const more = q.hasNextPage ? '+' : ''
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: q.tasks.length, active: 0, paused: 0, done: 0, cancelled: 0 }
    for (const t of q.tasks) c[t.status]++
    return c
  }, [q.tasks])
  const shown = filter === 'all' ? q.tasks : q.tasks.filter((t) => t.status === filter)
  const options = (Object.keys(LABEL) as Filter[]).map((f) => ({ value: f, label: `${LABEL[f]} ${exact(counts[f])}${more}`, hint: HINT[f] }))

  return (
    <ShellPage
      title="Tasks"
      description="Reminders and recurring prompts. Each one runs in its topic, and the agent answers there."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
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
          title="No tasks yet"
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
              onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
              title={(t) => <TaskTitle task={t} />}
              aside={(t) => <TaskStatus task={t} />}
              body={(t) => (
                <div className="flex flex-col gap-1.5">
                  <TaskPrompt task={t} />
                  <LastError task={t} />
                </div>
              )}
              meta={(t) => <TaskMeta task={t} topic={byId.get(t.conversation_id)} now={now} />}
              actions={(t) => <TaskActions task={t} />}
              footer={<LoadingMore q={q} count={q.tasks.length} />}
            />
          )}
        </div>
      )}
      <NewTaskDialog open={creating} onOpenChange={setCreating} topics={topics.data ?? []} />
    </ShellPage>
  )
}
