// What the three overview variants show, worked out once so they differ
// only in layout. Real queries against the stress API.
import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ErrorSummary, Task, Topic } from '../../../api'
import { errorSearchQuery, overviewQuery, tasksQuery, topicsQuery } from '../../../queries'

const DAY = 24 * 60 * 60 * 1000

export function topicGroup(t: Topic): 'ready' | 'setup' | 'off' {
  if (!t.enabled) return 'off'
  return t.setup_state === 'ready' ? 'ready' : 'setup'
}

export type OverviewData = ReturnType<typeof useOverviewData>

export function useOverviewData() {
  const overview = useQuery(overviewQuery)
  const topics = useQuery(topicsQuery)
  const tasks = useInfiniteQuery(tasksQuery)
  const errors = useInfiniteQuery(errorSearchQuery(''))
  const now = Date.now()

  const derived = useMemo(() => {
    const all = topics.data ?? []
    const byId = new Map(all.map((t) => [t.id, t]))
    const recent = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
    const unread = all.filter((t) => t.unread > 0).sort((a, b) => recent(b.last_activity) - recent(a.last_activity))
    const setup = all.filter((t) => topicGroup(t) === 'setup')
    const off = all.filter((t) => topicGroup(t) === 'off')
    const taskList: Task[] = (tasks.data?.pages ?? []).flat()
    const failed = taskList.filter((t) => t.last_error && t.status !== 'cancelled')
    const errorList: ErrorSummary[] = (errors.data?.pages ?? []).flat()
    const errorsToday = errorList.filter((e) => now - new Date(e.created_at).getTime() < DAY)
    return { all, byId, unread, setup, off, failed, errorList, errorsToday, taskList }
    // `now` changes every render; the lists only change with the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.data, tasks.data, errors.data])

  return {
    overview,
    topics,
    tasks,
    errors,
    ...derived,
    pending: overview.isPending || topics.isPending,
    error: overview.error ?? topics.error,
    retry: () => {
      overview.refetch()
      topics.refetch()
      tasks.refetch()
      errors.refetch()
    },
  }
}

/** The first line of an error message (panics run to thousands of characters). */
export function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim()
}
