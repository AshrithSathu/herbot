// What every topics variant shares: filtering, sorting, selection and the
// real bulk on/off (with Undo). The variants differ only in layout.
import { useDeferredValue, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { setEnabled, type Topic } from '../../../api'
import { exact } from '../../../format'
import { keys } from '../../../queries'
import { fold } from '@/components/hb/agent-list'
import type { Choice } from '@/components/hb/controls'
import { notify } from '@/components/hb/feedback'
import { topicGroup } from '../overview/data'

export type StateFilter = 'all' | 'ready' | 'setup' | 'off'
export type SortBy = 'made' | 'recent' | 'busiest'

export const SORTS: Choice<SortBy>[] = [
  { value: 'made', label: 'Order made', hint: 'General first, then the order you made them' },
  { value: 'recent', label: 'Recently active', hint: 'The agents you talked to last come first' },
  { value: 'busiest', label: 'Most messages', hint: 'The longest histories first' },
]

export function stateChoices(all: Topic[]): Choice<StateFilter>[] {
  const n = (g: StateFilter) => exact(g === 'all' ? all.length : all.filter((t) => topicGroup(t) === g).length)
  return [
    { value: 'all', label: `All ${n('all')}` },
    { value: 'ready', label: `Ready ${n('ready')}`, hint: 'Switched on and set up: they answer' },
    { value: 'setup', label: `Needs setup ${n('setup')}`, hint: 'Waiting for you to say what they’re for' },
    { value: 'off', label: `Off ${n('off')}`, hint: 'Messages there are ignored until you switch them on' },
  ]
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

export function sortTopics(list: Topic[], by: SortBy): Topic[] {
  if (by === 'made') return list
  const copy = [...list]
  copy.sort((a, b) => (by === 'recent' ? time(b.last_activity) - time(a.last_activity) : b.messages - a.messages))
  return copy
}

/** Filter text (deferred so typing stays smooth over hundreds of rows). */
export function useTopicFilter(all: Topic[], state: StateFilter, sort: SortBy) {
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const shown = useMemo(() => {
    const wanted = fold(deferred.trim())
    const byState = state === 'all' ? all : all.filter((t) => topicGroup(t) === state)
    const byText = wanted ? byState.filter((t) => fold(t.name).includes(wanted) || fold(t.purpose ?? '').includes(wanted)) : byState
    return sortTopics(byText, sort)
  }, [all, deferred, state, sort])
  return { text, setText, shown, filtering: text.trim() !== '' }
}

/** A set of selected topic ids. */
export function useSelection() {
  const [ids, setIds] = useState<Set<number>>(() => new Set())
  return {
    ids,
    has: (id: number) => ids.has(id),
    toggle: (id: number) =>
      setIds((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    setMany: (list: number[], on: boolean) =>
      setIds((s) => {
        const next = new Set(s)
        for (const id of list) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    clear: () => setIds(new Set()),
  }
}

/** Switches topics on or off, six at a time. Failures stay on screen with
 * their E-ids; success is a toast with Undo. */
export function useBulkSwitch() {
  const client = useQueryClient()
  const [failed, setFailed] = useState<{ id: number; error: string }[]>([])
  const run = async (ids: number[], enabled: boolean) => {
    const errors: { id: number; error: string }[] = []
    for (let i = 0; i < ids.length; i += 6) {
      const batch = ids.slice(i, i + 6)
      const results = await Promise.allSettled(batch.map((id) => setEnabled({ data: { id, enabled } })))
      results.forEach((r, j) => r.status === 'rejected' && errors.push({ id: batch[j], error: (r.reason as Error).message }))
    }
    await client.invalidateQueries({ queryKey: keys.topics })
    return errors
  }
  const mutation = useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) => run(ids, enabled),
    onMutate: () => setFailed([]),
    onSuccess: (errors, { ids, enabled }) => {
      setFailed(errors)
      const done = ids.filter((id) => !errors.some((e) => e.id === id))
      if (done.length > 0) {
        const what = `${exact(done.length)} ${done.length === 1 ? 'topic' : 'topics'}`
        notify(`Switched ${enabled ? 'on' : 'off'} ${what}.`, { run: () => mutation.mutate({ ids: done, enabled: !enabled }) })
      }
    },
  })
  return { ...mutation, failed, dismiss: () => setFailed([]) }
}
