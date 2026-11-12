// Memory, variant "List" — axis: one filterable list, newest edits first,
// with the add box on top; edit happens in place in the row.
import { useDeferredValue, useState } from 'react'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { PageFrame } from '../tasks/frame'
import { AddMemory, CountBadge, FilterInput, MemoryActions, MemoryEditor, MemoryFacts, MemoryText, sourceOf, useForget, useMemoryData } from './shared'

export function ListVariant() {
  return (
    <PageFrame>
      <ListPage />
    </PageFrame>
  )
}

function ListPage() {
  const [filter, setFilter] = useState('')
  const { q, all, shown, byId } = useMemoryData(useDeferredValue(filter))
  const [editing, setEditing] = useState<number | null>(null)
  const forget = useForget(all.length)

  return (
    <ShellPage
      title="Memory"
      description="Facts and preferences every agent can recall. Agents add them when you say “remember…”; you can add, edit and forget them here. Never store secrets."
      back={<BackToAgents />}
    >
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError && all.length === 0 ? (
        <InPlaceError title="Couldn’t load memories" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : (
        <>
          <AddMemory count={all.length} />
          <section aria-labelledby="memories-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="memories-heading" className="flex items-baseline gap-2 text-[15px] font-semibold">
                Memories <CountBadge count={all.length} />
              </h2>
            </div>
            {all.length === 0 ? (
              <InPlaceEmpty title="No memories yet">Say “remember that…” in any topic, or add one above. Every agent reads them.</InPlaceEmpty>
            ) : (
              <>
                <FilterInput value={filter} onChange={setFilter} count={all.length} />
                {shown.length === 0 ? (
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
                    label="Memories"
                    items={shown}
                    itemKey={(m) => m.id}
                    estimate={130}
                    title={(m) =>
                      editing === m.id ? (
                        <div className="font-normal">
                          <MemoryEditor memory={m} onDone={() => setEditing(null)} />
                        </div>
                      ) : (
                        <div className="font-normal">
                          <MemoryText memory={m} />
                        </div>
                      )
                    }
                    meta={(m) => <MemoryFacts memory={m} source={sourceOf(m, byId)} />}
                    actions={(m) => (editing === m.id ? null : <MemoryActions onEdit={() => setEditing(m.id)} onForget={() => forget.ask(m)} />)}
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
