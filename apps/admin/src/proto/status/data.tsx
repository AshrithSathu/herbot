// Shared real data for the status prototype (throwaway; nothing in
// production imports src/proto). Every variant renders the same contexts:
// overview figures, agent rows, a topic header with live activity, tasks,
// error kinds, and a legend of every state.
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ErrorSummary, Task, Topic } from '../../api'
import { topicStatus } from '../../format'
import { errorSearchQuery, overviewQuery, tasksQuery, topicsQuery } from '../../queries'

export type Tone = 'success' | 'warning' | 'danger' | 'muted' | 'accent'

export type TopicStateKey = 'ready' | 'asking' | 'waiting' | 'unset' | 'off'
export type TaskStateKey = Task['status']
export type ActivityKey = 'idle' | 'working' | 'transcribing' | 'sending' | 'failed'

export const TOPIC_STATES: Record<TopicStateKey, { label: string; tone: Tone; meaning: string }> = {
  ready: { label: 'Ready', tone: 'success', meaning: 'Has a purpose; messages go to its agent.' },
  asking: { label: 'Asking its purpose', tone: 'warning', meaning: 'Waiting for you to say what it’s for.' },
  waiting: { label: 'Waiting for a new purpose', tone: 'warning', meaning: 'After /setup: your next message replaces the purpose.' },
  unset: { label: 'Not set up', tone: 'muted', meaning: 'No message yet, so it hasn’t asked.' },
  off: { label: 'Off', tone: 'danger', meaning: 'Switched off; messages there are ignored.' },
}

export const TASK_STATES: Record<TaskStateKey, { label: string; tone: Tone; meaning: string }> = {
  active: { label: 'Active', tone: 'success', meaning: 'Runs on its schedule.' },
  paused: { label: 'Paused', tone: 'warning', meaning: 'Kept, but won’t run until resumed.' },
  done: { label: 'Done', tone: 'muted', meaning: 'A one-off that has run.' },
  cancelled: { label: 'Deleted', tone: 'danger', meaning: 'Stopped for good.' },
}

export const ACTIVITY: Record<ActivityKey, { label: string; tone: Tone; meaning: string }> = {
  idle: { label: 'Idle', tone: 'muted', meaning: 'Nothing running.' },
  working: { label: 'Thinking…', tone: 'accent', meaning: 'The agent is working on a reply.' },
  transcribing: { label: 'Transcribing…', tone: 'accent', meaning: 'Turning your voice note into text.' },
  sending: { label: 'Sending…', tone: 'muted', meaning: 'Your message is on its way.' },
  failed: { label: 'Not sent', tone: 'danger', meaning: 'Failed with an error ID; retry or edit.' },
}

export const TONE_VAR: Record<Tone, string> = {
  success: 'var(--c-ok)',
  warning: 'var(--c-warn)',
  danger: 'var(--c-off)',
  muted: 'var(--c-faint)',
  accent: 'var(--c-accent)',
}

export function topicKey(t: Pick<Topic, 'enabled' | 'setup_state' | 'purpose'>): TopicStateKey {
  const label = topicStatus(t).label
  return (Object.keys(TOPIC_STATES) as TopicStateKey[]).find((k) => TOPIC_STATES[k].label === label) ?? 'unset'
}

/** Unread counts as the agent list would show them. */
export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n)
}

export type Sample = {
  topics: (Topic & { state: TopicStateKey; unread: number; activity: ActivityKey; sample?: boolean })[]
  tasks: (Task & { topicName: string })[]
  errors: ErrorSummary[]
  overview: { answering: number; total: number; messages: number; errors: number; threads: number } | null
  pending: boolean
  failed: Error | null
}

const UNREAD = [0, 3, 0, 128, 12, 0, 1, 0]
const ACT: ActivityKey[] = ['working', 'idle', 'idle', 'transcribing', 'idle', 'failed', 'sending', 'idle']

