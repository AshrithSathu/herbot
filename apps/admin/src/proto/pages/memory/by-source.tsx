// Memory, variant "By source" — axis: grouped by where each memory came
// from (the topic that saved it, the panel, a deleted topic). One row per
// source, virtualized; its memories inside; most recently changed first.
import { useDeferredValue, useMemo, useState } from 'react'
import type { Memory } from '../../../api'
import { exact } from '../../../format'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { PageFrame } from '../tasks/frame'
import { AddMemory, CountBadge, FilterInput, MemoryActions, MemoryEditor, MemoryText, SourceLabel, sourceKey, sourceOf, useForget, useMemoryData, type Source } from './shared'

type Group = { key: string; source: Source; memories: Memory[] }

export function BySourceVariant() {
  return (
    <PageFrame>
      <BySourcePage />
    </PageFrame>
  )
}

function BySourcePage() {
  const [filter, setFilter] = useState('')
  const { q, all, shown, byId } = useMemoryData(useDeferredValue(filter))
  const [editing, setEditing] = useState<number | null>(null)
  const forget = useForget(all.length)
  const groups = useMemo(() => {
    const map = new Map<string, Group>()
    for (const m of shown) {
      const source = sourceOf(m, byId)
      const key = sourceKey(source)
      let g = map.get(key)
      if (!g) map.set(key, (g = { key, source, memories: [] }))
      g.memories.push(m)
    }
    // `shown` is newest-edited first, so each group's first memory is its newest.
    return [...map.values()]
  }, [shown, byId])

  return (
    <ShellPage
      title="Memory"
      description="What every agent remembers, by where it came from. Agents add memories when you say “remember…”; never store secrets."
      back={<BackToAgents />}
    >
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError && all.length === 0 ? (
        <InPlaceError title="Couldn’t load memories" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : (
        <>
          <AddMemory count={all.length} />
          <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="sources-heading" className="flex items-baseline gap-2 text-[15px] font-semibold">
                Memories <CountBadge count={all.length} />
              </h2>
              <span className="text-[13px] text-mute tabular-nums">from {exact(groups.length)} {groups.length === 1 ? 'source' : 'sources'}</span>
            </div>
            {all.length === 0 ? (
              <InPlaceEmpty title="No memories yet">Say “remember that…” in any topic, or add one above. Every agent reads them.</InPlaceEmpty>
            ) : (
              <>
                <FilterInput value={filter} onChange={setFilter} count={all.length} />
                {groups.length === 0 ? (
                  <InPlaceEmpty
                    title="No memory matches that"
                    action={
                      <Button variant="secondary" onClick={() => setFilter('')}>
                        Clear filter
                      </Button>
                    }
                  />
                ) : (
                  <ThreadList
                    label="Memories by source"
                    items={groups}
                    itemKey={(g) => g.key}
                    estimate={170}
                    title={(g) => (
                      <span className="flex min-w-0 items-baseline gap-1 text-[14px] font-semibold">
                        <SourceLabel source={g.source} capital />
                      </span>
                    )}
                    aside={(g) => (
                      <span className="text-[13px] text-mute tabular-nums">
                        {exact(g.memories.length)} {g.memories.length === 1 ? 'memory' : 'memories'}
                      </span>
                    )}
                    body={(g) => (
                      <ol className="mt-1 flex flex-col">
                        {g.memories.map((m) => (
                          <li key={m.id} className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-1">
                            {editing === m.id ? (
                              <MemoryEditor memory={m} onDone={() => setEditing(null)} />
                            ) : (
                              <>
                                <MemoryText memory={m} />
                                <div className="relative z-[1] -mx-2 flex flex-wrap items-center gap-1">
                                  <span className="px-2 text-[12.5px] text-faint tabular-nums">#{m.id}</span>
                                  <MemoryActions onEdit={() => setEditing(m.id)} onForget={() => forget.ask(m)} />
                                </div>
                              </>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  />
                )}
              </>
            )}
          </section>
        </>
      )}
      {forget.dialog}
    </ShellPage>
  )
}