/** One real topic per state (the stress seed has none "waiting for a new
 * purpose", so one ready topic is shown in that state and marked as a
 * sample), plus one real task per status and a spread of error kinds. */
export function useSample(): Sample {
  const topics = useQuery(topicsQuery)
  const overview = useQuery(overviewQuery)
  const tasks = useInfiniteQuery(tasksQuery)
  const errors = useInfiniteQuery(errorSearchQuery(''))

  const sample = useMemo(() => {
    const all = topics.data ?? []
    const byKey = new Map<TopicStateKey, Topic[]>()
    for (const t of all) {
      const k = topicKey(t)
      byKey.set(k, [...(byKey.get(k) ?? []), t])
    }
    const pick: Sample['topics'] = []
    const take = (k: TopicStateKey, n: number) => (byKey.get(k) ?? []).slice(0, n).forEach((t) => pick.push({ ...t, state: k, unread: 0, activity: 'idle' }))
    take('ready', 3)
    take('asking', 1)
    take('unset', 1)
    take('off', 1)
    const donor = (byKey.get('ready') ?? [])[3]
    if (donor) pick.push({ ...donor, setup_state: 'awaiting_purpose', state: 'waiting', unread: 0, activity: 'idle', sample: true })
    const longest = all.find((t) => t.name.length >= 128)
    if (longest && !pick.some((p) => p.id === longest.id)) pick.push({ ...longest, state: topicKey(longest), unread: 0, activity: 'idle' })
    return pick.map((t, i) => ({ ...t, unread: UNREAD[i % UNREAD.length], activity: ACT[i % ACT.length] }))
  }, [topics.data])

  const names = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t.name])), [topics.data])
  const allTasks = useMemo(() => tasks.data?.pages.flat() ?? [], [tasks.data])
  const taskPick = useMemo(() => {
    const out: Sample['tasks'] = []
    for (const st of ['active', 'paused', 'done', 'cancelled'] as const) {
      const t = allTasks.find((x) => x.status === st && (x.title?.length ?? 0) > 100) ?? allTasks.find((x) => x.status === st)
      if (t) out.push({ ...t, topicName: names.get(t.conversation_id) ?? `Topic #${t.conversation_id}` })
    }
    return out
  }, [allTasks, names])

  // Keep paging tasks until every status has an example (or there are no more).
  const missing = (['active', 'paused', 'done', 'cancelled'] as const).some((st) => !allTasks.some((t) => t.status === st))
  useEffect(() => {
    if (missing && tasks.hasNextPage && !tasks.isFetchingNextPage) void tasks.fetchNextPage()
  }, [missing, tasks])

  const errorPick = useMemo(() => {
    const seen = new Set<string>()
    const out: ErrorSummary[] = []
    for (const e of errors.data?.pages.flat() ?? []) {
      if (seen.has(e.kind)) continue
      seen.add(e.kind)
      out.push(e)
    }
    return out.slice(0, 7)
  }, [errors.data])

  const o = overview.data
  return {
    topics: sample,
    tasks: taskPick,
    errors: errorPick,
    overview: o
      ? { answering: o.enabled_conversations, total: o.conversations, messages: o.messages, errors: o.errors_last_24h, threads: o.active_threads }
      : null,
    pending: topics.isPending || overview.isPending || tasks.isPending || errors.isPending,
    failed: topics.error ?? overview.error ?? tasks.error ?? errors.error ?? null,
  }
}

/** Cycles a topic header through every activity state, to watch transitions. */
export function useActivityCycle() {
  const order: ActivityKey[] = ['idle', 'sending', 'working', 'transcribing', 'failed']
  const [i, setI] = useState(0)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setI((n) => (n + 1) % order.length), 1600)
    return () => window.clearInterval(id)
  }, [running, order.length])
  return { activity: order[i], running, toggle: () => setRunning((r) => !r), set: (k: ActivityKey) => setI(order.indexOf(k)) , order }
}
